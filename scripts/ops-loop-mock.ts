import { readFileSync } from "node:fs";
import {
  applyFixesToDoc,
  verifyCapture,
} from "../packages/core/src/index.js";
import type {
  CaptureDoc,
  FigmaOp,
  Fix,
  Suggestion,
} from "../packages/core/src/index.js";

/**
 * Offline proof of success-criterion 2's URL-mode loop:
 *   suggest → select → ops → (plugin apply) → re-verify against the
 *   APPLIED baseline passes, while the ORIGINAL baseline correctly fails.
 */

interface RestNode {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: Array<{
    type: string;
    visible?: boolean;
    opacity?: number;
    color?: { r: number; g: number; b: number };
  }>;
  characters?: string;
  fontSize?: number;
}

const clone = (c: { r: number; g: number; b: number }) => ({ ...c });

function solid(color: { r: number; g: number; b: number } | undefined, a = 1) {
  return color
    ? [{ type: "SOLID", opacity: a, color: clone(color) }]
    : [];
}

function mirror(doc: CaptureDoc): RestNode {
  const root: RestNode = {
    id: "1:2",
    name: `page:${doc.slug}`,
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: doc.docWidth, height: doc.docHeight },
    fills: solid(doc.rootBg ?? { r: 1, g: 1, b: 1 }),
    children: [],
  };
  root.children = doc.nodes.map((n, i) => ({
    id: `10:${i}`,
    name: n.id,
    type: n.kind === "text" ? "TEXT" : "RECTANGLE",
    absoluteBoundingBox: { x: n.x, y: n.y, width: n.w, height: n.h },
    fills:
      n.kind === "text"
        ? solid(n.textColor, n.textColor?.a ?? 1)
        : n.bgColor
          ? solid(n.bgColor, n.bgColor.a)
          : [],
    ...(n.kind === "text"
      ? { characters: n.text, fontSize: n.fontSize }
      : {}),
  }));
  return root;
}

/** Same mutation semantics as the plugin's runApply(). */
function applyOpsToMirror(mirrorRoot: RestNode, ops: FigmaOp[]): void {
  const byName = new Map<string, RestNode>();
  const walk = (n: RestNode): void => {
    byName.set(n.name, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(mirrorRoot);
  for (const op of ops) {
    const node = byName.get(op.id);
    if (!node) continue;
    switch (op.op) {
      case "setFill":
      case "setBackground": {
        const v = op.value as { r: number; g: number; b: number; a: number };
        node.fills = [{ type: "SOLID", opacity: v.a, color: { r: v.r, g: v.g, b: v.b } }];
        break;
      }
      case "setFontSize":
        node.fontSize = op.value as number;
        break;
      case "setSize":
        if (node.absoluteBoundingBox) {
          node.absoluteBoundingBox.width = op.w!;
          node.absoluteBoundingBox.height = op.h!;
        }
        break;
      case "setSnapY":
        if (node.absoluteBoundingBox) node.absoluteBoundingBox.y = op.value as number;
        break;
    }
  }
}

const doc = JSON.parse(
  readFileSync(".uiuxaudit/out/example.capture.json", "utf8"),
) as CaptureDoc;
const suggestions = JSON.parse(
  readFileSync(".uiuxaudit/out/example.suggestions.json", "utf8"),
) as Suggestion[];

// Select every suggestion that carries fixes (as `apply --all` would).
const selected = suggestions.filter((s) => s.fixes.length > 0);
const fixes: Fix[] = selected.flatMap((s) => s.fixes);
if (!fixes.length) {
  console.error("fixture has no applicable suggestions");
  process.exit(2);
}
console.log("selected:", selected.map((s) => `${s.id}/${s.rule}`).join(", "));

const toOps = (fs: Fix[]): FigmaOp[] =>
  fs.flatMap((f): FigmaOp[] => {
    switch (f.kind) {
      case "setTextColor":
        return [{ id: f.nodeId, op: "setFill", value: f.value }];
      case "setBackgroundColor":
        return [{ id: f.nodeId, op: "setBackground", value: f.value }];
      case "setFontSize":
        return [{ id: f.nodeId, op: "setFontSize", value: f.value }];
      case "setSize":
        return [{ id: f.nodeId, op: "setSize", w: f.w, h: f.h }];
      case "setSnapY":
        return [{ id: f.nodeId, op: "setSnapY", value: f.value }];
    }
  });
const ops = toOps(fixes);

const mirrored = mirror(doc);

const responses: Record<string, unknown> = {
  "files/k?depth=3": {
    document: {
      id: "0:0",
      name: "t",
      type: "DOCUMENT",
      children: [
        { id: "0:1", name: "Page 1", type: "CANVAS", children: [mirrored] },
      ],
    },
  },
  "files/k/nodes?ids=1:2&geometry=absolute_bounding_box": {
    nodes: { "1:2": { document: mirrored } },
  },
};
globalThis.fetch = (async (url: RequestInfo | URL) => {
  const u = String(url).replace("https://api.figma.com/v1/", "");
  const body = responses[u];
  return body
    ? new Response(JSON.stringify(body), { status: 200 })
    : new Response("{}", { status: 404 });
}) as typeof fetch;

const before = await verifyCapture({ token: "x", fileKey: "k", capture: doc });
console.log("pre-apply vs original baseline:", before.passed ? "PASS" : "FAIL");

applyOpsToMirror(mirrored, ops);
const applied = applyFixesToDoc(doc, fixes);

const stale = await verifyCapture({ token: "x", fileKey: "k", capture: doc });
console.log(
  "post-apply vs ORIGINAL baseline:",
  stale.passed ? "PASS (unexpected)" : `FAIL as expected (${stale.mismatches.length} deltas = the applied changes)`,
);

const after = await verifyCapture({
  token: "x",
  fileKey: "k",
  capture: applied,
});
console.log(
  "post-apply vs APPLIED baseline:",
  after.passed ? "PASS" : `FAIL ${JSON.stringify(after.mismatches.slice(0, 5))}`,
);

process.exit(after.passed && !stale.passed ? 0 : 1);
