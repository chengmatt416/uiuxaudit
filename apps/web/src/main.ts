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
  isDesktop?: boolean;
  platform?: string;
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

if (uaDesktop?.isDesktop) {
  document.body.classList.add("is-desktop");
  if (uaDesktop.platform === "darwin") {
    document.body.classList.add("is-mac");
  }
}

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

// Header actions & dropdowns
const tokensBtn = $<HTMLButtonElement>("tokensBtn");
const reportBtn = $<HTMLButtonElement>("reportBtn");
const exportDropdownWrap = $("exportDropdownWrap");
const exportMenuBtn = $<HTMLButtonElement>("exportMenuBtn");
const exportMenu = $("exportMenu");
const copyOpsBtn = $<HTMLButtonElement>("copyOpsBtn");
const copyCssBtn = $<HTMLButtonElement>("copyCssBtn");
const downloadDtcgBtn = $<HTMLButtonElement>("downloadDtcgBtn");
const downloadTokenCssBtn = $<HTMLButtonElement>("downloadTokenCssBtn");
const downloadReportHtmlBtn = $<HTMLButtonElement>("downloadReportHtmlBtn");
const downloadAppliedDocBtn = $<HTMLButtonElement>("downloadAppliedDocBtn");
const shortcutsBtn = $<HTMLButtonElement>("shortcutsBtn");

// Scorecard elements
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

// Toolbar controls
const btnViewOrig = $<HTMLButtonElement>("btnViewOrig");
const btnViewApplied = $<HTMLButtonElement>("btnViewApplied");
const btnViewSplit = $<HTMLButtonElement>("btnViewSplit");
const toggleOverlays = $<HTMLInputElement>("toggleOverlays");
const zoomOut = $<HTMLButtonElement>("zoomOut");
const zoomIn = $<HTMLButtonElement>("zoomIn");
const zoomReset = $<HTMLButtonElement>("zoomReset");
const zoomFit = $<HTMLButtonElement>("zoomFit");
const zoomLevel = $("zoomLevel");

// Inspector
const nodeInspector = $("nodeInspector");
const inspTag = $("inspTag");
const inspId = $("inspId");
const inspCoords = $("inspCoords");
const inspContrast = $("inspContrast");
const inspStyles = $("inspStyles");
const inspIssues = $("inspIssues");
const closeInsp = $<HTMLButtonElement>("closeInsp");
const copyNodeCssBtn = $<HTMLButtonElement>("copyNodeCssBtn");
const copyNodeTwBtn = $<HTMLButtonElement>("copyNodeTwBtn");

// Filter
const filterBar = $("filterBar");
const suggFilter = $<HTMLInputElement>("suggFilter");
const filterChips = document.querySelectorAll<HTMLButtonElement>(".filter-chips-row .filter-chip");

// Tokens Modal
const tokensModal = $("tokensModal");
tokensModal.hidden = true;
tokensModal.style.display = "none";
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

// Shortcuts Modal
const shortcutsModal = $("shortcutsModal");
shortcutsModal.hidden = true;
shortcutsModal.style.display = "none";
const shortcutsBackdrop = $("shortcutsBackdrop");
const closeShortcutsModal = $<HTMLButtonElement>("closeShortcutsModal");
const closeShortcutsFooter = $<HTMLButtonElement>("closeShortcutsFooter");

// State
let doc: CaptureDoc | null = null;
let appliedDoc: CaptureDoc | null = null;
let suggestions: Suggestion[] = [];
let auditScore: AuditScore | null = null;
let designTokens: DesignTokens | null = null;
let selectedNode: CaptureNode | null = null;
const checked = new Set<string>();

let viewMode: "orig" | "applied" | "split" = "orig";
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

