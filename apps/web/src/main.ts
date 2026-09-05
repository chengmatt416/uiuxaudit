import {
  applyFixesToDoc,
  calculateAuditScore,
  extractTokens,
  fixesToFigmaOps,
  generateCssPatch,
  generateHtmlReport,
  suggestFor,
  tokensToCss,
  tokensToDtcg,
  verifyCapture,
} from "@ua/core/browser";
import type {
  AuditScore,
  CaptureDoc,
  CaptureNode,
  DesignTokens,
  Fix,
  Suggestion,
  VerifyReport,
} from "@ua/core";

// ---------- desktop (Electron) mode: full pipeline via IPC ----------
interface DesktopBridge {
  convert(opts: {
    url: string;
    name?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    projectDir?: string;
  }): Promise<{ ok: boolean; doc?: CaptureDoc; error?: string }>;
  verify(opts: {
    token: string;
    fileKey: string;
    capture: CaptureDoc;
  }): Promise<{ ok: boolean; report?: VerifyReport; error?: string }>;
  chromiumPath(): Promise<{ ok: boolean; path?: string; error?: string }>;
}
const uaDesktop = (globalThis as { uaDesktop?: DesktopBridge }).uaDesktop;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error("missing #" + id);
  return el as T;
};

// DOM elements
const meta = $("meta");
const stage = $("stage");
const stageToolbar = $("stageToolbar");
const wrap = $("canvasWrap");
const canvas = $("canvas");
const dropHint = $("dropHint");
const fileInput = $<HTMLInputElement>("file");
const presetSelect = $<HTMLSelectElement>("presetSelect");
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

// New toolbar & action elements
const tokensBtn = $<HTMLButtonElement>("tokensBtn");
const reportBtn = $<HTMLButtonElement>("reportBtn");
const copyCssBtn = $<HTMLButtonElement>("copyCssBtn");
const copyOpsBtn = $<HTMLButtonElement>("copyOpsBtn");
const scorecardBar = $("scorecardBar");
const scoreGauge = $("scoreGauge");
const healthScoreNum = $("healthScoreNum");
const healthScoreGrade = $("healthScoreGrade");
const healthScoreWcag = $("healthScoreWcag");
const btnFilterError = $<HTMLButtonElement>("btnFilterError");
const btnFilterWarn = $<HTMLButtonElement>("btnFilterWarn");
const btnFilterInfo = $<HTMLButtonElement>("btnFilterInfo");
const cntError = $("cntError");
const cntWarn = $("cntWarn");
const cntInfo = $("cntInfo");
const catA11yVal = $("catA11yVal");
const catA11yBar = $("catA11yBar");
const catTouchVal = $("catTouchVal");
const catTouchBar = $("catTouchBar");
const catTypoVal = $("catTypoVal");
const catTypoBar = $("catTypoBar");
const catLayoutVal = $("catLayoutVal");
const catLayoutBar = $("catLayoutBar");

const btnViewOrig = $<HTMLButtonElement>("btnViewOrig");
const btnViewApplied = $<HTMLButtonElement>("btnViewApplied");
const toggleOverlays = $<HTMLInputElement>("toggleOverlays");
const zoomOut = $<HTMLButtonElement>("zoomOut");
const zoomIn = $<HTMLButtonElement>("zoomIn");
const zoomReset = $<HTMLButtonElement>("zoomReset");
const zoomFit = $<HTMLButtonElement>("zoomFit");
const zoomLevel = $("zoomLevel");

const nodeInspector = $("nodeInspector");
const inspTag = $("inspTag");
const inspId = $("inspId");
const inspCoords = $("inspCoords");
const inspStyles = $("inspStyles");
const inspIssues = $("inspIssues");
const closeInsp = $<HTMLButtonElement>("closeInsp");

const filterBar = $("filterBar");
const suggFilter = $<HTMLInputElement>("suggFilter");
const filterChips = document.querySelectorAll<HTMLButtonElement>(".filter-chips-row .filter-chip");

// Tokens Modal elements
const tokensModal = $("tokensModal");
const tokensBackdrop = $("tokensBackdrop");
const closeTokensModal = $<HTMLButtonElement>("closeTokensModal");
const closeTokensFooter = $<HTMLButtonElement>("closeTokensFooter");
const tokenTabBody = $("tokenTabBody");
const copyTokenCssBtn = $<HTMLButtonElement>("copyTokenCssBtn");
const copyTokenDtcgBtn = $<HTMLButtonElement>("copyTokenDtcgBtn");
const tabColors = $<HTMLButtonElement>("tabColors");
const tabTypo = $<HTMLButtonElement>("tabTypo");
const tabSpacing = $<HTMLButtonElement>("tabSpacing");
const tabCss = $<HTMLButtonElement>("tabCss");
const tabDtcg = $<HTMLButtonElement>("tabDtcg");

