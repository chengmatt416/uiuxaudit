/* uiuxaudit extension background — MV3 (Chrome service worker / Firefox event page).
 * Flow: action click stores the target tab, opens the audit workbench tab.
 * The workbench sends CAPTURE_TAB; we inject the extractor, inline images,
 * and reply with a complete CaptureDoc. Zero network beyond the page itself.
 */

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 48 * 1024 * 1024;

function toBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function slugify(text) {
  return String(text || "tab")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "tab";
}

async function resolveTabId(msg) {
  if (typeof msg.tabId === "number") return msg.tabId;
  const stored = await chrome.storage.session.get("lastTabId");
  if (typeof stored.lastTabId === "number") return stored.lastTabId;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active ? active.id : undefined;
}

async function captureTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["extractor.js"],
  });
  const [run] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.uaExt.default(false),
  });
  const raw = run && run.result;
  if (!raw || !Array.isArray(raw.nodes)) throw new Error("extractor returned nothing (restricted page?)");

  const tab = await chrome.tabs.get(tabId);
  const dataUrls = {};
  let total = 0;
  const urls = Array.from(new Set(raw.imageUrls || []));
  for (const u of urls) {
    if (total > MAX_TOTAL_IMAGE_BYTES) break;
    try {
      const r = await fetch(u, { credentials: "include" });
      const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!r.ok || !ct.startsWith("image/") || ct.includes("svg")) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) continue;
      dataUrls[u] = `data:${ct};base64,` + toBase64(buf);
      total += buf.length;
    } catch {
      /* blocked image → gray fallback in the canvas */
    }
  }

  const nodes = raw.nodes.map((n) => {
    if (n.imageUrl && dataUrls[n.imageUrl]) n.imageDataUrl = dataUrls[n.imageUrl];
    return n;
  });

  return {
    version: 1,
    slug: slugify(raw.title),
    url: tab ? tab.url : "",
    title: raw.title || "",
    viewportWidth: 1280,
    viewportHeight: 800,
    docWidth: raw.docWidth,
    docHeight: raw.docHeight,
    rootBg: raw.rootBg || undefined,
    nodes,
    capturedAt: new Date().toISOString(),
  };
}

chrome.action.onClicked.addListener((tab) => {
  if (tab && typeof tab.id === "number") {
    chrome.storage.session.set({ lastTabId: tab.id });
  }
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "CAPTURE_TAB") return undefined;
  resolveTabId(msg)
    .then((tabId) => {
      if (typeof tabId !== "number") throw new Error("no target tab");
      return captureTab(tabId);
    })
    .then((doc) => sendResponse({ ok: true, doc }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});
