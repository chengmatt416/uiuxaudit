/** RGBA with channels in 0..1, matching Figma's color space. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type Kind = "frame" | "text" | "image" | "vector";

export type TextAlign = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";

/**
 * Provenance of a node's style for source-code suggestion application.
 * Only produced for source-mode captures (local project / git repo served
 * over localhost so stylesheets are same-origin and readable).
 */
export interface Provenance {
  /** Stylesheet URL the winning declarations came from. */
  cssHref: string;
  /** Winning selector for the recorded declarations. */
  selector: string;
  /** Winning declarations for suggestion-relevant properties. */
  decls: Record<string, string>;
  /** Inline style attribute declarations (highest precedence). */
  inline: Record<string, string>;
}

export interface CaptureNode {
  /** Stable id, assigned in document order: e1, e2, ... */
  id: string;
  tag: string;
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Own background color; omitted when transparent. */
  bgColor?: RGBA;
  /** First opaque ancestor background, resolved for contrast checks. */
  effectiveBg?: RGBA;
  /** Product of ancestor opacities times own opacity (default 1). */
  opacity?: number;
  border?: { width: number; color: RGBA };
  /** Corner radii in px: [tl, tr, br, bl]. */
  radii?: [number, number, number, number];
  // --- text nodes ---
  text?: string;
  textColor?: RGBA;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number | null;
  letterSpacing?: number | null;
  textAlign?: TextAlign;
  /** Background the text was measured against (alias of effectiveBg). */
  // --- media nodes ---
  imageUrl?: string;
  imageDataUrl?: string;
  // --- structure ---
  parent: string | null;
  /** Document-order index for stable layering. */
  order: number;
  /** Interactive element hint (a, button, input, select, textarea, role=button). */
  interactive?: boolean;
  /** Present in source mode only. */
  provenance?: Provenance;
}

export interface CaptureDoc {
  version: 1;
  slug: string;
  url: string;
  title: string;
  viewportWidth: number;
  viewportHeight: number;
  docWidth: number;
  docHeight: number;
  rootBg?: RGBA;
  /** Source-mode captures: project dir the URL was served from. */
  projectDir?: string;
  nodes: CaptureNode[];
  capturedAt: string;
}

/** One suggested change, deterministically derived from a capture. */
export interface Suggestion {
  /** Stable id: rule-priority ordinal, e.g. "s001". */
  id: string;
  rule:
    | "contrast"
    | "touch-target"
    | "font-scale"
    | "spacing-rhythm"
    | "line-length";
  severity: "error" | "warn" | "info";
  message: string;
  targetIds: string[];
  /** Fixes to apply. */
  fixes: Fix[];
}

export type Fix =
  | { kind: "setTextColor"; nodeId: string; value: RGBA }
  | { kind: "setBackgroundColor"; nodeId: string; value: RGBA }
  | { kind: "setFontSize"; nodeId: string; value: number }
  | { kind: "setSize"; nodeId: string; w: number; h: number }
  | { kind: "setSnapY"; nodeId: string; value: number };

/** Serialized op handed to the Figma plugin's apply mode. */
export interface FigmaOp {
  id: string;
  op:
    | "setFill"
    | "setBackground"
    | "setFontSize"
    | "setSize"
    | "setSnapY";
  value?: unknown;
  w?: number;
  h?: number;
}

export interface VerifyReport {
  slug: string;
  fileKey: string;
  total: number;
  found: number;
  coverage: number;
  passed: boolean;
  mismatches: Mismatch[];
  checkedAt: string;
}

export interface Mismatch {
  id: string;
  field: "missing" | "x" | "y" | "w" | "h" | "bgColor" | "textColor" | "fontSize" | "characters";
  expected: string;
  actual: string;
  delta?: number;
}
