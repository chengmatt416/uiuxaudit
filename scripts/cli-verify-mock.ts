import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { CaptureDoc } from "../packages/core/src/index.js";

/**
 * CLI-level verify proof — Android-safe topology.
 *
 * On this device a spawned process CANNOT connect to a listener owned by its
 * parent, so the mock Figma API runs in its OWN spawned node process and the
 * CLI-under-test connects to that (child → child is allowed).
 */

const doc = JSON.parse(
  readFileSync(".uiuxaudit/out/example.capture.json", "utf8"),
) as CaptureDoc;
const KEY = "mockkey123";

interface RestNode {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox: { x: number; y: number; width: number; height: number };
  fills: Array<{ type: string; opacity: number; color: { r: number; g: number; b: number } }>;
  characters?: string;
  fontSize?: number;
}

const children: RestNode[] = doc.nodes.map((n, i) => ({
  id: `10:${i}`,
  name: n.id,
  type: n.kind === "text" ? "TEXT" : "RECTANGLE",
  absoluteBoundingBox: { x: n.x, y: n.y, width: n.w, height: n.h },
  fills:
    n.kind === "text"
      ? n.textColor
        ? [{ type: "SOLID", opacity: n.textColor.a, color: { ...n.textColor } }]
        : []
      : n.bgColor
        ? [{ type: "SOLID", opacity: n.bgColor.a, color: { ...n.bgColor } }]
        : [],
  ...(n.kind === "text" ? { characters: n.text, fontSize: n.fontSize } : {}),
}));

const root: RestNode & { children: RestNode[] } = {
  id: "1:2",
  name: `page:${doc.slug}`,
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: doc.docWidth, height: doc.docHeight },
  fills: [{ type: "SOLID", opacity: 1, color: { r: 1, g: 1, b: 1 } }],
  children,
};

const fixturePath = ".uiuxaudit/out/mock-figma-fixture.json";
writeFileSync(fixturePath, JSON.stringify({ key: KEY, root }));

const serverCode = [
  'const http = require("http");',
  'const fs = require("fs");',
  'const { key, root } = JSON.parse(fs.readFileSync(process.env.UA_FIXTURE, "utf8"));',
  "const server = http.createServer((req, res) => {",
  '  const url = (req.url || "").split("?")[0];',
  '  if (url === "/v1/files/" + key || url === "/files/" + key) {',
  '    res.writeHead(200, { "Content-Type": "application/json" });',
  '    res.end(JSON.stringify({ document: { id: "0:0", name: "t", type: "DOCUMENT",',
  '      children: [{ id: "0:1", name: "Page 1", type: "CANVAS", children: [root] }] } }));',
  "    return;",
  "  }",
  '  if (url === "/v1/files/" + key + "/nodes" || url === "/files/" + key + "/nodes") {',
  '    res.writeHead(200, { "Content-Type": "application/json" });',
  '    res.end(JSON.stringify({ nodes: { [root.id]: { document: root } } }));',
  "    return;",
  "  }",
  "  res.writeHead(404);",
  '  res.end("{}");',
  "});",
  'server.listen(0, "127.0.0.1", () => console.log("MOCKPORT=" + server.address().port));',
].join("\n");

const serverProc = spawn("node", ["-e", serverCode], {
  env: { ...process.env, UA_FIXTURE: fixturePath },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverStderr = "";
serverProc.stderr?.on("data", (d) => {
  serverStderr += String(d);
});

const port = await new Promise<number>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("mock server startup timeout")), 15_000);
  serverProc.stdout?.on("data", (d) => {
    const m = String(d).match(/MOCKPORT=(\d+)/);
    if (m) {
      clearTimeout(timer);
      resolve(parseInt(m[1], 10));
    }
  });
  serverProc.on("exit", (c) =>
    reject(new Error("mock server exited " + c + ": " + serverStderr.slice(0, 400))),
  );
});

const base = `http://127.0.0.1:${port}`;
console.error("[mock] child server on", base);

const run = (args: string[]) =>
  execFileSync("npx", ["tsx", ...args], {
    env: { ...process.env, FIGMA_TOKEN: "test-token", UA_FIGMA_API: base },
    encoding: "utf8",
    timeout: 30_000,
  });

run([
  "packages/cli/src/cli.ts",
  "register",
  doc.slug,
  "--link",
  `https://www.figma.com/design/${KEY}/x`,
]);

const out = run(["packages/cli/src/cli.ts", "verify", doc.slug]);
console.log(out.trim());
serverProc.kill();
if (!out.includes("→ PASS") || !out.includes("100.00%")) {
  throw new Error("expected PASS at full coverage");
}
console.log("CLI_VERIFY_MOCK_OK");
