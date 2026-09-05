import type {
  AuditScore,
  CaptureDoc,
  CaptureNode,
  Fix,
  RGBA,
  Suggestion,
} from "./types.js";

// ---- WCAG contrast math ----

function srgbLinear(u: number): number {
  return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

function luminance(c: RGBA): number {
  return (
    0.2126 * srgbLinear(c.r) +
    0.7152 * srgbLinear(c.g) +
    0.0722 * srgbLinear(c.b)
  );
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };

function blendToward(c: RGBA, target: RGBA, f: number): RGBA {
  return {
    r: round4(c.r + (target.r - c.r) * f),
    g: round4(c.g + (target.g - c.g) * f),
    b: round4(c.b + (target.b - c.b) * f),
    a: c.a,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Nearest color (blend toward black or white) reaching the target ratio. */
export function adjustForContrast(
  fg: RGBA,
  bg: RGBA,
  targetRatio: number,
): RGBA | null {
  let bestF = Infinity;
  let bestC: RGBA | null = null;
  for (const t of [BLACK, WHITE]) {
    if (contrastRatio(blendToward(fg, t, 1), bg) < targetRatio) continue;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(blendToward(fg, t, mid), bg) >= targetRatio) hi = mid;
      else lo = mid;
    }
    if (hi < bestF) {
      bestF = hi;
      bestC = blendToward(fg, t, hi);
    }
  }
  if (!bestC) return null;
  // 8-bit/hex rounding can drop the ratio below target; nudge toward the
  // chosen extreme in single-quantum steps until it holds after rounding.
  const quantize = (c: RGBA): RGBA => ({
    r: Math.round(c.r * 255) / 255,
    g: Math.round(c.g * 255) / 255,
    b: Math.round(c.b * 255) / 255,
    a: c.a,
  });
  const darker =
    bestC.r + bestC.g + bestC.b <= fg.r + fg.g + fg.b;
  const extreme = darker ? BLACK : WHITE;
  for (let k = 0; k < 16; k++) {
    const cand = quantize(
      blendToward(fg, extreme, Math.min(1, bestF + k / 255)),
    );
    if (contrastRatio(cand, bg) >= targetRatio) return cand;
  }
  return quantize(bestC);
}

const SEVERITY_RANK: Record<string, number> = { error: 0, warn: 1, info: 2 };

/**
 * Deterministic rule-based UI/UX audit over a capture document.
 * Rules: WCAG contrast, touch-target size, font-scale consolidation,
 * line length, minimum font size, heading hierarchy, interactive labels,
 * and design grid spacing rhythm.
 */
export function suggestFor(doc: CaptureDoc, limit = 300): Suggestion[] {
  const raw: Array<Omit<Suggestion, "id">> = [];

  // ---- R1: WCAG text contrast ----
  for (const n of doc.nodes) {
    if (n.kind !== "text" || !n.textColor || !n.fontSize) continue;
    const bg = n.effectiveBg ?? doc.rootBg ?? WHITE;
    const large = n.fontSize >= 24 || (n.fontSize >= 18.66 && (n.fontWeight ?? 400) >= 700);
    const target = large ? 3 : 4.5;
    const ratio = contrastRatio(n.textColor, bg);
    if (ratio >= target - 1e-9) continue;
    const fixed = adjustForContrast(n.textColor, bg, target);
    raw.push({
      rule: "contrast",
      category: "accessibility",
      severity: ratio < target / 2 ? "error" : "warn",
      message: `Contrast ${ratio.toFixed(2)}:1 < ${target}:1 for ${(n.fontSize as number).toFixed(1)}px "${(n.text ?? "").trim().slice(0, 40)}"`,
      targetIds: [n.id],
      fixes: fixed
        ? [{ kind: "setTextColor", nodeId: n.id, value: fixed }]
        : [],
    });
  }

  // ---- R2: touch-target minimum size ----
  for (const n of doc.nodes) {
    if (!n.interactive || n.kind === "text") continue;
    if (n.w >= 24 && n.h >= 24) continue;
    raw.push({
      rule: "touch-target",
      category: "interaction",
      severity: "warn",
      message: `<${n.tag.toLowerCase()}> ${n.w.toFixed(0)}x${n.h.toFixed(0)}px below 24x24px minimum`,
      targetIds: [n.id],
      fixes: [
        {
          kind: "setSize",
          nodeId: n.id,
          w: Math.max(n.w, 24),
          h: Math.max(n.h, 24),
        },
      ],
    });
  }

  // ---- R3: font-size soup consolidation ----
  const freqKey = (fs: number): number => Math.round(fs * 2) / 2;
  const freq = new Map<number, number>();
  for (const n of doc.nodes) {
    if (n.kind !== "text" || !n.fontSize) continue;
    const k = freqKey(n.fontSize);
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const distinct = [...freq.keys()].sort((a, b) => a - b);
  if (distinct.length > 6) {
    const kept = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 4)
      .map((e) => e[0])
      .sort((a, b) => a - b);
    const fixes: Fix[] = [];
    const targetIds: string[] = [];
    for (const n of doc.nodes) {
      if (n.kind !== "text" || !n.fontSize) continue;
      const k = freqKey(n.fontSize);
      if (kept.includes(k)) continue;
      const nearest = kept.reduce((best, cur) =>
        Math.abs(cur - k) < Math.abs(best - k) ? cur : best,
      );
      if (nearest === k) continue;
      targetIds.push(n.id);
      fixes.push({ kind: "setFontSize", nodeId: n.id, value: nearest });
    }
    if (fixes.length) {
      raw.push({
        rule: "font-scale",
        category: "typography",
        severity: "info",
        message: `${distinct.length} distinct font sizes; consolidate outliers onto scale ${kept.join("/")}px (${fixes.length} nodes)`,
        targetIds,
        fixes,
      });
    }
  }

  // ---- R4: excessive line length ----
  for (const n of doc.nodes) {
    if (n.kind !== "text" || !n.fontSize || (n.fontSize ?? 16) < 12) continue;
    const estCharsPerLine = n.w / ((n.fontSize as number) * 0.5);
    if (estCharsPerLine <= 100) continue;
    raw.push({
      rule: "line-length",
      category: "typography",
      severity: "info",
      message: `Text block spans ~${estCharsPerLine.toFixed(0)} em-halved characters per line (>100); consider constraining measure`,
      targetIds: [n.id],
      fixes: [],
    });
  }

  // ---- R5: minimum legible font size (< 12px) ----
  for (const n of doc.nodes) {
    if (n.kind !== "text" || !n.fontSize) continue;
    if (n.fontSize < 12 && (n.text ?? "").trim().length > 0) {
      raw.push({
        rule: "min-font-size",
        category: "accessibility",
        severity: "warn",
        message: `Font size ${(n.fontSize as number).toFixed(1)}px is below 12px legibility threshold for "${(n.text ?? "").trim().slice(0, 30)}"`,
        targetIds: [n.id],
        fixes: [{ kind: "setFontSize", nodeId: n.id, value: 12 }],
      });
    }
  }

  // ---- R6: heading hierarchy skips ----
  let lastH = 0;
  for (const n of doc.nodes) {
    const m = n.tag.toUpperCase().match(/^H([1-6])$/);
    if (!m) continue;
    const cur = parseInt(m[1], 10);
    if (lastH > 0 && cur > lastH + 1) {
      raw.push({
        rule: "heading-hierarchy",
        category: "typography",
        severity: "info",
        message: `Heading level jumped from <h${lastH}> to <h${cur}> without intermediate levels`,
        targetIds: [n.id],
        fixes: [],
      });
    }
    lastH = cur;
  }

  // ---- R7: interactive element labels ----
  for (const n of doc.nodes) {
    if (!n.interactive || n.kind === "text") continue;
    const tag = n.tag.toUpperCase();
    if (tag === "BUTTON" || tag === "A") {
      const hasTextChild = doc.nodes.some(
        (o) =>
          (o.parent === n.id ||
            (o.x >= n.x - 4 && o.y >= n.y - 4 && o.x <= n.x + n.w + 4 && o.y <= n.y + n.h + 4)) &&
          (o.kind === "text" || (o.text && o.text.trim().length > 0)),
      );
      if (!hasTextChild && (!n.text || n.text.trim().length === 0) && n.w > 0 && n.h > 0) {
        raw.push({
          rule: "interactive-labels",
          category: "accessibility",
          severity: "warn",
          message: `<${n.tag.toLowerCase()}> interactive control has no text or accessible label`,
          targetIds: [n.id],
          fixes: [],
        });
      }

    }
  }

  // ---- R8: spacing & layout grid rhythm (4px/8px baseline) ----
  for (const n of doc.nodes) {
    if (n.kind !== "frame" || n.w < 32 || n.h < 32) continue;
    const isIntW = Math.abs(n.w - Math.round(n.w)) < 1e-3;
    const isIntH = Math.abs(n.h - Math.round(n.h)) < 1e-3;
    if (isIntW && isIntH && n.w % 4 !== 0 && n.h % 4 !== 0 && n.w > 48 && n.h > 48) {
      const snapW = Math.round(n.w / 4) * 4;
      const snapH = Math.round(n.h / 4) * 4;
      raw.push({
        rule: "spacing-rhythm",
        category: "layout",
        severity: "info",
        message: `<${n.tag.toLowerCase()}> ${n.w}×${n.h}px deviates from 4px/8px design grid (nearest: ${snapW}×${snapH}px)`,
        targetIds: [n.id],
        fixes: [{ kind: "setSize", nodeId: n.id, w: snapW, h: snapH }],
      });
    }
  }

  raw.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.targetIds[0] ?? "").localeCompare(
        (b.targetIds[0] ?? "") || "",
        undefined,
        { numeric: true },
      ) ||
      a.rule.localeCompare(b.rule),
  );

  const truncated = raw.length > limit;
  const picked = raw.slice(0, limit).map((s, i) => ({
    ...s,
    id: "s" + String(i + 1).padStart(3, "0"),
  }));
  if (truncated) {
    picked.push({
      id: "s" + String(picked.length + 1).padStart(3, "0"),
      rule: "contrast",
      category: "accessibility",
      severity: "info",
      message: `(+${raw.length - limit} further findings truncated deterministically)`,
      targetIds: [],
      fixes: [],
    });
  }
  return picked;
}

