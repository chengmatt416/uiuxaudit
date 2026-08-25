import {
  applyFixesToDoc,
  fixesToFigmaOps,
  suggestFor,
  verifyCapture,
} from "@ua/core/browser";
import type {
  CaptureDoc,
  Suggestion,
  VerifyReport,
} from "@ua/core";
// ---------- dom ----------
// ---------- desktop (Electron) mode: full pipeline via IPC ----------
interface DesktopBridge {
  convert(opts: {
    url: string;
    name?: string;
    viewportWidth?: number;
    viewportHeight?: number;
  }): Promise<{ ok: boolean; doc?: CaptureDoc; error?: string }>;
  verify(opts: {
    token: string;
    fileKey: string;
    capture: CaptureDoc;
  }): Promise<{ ok: boolean; report?: VerifyReport; error?: string }>;
  chromiumPath(): Promise<{ ok: boolean; path?: string; error?: string }>;
}
// preload exposes uaDesktop; DOM lib has no typing — one named widening.
const uaDesktop = (globalThis as { uaDesktop?: DesktopBridge }).uaDesktop;
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error("missing #" + id);
  return el as T;
};
const meta = $("meta");
const stage = $("stage");
const wrap = $("canvasWrap");
const canvas = $("canvas");
const dropHint = $("dropHint");
const fileInput = $<HTMLInputElement>("file");
const verifyBtn = $<HTMLButtonElement>("verifyBtn");
const captureTabBtn = $<HTMLButtonElement>("captureTabBtn");
const list = $<HTMLOListElement>("suggList");
const selCount = $("selCount");
const selAll = $<HTMLButtonElement>("selAll");
const selNone = $<HTMLButtonElement>("selNone");
const applyBtn = $<HTMLButtonElement>("applyBtn");
const dlOps = $<HTMLAnchorElement>("dlOps");
const dlApplied = $<HTMLAnchorElement>("dlApplied");
const verifyPanel = $("verifyPanel");
const tokInput = $<HTMLInputElement>("tok");
const fkeyInput = $<HTMLInputElement>("fkey");
const useAppliedCb = $<HTMLInputElement>("useApplied");
const runVerifyBtn = $<HTMLButtonElement>("runVerify");
const verifyOut = $("verifyOut");

// ---------- state ----------
let doc: CaptureDoc | null = null;
let appliedDoc: CaptureDoc | null = null;
let suggestions: Suggestion[] = [];
const checked = new Set<string>();

function toast(msg: string): void {
  const t = document.createElement("div");
  t.id = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- loading ----------
async function loadFile(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as CaptureDoc;
    if (parsed?.version !== 1 || !Array.isArray(parsed.nodes)) {
      throw new Error("not a uiuxaudit capture (version/nodes missing)");
    }
    doc = parsed;
    appliedDoc = null;
    useAppliedCb.checked = false;
    useAppliedCb.disabled = true;
    suggestions = suggestFor(doc);
    checked.clear();
    meta.textContent = `${doc.slug} · ${doc.url} · ${doc.nodes.length} nodes · ${doc.docWidth}×${doc.docHeight}`;
    stage.classList.add("hasdoc");
    verifyBtn.hidden = false;
    dlOps.hidden = true;
    dlApplied.hidden = true;
    renderCanvas();
    renderSuggestions();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void loadFile(f);
});

for (const ev of ["dragover", "dragenter"] as const) {
  stage.addEventListener(ev, (e) => {
    e.preventDefault();
    dropHint.classList.add("drag");
  });
}
for (const ev of ["dragleave", "drop"] as const) {
  stage.addEventListener(ev, (e) => {
    e.preventDefault();
    dropHint.classList.remove("drag");
  });
}
stage.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadFile(f);
});

// ---------- canvas rendering ----------
const MAX_RENDERED_NODES = 8000;

