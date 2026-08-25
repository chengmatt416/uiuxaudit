import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { CaptureDoc, FigmaOp } from "../packages/core/src/index.js";

/**
 * Runs the REAL plugin code (packages/plugin/code.js) against a mock of the
 * Figma Plugin API, then asserts import + apply behavior on the example.com
 * capture. Proves the plugin logic before any human touches Figma.
 */

interface MockNode {
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  fills: unknown[];
  strokes: unknown[];
  strokeWeight: number;
  strokeAlign: string;
  topLeftRadius: number;
  topRightRadius: number;
  bottomRightRadius: number;
  bottomLeftRadius: number;
  clipsContent: boolean;
  characters?: string;
  fontSize?: number;
  fontName?: unknown;
  textAlignHorizontal?: string;
  lineHeight?: unknown;
  letterSpacing?: unknown;
  textAutoResize?: string;
  children: MockNode[];
  resize(w: number, h: number): void;
  appendChild(c: MockNode): void;
}

function mkNode(type: string, name = ""): MockNode {
  const n: MockNode = {
    type,
    name,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    opacity: 1,
    fills: [],
    strokes: [],
    strokeWeight: 0,
    strokeAlign: "INSIDE",
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomRightRadius: 0,
    bottomLeftRadius: 0,
    clipsContent: true,
    children: [],
    resize(w: number, h: number) {
      n.width = w;
      n.height = h;
    },
    appendChild(c: MockNode) {
      n.children.push(c);
    },
  };
  return n;
}

type Handler = (msg: Record<string, unknown>) => Promise<void> | void;

const created: MockNode[] = [];
const posted: Array<Record<string, unknown>> = [];
const fontsLoaded: string[] = [];

const figmaMock = {
  showUI: () => {},
  // code.js ASSIGNS figma.ui.onmessage; we read it back after require.
  ui: {
    onmessage: undefined as Handler | undefined,
    postMessage: (m: Record<string, unknown>) => {
      posted.push(m);
    },
  },
  currentPage: {
    appendChild: (n: MockNode) => {
      created.push(n);
    },
    findOne: (pred: (n: MockNode) => boolean): MockNode | undefined => {
      for (const root of created) {
        if (pred(root)) return root;
        const stack = [...root.children];
        while (stack.length) {
          const c = stack.shift()!;
          if (pred(c)) return c;
          stack.push(...c.children);
        }
      }
      return undefined;
    },
  },
  createFrame: () => mkNode("FRAME"),
  createRectangle: () => mkNode("RECTANGLE"),
  createText: () => mkNode("TEXT"),
  createImage: (_bytes: Uint8Array) => ({ hash: "img-mock" }),
  loadFontAsync: async (f: { family: string; style: string }) => {
    fontsLoaded.push(f.family + "/" + f.style);
  },
  viewport: { scrollAndZoomIntoView: () => {} },
};

(globalThis as Record<string, unknown>)["figma"] = figmaMock;
(globalThis as Record<string, unknown>)["__html__"] = "<html>mock</html>";

const require_ = createRequire(import.meta.url);
require_("../packages/plugin/code.js");

const messageHandler = figmaMock.ui.onmessage;
if (!messageHandler) throw new Error("plugin did not assign ui.onmessage");

const doc = JSON.parse(
  readFileSync(".uiuxaudit/out/example.capture.json", "utf8"),
) as CaptureDoc;

await messageHandler({ type: "import", payload: doc });

const root = created.find((n) => n.name === "page:" + doc.slug);
if (!root) throw new Error("root frame page:example not created");
if (root.width !== doc.docWidth || root.height !== doc.docHeight) {
  throw new Error(`root size ${root.width}x${root.height} != ${doc.docWidth}x${doc.docHeight}`);
}
if (root.children.length !== doc.nodes.length) {
  throw new Error(`expected ${doc.nodes.length} children, got ${root.children.length}`);
}

const byName = new Map(root.children.map((c) => [c.name, c]));
let checked = 0;
for (const n of doc.nodes) {
  const m = byName.get(n.id);
  if (!m) throw new Error("missing child " + n.id);
  if (Math.abs(m.x - n.x) > 0.01 || Math.abs(m.y - n.y) > 0.01) {
    throw new Error(`${n.id} position mismatch`);
  }
  if (Math.abs(m.width - n.w) > 0.01 || Math.abs(m.height - n.h) > 0.01) {
    throw new Error(`${n.id} size mismatch`);
  }
  if (n.kind === "text") {
    if (m.characters !== n.text) throw new Error(`${n.id} characters mismatch`);
    if (m.fontSize !== n.fontSize) throw new Error(`${n.id} fontSize mismatch`);
  }
  checked++;
}

const doneMsg = posted.find((m) => m["type"] === "done") as
  | { created: number; failed: number }
  | undefined;
if (!doneMsg || doneMsg.failed !== 0) throw new Error("import reported failures");

// ---- apply path: run a real ops payload through runApply ----
const target = doc.nodes.find((n) => n.kind === "text")!;
const before = byName.get(target.id)!.fontSize;
const ops: FigmaOp[] = [{ id: target.id, op: "setFontSize", value: 42 }];
await messageHandler({ type: "apply", payload: { slug: doc.slug, ops } });
const after = byName.get(target.id)!.fontSize;
if (after !== 42) throw new Error(`apply setFontSize failed: ${before} → ${after}`);
const appliedMsg = posted.find((m) => m["type"] === "applied") as
  | { applied: number; skipped: number }
  | undefined;
if (!appliedMsg || appliedMsg.applied !== 1) {
  throw new Error("apply reported wrong counts");
}

console.log(
  JSON.stringify(
    {
      root: root.name,
      children: root.children.length,
      geometryChecked: checked,
      fontsLoaded: fontsLoaded.length,
      importFailed: doneMsg.failed,
      applyProbe: { node: target.id, before, after },
    },
    null,
    2,
  ),
);
console.log("PLUGIN_SIM_OK");