function getContrastRatio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
  const lum = (c: { r: number; g: number; b: number }) => {
    const a = [c.r, c.g, c.b].map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  };
  const l1 = lum(fg);
  const l2 = lum(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function generateNodeCss(n: CaptureNode): string {
  const lines: string[] = [
    `/* <${n.tag.toLowerCase()}> #${n.id} */`,
    `width: ${Math.round(n.w)}px;`,
    `height: ${Math.round(n.h)}px;`,
  ];
  if (n.textColor) lines.push(`color: ${cssColor(n.textColor)};`);
  if (n.bgColor && n.bgColor.a > 0) lines.push(`background-color: ${cssColor(n.bgColor)};`);
  if (n.fontSize) lines.push(`font-size: ${n.fontSize}px;`);
  if (n.fontWeight) lines.push(`font-weight: ${n.fontWeight};`);
  if (n.lineHeight) lines.push(`line-height: ${n.lineHeight}px;`);
  if (n.radii && n.radii.some((r) => r > 0)) {
    lines.push(`border-radius: ${n.radii.map((r) => r + "px").join(" ")};`);
  }
  if (n.border && n.border.width > 0) {
    lines.push(`border: ${n.border.width}px solid ${cssColor(n.border.color)};`);
  }
  return lines.join("\n");
}

function generateNodeTailwind(n: CaptureNode): string {
  const tw: string[] = [];
  tw.push(`w-[${Math.round(n.w)}px]`, `h-[${Math.round(n.h)}px]`);
  if (n.textColor) tw.push(`text-[${cssColor(n.textColor)}]`);
  if (n.bgColor && n.bgColor.a > 0) tw.push(`bg-[${cssColor(n.bgColor)}]`);
  if (n.fontSize) tw.push(`text-[${n.fontSize}px]`);
  if (n.fontWeight && n.fontWeight >= 700) tw.push(`font-bold`);
  else if (n.fontWeight && n.fontWeight >= 600) tw.push(`font-semibold`);
  else if (n.fontWeight && n.fontWeight >= 500) tw.push(`font-medium`);
  if (n.radii && n.radii[0] > 0) tw.push(`rounded-[${n.radii[0]}px]`);
  return tw.join(" ");
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
  selectedNode = null;
  nodeInspector.hidden = true;
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
  exportDropdownWrap.hidden = false;
  btnViewSplit.disabled = false;
  viewMode = "orig";
  btnViewOrig.classList.add("active");
  btnViewApplied.classList.remove("active");
  btnViewSplit.classList.remove("active");
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
  ecommerce: {
    slug: "ecommerce",
    url: "https://lumina-studio.design/store/chrono-noir",
    title: "Lumina Minimalist Luxury Store",
    viewportWidth: 1440,
    viewportHeight: 900,
    docWidth: 1440,
    docHeight: 900,
    rootBg: { r: 0.04, g: 0.05, b: 0.07, a: 1 },
    nodes: [
      { id: "ec1", tag: "NAV", kind: "frame", x: 0, y: 0, w: 1440, h: 64, parent: null, bgColor: { r: 0.07, g: 0.08, b: 0.11, a: 1 }, effectiveBg: { r: 0.07, g: 0.08, b: 0.11, a: 1 }, order: 0 },
      { id: "ec2", tag: "#text", kind: "text", x: 48, y: 22, w: 160, h: 22, text: "LUMINA ATELIER", fontSize: 16, fontWeight: 700, textColor: { r: 0.95, g: 0.95, b: 0.95, a: 1 }, effectiveBg: { r: 0.07, g: 0.08, b: 0.11, a: 1 }, parent: "ec1", order: 1 },
      { id: "ec3", tag: "BUTTON", kind: "frame", x: 1300, y: 18, w: 90, h: 30, interactive: true, radii: [6,6,6,6], bgColor: { r: 0.15, g: 0.18, b: 0.24, a: 1 }, effectiveBg: { r: 0.15, g: 0.18, b: 0.24, a: 1 }, parent: "ec1", order: 2 },
      { id: "ec4", tag: "#text", kind: "text", x: 1318, y: 24, w: 56, h: 18, text: "Cart (2)", fontSize: 13, fontWeight: 600, textColor: { r: 0.85, g: 0.9, b: 1, a: 1 }, effectiveBg: { r: 0.15, g: 0.18, b: 0.24, a: 1 }, parent: "ec3", order: 3 },
      { id: "ec5", tag: "DIV", kind: "frame", x: 120, y: 130, w: 480, h: 480, parent: null, bgColor: { r: 0.09, g: 0.11, b: 0.15, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.15, a: 1 }, radii: [16,16,16,16], order: 4 },
      { id: "ec6", tag: "#text", kind: "text", x: 650, y: 150, w: 120, h: 16, text: "NEW ARRIVAL", fontSize: 11, fontWeight: 700, textColor: { r: 0.22, g: 0.74, b: 0.97, a: 1 }, effectiveBg: { r: 0.04, g: 0.05, b: 0.07, a: 1 }, parent: null, order: 5 },
      { id: "ec7", tag: "#text", kind: "text", x: 650, y: 180, w: 420, h: 40, text: "Chrono Noir Automatique", fontSize: 32, fontWeight: 800, textColor: { r: 0.98, g: 0.98, b: 0.98, a: 1 }, effectiveBg: { r: 0.04, g: 0.05, b: 0.07, a: 1 }, parent: null, order: 6 },
      { id: "ec8", tag: "#text", kind: "text", x: 650, y: 236, w: 140, h: 28, text: "$480.00", fontSize: 24, fontWeight: 700, textColor: { r: 0.8, g: 0.85, b: 0.95, a: 1 }, effectiveBg: { r: 0.04, g: 0.05, b: 0.07, a: 1 }, parent: null, order: 7 },
      { id: "ec9", tag: "#text", kind: "text", x: 650, y: 280, w: 480, h: 42, text: "Machined from aerospace-grade titanium with an anti-reflective sapphire crystal face and 48-hour mechanical reserve.", fontSize: 14, fontWeight: 400, textColor: { r: 0.44, g: 0.47, b: 0.52, a: 1 }, effectiveBg: { r: 0.04, g: 0.05, b: 0.07, a: 1 }, parent: null, order: 8 },
      { id: "ec10", tag: "BUTTON", kind: "frame", x: 650, y: 350, w: 18, h: 18, interactive: true, radii: [4,4,4,4], bgColor: { r: 0.16, g: 0.19, b: 0.25, a: 1 }, effectiveBg: { r: 0.16, g: 0.19, b: 0.25, a: 1 }, parent: null, order: 9 },
      { id: "ec11", tag: "#text", kind: "text", x: 655, y: 351, w: 10, h: 16, text: "−", fontSize: 13, fontWeight: 600, textColor: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, effectiveBg: { r: 0.16, g: 0.19, b: 0.25, a: 1 }, parent: "ec10", order: 10 },
      { id: "ec12", tag: "BUTTON", kind: "frame", x: 690, y: 350, w: 18, h: 18, interactive: true, radii: [4,4,4,4], bgColor: { r: 0.16, g: 0.19, b: 0.25, a: 1 }, effectiveBg: { r: 0.16, g: 0.19, b: 0.25, a: 1 }, parent: null, order: 11 },
      { id: "ec13", tag: "#text", kind: "text", x: 695, y: 351, w: 10, h: 16, text: "+", fontSize: 13, fontWeight: 600, textColor: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, effectiveBg: { r: 0.16, g: 0.19, b: 0.25, a: 1 }, parent: "ec12", order: 12 },
      { id: "ec14", tag: "BUTTON", kind: "frame", x: 650, y: 410, w: 260, h: 48, interactive: true, radii: [10,10,10,10], bgColor: { r: 0.22, g: 0.74, b: 0.97, a: 1 }, effectiveBg: { r: 0.22, g: 0.74, b: 0.97, a: 1 }, parent: null, order: 13 },
      { id: "ec15", tag: "#text", kind: "text", x: 720, y: 424, w: 120, h: 20, text: "Add to Bag", fontSize: 15, fontWeight: 700, textColor: { r: 0.02, g: 0.08, b: 0.14, a: 1 }, effectiveBg: { r: 0.22, g: 0.74, b: 0.97, a: 1 }, parent: "ec14", order: 14 },
    ],
  },
  pricing: {
    slug: "pricing",
    url: "https://apexcloud.dev/pricing",
    title: "Apex Cloud Pricing Matrix",
    viewportWidth: 1440,
    viewportHeight: 900,
    docWidth: 1440,
    docHeight: 900,
    rootBg: { r: 0.05, g: 0.06, b: 0.08, a: 1 },
    nodes: [
      { id: "p1", tag: "#text", kind: "text", x: 440, y: 80, w: 560, h: 42, text: "Predictable, Scalable Pricing", fontSize: 34, fontWeight: 800, textAlign: "CENTER", textColor: { r: 1, g: 1, b: 1, a: 1 }, effectiveBg: { r: 0.05, g: 0.06, b: 0.08, a: 1 }, parent: null, order: 0 },
      { id: "p2", tag: "#text", kind: "text", x: 470, y: 132, w: 500, h: 24, text: "Transparent plans with zero ingress fees and guaranteed 99.99% uptime SLA.", fontSize: 14, fontWeight: 400, textAlign: "CENTER", textColor: { r: 0.45, g: 0.48, b: 0.53, a: 1 }, effectiveBg: { r: 0.05, g: 0.06, b: 0.08, a: 1 }, parent: null, order: 1 },
      { id: "p3", tag: "DIV", kind: "frame", x: 160, y: 210, w: 340, h: 420, parent: null, bgColor: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, radii: [12,12,12,12], order: 2 },
      { id: "p4", tag: "#text", kind: "text", x: 190, y: 240, w: 100, h: 22, text: "Starter", fontSize: 18, fontWeight: 700, textColor: { r: 0.9, g: 0.93, b: 0.98, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, parent: "p3", order: 3 },
      { id: "p5", tag: "#text", kind: "text", x: 190, y: 270, w: 80, h: 36, text: "$0", fontSize: 32, fontWeight: 800, textColor: { r: 1, g: 1, b: 1, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, parent: "p3", order: 4 },
      { id: "p6", tag: "BUTTON", kind: "frame", x: 190, y: 550, w: 280, h: 42, interactive: true, radii: [8,8,8,8], bgColor: { r: 0.18, g: 0.22, b: 0.28, a: 1 }, effectiveBg: { r: 0.18, g: 0.22, b: 0.28, a: 1 }, parent: "p3", order: 5 },
      { id: "p7", tag: "#text", kind: "text", x: 275, y: 562, w: 110, h: 18, text: "Deploy Free", fontSize: 14, fontWeight: 600, textColor: { r: 0.9, g: 0.94, b: 1, a: 1 }, effectiveBg: { r: 0.18, g: 0.22, b: 0.28, a: 1 }, parent: "p6", order: 6 },
      { id: "p8", tag: "DIV", kind: "frame", x: 550, y: 190, w: 340, h: 460, parent: null, bgColor: { r: 0.11, g: 0.14, b: 0.2, a: 1 }, effectiveBg: { r: 0.11, g: 0.14, b: 0.2, a: 1 }, radii: [12,12,12,12], order: 7 },
      { id: "p9", tag: "#text", kind: "text", x: 580, y: 220, w: 120, h: 22, text: "Professional", fontSize: 18, fontWeight: 700, textColor: { r: 0.35, g: 0.75, b: 1, a: 1 }, effectiveBg: { r: 0.11, g: 0.14, b: 0.2, a: 1 }, parent: "p8", order: 8 },
      { id: "p10", tag: "#text", kind: "text", x: 580, y: 250, w: 120, h: 36, text: "$49/mo", fontSize: 32, fontWeight: 800, textColor: { r: 1, g: 1, b: 1, a: 1 }, effectiveBg: { r: 0.11, g: 0.14, b: 0.2, a: 1 }, parent: "p8", order: 9 },
      { id: "p11", tag: "BUTTON", kind: "frame", x: 580, y: 570, w: 280, h: 44, interactive: true, radii: [8,8,8,8], bgColor: { r: 0.22, g: 0.74, b: 0.97, a: 1 }, effectiveBg: { r: 0.22, g: 0.74, b: 0.97, a: 1 }, parent: "p8", order: 10 },
      { id: "p12", tag: "#text", kind: "text", x: 650, y: 583, w: 140, h: 18, text: "Start 14-Day Trial", fontSize: 14, fontWeight: 700, textColor: { r: 0.02, g: 0.08, b: 0.14, a: 1 }, effectiveBg: { r: 0.22, g: 0.74, b: 0.97, a: 1 }, parent: "p11", order: 11 },
      { id: "p13", tag: "DIV", kind: "frame", x: 940, y: 210, w: 340, h: 420, parent: null, bgColor: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, radii: [12,12,12,12], order: 12 },
      { id: "p14", tag: "#text", kind: "text", x: 970, y: 240, w: 100, h: 22, text: "Enterprise", fontSize: 18, fontWeight: 700, textColor: { r: 0.9, g: 0.93, b: 0.98, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, parent: "p13", order: 13 },
      { id: "p15", tag: "#text", kind: "text", x: 970, y: 270, w: 140, h: 36, text: "$199/mo", fontSize: 32, fontWeight: 800, textColor: { r: 1, g: 1, b: 1, a: 1 }, effectiveBg: { r: 0.09, g: 0.11, b: 0.14, a: 1 }, parent: "p13", order: 14 },
      { id: "p16", tag: "BUTTON", kind: "frame", x: 970, y: 550, w: 280, h: 42, interactive: true, radii: [8,8,8,8], bgColor: { r: 0.18, g: 0.22, b: 0.28, a: 1 }, effectiveBg: { r: 0.18, g: 0.22, b: 0.28, a: 1 }, parent: "p13", order: 15 },
      { id: "p17", tag: "#text", kind: "text", x: 1055, y: 562, w: 110, h: 18, text: "Contact Sales", fontSize: 14, fontWeight: 600, textColor: { r: 0.9, g: 0.94, b: 1, a: 1 }, effectiveBg: { r: 0.18, g: 0.22, b: 0.28, a: 1 }, parent: "p16", order: 16 },
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
  const targetWidth = viewMode === "split" ? (doc.docWidth * 2 + 48) : doc.docWidth;
  const availableWidth = Math.max(stage.clientWidth - 48, 240);
  const fitScale = Math.max(0.08, Math.min(1.0, availableWidth / targetWidth));
  const effective = fitScale * zoomFactor;
  wrap.style.transform = `scale(${effective})`;
  zoomLevel.textContent = `${Math.round(effective * 100)}%`;
}

zoomIn.addEventListener("click", () => {
  zoomFactor = Math.min(3.0, zoomFactor * 1.25);
  applyZoom();
});
zoomOut.addEventListener("click", () => {
  zoomFactor = Math.max(0.2, zoomFactor / 1.25);
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
  btnViewSplit.classList.remove("active");
  applyZoom();
  renderCanvas();
});

btnViewApplied.addEventListener("click", () => {
  if (!appliedDoc) return;
  viewMode = "applied";
  btnViewApplied.classList.add("active");
  btnViewOrig.classList.remove("active");
  btnViewSplit.classList.remove("active");
  applyZoom();
  renderCanvas();
});

btnViewSplit.addEventListener("click", () => {
  viewMode = "split";
  btnViewSplit.classList.add("active");
  btnViewOrig.classList.remove("active");
  btnViewApplied.classList.remove("active");
  applyZoom();
  renderCanvas();
});

toggleOverlays.addEventListener("change", () => {
  showOverlays = toggleOverlays.checked;
  renderCanvas();
});

// ---------- canvas rendering ----------
const MAX_RENDERED_NODES = 8000;

function renderNodeList(container: HTMLElement, nodes: CaptureNode[], isOrig: boolean): void {
  const frag = document.createDocumentFragment();
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
    if (showOverlays && isOrig) {
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
      for (const hot of stage.querySelectorAll(".hot")) hot.classList.remove("hot");
      el.classList.add("hot");
      renderInspector(n);
    });

    frag.appendChild(el);
  }

  container.appendChild(frag);
}

function renderCanvas(): void {
  if (!doc) return;
  canvas.textContent = "";

  if (viewMode === "split") {
    wrap.className = "canvas-wrapper is-split";
    wrap.style.width = "max-content";
    wrap.style.height = "auto";
    canvas.style.width = "max-content";
    canvas.style.height = "auto";
    canvas.style.background = "transparent";

    const effectiveApplied = appliedDoc ?? applyFixesToDoc(doc, suggestions.flatMap((s) => s.fixes));

    // Left pane: Original
    const frameOrig = document.createElement("div");
    frameOrig.className = "split-frame";
    frameOrig.innerHTML = `
      <div class="split-frame-header">
        <span class="split-frame-title">Original Baseline</span>
        <span class="split-badge warn">${suggestions.length} Findings</span>
      </div>
    `;
    const bodyOrig = document.createElement("div");
    bodyOrig.className = "split-frame-body";
    bodyOrig.style.width = doc.docWidth + "px";
    bodyOrig.style.height = doc.docHeight + "px";
    bodyOrig.style.background = doc.rootBg ? cssColor(doc.rootBg) : "#07080a";
    renderNodeList(bodyOrig, doc.nodes.slice(0, MAX_RENDERED_NODES), true);
    frameOrig.appendChild(bodyOrig);

    // Right pane: Applied
    const frameApplied = document.createElement("div");
    frameApplied.className = "split-frame";
    frameApplied.innerHTML = `
      <div class="split-frame-header">
        <span class="split-frame-title">Audit Fixes Applied</span>
        <span class="split-badge success">WCAG Compliant</span>
      </div>
    `;
    const bodyApplied = document.createElement("div");
    bodyApplied.className = "split-frame-body";
    bodyApplied.style.width = effectiveApplied.docWidth + "px";
    bodyApplied.style.height = effectiveApplied.docHeight + "px";
    bodyApplied.style.background = effectiveApplied.rootBg ? cssColor(effectiveApplied.rootBg) : "#07080a";
    renderNodeList(bodyApplied, effectiveApplied.nodes.slice(0, MAX_RENDERED_NODES), false);
    frameApplied.appendChild(bodyApplied);

    canvas.appendChild(frameOrig);
    canvas.appendChild(frameApplied);
  } else {
    wrap.className = "canvas-wrapper";
    wrap.style.width = doc.docWidth + "px";
    wrap.style.height = doc.docHeight + "px";
    const activeDoc = viewMode === "applied" && appliedDoc ? appliedDoc : doc;
    canvas.style.width = activeDoc.docWidth + "px";
    canvas.style.height = activeDoc.docHeight + "px";
    canvas.style.background = activeDoc.rootBg ? cssColor(activeDoc.rootBg) : "#07080a";
    renderNodeList(canvas, activeDoc.nodes.slice(0, MAX_RENDERED_NODES), viewMode === "orig");
  }
}

window.addEventListener("resize", () => {
  if (doc) applyZoom();
});

// ---------- node inspector ----------
function renderInspector(n: CaptureNode): void {
  selectedNode = n;
  nodeInspector.hidden = false;
  nodeInspector.style.display = "block";
  inspTag.textContent = `<${n.tag.toLowerCase()}>`;
  inspId.textContent = n.id;
  inspCoords.textContent = `${Math.round(n.w)}×${Math.round(n.h)}px @ (${Math.round(n.x)}, ${Math.round(n.y)})`;

  // Contrast checking
  if (n.textColor && n.effectiveBg) {
    const cr = getContrastRatio(n.textColor, n.effectiveBg);
    inspContrast.hidden = false;
    inspContrast.style.display = "flex";
    const passAA = cr >= 4.5;
    const passAALarge = cr >= 3.0;
    const passAAA = cr >= 7.0;
    inspContrast.innerHTML = `
      <div class="contrast-header-row">
        <span class="contrast-label">WCAG Contrast</span>
        <span class="contrast-ratio-num" style="color:${passAA ? 'var(--color-success)' : 'var(--color-error)'}">${cr.toFixed(2)}:1</span>
      </div>
      <div class="contrast-pills-row">
        <span class="contrast-pill ${passAA ? 'pass' : 'fail'}">AA Normal ${passAA ? 'PASS' : 'FAIL'}</span>
        <span class="contrast-pill ${passAALarge ? 'pass' : 'fail'}">AA Large ${passAALarge ? 'PASS' : 'FAIL'}</span>
        <span class="contrast-pill ${passAAA ? 'pass' : 'fail'}">AAA ${passAAA ? 'PASS' : 'FAIL'}</span>
      </div>
    `;
  } else {
    inspContrast.hidden = true;
    inspContrast.style.display = "none";
  }

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
  if (n.radii && n.radii.some((r) => r > 0)) {
    inspStyles.innerHTML += `<div>Radius: ${n.radii.join(" ")}px</div>`;
  }

  const related = suggestions.filter((s) => s.targetIds.includes(n.id));
  inspIssues.innerHTML = "";
  if (!related.length) {
    inspIssues.innerHTML = '<div style="color:var(--dim);font-size:11px">No audit findings on this node.</div>';
  } else {
    related.forEach((s) => {
      const card = document.createElement("div");
      card.className = "insp-issue-item";
      card.innerHTML = `<strong>${s.rule}:</strong> ${s.message}`;
      if (s.fixes.length) {
        const fixBtn = document.createElement("button");
        fixBtn.className = "btn btn-sm insp-fix-btn";
        fixBtn.textContent = "⚡ Apply Fix";
        fixBtn.addEventListener("click", () => {
          checked.add(s.id);
          updateCount();
          applyBtn.click();
        });
        card.appendChild(fixBtn);
      }
      inspIssues.appendChild(card);
    });
  }
}

closeInsp.addEventListener("click", () => {
  nodeInspector.hidden = true;
  nodeInspector.style.display = "none";
});

copyNodeCssBtn.addEventListener("click", () => {
  if (!selectedNode) return;
  const css = generateNodeCss(selectedNode);
  copyToClipboard(css, `Copied CSS for <${selectedNode.tag.toLowerCase()}> #${selectedNode.id}!`);
});

copyNodeTwBtn.addEventListener("click", () => {
  if (!selectedNode) return;
  const tw = generateNodeTailwind(selectedNode);
  copyToClipboard(tw, `Copied Tailwind utility classes!`);
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
    toast("Selected findings carry no automated fixes");
    return;
  }
  const ops = fixesToFigmaOps(fixes);
  appliedDoc = applyFixesToDoc(doc, fixes);
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
  btnViewSplit.disabled = false;
  btnViewApplied.click(); // switch to live applied preview

  toast(`✓ Applied ${fixes.length} fixes! Check Applied Preview or Side-by-Side`);
});

// ---------- export dropdown menu ----------
exportMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
  exportMenu.style.display = exportMenu.hidden ? "none" : "flex";
});

window.addEventListener("click", (e) => {
  if (!exportDropdownWrap.contains(e.target as Node)) {
    exportMenu.hidden = true;
    exportMenu.style.display = "none";
  }
});

copyOpsBtn.addEventListener("click", () => {
  if (!doc) return;
  const chosen = suggestions.filter((s) => checked.has(s.id));
  const fixes = (chosen.length ? chosen : suggestions).flatMap((s) => s.fixes);
  const ops = fixesToFigmaOps(fixes);
  copyToClipboard(JSON.stringify({ slug: doc.slug, ops }, null, 2), `Copied ${ops.length} Figma Ops JSON!`);
  exportMenu.hidden = true;
  exportMenu.style.display = "none";
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
  exportMenu.hidden = true;
  exportMenu.style.display = "none";
});

downloadDtcgBtn.addEventListener("click", () => {
  if (!designTokens || !doc) return;
  const dtcg = tokensToDtcg(designTokens);
  download(`${doc.slug}.tokens.json`, dtcg);
  toast(`Exported W3C DTCG tokens for ${doc.slug}!`);
  exportMenu.hidden = true;
  exportMenu.style.display = "none";
});

downloadTokenCssBtn.addEventListener("click", () => {
  if (!designTokens || !doc) return;
  const css = tokensToCss(designTokens);
  download(`${doc.slug}.tokens.css`, css);
  toast(`Exported tokens.css for ${doc.slug}!`);
  exportMenu.hidden = true;
  exportMenu.style.display = "none";
});

downloadReportHtmlBtn.addEventListener("click", () => {
  if (!doc) return;
  const reportHtml = generateHtmlReport(doc, suggestions, auditScore ?? undefined, designTokens ?? undefined);
  download(`${doc.slug}.report.html`, reportHtml);
  toast(`Exported HTML audit report for ${doc.slug}!`);
  exportMenu.hidden = true;
  exportMenu.style.display = "none";
});

downloadAppliedDocBtn.addEventListener("click", () => {
  if (!doc) return;
  const target = appliedDoc ?? applyFixesToDoc(doc, suggestions.flatMap((s) => s.fixes));
  download(`${doc.slug}.applied.capture.json`, target);
  toast(`Exported applied JSON for ${doc.slug}!`);
  exportMenu.hidden = true;
  exportMenu.style.display = "none";
});

reportBtn.addEventListener("click", () => {
  if (!doc) return;
  const reportHtml = generateHtmlReport(doc, suggestions, auditScore ?? undefined, designTokens ?? undefined);
  download(`${doc.slug}.report.html`, reportHtml);
  toast(`Exported HTML audit report for ${doc.slug}!`);
});

// ---------- shortcuts modal ----------
const openShortcuts = () => {
  shortcutsModal.hidden = false;
  shortcutsModal.style.display = "flex";
};
const closeShortcuts = () => {
  shortcutsModal.hidden = true;
  shortcutsModal.style.display = "none";
};
shortcutsBtn.addEventListener("click", openShortcuts);
closeShortcutsModal.addEventListener("click", closeShortcuts);
closeShortcutsFooter.addEventListener("click", closeShortcuts);
shortcutsBackdrop.addEventListener("click", closeShortcuts);

// ---------- spacebar pan & trackpad zoom ----------
let isSpacePressed = false;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let scrollStartX = 0;
let scrollStartY = 0;

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
  if (e.code === "Space" && !isInput) {
    if (!isSpacePressed) {
      isSpacePressed = true;
      stage.style.cursor = "grab";
    }
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    isSpacePressed = false;
    if (!isPanning) stage.style.cursor = "default";
  }
});

