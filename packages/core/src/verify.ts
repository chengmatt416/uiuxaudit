import type {
  CaptureDoc,
  Mismatch,
  VerifyReport,
} from "./types.js";

const POS_TOLERANCE_PX = 2;
const COLOR_TOLERANCE = 3 / 255;
const ALPHA_TOLERANCE = 0.02;
const FONT_SIZE_TOLERANCE = 0.51;

interface RestBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RestPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number };
}

interface RestNode {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: RestBoundingBox;
  fills?: RestPaint[];
  opacity?: number;
  characters?: string;
  fontSize?: number;
  style?: {
    fontSize?: number;
    textAlignHorizontal?: string;
  };
  children?: RestNode[];
}

interface RestFileResponse {
  document: { id: string; name: string; type: string; children?: RestNode[] };
}

interface RestNodesResponse {
  nodes: Record<string, { document: RestNode }>;
}

export interface VerifyOptions {
  token: string;
  /** Figma file key (from a file URL like figma.com/<name>-<key>). */
  fileKey: string;
  capture: CaptureDoc;
}

async function figmaGet<T>(path: string, token: string): Promise<T> {
  // UA_FIGMA_API exists for offline CLI tests; production default is official.
  const base = process.env.UA_FIGMA_API ?? "https://api.figma.com/v1";
  const res = await fetch(`${base}/${path}`, {
    headers: { "X-Figma-Token": token },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(
      `Figma API ${res.status} for /${path}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

function walk(node: RestNode, out: Map<string, RestNode>): void {
  out.set(node.name, node);
  for (const c of node.children ?? []) walk(c, out);
}

function firstSolidPaint(node: RestNode): RestPaint | undefined {
  for (const p of node.fills ?? []) {
    if (
      p.type === "SOLID" &&
      p.visible !== false &&
      p.color &&
      (p.opacity ?? 1) > 0
    ) {
      return p;
    }
  }
  return undefined;
}

function colorMatches(
  paint: RestPaint | undefined,
  expected: { r: number; g: number; b: number; a: number },
): boolean {
  if (!paint?.color) return false;
  const o = paint.opacity ?? 1;
  return (
    Math.abs(paint.color.r - expected.r) <= COLOR_TOLERANCE &&
    Math.abs(paint.color.g - expected.g) <= COLOR_TOLERANCE &&
    Math.abs(paint.color.b - expected.b) <= COLOR_TOLERANCE &&
    (expected.a >= 1 ? o >= 1 - ALPHA_TOLERANCE : Math.abs(o - expected.a) <= ALPHA_TOLERANCE)
  );
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Verifies a Figma file against its baseline capture via the read-only REST
 * API. Deterministic thresholds: coverage ≥95%, position/size ≤2px, colors
 * within 3/255 per channel.
 */
export async function verifyCapture(opts: VerifyOptions): Promise<VerifyReport> {
  const { token, fileKey, capture } = opts;
  const rootName = `page:${capture.slug}`;

  const file = await figmaGet<RestFileResponse>(
    `files/${fileKey}?depth=3`,
    token,
  );
  let rootId: string | undefined;
  for (const page of file.document.children ?? []) {
    for (const child of page.children ?? []) {
      if (child.name === rootName) {
        rootId = child.id;
        break;
      }
    }
    if (rootId) break;
  }
  if (!rootId) {
    throw new Error(
      `Frame "${rootName}" not found in file ${fileKey}. Import the capture first.`,
    );
  }

  const detail = await figmaGet<RestNodesResponse>(
    `files/${fileKey}/nodes?ids=${rootId}&geometry=absolute_bounding_box`,
    token,
  );
  const subtree = detail.nodes[rootId]?.document;
  if (!subtree) throw new Error(`Figma returned no subtree for node ${rootId}`);
  const byName = new Map<string, RestNode>();
  walk(subtree, byName);

  const mismatches: Mismatch[] = [];
  let found = 0;

  for (const cap of capture.nodes) {
    const node = byName.get(cap.id);
    if (!node) {
      mismatches.push({
        id: cap.id,
        field: "missing",
        expected: `${cap.kind} @(${cap.x},${cap.y})`,
        actual: "absent",
      });
      continue;
    }
    found++;
    const bb = node.absoluteBoundingBox;
    if (!bb) {
      mismatches.push({ id: cap.id, field: "missing", expected: "bbox", actual: "none" });
      continue;
    }
    const checks: Array<[Mismatch["field"], number, number]> = [
      ["x", bb.x, cap.x],
      ["y", bb.y, cap.y],
      ["w", bb.width, cap.w],
      ["h", bb.height, cap.h],
    ];
    for (const [field, actual, expected] of checks) {
      const delta = Math.abs(actual - expected);
      if (delta > POS_TOLERANCE_PX) {
        mismatches.push({
          id: cap.id,
          field,
          expected: String(Number(expected.toFixed(2))),
          actual: String(Number(actual.toFixed(2))),
          delta: Number(delta.toFixed(2)),
        });
      }
    }
    if (cap.bgColor && cap.bgColor.a > 0) {
      const p = firstSolidPaint(node);
      if (!colorMatches(p, cap.bgColor)) {
        mismatches.push({
          id: cap.id,
          field: "bgColor",
          expected: JSON.stringify(cap.bgColor),
          actual: p ? JSON.stringify(p.color) + "@" + (p.opacity ?? 1) : "none",
        });
      }
    }
    if (cap.kind === "text") {
      if (cap.textColor && cap.textColor.a > 0) {
        const p = firstSolidPaint(node);
        if (!colorMatches(p, cap.textColor)) {
          mismatches.push({
            id: cap.id,
            field: "textColor",
            expected: JSON.stringify(cap.textColor),
            actual: p ? JSON.stringify(p.color) + "@" + (p.opacity ?? 1) : "none",
          });
        }
      }
      if (cap.fontSize && node.fontSize) {
        if (Math.abs(node.fontSize - cap.fontSize) > FONT_SIZE_TOLERANCE) {
          mismatches.push({
            id: cap.id,
            field: "fontSize",
            expected: String(cap.fontSize),
            actual: String(node.fontSize),
          });
        }
      }
      if (cap.text && node.characters !== undefined) {
        if (norm(node.characters) !== norm(cap.text)) {
          mismatches.push({
            id: cap.id,
            field: "characters",
            expected: cap.text.slice(0, 60),
            actual: node.characters.slice(0, 60),
          });
        }
      }
    }
  }

  const coverage = capture.nodes.length ? found / capture.nodes.length : 1;
  return {
    slug: capture.slug,
    fileKey,
    total: capture.nodes.length,
    found,
    coverage,
    passed: coverage >= 0.95 && mismatches.length === 0,
    mismatches,
    checkedAt: new Date().toISOString(),
  };
}