// State
let doc: CaptureDoc | null = null;
let appliedDoc: CaptureDoc | null = null;
let suggestions: Suggestion[] = [];
let auditScore: AuditScore | null = null;
let designTokens: DesignTokens | null = null;
const checked = new Set<string>();

let viewMode: "orig" | "applied" = "orig";
let showOverlays = true;
let zoomFactor = 1.0;
let filterQuery = "";
let filterSeverity: "all" | "error" | "warn" | "info" = "all";
let activeTokenTab: "colors" | "typo" | "spacing" | "css" | "dtcg" = "colors";

function toast(msg: string): void {
  const existing = document.getElementById("toast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.id = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function copyToClipboard(text: string, okMsg: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast(okMsg),
    () => toast("Failed to copy to clipboard"),
  );
}

function download(name: string, data: unknown): void {
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const mime = typeof data === "string" ? "text/html" : "application/json";
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function cssColor(c: { r: number; g: number; b: number; a: number }): string {
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return c.a >= 1
    ? "#" + h(c.r) + h(c.g) + h(c.b)
    : `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
}

// ---------- scorecard ----------
function updateScorecard(): void {
  if (!doc || !auditScore) {
    scorecardBar.hidden = true;
    return;
  }
  scorecardBar.hidden = false;
  healthScoreNum.textContent = String(auditScore.score);
  healthScoreGrade.textContent = `Grade ${auditScore.grade}`;
  healthScoreWcag.textContent = `WCAG: ${auditScore.wcagLevel}`;
  cntError.textContent = `${auditScore.counts.error} errors`;
  cntWarn.textContent = `${auditScore.counts.warn} warnings`;
  cntInfo.textContent = `${auditScore.counts.info} info`;

  const scoreColor =
    auditScore.score >= 90
      ? "var(--color-success)"
      : auditScore.score >= 70
        ? "var(--color-warn)"
        : "var(--color-error)";
  healthScoreNum.style.color = scoreColor;
  scoreGauge.style.borderColor = scoreColor;
  scoreGauge.style.boxShadow = `0 0 12px ${
    auditScore.score >= 90
      ? "rgba(16, 185, 129, 0.3)"
      : auditScore.score >= 70
        ? "rgba(245, 158, 11, 0.3)"
        : "rgba(239, 68, 68, 0.3)"
  }`;

  catA11yVal.textContent = `${auditScore.byCategory.accessibility.score}%`;
  catA11yBar.style.width = `${auditScore.byCategory.accessibility.score}%`;

  catTouchVal.textContent = `${auditScore.byCategory.interaction.score}%`;
  catTouchBar.style.width = `${auditScore.byCategory.interaction.score}%`;

  catTypoVal.textContent = `${auditScore.byCategory.typography.score}%`;
  catTypoBar.style.width = `${auditScore.byCategory.typography.score}%`;

  catLayoutVal.textContent = `${auditScore.byCategory.layout.score}%`;
  catLayoutBar.style.width = `${auditScore.byCategory.layout.score}%`;
}

// ---------- loading ----------
function loadDoc(parsed: CaptureDoc): void {
  if (parsed?.version !== 1 || !Array.isArray(parsed.nodes)) {
    throw new Error("not a uiuxaudit capture (version/nodes missing)");
  }
  doc = parsed;
  appliedDoc = null;
  viewMode = "orig";
  btnViewOrig.classList.add("active");
  btnViewApplied.classList.remove("active");
  btnViewApplied.disabled = true;

  useAppliedCb.checked = false;
  useAppliedCb.disabled = true;
  suggestions = suggestFor(doc);
  auditScore = calculateAuditScore(doc, suggestions);
  designTokens = extractTokens(doc);

  checked.clear();
  meta.textContent = `${doc.slug} · ${doc.url || "local"} · ${doc.nodes.length} nodes · ${doc.docWidth}×${doc.docHeight}`;
  stage.classList.add("hasdoc");
  stageToolbar.hidden = false;
  filterBar.hidden = false;
  verifyBtn.hidden = false;
  tokensBtn.hidden = false;
  reportBtn.hidden = false;
  copyCssBtn.hidden = false;
  copyOpsBtn.hidden = false;
  dlOps.hidden = true;
  dlApplied.hidden = true;

  updateScorecard();
  applyZoom();
  renderCanvas();
  renderSuggestions();
}

async function loadFile(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as CaptureDoc;
    loadDoc(parsed);
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

// ---------- presets ----------
const PRESETS: Record<string, Partial<CaptureDoc>> = {
  example: {
    slug: "example",
    url: "https://example.com",
    title: "Example Domain",
    viewportWidth: 1440,
    viewportHeight: 900,
    docWidth: 1440,
    docHeight: 900,
    rootBg: { r: 0.933, g: 0.933, b: 0.933, a: 1 },
    nodes: [
      { id: "e1", tag: "BODY", kind: "frame", x: 288, y: 135, w: 864, h: 96, parent: null, effectiveBg: { r: 0.933, g: 0.933, b: 0.933, a: 1 }, opacity: 1, radii: [0,0,0,0], interactive: false, bgColor: { r: 0.933, g: 0.933, b: 0.933, a: 1 }, order: 0 },
      { id: "e2", tag: "H1", kind: "frame", x: 288, y: 135, w: 864, h: 28, parent: "e1", effectiveBg: { r: 0.933, g: 0.933, b: 0.933, a: 1 }, opacity: 0.8, radii: [0,0,0,0], interactive: false, order: 1 },
      { id: "e5", kind: "text", tag: "#text", x: 288, y: 135, w: 186, h: 28, text: "Example Domain", textColor: { r: 0, g: 0, b: 0, a: 1 }, effectiveBg: { r: 0.933, g: 0.933, b: 0.933, a: 1 }, fontSize: 24, fontWeight: 700, fontFamily: "system-ui", textAlign: "LEFT", opacity: 0.8, order: 2, parent: "e2" },
      { id: "e3", tag: "P", kind: "frame", x: 288, y: 179, w: 864, h: 18, parent: "e1", effectiveBg: { r: 0.933, g: 0.933, b: 0.933, a: 1 }, opacity: 0.8, radii: [0,0,0,0], interactive: false, order: 3 },
      { id: "e6", kind: "text", tag: "#text", x: 288, y: 179, w: 746, h: 18, text: "This domain is for use in documentation examples without needing permission. Avoid use in operations.", textColor: { r: 0, g: 0, b: 0, a: 1 }, effectiveBg: { r: 0.933, g: 0.933, b: 0.933, a: 1 }, fontSize: 16, fontWeight: 400, fontFamily: "system-ui", textAlign: "LEFT", opacity: 0.8, order: 4, parent: "e3" },
      { id: "e4", tag: "A", kind: "frame", x: 288, y: 213, w: 82, h: 18, parent: "e1", effectiveBg: { r: 0.933, g: 0.933, b: 0.933, a: 1 }, opacity: 0.8, radii: [0,0,0,0], interactive: true, order: 5 },
      { id: "e7", kind: "text", tag: "#text", x: 288, y: 213, w: 82, h: 18, text: "Learn more", textColor: { r: 0.2, g: 0.266, b: 0.533, a: 1 }, effectiveBg: { r: 0.933, g: 0.933, b: 0.933, a: 1 }, fontSize: 16, fontWeight: 400, fontFamily: "system-ui", textAlign: "LEFT", opacity: 0.8, order: 6, parent: "e4" },
    ],
  },
  saas: {
    slug: "saas",
    url: "https://app.cloudscale.io/dashboard",
    title: "CloudScale SaaS Analytics",
    viewportWidth: 1440,
    viewportHeight: 900,
    docWidth: 1440,
    docHeight: 900,
    rootBg: { r: 0.055, g: 0.067, b: 0.086, a: 1 },
    nodes: [
      { id: "s1", tag: "NAV", kind: "frame", x: 0, y: 0, w: 1440, h: 64, parent: null, bgColor: { r: 0.086, g: 0.106, b: 0.137, a: 1 }, effectiveBg: { r: 0.086, g: 0.106, b: 0.137, a: 1 }, order: 0 },
      { id: "s2", tag: "#text", kind: "text", x: 32, y: 20, w: 140, h: 24, text: "CloudScale UI", fontSize: 20, fontWeight: 700, textColor: { r: 0.9, g: 0.94, b: 1, a: 1 }, effectiveBg: { r: 0.086, g: 0.106, b: 0.137, a: 1 }, parent: "s1", order: 1 },
      { id: "s3", tag: "BUTTON", kind: "frame", x: 1320, y: 16, w: 88, h: 32, interactive: true, radii: [6,6,6,6], bgColor: { r: 0.3, g: 0.64, b: 1, a: 1 }, effectiveBg: { r: 0.3, g: 0.64, b: 1, a: 1 }, parent: "s1", order: 2 },
      { id: "s4", tag: "#text", kind: "text", x: 1336, y: 22, w: 56, h: 20, text: "Deploy", fontSize: 14, fontWeight: 600, textColor: { r: 0.02, g: 0.07, b: 0.12, a: 1 }, effectiveBg: { r: 0.3, g: 0.64, b: 1, a: 1 }, parent: "s3", order: 3 },
      { id: "s5", tag: "DIV", kind: "frame", x: 64, y: 120, w: 400, h: 180, parent: null, bgColor: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, radii: [8,8,8,8], order: 4 },
      { id: "s6", tag: "#text", kind: "text", x: 88, y: 144, w: 200, h: 16, text: "Total Workloads", fontSize: 13, fontWeight: 500, textColor: { r: 0.45, g: 0.48, b: 0.52, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, parent: "s5", order: 5 },
      { id: "s7", tag: "#text", kind: "text", x: 88, y: 172, w: 120, h: 44, text: "1,248", fontSize: 36, fontWeight: 800, textColor: { r: 1, g: 1, b: 1, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, parent: "s5", order: 6 },
      { id: "s8", tag: "DIV", kind: "frame", x: 500, y: 120, w: 400, h: 180, parent: null, bgColor: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, radii: [8,8,8,8], order: 7 },
      { id: "s9", tag: "#text", kind: "text", x: 524, y: 144, w: 200, h: 16, text: "Bandwidth Used", fontSize: 13, fontWeight: 500, textColor: { r: 0.45, g: 0.48, b: 0.52, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, parent: "s8", order: 8 },
      { id: "s10", tag: "#text", kind: "text", x: 524, y: 172, w: 140, h: 44, text: "42.8 TB", fontSize: 36, fontWeight: 800, textColor: { r: 0.18, g: 0.66, b: 0.42, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, parent: "s8", order: 9 },
    ],
  },
  mobile: {
    slug: "mobile",
    url: "https://m.walletflow.app/send",
    title: "WalletFlow Mobile Checkout",
    viewportWidth: 390,
    viewportHeight: 844,
    docWidth: 390,
    docHeight: 844,
    rootBg: { r: 0.07, g: 0.08, b: 0.1, a: 1 },
    nodes: [
      { id: "m1", tag: "HEADER", kind: "frame", x: 0, y: 0, w: 390, h: 60, parent: null, bgColor: { r: 0.1, g: 0.12, b: 0.15, a: 1 }, effectiveBg: { r: 0.1, g: 0.12, b: 0.15, a: 1 }, order: 0 },
      { id: "m2", tag: "#text", kind: "text", x: 20, y: 18, w: 120, h: 24, text: "Send Money", fontSize: 18, fontWeight: 700, textColor: { r: 1, g: 1, b: 1, a: 1 }, effectiveBg: { r: 0.1, g: 0.12, b: 0.15, a: 1 }, parent: "m1", order: 1 },
      { id: "m3", tag: "BUTTON", kind: "frame", x: 340, y: 22, w: 16, h: 16, interactive: true, parent: "m1", bgColor: { r: 0.2, g: 0.24, b: 0.3, a: 1 }, effectiveBg: { r: 0.1, g: 0.12, b: 0.15, a: 1 }, radii: [8,8,8,8], order: 2 },
      { id: "m4", tag: "DIV", kind: "frame", x: 20, y: 100, w: 350, h: 90, parent: null, bgColor: { r: 0.12, g: 0.14, b: 0.18, a: 1 }, effectiveBg: { r: 0.12, g: 0.14, b: 0.18, a: 1 }, radii: [12,12,12,12], order: 3 },
      { id: "m5", tag: "#text", kind: "text", x: 40, y: 120, w: 200, h: 16, text: "Transfer Amount", fontSize: 13, fontWeight: 500, textColor: { r: 0.5, g: 0.54, b: 0.6, a: 1 }, effectiveBg: { r: 0.12, g: 0.14, b: 0.18, a: 1 }, parent: "m4", order: 4 },
      { id: "m6", tag: "#text", kind: "text", x: 40, y: 144, w: 160, h: 32, text: "$250.00", fontSize: 26, fontWeight: 700, textColor: { r: 1, g: 1, b: 1, a: 1 }, effectiveBg: { r: 0.12, g: 0.14, b: 0.18, a: 1 }, parent: "m4", order: 5 },
      { id: "m7", tag: "BUTTON", kind: "frame", x: 20, y: 740, w: 350, h: 52, interactive: true, bgColor: { r: 0.3, g: 0.64, b: 1, a: 1 }, effectiveBg: { r: 0.3, g: 0.64, b: 1, a: 1 }, radii: [12,12,12,12], order: 6 },
      { id: "m8", tag: "#text", kind: "text", x: 140, y: 755, w: 110, h: 22, text: "Confirm Send", fontSize: 16, fontWeight: 700, textColor: { r: 0.05, g: 0.08, b: 0.12, a: 1 }, effectiveBg: { r: 0.3, g: 0.64, b: 1, a: 1 }, parent: "m7", order: 7 },
    ],
  },
};

function loadPreset(key: string): void {
  const chosen = PRESETS[key];
  if (!chosen) return;
  const completeDoc: CaptureDoc = {
    version: 1,
    slug: chosen.slug ?? key,
    url: chosen.url ?? "https://example.com",
    title: chosen.title ?? "Preset",
    viewportWidth: chosen.viewportWidth ?? 1440,
    viewportHeight: chosen.viewportHeight ?? 900,
    docWidth: chosen.docWidth ?? 1440,
    docHeight: chosen.docHeight ?? 900,
    rootBg: chosen.rootBg,
    nodes: (chosen.nodes ?? []) as CaptureNode[],
    capturedAt: new Date().toISOString(),
  };
  loadDoc(completeDoc);
}

presetSelect.addEventListener("change", () => {
  if (presetSelect.value) loadPreset(presetSelect.value);
});

document.querySelectorAll<HTMLButtonElement>(".preset-card-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset["preset"];
    if (key) loadPreset(key);
  });
});

// ---------- zoom & pan controls ----------
function applyZoom(): void {
  if (!doc) return;
  const availableWidth = Math.max(stage.clientWidth - 48, 240);
  const fitScale = Math.max(0.1, Math.min(1.0, availableWidth / doc.docWidth));
  const effective = fitScale * zoomFactor;
  wrap.style.transform = `scale(${effective})`;
  wrap.style.width = doc.docWidth + "px";
  wrap.style.height = doc.docHeight + "px";
  zoomLevel.textContent = `${Math.round(effective * 100)}%`;
}

zoomIn.addEventListener("click", () => {
  zoomFactor = Math.min(3.0, zoomFactor * 1.25);
  applyZoom();
});
zoomOut.addEventListener("click", () => {
  zoomFactor = Math.max(0.3, zoomFactor / 1.25);
  applyZoom();
});
zoomReset.addEventListener("click", () => {
  zoomFactor = 1.0;
  applyZoom();
});
zoomFit.addEventListener("click", () => {
  zoomFactor = 1.0;
  applyZoom();
});

// ---------- view mode toggle ----------
btnViewOrig.addEventListener("click", () => {
  viewMode = "orig";
  btnViewOrig.classList.add("active");
  btnViewApplied.classList.remove("active");
  renderCanvas();
});

btnViewApplied.addEventListener("click", () => {
  if (!appliedDoc) return;
  viewMode = "applied";
  btnViewApplied.classList.add("active");
  btnViewOrig.classList.remove("active");
  renderCanvas();
});

toggleOverlays.addEventListener("change", () => {
  showOverlays = toggleOverlays.checked;
  renderCanvas();
});

// ---------- canvas rendering ----------
const MAX_RENDERED_NODES = 8000;

function renderCanvas(): void {
  if (!doc) return;
  const activeDoc = viewMode === "applied" && appliedDoc ? appliedDoc : doc;
  canvas.textContent = "";

  const frag = document.createDocumentFragment();
  const nodes = activeDoc.nodes.slice(0, MAX_RENDERED_NODES);

  // Map suggestions to target nodes for overlay rendering
  const touchMap = new Set<string>();
  const contrastMap = new Map<string, Suggestion>();
  for (const s of suggestions) {
    if (s.rule === "touch-target") {
      s.targetIds.forEach((id) => touchMap.add(id));
    } else if (s.rule === "contrast") {
      s.targetIds.forEach((id) => contrastMap.set(id, s));
    }
  }

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
      el.style.textAlign =
        (n.textAlign ?? "LEFT").toLowerCase() === "center"
          ? "center"
          : (n.textAlign ?? "").toLowerCase() === "right"
            ? "right"
            : "left";
      el.textContent = n.text ?? "";
    } else if (n.kind === "image") {
      el.style.background = n.imageDataUrl
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

    // Render in-canvas audit overlays
    if (showOverlays && viewMode === "orig") {
      if (touchMap.has(n.id) && (n.w < 24 || n.h < 24)) {
        const overlay = document.createElement("div");
        overlay.className = "touch-target-overlay";
        overlay.style.left = n.x + "px";
        overlay.style.top = n.y + "px";
        overlay.style.width = Math.max(n.w, 24) + "px";
        overlay.style.height = Math.max(n.h, 24) + "px";
        frag.appendChild(overlay);
      }
      if (contrastMap.has(n.id)) {
        const s = contrastMap.get(n.id)!;
        const pill = document.createElement("div");
        pill.className = "contrast-badge-pill";
        pill.style.left = n.x + "px";
        pill.style.top = (n.y - 16) + "px";
        const m = s.message.match(/Contrast ([\d.]+):1/);
        pill.textContent = `Contrast ${m ? m[1] : "!<4.5"}`;
        frag.appendChild(pill);
      }
    }

    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      for (const hot of canvas.querySelectorAll(".hot")) hot.classList.remove("hot");
      el.classList.add("hot");
      renderInspector(n);
    });

    frag.appendChild(el);
  }

  canvas.appendChild(frag);
}

window.addEventListener("resize", () => {
  if (doc) applyZoom();
});

// ---------- node inspector ----------
function renderInspector(n: CaptureNode): void {
  nodeInspector.hidden = false;
  inspTag.textContent = `<${n.tag.toLowerCase()}>`;
  inspId.textContent = n.id;
  inspCoords.textContent = `${Math.round(n.w)}×${Math.round(n.h)}px @ (${Math.round(n.x)}, ${Math.round(n.y)})`;

  inspStyles.innerHTML = "";
  if (n.textColor) {
    inspStyles.innerHTML += `<div>Text: <span style="color:${cssColor(n.textColor)}">■</span> ${cssColor(n.textColor)}</div>`;
  }
  if (n.bgColor) {
    inspStyles.innerHTML += `<div>BG: <span style="color:${cssColor(n.bgColor)}">■</span> ${cssColor(n.bgColor)}</div>`;
  }
  if (n.fontSize) {
    inspStyles.innerHTML += `<div>Font: ${n.fontSize}px (${n.fontWeight ?? 400})</div>`;
  }

  const related = suggestions.filter((s) => s.targetIds.includes(n.id));
  inspIssues.innerHTML = "";
  if (!related.length) {
    inspIssues.innerHTML = '<div style="color:var(--dim)">No audit findings on this node.</div>';
  } else {
    related.forEach((s) => {
      const card = document.createElement("div");
      card.className = "insp-issue-item";
      card.innerHTML = `<strong>${s.rule}:</strong> ${s.message}`;
      if (s.fixes.length) {
        const fixBtn = document.createElement("button");
        fixBtn.className = "btn btn-sm insp-fix-btn";
        fixBtn.textContent = "Select Fix";
        fixBtn.addEventListener("click", () => {
          checked.add(s.id);
          updateCount();
          toast(`Selected fix ${s.id} for apply`);
        });
        card.appendChild(fixBtn);
      }
      inspIssues.appendChild(card);
    });
  }
}

closeInsp.addEventListener("click", () => {
  nodeInspector.hidden = true;
});

// ---------- suggestions list & filtering ----------
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
  const q = filterQuery.toLowerCase().trim();
  const filtered = suggestions.filter((s) => {
    const matchesSev = filterSeverity === "all" || s.severity === filterSeverity;
    const matchesQ =
      !q ||
      s.rule.toLowerCase().includes(q) ||
      s.message.toLowerCase().includes(q) ||
      s.targetIds.some((t) => t.toLowerCase().includes(q));
    return matchesSev && matchesQ;
  });

  const frag = document.createDocumentFragment();
  filtered.forEach((s) => {
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
    msg.textContent = s.message + (s.fixes.length ? "" : " · report only");

    li.addEventListener("click", (e) => {
      if (e.target === cb) return;
      const target = doc?.nodes.find((n) => n.id === s.targetIds[0]);
      if (!target) return;
      for (const hot of canvas.querySelectorAll(".hot")) hot.classList.remove("hot");
      const el = canvas.querySelector<HTMLElement>(`[data-id="${target.id}"]`);
      if (el) {
        el.classList.add("hot");
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        renderInspector(target);
      }
    });

    li.appendChild(msg);
    if (checked.has(s.id)) cb.checked = true;
    frag.appendChild(li);
  });
  list.appendChild(frag);
  updateCount();
}

function setSeverityFilter(sev: "all" | "error" | "warn" | "info"): void {
  filterSeverity = sev;
  filterChips.forEach((b) => {
    if (b.dataset["sev"] === sev) b.classList.add("active");
    else b.classList.remove("active");
  });
  renderSuggestions();
}

btnFilterError.addEventListener("click", () =>
  setSeverityFilter(filterSeverity === "error" ? "all" : "error"),
);
btnFilterWarn.addEventListener("click", () =>
  setSeverityFilter(filterSeverity === "warn" ? "all" : "warn"),
);
btnFilterInfo.addEventListener("click", () =>
  setSeverityFilter(filterSeverity === "info" ? "all" : "info"),
);

suggFilter.addEventListener("input", () => {
  filterQuery = suggFilter.value;
  renderSuggestions();
});

filterChips.forEach((btn) => {
  btn.addEventListener("click", () => {
    const sev = (btn.dataset["sev"] ?? "all") as typeof filterSeverity;
    setSeverityFilter(sev);
  });
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!tokensModal.hidden) closeTokens();
    if (!nodeInspector.hidden) nodeInspector.hidden = true;
  }
});

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

  btnViewApplied.disabled = false;
  btnViewApplied.click(); // switch to live applied preview

  toast(`${ops.length} ops applied! Showing live Applied Preview`);
});

// Quick action buttons
reportBtn.addEventListener("click", () => {
  if (!doc) return;
  const reportHtml = generateHtmlReport(doc, suggestions, auditScore ?? undefined, designTokens ?? undefined);
  download(`${doc.slug}.report.html`, reportHtml);
  toast(`Exported HTML audit report for ${doc.slug}!`);
});

copyCssBtn.addEventListener("click", () => {
  if (!doc) return;
  const chosen = suggestions.filter((s) => checked.has(s.id));
  const fixes = (chosen.length ? chosen : suggestions).flatMap((s) => s.fixes);
  if (!fixes.length) {
    toast("No fixes to generate CSS for");
    return;
  }
  const css = generateCssPatch(doc, fixes);
  copyToClipboard(css, `Copied ${fixes.length} CSS fix declarations!`);
});

copyOpsBtn.addEventListener("click", () => {
  if (!doc) return;
  const chosen = suggestions.filter((s) => checked.has(s.id));
  const fixes = (chosen.length ? chosen : suggestions).flatMap((s) => s.fixes);
  const ops = fixesToFigmaOps(fixes);
  copyToClipboard(JSON.stringify({ slug: doc.slug, ops }, null, 2), `Copied ${ops.length} Figma Ops JSON!`);
});

// ---------- tokens modal ----------
tokensBtn.addEventListener("click", () => {
  if (!designTokens) return;
  tokensModal.hidden = false;
  renderTokenTab();
});

const closeTokens = () => { tokensModal.hidden = true; };
closeTokensModal.addEventListener("click", closeTokens);
closeTokensFooter.addEventListener("click", closeTokens);
tokensBackdrop.addEventListener("click", closeTokens);

function renderTokenTab(): void {
  if (!designTokens) return;
  tokenTabBody.innerHTML = "";

  if (activeTokenTab === "colors") {
    const grid = document.createElement("div");
    grid.className = "token-grid";
    designTokens.colors.forEach((c) => {
      const card = document.createElement("div");
      card.className = "token-card";
      card.innerHTML = `
        <div class="token-swatch" style="background:${c.hex}"></div>
        <div class="token-info">
          <div><strong>${c.name}</strong></div>
          <div style="font-family:monospace;color:var(--dim)">${c.hex}</div>
          <div style="font-size:10px;color:var(--dim)">${c.role} (${c.count}×)</div>
        </div>
      `;
      grid.appendChild(card);
    });
    tokenTabBody.appendChild(grid);
  } else if (activeTokenTab === "typo") {
    const pre = document.createElement("div");
    pre.className = "token-code";
    pre.textContent = JSON.stringify(designTokens.typography, null, 2);
    tokenTabBody.appendChild(pre);
  } else if (activeTokenTab === "spacing") {
    const pre = document.createElement("div");
    pre.className = "token-code";
    pre.textContent = JSON.stringify({ spacing: designTokens.spacing, radii: designTokens.radii }, null, 2);
    tokenTabBody.appendChild(pre);
  } else if (activeTokenTab === "css") {
    const pre = document.createElement("div");
    pre.className = "token-code";
    pre.textContent = tokensToCss(designTokens);
    tokenTabBody.appendChild(pre);
  } else if (activeTokenTab === "dtcg") {
    const pre = document.createElement("div");
    pre.className = "token-code";
    pre.textContent = JSON.stringify(tokensToDtcg(designTokens), null, 2);
    tokenTabBody.appendChild(pre);
  }
}

const tabBtns = [tabColors, tabTypo, tabSpacing, tabCss, tabDtcg];
const tabKeys: Array<typeof activeTokenTab> = ["colors", "typo", "spacing", "css", "dtcg"];
tabBtns.forEach((b, i) => {
  b.addEventListener("click", () => {
    tabBtns.forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    activeTokenTab = tabKeys[i];
    renderTokenTab();
  });
});

copyTokenCssBtn.addEventListener("click", () => {
  if (!designTokens) return;
  copyToClipboard(tokensToCss(designTokens), "Copied CSS Custom Properties to clipboard!");
});

copyTokenDtcgBtn.addEventListener("click", () => {
  if (!designTokens) return;
  copyToClipboard(JSON.stringify(tokensToDtcg(designTokens), null, 2), "Copied DTCG tokens JSON!");
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
    try {
      const parsed = JSON.parse(text) as CaptureDoc;
      loadDoc(parsed);
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  },
};
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// ---------- extension mode ----------
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

// ---------- URL conversion: desktop bridge or local GUI server ----------
const convUrlInput = $<HTMLInputElement>("convUrl");
const convBtn = $<HTMLButtonElement>("convBtn");
const convertingOverlay = $("convertingOverlay");
const loaderTitle = $("loaderTitle");
const loaderSub = $("loaderSub");

if (uaDesktop) {
  void uaDesktop.chromiumPath?.().then((r) => {
    if (!r.ok) toast("convert disabled — " + r.error);
  });
}

const runConvert = async () => {
  let url = convUrlInput.value.trim();
  if (!url) {
    toast("Please enter a website URL (e.g. example.com)");
    convUrlInput.focus();
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
    convUrlInput.value = url;
  }

  convBtn.disabled = true;
  const btnText = convBtn.querySelector<HTMLElement>(".btn-text");
  const origText = btnText ? btnText.textContent : convBtn.textContent;
  if (btnText) btnText.textContent = "Capturing…";
  else convBtn.textContent = "Capturing…";

  convertingOverlay.hidden = false;
  loaderTitle.textContent = `Capturing ${url}…`;
  loaderSub.textContent = "Launching headless Chromium & extracting 1:1 design tree";

  try {
    if (uaDesktop) {
      const r = await uaDesktop.convert({ url });
      if (!r.ok || !r.doc) throw new Error(r.error ?? "Desktop capture failed");
      loadDoc(r.doc);
      toast(`Captured ${url} successfully!`);
    } else {
      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => null);

      if (!res) {
        throw new Error(
          "Direct URL conversion requires local GUI server. Run 'npm run gui' or use desktop app.",
        );
      }
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            "Direct URL conversion requires local GUI server. Run 'npm run gui' or use desktop app.",
          );
        }
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? `Capture failed with status ${res.status}`);
      }
      const data = (await res.json()) as { ok: boolean; doc?: CaptureDoc; error?: string };
      if (!data.ok || !data.doc) throw new Error(data.error ?? "Invalid capture response");
      loadDoc(data.doc);
      toast(`Captured ${url} successfully!`);
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  } finally {
    convertingOverlay.hidden = true;
    convBtn.disabled = false;
    if (btnText) btnText.textContent = origText;
    else convBtn.textContent = origText;
  }
};

convBtn.addEventListener("click", () => void runConvert());
convUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void runConvert();
});

// Auto-load default SaaS preset on startup if no document is loaded
if (!doc) {
  loadPreset("saas");
}
