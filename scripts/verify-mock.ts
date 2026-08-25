import { readFileSync } from "node:fs";
import { verifyCapture } from "../packages/core/src/index.js";
import type { CaptureDoc } from "../packages/core/src/index.js";

/**
 * Offline proof of the verify comparer: fabricate Figma REST responses that
 * mirror the example.com capture and assert PASS; then perturb fields and
 * assert FAIL detection.
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

function solid(color: { r: number; g: number; b: number }, a = 1) {
  return [
    {
      type: "SOLID",
      opacity: a,
      color: { r: color.r, g: color.g, b: color.b },
    },
  ];
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
  root.children = doc.nodes.map((n, i) => {
    if (n.kind === "text") {
      return {
        id: `10:${i}`,
        name: n.id,
        type: "TEXT",
        absoluteBoundingBox: { x: n.x, y: n.y, width: n.w, height: n.h },
        fills: n.textColor ? solid(n.textColor, n.textColor.a) : solid({ r: 0, g: 0, b: 0 }),
        characters: n.text,
        fontSize: n.fontSize,
      };
    }
    return {
      id: `10:${i}`,
      name: n.id,
      type: "RECTANGLE",
      absoluteBoundingBox: { x: n.x, y: n.y, width: n.w, height: n.h },
      fills: n.bgColor ? solid(n.bgColor, n.bgColor.a) : [],
    };
  });
  return root;
}

const doc = JSON.parse(
  readFileSync(".uiuxaudit/out/example.capture.json", "utf8"),
) as CaptureDoc;
const mirrored = mirror(doc);

const responses: Record<string, unknown> = {
  "files/testkey?depth=3": {
    document: {
      id: "0:0",
      name: "t",
      type: "DOCUMENT",
      children: [
        { id: "0:1", name: "Page 1", type: "CANVAS", children: [mirrored] },
      ],
    },
  },
  [`files/testkey/nodes?ids=${mirrored.id}&geometry=absolute_bounding_box`]: {
    nodes: { [mirrored.id]: { document: mirrored } },
  },
};

globalThis.fetch = (async (url: RequestInfo | URL) => {
  const u = String(url).replace("https://api.figma.com/v1/", "");
  const body = responses[u];
  if (!body) return new Response("{}", { status: 404 });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

const good = await verifyCapture({ token: "x", fileKey: "testkey", capture: doc });
console.log("perfect-copy:", good.passed ? "PASS" : "FAIL", "coverage", good.coverage);
if (!good.passed) {
  console.log(good.mismatches.slice(0, 8));
  process.exit(1);
}

// Perturb: shift one node 3px on x, darken one text fill, drop one node entirely
const victim = doc.nodes[0];
const victimNode = mirrored.children?.find((c) => c.name === victim.id);
if (victimNode?.absoluteBoundingBox) victimNode.absoluteBoundingBox.x += 3;

const textNode = doc.nodes.find((n) => n.kind === "text");
const textMirror = mirrored.children?.find((c) => c.name === textNode?.id);
if (textMirror?.fills?.[0].color) textMirror.fills[0].color.r += 0.2;

if (mirrored.children && mirrored.children.length > 2) mirrored.children.pop();

const bad = await verifyCapture({ token: "x", fileKey: "testkey", capture: doc });
console.log(
  "perturbed:",
  bad.passed ? "FAIL(detector broken)" : "PASS(detected)",
  "| mismatches:",
  bad.mismatches.map((m) => `${m.id}/${m.field}`).join(","),
);
console.log(
  "mutated textMirror:",
  JSON.stringify(mirrored.children?.find((c) => c.name === textNode?.id)?.fills),
);
console.log("all mismatches:", JSON.stringify(bad.mismatches));
process.exit(bad.passed ? 1 : 0);
