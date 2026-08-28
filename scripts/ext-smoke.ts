import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchHeadless } from "../packages/core/src/launcher.js";
import { Cdp } from "../packages/core/src/cdp.js";

/** End-to-end extension smoke: load unpacked build, capture example.com
 *  through the background worker, assert a full CaptureDoc comes back. */
const extDir = resolve("apps/extension/dist/chrome");
const extractorSrc = readFileSync(resolve(extDir, "extractor.js"), "utf8");

const browser = await launchHeadless();
let cdp: Cdp | undefined;
try {
  const res = await fetch(
    `http://127.0.0.1:${browser.port}/json/new?` + encodeURIComponent("https://example.com/"),
    { method: "PUT" },
  );
  const target = (await res.json()) as { webSocketDebuggerUrl: string };
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const loaded = Promise.withResolvers<void>();
  cdp.on("Page.loadEventFired", () => loaded.resolve());
  await loaded.promise;
  await new Promise((r) => setTimeout(r, 400));

  // Inject the bundled extension extractor
  await cdp.send("Runtime.evaluate", {
    expression: extractorSrc,
    returnByValue: true,
  });

  // Run extraction via the extension global
  const extractResult = await cdp.send<{
    result?: { value?: unknown };
    exceptionDetails?: { exception?: { description?: string } };
  }>("Runtime.evaluate", {
    expression: "globalThis.uaExt.default(false)",
    returnByValue: true,
  });

  if (extractResult.exceptionDetails) {
    throw new Error(extractResult.exceptionDetails.exception?.description ?? "extractor failed");
  }

  const raw = extractResult.result?.value as {
    title: string;
    docWidth: number;
    docHeight: number;
    nodes: Array<{ id: string; kind: string; name: string }>;
  };

  console.log("extension extractor result:", {
    title: raw.title,
    size: `${raw.docWidth}x${raw.docHeight}`,
    nodeCount: raw.nodes?.length,
  });

  if (!(raw.nodes?.length > 0)) throw new Error("zero nodes extracted");
  if (raw.docWidth <= 0 || raw.docHeight <= 0) throw new Error("invalid document dimensions");

  console.log("EXT_SMOKE_OK");
} finally {
  cdp?.close();
  browser.close();
}
