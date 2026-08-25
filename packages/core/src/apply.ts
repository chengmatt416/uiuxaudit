import type { CaptureDoc, Fix, FigmaOp } from "./types.js";

/**
 * Returns a patched copy of the capture reflecting accepted fixes. The input
 * document is NOT mutated: nodes are shallow-copied before any field changes,
 * so the original baseline stays intact for `verify --original`.
 */
export function applyFixesToDoc(doc: CaptureDoc, fixes: Fix[]): CaptureDoc {
  const nodes = doc.nodes.map((n) => ({ ...n }));
  const byId = new Map<string, CaptureDoc["nodes"][number]>();
  for (const n of nodes) byId.set(n.id, n);
  for (const f of fixes) {
    if (!f.nodeId) continue;
    const n = byId.get(f.nodeId);
    if (!n) continue;
    switch (f.kind) {
      case "setTextColor":
        n.textColor = { ...f.value };
        break;
      case "setBackgroundColor":
        n.bgColor = { ...f.value };
        break;
      case "setFontSize":
        n.fontSize = f.value;
        break;
      case "setSize":
        n.w = f.w;
        n.h = f.h;
        break;
      case "setSnapY":
        n.y = f.value;
        break;
    }
  }
  return { ...doc, nodes, capturedAt: new Date().toISOString() };
}

/** Serializes accepted fixes into plugin-executable operations. */
export function fixesToFigmaOps(fixes: Fix[]): FigmaOp[] {
  const ops: FigmaOp[] = [];
  for (const f of fixes) {
    switch (f.kind) {
      case "setTextColor":
        ops.push({ id: f.nodeId, op: "setFill", value: f.value });
        break;
      case "setBackgroundColor":
        ops.push({ id: f.nodeId, op: "setBackground", value: f.value });
        break;
      case "setFontSize":
        ops.push({ id: f.nodeId, op: "setFontSize", value: f.value });
        break;
      case "setSize":
        ops.push({ id: f.nodeId, op: "setSize", w: f.w, h: f.h });
        break;
      case "setSnapY":
        ops.push({ id: f.nodeId, op: "setSnapY", value: f.value });
        break;
    }
  }
  return ops;
}
