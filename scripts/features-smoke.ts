import { readFileSync, existsSync } from "node:fs";
import {
  calculateAuditScore,
  compareCaptures,
  extractTokens,
  generateCssPatch,
  generateHtmlReport,
  generateMarkdownReport,
  suggestFor,
  tokensToCss,
  tokensToDtcg,
  tokensToTailwind,
} from "../packages/core/src/index.js";
import type { CaptureDoc } from "../packages/core/src/index.js";

const doc = JSON.parse(
  readFileSync(".uiuxaudit/out/example.capture.json", "utf8"),
) as CaptureDoc;

console.log("== 1. Testing Suggest & Audit Scoring ==");
const suggestions = suggestFor(doc);
const score = calculateAuditScore(doc, suggestions);
console.log("Score:", score.score, "Grade:", score.grade, "WCAG:", score.wcagLevel);
if (typeof score.score !== "number" || score.score <= 0 || score.score > 100) {
  throw new Error("Invalid score: " + score.score);
}
if (!score.grade || !score.wcagLevel) {
  throw new Error("Invalid grade or WCAG level");
}

console.log("== 2. Testing Design Tokens ==");
const tokens = extractTokens(doc);
console.log(`Extracted: ${tokens.colors.length} colors, ${tokens.typography.fontSizeScale.length} font sizes`);
if (tokens.colors.length === 0) throw new Error("No colors extracted");

const cssTokens = tokensToCss(tokens);
if (!cssTokens.includes(":root") || !cssTokens.includes("--color-")) {
  throw new Error("Invalid CSS tokens output");
}

const dtcgTokens = tokensToDtcg(tokens);
if (!dtcgTokens["$version"] || !dtcgTokens["color"]) {
  throw new Error("Invalid DTCG tokens output");
}

const tailwindConfig = tokensToTailwind(tokens);
if (!tailwindConfig.includes("tailwind.config.js") || !tailwindConfig.includes("extend")) {
  throw new Error("Invalid Tailwind config output");
}

console.log("== 3. Testing Report Generation ==");
const htmlReport = generateHtmlReport(doc, suggestions, score, tokens);
if (!htmlReport.includes("UI/UX Audit Report") || !htmlReport.includes("<!doctype html>")) {
  throw new Error("Invalid HTML report output");
}
const mdReport = generateMarkdownReport(doc, suggestions, score);
if (!mdReport.includes("# UI/UX Audit Report") || !mdReport.includes("Executive Scorecard")) {
  throw new Error("Invalid Markdown report output");
}

console.log("== 4. Testing CSS Patch Generation ==");
const fixes = suggestions.flatMap((s) => s.fixes);
const cssPatch = generateCssPatch(doc, fixes);
if (!cssPatch.includes("/* uiuxaudit CSS Patch") || (fixes.length > 0 && !cssPatch.includes("{"))) {
  throw new Error("Invalid CSS patch output");
}

console.log("== 5. Testing Capture Diff ==");
const appliedDocPath = ".uiuxaudit/out/example.applied.capture.json";
if (existsSync(appliedDocPath)) {
  const appliedDoc = JSON.parse(readFileSync(appliedDocPath, "utf8")) as CaptureDoc;
  const diff = compareCaptures(doc, appliedDoc);
  console.log(`Diff: ${diff.modifiedCount} modified nodes`);
  if (diff.modifiedCount === 0) throw new Error("Diff should have detected applied modifications");
}

console.log("FEATURES_SMOKE_OK");
