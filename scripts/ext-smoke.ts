import { resolve } from "node:path";
import { launchHeadless } from "../packages/core/src/launcher.js";
import { Cdp } from "../packages/core/src/cdp.js";

/** End-to-end extension smoke: load unpacked build, capture example.com
 *  through the background worker, assert a full CaptureDoc comes back. */
const extDir = resolve("apps/extension/dist/chrome");
const browser = await launchHeadless({
  extraArgs: [
    `--load-extension=${extDir}`,
    `--disable-extensions-except=${extDir}`,
  ],
});
let cdp: Cdp | undefined;
try {
  // Discover the extension id from the background service worker target.
  const listRes = await fetch(`http://127.0.0.1:${browser.port}/json/list`);
  const targets = (await listRes.json()) as Array<{ url: string; type: string }>;
  const sw = targets.find(
    (t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://"),
  );
  if (!sw) throw new Error("extension service worker not found; targets=" + JSON.stringify(targets.slice(0, 6)));
  const extId = sw.url.split("/")[2];
  console.log("extension id:", extId);

  const openTab = async (url: string) => {
    const r = await fetch(
      `http://127.0.0.1:${browser.port}/json/new?` + encodeURIComponent(url),
      { method: "PUT" },
    );
    const t = (await r.json()) as { webSocketDebuggerUrl: string };
    const c = await Cdp.connect(t.webSocketDebuggerUrl);
    await c.send("Page.enable");
    const loaded = Promise.withResolvers<void>();
    c.on("Page.loadEventFired", () => loaded.resolve());
    return { c, loaded: loaded.promise };
  };

  // 1. target page
  const page = await openTab("https://example.com/");
  await page.loaded;

  // 2. workbench page
  const app = await openTab(`chrome-extension://${extId}/index.html`);
  await app.loaded;
  await new Promise((r) => setTimeout(r, 400));

  const evalJs = async <T>(expression: string): Promise<T> => {
    const r = await app.c.send<{
      result?: { value?: unknown };
      exceptionDetails?: { exception?: { description?: string } };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
    }
    return r.result?.value as T;
  };

  const summary = await evalJs<Record<string, unknown>>(
    `new Promise((res, rej) => {
      const timeout = setTimeout(() => rej(new Error("capture timeout 30s")), 30000);
      chrome.tabs.query({ url: "*://example.com/*" }, (ts) => {
        if (!ts.length) { clearTimeout(timeout); return res({ ok: false, error: "example tab not found" }); }
        chrome.storage.session.set({ lastTabId: ts[0].id }, () => {
          chrome.runtime.sendMessage({ type: "CAPTURE_TAB" }, (r) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) return res({ ok: false, error: chrome.runtime.lastError.message });
            if (!r || !r.ok) return res({ ok: false, error: r && r.error });
            res({
              ok: true,
              slug: r.doc.slug,
              url: r.doc.url,
              nodes: r.doc.nodes.length,
              images: r.doc.nodes.filter((n) => n.kind === "image").length,
              texts: r.doc.nodes.filter((n) => n.kind === "text").length,
            });
          });
        });
      });
    })`,
  );
  console.log("capture result:", summary);
  if (!summary["ok"]) throw new Error("capture failed: " + summary["error"]);
  if (!(Number(summary["nodes"]) > 0)) throw new Error("zero nodes captured");
  if (String(summary["url"]).includes("example.com") === false) {
    throw new Error("captured wrong url: " + summary["url"]);
  }
  console.log("EXT_SMOKE_OK");
  page.c.close();
  app.c.close();
} finally {
  cdp?.close();
  browser.close();
}
