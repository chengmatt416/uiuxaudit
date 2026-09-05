import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { launchHeadless } from "../packages/core/src/launcher.js";
import { Cdp } from "../packages/core/src/cdp.js";

/**
 * Headless smoke test for the web UI: loads dist/index.html in real Chromium,
 * feeds it the example.com capture through the scripted hook, screenshots the
 * result, and fails on any page exception or empty canvas.
 */
const root = resolve(".");
const url = "file://" + root + "/apps/web/dist/index.html";

if (!existsSync(".uiuxaudit/out/example.capture.json")) {
  execSync("npx tsx packages/cli/src/cli.ts convert https://example.com --name example", { stdio: "inherit" });
}
const capture = readFileSync(".uiuxaudit/out/example.capture.json", "utf8");

const browser = await launchHeadless();
let cdp: Cdp | undefined;
try {
  const res = await fetch(
    `http://127.0.0.1:${browser.port}/json/new?` + encodeURIComponent("about:blank"),
    { method: "PUT" },
  );
  const target = (await res.json()) as { webSocketDebuggerUrl: string };
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 860,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const errors: string[] = [];
  cdp.on("Runtime.exceptionThrown", (p) => {
    errors.push(JSON.stringify(p));
  });

  const loaded = Promise.withResolvers<void>();
  cdp.on("Page.loadEventFired", () => loaded.resolve());
  await cdp.send("Page.navigate", { url });
  await loaded.promise;

  const evalJs = async <T>(expression: string): Promise<T> => {
    const r = await cdp!.send<{
      result?: { value?: unknown };
      exceptionDetails?: { exception?: { description?: string } };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
    return r.result?.value as T;
  };

  // Feed the capture through the same path a user file-drop would take.
  const nodeCount = await evalJs<number>(
    `window.__ua.loadJSON(${JSON.stringify(capture)}).then(() =>
       document.querySelectorAll("#canvas .node").length)`,
  );
  const meta = await evalJs<string>(
    `document.getElementById("meta")?.textContent ?? ""`,
  );
  const suggFirst = await evalJs<string>(
    `document.querySelector("#suggList li")?.textContent?.slice(0, 90) ?? ""`,
  );

  if (!(nodeCount > 0)) throw new Error("canvas rendered no nodes");
  if (!meta.includes("example")) throw new Error("meta line not populated: " + meta);

  mkdirSync("apps/web/dist", { recursive: true });
  const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync("apps/web/dist/ui-smoke.png", Buffer.from(shot.data, "base64"));

  if (errors.length) {
    console.error("page exceptions:", errors.slice(0, 3));
    process.exit(1);
  }
  console.log(
    JSON.stringify({ nodeCount, meta, firstSuggestion: suggFirst }, null, 2),
  );
  console.log("UI_SMOKE_OK → apps/web/dist/ui-smoke.png");
} finally {
  cdp?.close();
  browser.close();
}