/**
 * Calculates a comprehensive UI/UX Health Score (0-100), letter grade,
 * WCAG 2.1 compliance level, and category breakdowns.
 */
export function calculateAuditScore(
  doc: CaptureDoc,
  suggestions: Suggestion[],
): AuditScore {
  let errorCount = 0;
  let warnCount = 0;
  let infoCount = 0;

  const cats = {
    accessibility: { errors: 0, warns: 0, infos: 0, total: 0 },
    interaction: { errors: 0, warns: 0, infos: 0, total: 0 },
    typography: { errors: 0, warns: 0, infos: 0, total: 0 },
    layout: { errors: 0, warns: 0, infos: 0, total: 0 },
  };

  for (const s of suggestions) {
    const c = s.category ?? (
      s.rule === "contrast" || s.rule === "min-font-size" || s.rule === "interactive-labels"
        ? "accessibility"
        : s.rule === "touch-target"
          ? "interaction"
          : s.rule === "font-scale" || s.rule === "line-length" || s.rule === "heading-hierarchy"
            ? "typography"
            : "layout"
    );
    const target = cats[c] || cats.accessibility;
    target.total++;
    if (s.severity === "error") {
      errorCount++;
      target.errors++;
    } else if (s.severity === "warn") {
      warnCount++;
      target.warns++;
    } else {
      infoCount++;
      target.infos++;
    }
  }

  const penalty = errorCount * 12 + warnCount * 4 + infoCount * 1;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  let grade: AuditScore["grade"] = "F";
  if (score >= 95) grade = "A+";
  else if (score >= 90) grade = "A";
  else if (score >= 80) grade = "B";
  else if (score >= 70) grade = "C";
  else if (score >= 60) grade = "D";

  let wcagLevel: AuditScore["wcagLevel"] = "AAA";
  if (errorCount > 0) wcagLevel = "Non-compliant";
  else if (warnCount > 0) wcagLevel = "AA";

  const totalChecks = Math.max(doc.nodes.length * 3, 10);
  const passedChecks = Math.max(0, totalChecks - (errorCount + warnCount + infoCount));

  const scoreForCat = (item: { errors: number; warns: number; infos: number }) =>
    Math.max(0, Math.min(100, 100 - (item.errors * 20 + item.warns * 8 + item.infos * 2)));

  return {
    score,
    grade,
    wcagLevel,
    passedChecks,
    totalChecks,
    counts: { error: errorCount, warn: warnCount, info: infoCount },
    byCategory: {
      accessibility: {
        name: "Accessibility & WCAG",
        score: scoreForCat(cats.accessibility),
        ...cats.accessibility,
        passed: Math.max(0, doc.nodes.length - cats.accessibility.errors - cats.accessibility.warns),
      },
      interaction: {
        name: "Mobile & Touch Targets",
        score: scoreForCat(cats.interaction),
        ...cats.interaction,
        passed: Math.max(0, doc.nodes.length - cats.interaction.errors - cats.interaction.warns),
      },
      typography: {
        name: "Typography & Legibility",
        score: scoreForCat(cats.typography),
        ...cats.typography,
        passed: Math.max(0, doc.nodes.length - cats.typography.errors - cats.typography.warns),
      },
      layout: {
        name: "Layout & Spacing Rhythm",
        score: scoreForCat(cats.layout),
        ...cats.layout,
        passed: Math.max(0, doc.nodes.length - cats.layout.errors - cats.layout.warns),
      },
    },
  };
}

export interface NodeIndex {
  byId(id: string): CaptureNode | undefined;
}

export function indexNodes(doc: CaptureDoc): NodeIndex {
  const m = new Map<string, CaptureNode>();
  for (const n of doc.nodes) m.set(n.id, n);
  return { byId: (id) => m.get(id) };
}

