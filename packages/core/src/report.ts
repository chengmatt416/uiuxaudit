import type { AuditScore, CaptureDoc, DesignTokens, Suggestion } from "./types.js";
import { calculateAuditScore } from "./suggest.js";
import { extractTokens, tokensToCss } from "./tokens.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generates a self-contained, professional HTML audit report.
 */
export function generateHtmlReport(
  doc: CaptureDoc,
  suggestions: Suggestion[],
  providedScore?: AuditScore,
  providedTokens?: DesignTokens,
): string {
  const score = providedScore ?? calculateAuditScore(doc, suggestions);
  const tokens = providedTokens ?? extractTokens(doc);
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const gradeColor =
    score.grade.startsWith("A") ? "#2ea86c" :
    score.grade === "B" ? "#4da3ff" :
    score.grade === "C" ? "#d9a03c" : "#e5534b";

  const colorSwatches = tokens.colors
    .map(
      (c) => `
      <div class="swatch-card">
        <div class="swatch-preview" style="background:${c.hex}"></div>
        <div class="swatch-info">
          <div class="swatch-name">${escapeHtml(c.name)}</div>
          <div class="swatch-hex">${escapeHtml(c.hex)}</div>
          <div class="swatch-role">${escapeHtml(c.role)} (${c.count}×)</div>
        </div>
      </div>`,
    )
    .join("");

  const issueCards = suggestions
    .map((s, idx) => {
      const sevClass = s.severity;
      const targetStr = s.targetIds.length ? `Targets: ${s.targetIds.join(", ")}` : "Page level";
      const fixesSummary = s.fixes
        .map((f) => {
          switch (f.kind) {
            case "setTextColor":
              return `Set text color to rgba(${Math.round(f.value.r * 255)}, ${Math.round(f.value.g * 255)}, ${Math.round(f.value.b * 255)}, ${f.value.a})`;
            case "setBackgroundColor":
              return `Set bg color to rgba(${Math.round(f.value.r * 255)}, ${Math.round(f.value.g * 255)}, ${Math.round(f.value.b * 255)}, ${f.value.a})`;
            case "setFontSize":
              return `Set font-size to ${f.value}px`;
            case "setSize":
              return `Expand touch target to ${f.w}×${f.h}px`;
            case "setSnapY":
              return `Snap Y coordinate to ${f.value}px`;
            default:
              return "";
          }
        })
        .filter(Boolean)
        .join("; ");

      return `
      <div class="issue-card" data-severity="${s.severity}" data-rule="${s.rule}">
        <div class="issue-header">
          <span class="badge ${sevClass}">${s.severity.toUpperCase()}</span>
          <span class="issue-rule">${escapeHtml(s.rule)}</span>
          <span class="issue-id">${escapeHtml(s.id)}</span>
          <span class="spacer"></span>
          <span class="issue-targets">${escapeHtml(targetStr)}</span>
        </div>
        <div class="issue-message">${escapeHtml(s.message)}</div>
        ${fixesSummary ? `<div class="issue-fix"><strong>Recommended Fix:</strong> <code>${escapeHtml(fixesSummary)}</code></div>` : ""}
      </div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>UI/UX Audit Report — ${escapeHtml(doc.slug)}</title>
  <style>
    :root {
      --bg: #0e1116;
      --panel: #161b23;
      --panel-hover: #1c2430;
      --line: #232a35;
      --fg: #d7dde5;
      --dim: #8b95a3;
      --accent: #4da3ff;
      --ok: #2ea86c;
      --warn: #d9a03c;
      --err: #e5534b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
      padding: 0;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 24px;
    }
    header {
      border-bottom: 1px solid var(--line);
      padding-bottom: 24px;
      margin-bottom: 32px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }
    h1 { margin: 0 0 6px 0; font-size: 26px; font-weight: 700; }
    .subtitle { color: var(--dim); font-size: 14px; }
    .scorecard {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 24px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 32px;
    }
    .score-circle-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-right: 1px solid var(--line);
      padding-right: 24px;
    }
    .big-score {
      font-size: 56px;
      font-weight: 800;
      line-height: 1;
      color: ${gradeColor};
    }
    .score-grade {
      font-size: 18px;
      font-weight: 700;
      color: var(--dim);
      margin-top: 4px;
    }
    .wcag-badge {
      display: inline-block;
      margin-top: 12px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      background: ${score.wcagLevel === "Non-compliant" ? "rgba(229,83,75,0.2)" : "rgba(46,168,108,0.2)"};
      color: ${score.wcagLevel === "Non-compliant" ? "var(--err)" : "var(--ok)"};
      border: 1px solid ${score.wcagLevel === "Non-compliant" ? "var(--err)" : "var(--ok)"};
    }
    .cat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      align-content: center;
    }
    .cat-item {
      background: #11151c;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px 14px;
    }
    .cat-title { font-size: 12px; color: var(--dim); margin-bottom: 6px; }
    .cat-score { font-size: 20px; font-weight: 700; }
    .cat-meta { font-size: 11px; color: var(--dim); margin-top: 4px; }
    .cat-bar-wrap {
      background: var(--line);
      height: 4px;
      border-radius: 2px;
      margin-top: 8px;
      overflow: hidden;
    }
    .cat-bar-fill {
      height: 100%;
      border-radius: 2px;
      background: var(--accent);
    }
    .stats-summary {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      background: var(--panel);
      border: 1px solid var(--line);
    }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 99px;
      font-size: 10px;
      font-weight: 700;
    }
    .badge.error { background: #3a1715; color: #ff8f88; }
    .badge.warn { background: #392b12; color: #eec26a; }
    .badge.info { background: #14304a; color: #79bdff; }
    .toolbar {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .filter-btn {
      background: var(--panel);
      border: 1px solid var(--line);
      color: var(--fg);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    .filter-btn.active {
      background: var(--accent);
      color: #06121f;
      border-color: var(--accent);
      font-weight: 600;
    }
    .search-box {
      flex: 1;
      min-width: 200px;
      padding: 7px 12px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--fg);
      font-size: 13px;
    }
    .issue-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      transition: background 0.15s ease;
    }
    .issue-card:hover { background: var(--panel-hover); }
    .issue-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .issue-rule { font-weight: 600; font-size: 13px; }
    .issue-id { color: var(--dim); font-size: 11px; font-family: monospace; }
    .issue-targets { color: var(--dim); font-size: 11px; }
    .issue-message { font-size: 13.5px; margin-bottom: 8px; }
    .issue-fix {
      font-size: 12px;
      background: #0d1218;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      color: var(--dim);
    }
    .issue-fix code { color: var(--accent); font-family: monospace; }
    .swatches-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .swatch-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .swatch-preview { height: 50px; width: 100%; }
    .swatch-info { padding: 8px 10px; font-size: 11px; }
    .swatch-name { font-weight: 600; color: var(--fg); }
    .swatch-hex { color: var(--dim); font-family: monospace; }
    .swatch-role { color: var(--dim); font-size: 10px; margin-top: 2px; }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      margin: 40px 0 16px 0;
      border-bottom: 1px solid var(--line);
      padding-bottom: 8px;
    }
    .spacer { flex: 1; }
    @media print {
      body { background: #fff; color: #111; }
      .scorecard, .issue-card, .swatch-card { border: 1px solid #ccc; background: #fff; color: #111; }
      .toolbar, .search-box { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>UI/UX Audit Report</h1>
        <div class="subtitle">${escapeHtml(doc.title || doc.slug)} · <code>${escapeHtml(doc.url)}</code> · Generated ${dateStr}</div>
      </div>
      <div>
        <div class="subtitle" style="text-align:right">Captured Nodes: <strong>${doc.nodes.length}</strong></div>
        <div class="subtitle" style="text-align:right">Viewport: <strong>${doc.viewportWidth}×${doc.viewportHeight}</strong></div>
      </div>
    </header>

    <div class="scorecard">
      <div class="score-circle-box">
        <div class="big-score">${score.score}</div>
        <div class="score-grade">Grade ${score.grade}</div>
        <span class="wcag-badge">${score.wcagLevel === "Non-compliant" ? "WCAG: Non-compliant" : "WCAG: " + score.wcagLevel}</span>
      </div>
      <div class="cat-grid">
        ${Object.values(score.byCategory)
          .map(
            (cat) => `
          <div class="cat-item">
            <div class="cat-title">${escapeHtml(cat.name)}</div>
            <div class="cat-score">${cat.score}/100</div>
            <div class="cat-bar-wrap">
              <div class="cat-bar-fill" style="width:${cat.score}%; background:${cat.score > 85 ? "var(--ok)" : cat.score > 70 ? "var(--accent)" : "var(--warn)"}"></div>
            </div>
            <div class="cat-meta">${cat.errors} err · ${cat.warns} warn · ${cat.infos} info</div>
          </div>`,
          )
          .join("")}
      </div>
    </div>

    <div class="stats-summary">
      <div class="stat-pill"><strong>Total Findings:</strong> ${suggestions.length}</div>
      <div class="stat-pill"><span class="badge error">ERRORS</span> ${score.counts.error}</div>
      <div class="stat-pill"><span class="badge warn">WARNINGS</span> ${score.counts.warn}</div>
      <div class="stat-pill"><span class="badge info">INFO</span> ${score.counts.info}</div>
    </div>

    <div class="section-title">Audit Findings</div>

    <div class="toolbar">
      <button class="filter-btn active" data-filter="all">All (${suggestions.length})</button>
      <button class="filter-btn" data-filter="error">Errors (${score.counts.error})</button>
      <button class="filter-btn" data-filter="warn">Warnings (${score.counts.warn})</button>
      <button class="filter-btn" data-filter="info">Info (${score.counts.info})</button>
      <input type="text" id="filterInput" class="search-box" placeholder="Search rules, messages, or elements…" />
    </div>

    <div id="issuesContainer">
      ${issueCards || '<div class="subtitle">No findings detected. Document passed all rule checks.</div>'}
    </div>

    <div class="section-title">Extracted Design Tokens</div>
    <div class="subtitle">Detected color palette, hierarchy, and typography scale from the captured page.</div>
    <div class="swatches-grid">
      ${colorSwatches}
    </div>
  </div>

  <script>
    const btns = document.querySelectorAll(".filter-btn");
    const search = document.getElementById("filterInput");
    const cards = document.querySelectorAll(".issue-card");
    let currentFilter = "all";

    function update() {
      const q = (search.value || "").toLowerCase().trim();
      cards.forEach((c) => {
        const sev = c.dataset.severity;
        const text = c.textContent.toLowerCase();
        const matchesFilter = currentFilter === "all" || sev === currentFilter;
        const matchesSearch = !q || text.includes(q);
        c.style.display = matchesFilter && matchesSearch ? "" : "none";
      });
    }

    btns.forEach((b) => {
      b.addEventListener("click", () => {
        btns.forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        currentFilter = b.dataset.filter;
        update();
      });
    });

    search.addEventListener("input", update);
  </script>
</body>
</html>`;
}

/**
 * Generates a clean GitHub-Flavored Markdown summary report.
 */
export function generateMarkdownReport(
  doc: CaptureDoc,
  suggestions: Suggestion[],
  providedScore?: AuditScore,
): string {
  const score = providedScore ?? calculateAuditScore(doc, suggestions);
  const lines: string[] = [
    `# UI/UX Audit Report — ${doc.slug}`,
    "",
    `**URL:** \`${doc.url}\` · **Viewport:** ${doc.viewportWidth}×${doc.viewportHeight} · **Nodes:** ${doc.nodes.length}`,
    "",
    `## Executive Scorecard`,
    "",
    `| Metric | Value |`,
    `| --- | --- |`,
    `| **Overall Health Score** | **${score.score}/100** (Grade ${score.grade}) |`,
    `| **WCAG 2.1 Compliance** | **${score.wcagLevel}** |`,
    `| **Errors** | ${score.counts.error} |`,
    `| **Warnings** | ${score.counts.warn} |`,
    `| **Info** | ${score.counts.info} |`,
    "",
    `### Category Breakdown`,
    "",
    `| Category | Score | Issues |`,
    `| --- | --- | --- |`,
  ];

  for (const cat of Object.values(score.byCategory)) {
    lines.push(`| ${cat.name} | ${cat.score}/100 | ${cat.errors} err, ${cat.warns} warn, ${cat.infos} info |`);
  }

  lines.push("", `## Audit Findings (${suggestions.length})`, "");

  if (!suggestions.length) {
    lines.push("All deterministic UI/UX checks passed with zero violations.");
  } else {
    lines.push(`| ID | Severity | Rule | Message | Targets | Automated Fix |`);
    lines.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const s of suggestions) {
      lines.push(
        `| \`${s.id}\` | **${s.severity.toUpperCase()}** | \`${s.rule}\` | ${s.message} | ${s.targetIds.join(", ") || "-"} | ${s.fixes.length > 0 ? "Yes" : "Report only"} |`,
      );
    }
  }

  return lines.join("\n");
}
