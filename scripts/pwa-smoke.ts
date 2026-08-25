import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { launchHeadless } from "../packages/core/src/launcher.js";
import { Cdp } from "../packages/core/src/cdp.js";

/** PWA smoke: serve dist over localhost, assert manifest + active service worker. */
const root = "apps/web/dist";
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};
const server = createServer((req, res) => {
  const p = join(root, (req.url ?? "/").split("?")[0].replace(/^\//, "") || "index.html");
  try {
    res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(readFileSync(p));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.on("listening", r));
const port = (server.address() as AddressInfo).port;

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
  const loaded = Promise.withResolvers<void>();
  cdp.on("Page.loadEventFired", () => loaded.resolve());
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
  await loaded.promise;
  await new Promise((r) => setTimeout(r, 800));

  const evalJs = async <T>(expression: string): Promise<T> => {
    const r = await cdp!.send<{
      result?: { value?: unknown };
      exceptionDetails?: { exception?: { description?: string } };
    }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval");
    return r.result?.value as T;
  };
  const swState = await evalJs<string>(
    `navigator.serviceWorker.getRegistrations().then(rs => rs.map(r => r.active?.state ?? r.installing?.state ?? "none").join(",") || "unregistered")`,
  );
  const manifest = await evalJs<string>(
    `fetch("./manifest.webmanifest").then(r => r.status)`,
  );
  const offline = await evalJs<string>(
    `caches.keys().then(ks => ks.join(","))`,
  );
  console.log({ swState, manifestHttp: manifest, caches: offline });
  if (swState === "unregistered" || swState === "") {
    throw new Error("service worker not registered");
  }
  if (manifest !== 200) throw new Error("manifest not served");
  console.log("PWA_SMOKE_OK");
} finally {
  cdp?.close();
  browser.close();
  server.close();
}
