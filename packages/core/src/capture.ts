import type {
  CaptureDoc,
  CaptureNode,
} from "./types.js";
import { Cdp } from "./cdp.js";
import { launchHeadless } from "./launcher.js";
import __ua_extract from "./extractor.js";
export interface CaptureOptions {
  viewportWidth?: number;
  viewportHeight?: number;
  slug?: string;
  projectDir?: string;
}

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 48 * 1024 * 1024;

interface RawExtract {
  title: string;
  docWidth: number;
  docHeight: number;
  rootBg: CaptureNode["effectiveBg"] | null;
  nodes: Array<Record<string, unknown>>;
  imageUrls: string[];
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}


async function evalExpr<T>(cdp: Cdp, expression: string): Promise<T> {
  const r = await cdp.send<{
    result: { value?: unknown };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      "Page evaluation failed: " +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text),
    );
  }
  return r.result.value as T;
}

/**
 * Captures a URL into a deterministic baseline JSON document using a locally
 * launched headless Chromium driven over raw CDP. No LLM tokens involved.
 */
export async function captureUrl(
  url: string,
  opts: CaptureOptions = {},
): Promise<CaptureDoc> {
  const viewportWidth = opts.viewportWidth ?? 1440;
  const viewportHeight = opts.viewportHeight ?? 900;
  const browser = await launchHeadless();
  let cdp: Cdp | undefined;
  try {
    // Create a fresh tab (Chrome >= 111 requires PUT; older builds accept GET).
    let target: { webSocketDebuggerUrl: string };
    const newTargetUrl =
      `http://127.0.0.1:${browser.port}/json/new?` + encodeURIComponent("about:blank");
    try {
      const res = await fetch(newTargetUrl, { method: "PUT" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      target = (await res.json()) as typeof target;
    } catch {
      const res = await fetch(newTargetUrl);
      target = (await res.json()) as typeof target;
    }

    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const { promise: loaded, resolve: markLoaded } = Promise.withResolvers<void>();
    cdp.on("Page.loadEventFired", () => markLoaded());
    await cdp.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(45_000)]);

    // Wait for readyState complete + fonts, then trigger lazy loads and settle.
    await evalExpr<void>(
      cdp,
      `(async () => {
        for (let i = 0; i < 60; i++) {
          if (document.readyState === "complete") break;
          await new Promise((r) => setTimeout(r, 250));
        }
        try { await document.fonts.ready; } catch {}
      })()`,
    );
    await evalExpr<void>(
      cdp,
      `(async () => {
        const h = Math.max(
          document.documentElement.scrollHeight,
          document.body ? document.body.scrollHeight : 0,
        );
        for (let y = 0; y < h; y += 800) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
        }
        window.scrollTo(0, 0);
      })()`,
    );
    await sleep(400);

    const expression = `(${__ua_extract.toString()})(${Boolean(opts.projectDir)})`;
    const raw = await evalExpr<RawExtract>(cdp, expression);

    // Fetch image bytes up front so the plugin never needs network access.
    const dataUrls: Record<string, string> = {};
    let total = 0;
    for (const u of raw.imageUrls) {
      if (total > MAX_TOTAL_IMAGE_BYTES) break;
      try {
        const resp = await fetch(u, {
          headers: { Accept: "image/*,*/*;q=0.8" },
          redirect: "follow",
          signal: AbortSignal.timeout(20_000),
        });
        if (!resp.ok) continue;
        const ct = (resp.headers.get("content-type") || "").split(";")[0].trim();
        if (!ct.startsWith("image/") || ct.includes("svg")) continue;
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) continue;
        dataUrls[u] = `data:${ct};base64,${buf.toString("base64")}`;
        total += buf.length;
      } catch {
        // unreachable/blocked image: falls back to gray fill in Figma
      }
    }

    const nodes = raw.nodes.map((n) => {
      const imageUrl = n["imageUrl"] as string | undefined;
      if (imageUrl && dataUrls[imageUrl]) n["imageDataUrl"] = dataUrls[imageUrl];
      return n as unknown as CaptureNode;
    });

    return {
      version: 1,
      slug: opts.slug ?? "page",
      url,
      title: raw.title,
      viewportWidth,
      viewportHeight,
      docWidth: raw.docWidth,
      docHeight: raw.docHeight,
      rootBg: raw.rootBg ?? undefined,
      projectDir: opts.projectDir,
      nodes,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    cdp?.close();
    browser.close();
  }
}
