import type { CaptureDoc, Fix, RGBA } from "./types.js";
import { indexNodes } from "./suggest.js";

function cssColor(c: RGBA): string {
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return c.a >= 1
    ? `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
    : `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${Number(c.a.toFixed(3))})`;
}

export interface PatchRule {
  selector: string;
  declarations: Array<{ property: string; value: string }>;
  nodeId: string;
  tag: string;
  notes: string[];
}

/**
 * Generates copyable, clean CSS overrides corresponding to the provided fixes.
 */
export function generateCssPatch(doc: CaptureDoc, fixes: Fix[]): string {
  const idx = indexNodes(doc);
  const bySelector = new Map<string, PatchRule>();

  for (const f of fixes) {
    if (!f.nodeId) continue;
    const node = idx.byId(f.nodeId);
    if (!node) continue;

    const selector =
      node.provenance?.selector ||
      (node.tag.toLowerCase() === "body"
        ? "body"
        : `${node.tag.toLowerCase()}[data-id="${node.id}"]`);

    let rule = bySelector.get(selector);
    if (!rule) {
      rule = {
        selector,
        declarations: [],
        nodeId: node.id,
        tag: node.tag.toLowerCase(),
        notes: [],
      };
      bySelector.set(selector, rule);
    }

    switch (f.kind) {
      case "setTextColor":
        rule.declarations.push({ property: "color", value: cssColor(f.value) });
        rule.notes.push(`improve contrast against background`);
        break;
      case "setBackgroundColor":
        rule.declarations.push({ property: "background-color", value: cssColor(f.value) });
        rule.notes.push(`contrast background adjustment`);
        break;
      case "setFontSize":
        rule.declarations.push({ property: "font-size", value: `${f.value}px` });
        rule.notes.push(`consolidate font scale / legibility`);
        break;
      case "setSize":
        rule.declarations.push(
          { property: "min-width", value: `${f.w}px` },
          { property: "min-height", value: `${f.h}px` },
        );
        rule.notes.push(`ensure minimum touch target size (>=24x24px)`);
        break;
      case "setSnapY":
        rule.notes.push(`align Y coordinate to grid (${f.value}px)`);
        break;
    }
  }

  const lines: string[] = [
    `/* ========================================================================== */`,
    `/* uiuxaudit CSS Patch — ${doc.slug} (${new Date().toISOString().split("T")[0]}) */`,
    `/* Fixes: ${fixes.length} changes applied */`,
    `/* ========================================================================== */`,
    ``,
  ];

  for (const [selector, rule] of bySelector) {
    if (!rule.declarations.length) continue;
    lines.push(`/* Node ${rule.nodeId} <${rule.tag}>: ${rule.notes.join("; ")} */`);
    lines.push(`${selector} {`);
    for (const d of rule.declarations) {
      lines.push(`  ${d.property}: ${d.value};`);
    }
    lines.push(`}`, ``);
  }

  return lines.join("\n");
}
