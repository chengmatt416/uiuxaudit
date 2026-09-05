import type { CaptureDoc, CaptureDiff } from "./types.js";

function round2(n: number | undefined): number | undefined {
  return n !== undefined ? Math.round(n * 100) / 100 : undefined;
}

/**
 * Compares two capture documents (e.g. original vs applied) and returns
 * a structured list of changes.
 */
export function compareCaptures(before: CaptureDoc, after: CaptureDoc): CaptureDiff {
  const afterMap = new Map(after.nodes.map((n) => [n.id, n]));
  const changes: CaptureDiff["changes"] = [];
  let modifiedCount = 0;

  for (const b of before.nodes) {
    const a = afterMap.get(b.id);
    if (!a) {
      changes.push({
        nodeId: b.id,
        tag: b.tag,
        field: "node",
        before: "present",
        after: "removed",
      });
      modifiedCount++;
      continue;
    }

    let nodeChanged = false;

    // Check geometry
    if (Math.abs(b.x - a.x) > 0.01) {
      changes.push({ nodeId: b.id, tag: b.tag, field: "x", before: round2(b.x), after: round2(a.x) });
      nodeChanged = true;
    }
    if (Math.abs(b.y - a.y) > 0.01) {
      changes.push({ nodeId: b.id, tag: b.tag, field: "y", before: round2(b.y), after: round2(a.y) });
      nodeChanged = true;
    }
    if (Math.abs(b.w - a.w) > 0.01) {
      changes.push({ nodeId: b.id, tag: b.tag, field: "w", before: round2(b.w), after: round2(a.w) });
      nodeChanged = true;
    }
    if (Math.abs(b.h - a.h) > 0.01) {
      changes.push({ nodeId: b.id, tag: b.tag, field: "h", before: round2(b.h), after: round2(a.h) });
      nodeChanged = true;
    }

    // Check font size
    if (b.fontSize !== undefined && a.fontSize !== undefined && Math.abs(b.fontSize - a.fontSize) > 0.1) {
      changes.push({ nodeId: b.id, tag: b.tag, field: "fontSize", before: b.fontSize, after: a.fontSize });
      nodeChanged = true;
    }

    // Check text color
    if (b.textColor && a.textColor) {
      const changed =
        Math.abs(b.textColor.r - a.textColor.r) > 0.01 ||
        Math.abs(b.textColor.g - a.textColor.g) > 0.01 ||
        Math.abs(b.textColor.b - a.textColor.b) > 0.01;
      if (changed) {
        changes.push({ nodeId: b.id, tag: b.tag, field: "textColor", before: b.textColor, after: a.textColor });
        nodeChanged = true;
      }
    }

    // Check bg color
    if (b.bgColor && a.bgColor) {
      const changed =
        Math.abs(b.bgColor.r - a.bgColor.r) > 0.01 ||
        Math.abs(b.bgColor.g - a.bgColor.g) > 0.01 ||
        Math.abs(b.bgColor.b - a.bgColor.b) > 0.01;
      if (changed) {
        changes.push({ nodeId: b.id, tag: b.tag, field: "bgColor", before: b.bgColor, after: a.bgColor });
        nodeChanged = true;
      }
    }

    if (nodeChanged) modifiedCount++;
  }

  return {
    slug: before.slug,
    nodeCountBefore: before.nodes.length,
    nodeCountAfter: after.nodes.length,
    modifiedCount,
    changes,
  };
}

/**
 * Returns a human-readable summary of capture differences.
 */
export function formatDiffSummary(diff: CaptureDiff): string {
  const lines: string[] = [
    `Capture Diff: ${diff.slug}`,
    `Nodes: ${diff.nodeCountBefore} before → ${diff.nodeCountAfter} after (${diff.modifiedCount} modified)`,
    "",
  ];

  if (!diff.changes.length) {
    lines.push("  No differences detected.");
    return lines.join("\n");
  }

  for (const c of diff.changes.slice(0, 50)) {
    lines.push(
      `  [${c.nodeId}] <${c.tag.toLowerCase()}> ${c.field}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`,
    );
  }

  if (diff.changes.length > 50) {
    lines.push(`  … +${diff.changes.length - 50} more changes`);
  }

  return lines.join("\n");
}