stage.addEventListener("mousedown", (e) => {
  if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
    e.preventDefault();
    isPanning = true;
    stage.style.cursor = "grabbing";
    panStartX = e.clientX;
    panStartY = e.clientY;
    scrollStartX = stage.scrollLeft;
    scrollStartY = stage.scrollTop;
  }
});

window.addEventListener("mousemove", (e) => {
  if (!isPanning) return;
  e.preventDefault();
  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;
  stage.scrollLeft = scrollStartX - dx;
  stage.scrollTop = scrollStartY - dy;
});

window.addEventListener("mouseup", () => {
  if (isPanning) {
    isPanning = false;
    stage.style.cursor = isSpacePressed ? "grab" : "default";
  }
});

stage.addEventListener(
  "wheel",
  (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomFactor = Math.min(3.0, zoomFactor * 1.15);
      } else {
        zoomFactor = Math.max(0.15, zoomFactor / 1.15);
      }
      applyZoom();
    }
  },
  { passive: false },
);

// Global keyboard shortcuts
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

  if (e.key === "Escape") {
    if (!tokensModal.hidden) closeTokens();
    if (!shortcutsModal.hidden) closeShortcuts();
    if (!nodeInspector.hidden) {
      nodeInspector.hidden = true;
      nodeInspector.style.display = "none";
    }
    if (!exportMenu.hidden) {
      exportMenu.hidden = true;
      exportMenu.style.display = "none";
    }
    return;
  }

  if (isInput) return;

  if (e.key === "?") {
    if (shortcutsModal.hidden) openShortcuts();
    else closeShortcuts();
  } else if (e.key === "1") {
    btnViewOrig.click();
  } else if (e.key === "2") {
    if (!btnViewApplied.disabled) btnViewApplied.click();
  } else if (e.key === "3") {
    if (!btnViewSplit.disabled) btnViewSplit.click();
  } else if (e.key.toLowerCase() === "o") {
    toggleOverlays.checked = !toggleOverlays.checked;
    showOverlays = toggleOverlays.checked;
    renderCanvas();
  } else if (e.key.toLowerCase() === "t") {
    tokensBtn.click();
  } else if (e.key.toLowerCase() === "r") {
    reportBtn.click();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    selAll.click();
  }
});

// ---------- tokens modal ----------
tokensBtn.addEventListener("click", () => {
  if (!designTokens) return;
  tokensModal.hidden = false;
  tokensModal.style.display = "flex";
  renderTokenTab();
});

const closeTokens = () => {
  tokensModal.hidden = true;
  tokensModal.style.display = "none";
};
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
