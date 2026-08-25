import type { CaptureDoc, Fix } from "./types.js";

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