function cssColor(c: { r: number; g: number; b: number; a: number }): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return c.a >= 1
    ? "#" + h(c.r) + h(c.g) + h(c.b)
    : `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
}

function renderCanvas(): void {
  if (!doc) return;
  canvas.textContent = "";
  const scale = Math.min(1, (stage.clientWidth - 24) / doc.docWidth);
  wrap.style.transform = `scale(${scale})`;
  wrap.style.width = doc.docWidth + "px";
  wrap.style.height = doc.docHeight + "px";
  canvas.style.position = "relative";

  const frag = document.createDocumentFragment();
  const nodes = doc.nodes.slice(0, MAX_RENDERED_NODES);
  for (const n of nodes) {
    const el = document.createElement("div");
    el.className = "node" + (n.kind === "text" ? " text" : "");
    el.dataset["id"] = n.id;
    Object.assign(el.style, {
      left: n.x + "px",
      top: n.y + "px",
      width: Math.max(n.w, 1) + "px",
      height: Math.max(n.h, 1) + "px",
      opacity: String(n.opacity ?? 1),
    });
    if (n.kind === "text") {
      el.style.color = n.textColor ? cssColor(n.textColor) : "#000";
      el.style.fontSize = (n.fontSize ?? 16) + "px";
      el.style.fontWeight = String(n.fontWeight ?? 400);
      el.style.lineHeight = n.lineHeight ? n.lineHeight + "px" : "normal";
      el.style.textAlign = (n.textAlign ?? "LEFT").toLowerCase() === "center"
        ? "center"
        : (n.textAlign ?? "").toLowerCase() === "right" ? "right" : "left";
      el.textContent = n.text ?? "";
    } else if (n.kind === "image") {
      el.style.background =
        n.imageDataUrl
          ? `center/cover no-repeat url("${n.imageDataUrl}")`
          : "#8a8f98";
    } else if (n.kind === "vector") {
      el.style.outline = "1px dashed #5a6472";
    } else {
      if (n.bgColor && n.bgColor.a > 0) el.style.background = cssColor(n.bgColor);
      if (n.border && n.border.width > 0) {
        el.style.borderStyle = "solid";
        el.style.borderWidth = n.border.width + "px";
        el.style.borderColor = cssColor(n.border.color);
      }
    }
    if (n.radii) {
      const [tl, tr, br, bl] = n.radii;
      el.style.borderRadius = `${tl}px ${tr}px ${br}px ${bl}px`;
    }
    el.addEventListener("click", () => {
      for (const hot of canvas.querySelectorAll(".hot")) hot.classList.remove("hot");
      el.classList.add("hot");
      toast(`${n.id} <${n.tag.toLowerCase()}> ${Math.round(n.w)}×${Math.round(n.h)} @ ${Math.round(n.x)},${Math.round(n.y)}`);
    });
    frag.appendChild(el);
  }
  canvas.appendChild(frag);
  if (doc.nodes.length > MAX_RENDERED_NODES) {
    toast(`rendered first ${MAX_RENDERED_NODES} of ${doc.nodes.length} nodes`);
  }
}

window.addEventListener("resize", () => { if (doc) renderCanvas(); });

// ---------- suggestions ----------
function severityChip(sev: Suggestion["severity"]): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "sev " + sev;
  chip.textContent = sev.toUpperCase();
  return chip;
}

function updateCount(): void {
  selCount.textContent = `${checked.size}/${suggestions.length} selected`;
  applyBtn.disabled = checked.size === 0;
  for (const li of list.children) {
    const cb = li.querySelector<HTMLInputElement>("input");
    if (cb && cb.dataset["sid"]) cb.checked = checked.has(cb.dataset["sid"]);
  }
}

function renderSuggestions(): void {
  list.textContent = "";
  const frag = document.createDocumentFragment();
  suggestions.forEach((s) => {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.disabled = s.fixes.length === 0;
    cb.dataset["sid"] = s.id;
    if (s.fixes.length === 0) cb.title = "report-only finding (no automated fix)";
    cb.addEventListener("change", () => {
      if (cb.checked) checked.add(s.id);
      else checked.delete(s.id);
      updateCount();
    });
    li.appendChild(cb);
    li.appendChild(severityChip(s.severity));
    const rule = document.createElement("span");
    rule.className = "rule";
    rule.textContent = s.rule;
    li.appendChild(rule);
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = s.message +
      (s.fixes.length ? "" : "  · report only");
    msg.addEventListener("click", () => {
      const target = doc?.nodes.find((n) => n.id === s.targetIds[0]);
      if (!target) return;
      for (const hot of canvas.querySelectorAll(".hot")) hot.classList.remove("hot");
      const el = canvas.querySelector<HTMLElement>(`[data-id="${target.id}"]`);
      if (el) {
        el.classList.add("hot");
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    li.appendChild(msg);
    if (checked.has(s.id)) cb.checked = true;
    frag.appendChild(li);
  });
  list.appendChild(frag);
  updateCount();
}

selAll.addEventListener("click", () => {
  for (const s of suggestions) if (s.fixes.length) checked.add(s.id);
  updateCount();
});
selNone.addEventListener("click", () => {
  checked.clear();
  updateCount();
});

// ---------- apply ----------
applyBtn.addEventListener("click", () => {
  if (!doc) return;
  const chosen = suggestions.filter((s) => checked.has(s.id));
  const fixes = chosen.flatMap((s) => s.fixes);
  if (!fixes.length) {
    toast("selected findings carry no automated fixes");
    return;
  }
  const ops = fixesToFigmaOps(fixes);
  appliedDoc = applyFixesToDoc(doc, fixes);
  download(`${doc.slug}.ops.json`, { slug: doc.slug, ops });
  download(`${doc.slug}.applied.capture.json`, appliedDoc);
  dlOps.href = URL.createObjectURL(
    new Blob([JSON.stringify({ slug: doc.slug, ops }, null, 2)], { type: "application/json" }),
  );
  dlApplied.href = URL.createObjectURL(
    new Blob([JSON.stringify(appliedDoc, null, 2)], { type: "application/json" }),
  );
  dlOps.hidden = false;
  dlApplied.hidden = false;
  useAppliedCb.disabled = false;
  useAppliedCb.checked = true;
  toast(`${ops.length} ops generated — run plugin Apply mode, then Verify`);
});

// ---------- verify ----------
const LS_TOK = "ua.token";
const LS_KEY = "ua.filekey";
tokInput.value = localStorage.getItem(LS_TOK) ?? "";
fkeyInput.value = localStorage.getItem(LS_KEY) ?? "";

verifyBtn.addEventListener("click", () => {
  verifyPanel.hidden = !verifyPanel.hidden;
});

runVerifyBtn.addEventListener("click", async () => {
  if (!doc) {
    toast("load a capture first");
    return;
  }
  const token = tokInput.value.trim();
  const fileKey = fkeyInput.value.trim().match(/([A-Za-z0-9]{6,})\s*$/)?.[1] ?? fkeyInput.value.trim();
  if (!token || !fileKey) {
    toast("token and file key required");
    return;
  }
  localStorage.setItem(LS_TOK, token);
  localStorage.setItem(LS_KEY, fileKey);
  const baseline = useAppliedCb.checked && appliedDoc ? appliedDoc : doc;
  runVerifyBtn.disabled = true;
  verifyOut.textContent = `verifying ${baseline.slug} vs ${useAppliedCb.checked && appliedDoc ? "applied" : "original"} baseline…`;
  try {
    let report: VerifyReport;
    if (uaDesktop) {
      const r = await uaDesktop.verify({ token, fileKey, capture: baseline });
      if (!r.ok || !r.report) throw new Error(r.error ?? "bridge verify failed");
      report = r.report;
    } else {
      report = await verifyCapture({ token, fileKey, capture: baseline });
    }
    const badge = document.createElement("span");
    badge.className = "badge " + (report.passed ? "pass" : "fail");
    badge.textContent = report.passed ? "PASS" : "FAIL";
    const lines: string[] = [
      `coverage ${(report.coverage * 100).toFixed(2)}% (${report.found}/${report.total})`,
      `mismatches: ${report.mismatches.length}`,
      ...report.mismatches.slice(0, 30).map(
        (m) =>
          `${m.id.padEnd(8)} ${m.field.padEnd(11)} expected=${m.expected} actual=${m.actual}` +
          (m.delta !== undefined ? ` Δ=${m.delta}` : ""),
      ),
      ...(report.mismatches.length > 30 ? [`… +${report.mismatches.length - 30} more`] : []),
    ];
    verifyOut.textContent = "";
    verifyOut.appendChild(badge);
    verifyOut.appendChild(document.createTextNode("\n" + lines.join("\n")));
  } catch (e) {
    verifyOut.textContent = "verify failed: " + (e instanceof Error ? e.message : String(e));
  } finally {
    runVerifyBtn.disabled = false;
  }
});

// Scripted hook used by headless UI smoke tests and the desktop shell.
(window as unknown as Record<string, unknown>)["__ua"] = {
  loadJSON(text: string): Promise<void> {
    return loadFile(new File([text], "smoke.capture.json", { type: "application/json" }));
  },
};
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// ---------- extension mode: capture the tab the user came from ----------
interface CaptureResponse {
  ok: boolean;
  doc?: CaptureDoc;
  error?: string;
}
interface ExtRuntime {
  id?: string;
  lastError?: { message: string };
  sendMessage?: (msg: { type: "CAPTURE_TAB" }, cb: (resp?: CaptureResponse) => void) => void;
}
interface ExtGlobal {
  chrome?: { runtime?: ExtRuntime };
}
// DOM lib has no chrome typing; one named widening, guarded before every use.
const extGlobal = globalThis as ExtGlobal;
const extRuntime = extGlobal.chrome?.runtime;
if (extRuntime?.id && typeof extRuntime.sendMessage === "function") {
  captureTabBtn.hidden = false;
  captureTabBtn.addEventListener("click", () => {
    captureTabBtn.disabled = true;
    extRuntime.sendMessage!({ type: "CAPTURE_TAB" }, (resp?: CaptureResponse) => {
      captureTabBtn.disabled = false;
      const err = extRuntime.lastError?.message ?? resp?.error;
      if (err || !resp?.ok || !resp.doc) {
        toast("capture failed: " + (err ?? "unknown"));
        return;
      }
      void loadFile(
        new File([JSON.stringify(resp.doc)], (resp.doc.slug || "tab") + ".capture.json", {
          type: "application/json",
        }),
      );
    });
  });
}

const convUrlInput = $<HTMLInputElement>("convUrl");
const convBtn = $<HTMLButtonElement>("convBtn");
if (uaDesktop) {
  convUrlInput.hidden = false;
  convBtn.hidden = false;
  void uaDesktop.chromiumPath?.().then((r) => {
    if (!r.ok) toast("convert disabled — " + r.error);
  });
  const runConvert = async () => {
    const url = convUrlInput.value.trim();
    if (!/^https?:\/\//.test(url)) {
      toast("enter an http(s) URL");
      return;
    }
    convBtn.disabled = true;
    convBtn.textContent = "Capturing…";
    const r = await uaDesktop.convert({ url });
    convBtn.disabled = false;
    convBtn.textContent = "Convert";
    if (!r.ok || !r.doc) {
      toast("convert failed: " + (r.error ?? "unknown"));
      return;
    }
    await loadFile(
      new File([JSON.stringify(r.doc)], (r.doc.slug || "page") + ".capture.json", {
        type: "application/json",
      }),
    );
  };
  convBtn.addEventListener("click", () => void runConvert());
  convUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void runConvert();
  });
}
