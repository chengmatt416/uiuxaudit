#!/usr/bin/env node
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline/promises";
import {
  applyFixesToDoc,
  captureUrl,
  fixesToFigmaOps,
  indexNodes,
  suggestFor,
  verifyCapture,
} from "@ua/core";
import type {
  CaptureDoc,
  Fix,
  FigmaOp,
  RGBA,
  Suggestion,
  VerifyReport,
} from "@ua/core";

// ---------------- tiny arg parsing ----------------

interface Parsed {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parse(argv: string[]): Parsed {
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const nx = argv[i + 1];
      if (nx !== undefined && !nx.startsWith("--")) {
        flags[key] = nx;
        i++;
      } else flags[key] = true;
    } else args[args.length] = a;
  }
  return { _: args, flags };
}

function num(v: string | boolean | undefined, dflt: number): number {
  const n = typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

// ---------------- state ----------------

const UA_DIR = ".uiuxaudit";
const OUT_DIR = join(UA_DIR, "out");
const STATE_PATH = join(UA_DIR, "state.json");

interface StateRec {
  fileKey?: string;
  capturePath?: string;
  appliedPath?: string;
}
type State = Record<string, StateRec>;

function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
  } catch {
    return {};
  }
}

function saveState(s: State): void {
  mkdirSync(UA_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function loadCapture(slug: string): CaptureDoc {
  const p = join(OUT_DIR, `${slug}.capture.json`);
  if (!existsSync(p)) throw new Error(`No capture for "${slug}". Run convert first.`);
  return JSON.parse(readFileSync(p, "utf8")) as CaptureDoc;
}

function loadSuggestions(slug: string): Suggestion[] {
  const p = join(OUT_DIR, `${slug}.suggestions.json`);
  if (!existsSync(p)) throw new Error(`No suggestions for "${slug}". Run suggest first.`);
  return JSON.parse(readFileSync(p, "utf8")) as Suggestion[];
}

// ---------------- local static server (source mode) ----------------

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

async function serveDir(dir: string): Promise<{ port: number; close(): void }> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let filePath = resolve(join(root, urlPath === "/" ? "index.html" : urlPath));
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      /* falls through to 404 */
    }
    try {
      const data = readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  const { promise, resolve: listening } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening());
  await promise;
  return {
    port: (server.address() as AddressInfo).port,
    close: () => server.close(),
  };
}

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30);
    return (u.hostname.replace(/\./g, "-") + (path ? "-" + path : "")).toLowerCase();
  } catch {
    return "page";
  }
}

// ---------------- commands ----------------

async function cmdConvert(p: Parsed): Promise<number> {
  if (!p._.length && !p.flags.project) {
    console.error(
      "usage: convert <url> [--name slug] [--vw W] [--vh H]\n       convert --project <dir> [--entry /index.html] [--name slug]",
    );
    return 2;
  }
  const projectDir = p.flags.project ? resolve(String(p.flags.project)) : undefined;
  let url = p._[0];
  let closeServer: (() => void) | undefined;
  try {
    if (!url && projectDir) {
      const srv = await serveDir(projectDir);
      closeServer = srv.close;
      const entry = typeof p.flags.entry === "string" ? p.flags.entry : "/index.html";
      url = `http://127.0.0.1:${srv.port}${entry}`;
    }
    if (!url) throw new Error("no URL resolved");
    const slug =
      typeof p.flags.name === "string" && p.flags.name
        ? p.flags.name
        : projectDir
          ? basename(projectDir)
          : slugFromUrl(url);
    console.error(`capturing ${url} …`);
    const doc = await captureUrl(url, {
      slug,
      viewportWidth: num(p.flags.vw, 1440),
      viewportHeight: num(p.flags.vh, 900),
      projectDir,
    });
    mkdirSync(OUT_DIR, { recursive: true });
    const outPath = join(OUT_DIR, `${slug}.capture.json`);
    writeFileSync(outPath, JSON.stringify(doc));
    const state = loadState();
    state[slug] = { ...state[slug], capturePath: outPath };
    saveState(state);
    const counts: Record<string, number> = { frame: 0, text: 0, image: 0, vector: 0 };
    for (const n of doc.nodes) counts[n.kind]++;
    console.log(
      JSON.stringify({ slug, nodes: doc.nodes.length, byKind: counts, capture: outPath }, null, 2),
    );
    console.log(
      [
        "",
        "Next steps:",
        "  1. Figma → Plugins → Development → Import plugin from manifest → packages/plugin/manifest.json",
        `  2. Run plugin (Import mode) → select ${outPath}`,
        `  3. npm run ua -- register ${slug} --link <figma-file-url>`,
        `  4. FIGMA_TOKEN=… npm run ua -- verify ${slug}`,
      ].join("\n"),
    );
    return 0;
  } finally {
    closeServer?.();
  }
}

function cmdRegister(p: Parsed): number {
  const slug = p._[0];
  const link = String(p.flags.link ?? "");
  if (!slug || !link) {
    console.error("usage: register <slug> --link <figma-file-url>");
    return 2;
  }
  const m = link.match(/figma\.com\/(?:design|file|proto|board|slides)\/([A-Za-z0-9]+)/);
  if (!m) {
    console.error("could not parse a Figma file key from that link");
    return 2;
  }
  const state = loadState();
  state[slug] = { ...state[slug], fileKey: m[1] };
  saveState(state);
  console.log(`${slug} → fileKey ${m[1]}`);
  return 0;
}

function printReport(r: VerifyReport): void {
  console.log(
    `[${r.slug}] coverage ${(r.coverage * 100).toFixed(2)}% (${r.found}/${r.total}) mismatches ${r.mismatches.length} → ${r.passed ? "PASS" : "FAIL"}`,
  );
  for (const m of r.mismatches.slice(0, 25)) {
    console.log(
      `  ${m.id.padEnd(8)} ${m.field.padEnd(11)} expected=${m.expected} actual=${m.actual}` +
        (m.delta !== undefined ? ` delta=${m.delta}` : ""),
    );
  }
  if (r.mismatches.length > 25) console.log(`  … +${r.mismatches.length - 25} more`);
}

async function cmdVerify(p: Parsed): Promise<number> {
  const token = process.env.FIGMA_TOKEN;
  if (!token) {
    console.error("FIGMA_TOKEN environment variable is required");
    return 2;
  }
  const state = loadState();
  const slugs = p._.length
    ? p._
    : Object.keys(state).filter((s) => state[s]?.capturePath);
  if (!slugs.length) {
    console.error("nothing registered to verify");
    return 2;
  }
  let allOk = true;
  for (const slug of slugs) {
    const rec = state[slug];
    if (!rec?.fileKey) {
      console.error(`${slug}: no registered Figma file (run register)`);
      allOk = false;
      continue;
    }
    try {
      const useApplied = p.flags.original !== true;
      const defaultCap = join(OUT_DIR, `${slug}.capture.json`);
      const defaultApp = join(OUT_DIR, `${slug}.applied.capture.json`);
      const appliedPath = rec.appliedPath || (existsSync(defaultApp) ? defaultApp : undefined);
      const capturePath = rec.capturePath || (existsSync(defaultCap) ? defaultCap : undefined);
      const basePath =
        useApplied && appliedPath && existsSync(appliedPath)
          ? appliedPath
          : capturePath;
      if (!basePath || !existsSync(basePath)) {
        console.error(`${slug}: capture missing`);
        allOk = false;
        continue;
      }
      console.error(
        `[${slug}] baseline: ${useApplied && appliedPath && basePath === appliedPath ? "applied" : "original"}`,
      );
      const report = await verifyCapture({
        token,
        fileKey: rec.fileKey,
        capture: JSON.parse(readFileSync(basePath, "utf8")) as CaptureDoc,
      });
      printReport(report);
      if (!report.passed) allOk = false;
    } catch (e) {
      console.error(`${slug}: verify failed: ${e instanceof Error ? e.message : e}`);
      allOk = false;
    }
  }
  return allOk ? 0 : 1;
}

function cmdSuggest(p: Parsed): number {
  const slug = p._[0];
  if (!slug) {
    console.error("usage: suggest <slug>");
    return 2;
  }
  const suggestions = suggestFor(loadCapture(slug));
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${slug}.suggestions.json`);
  writeFileSync(outPath, JSON.stringify(suggestions, null, 2));
  console.log(`${suggestions.length} suggestions → ${outPath}\n`);
  suggestions.forEach((s, i) =>
    console.log(
      `${String(i + 1).padStart(3)} [${s.severity.toUpperCase()}] ${s.rule.padEnd(13)} ${s.message}`,
    ),
  );
  return 0;
}

// ---------------- apply ----------------

function parseIdx(spec: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const t = part.trim();
    const rng = t.match(/^(\d+)-(\d+)$/);
    if (rng) {
      const lo = parseInt(rng[1], 10);
      const hi = Math.min(parseInt(rng[2], 10), max);
      for (let i = lo; i <= hi; i++) if (i >= 1) out.add(i - 1);
    } else {
      const i = parseInt(t, 10);
      if (i >= 1 && i <= max) out.add(i - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

async function pickInteractive(suggestions: Suggestion[]): Promise<Suggestion[]> {
  const selectable = suggestions
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s.fixes.length > 0);
  console.log("Selectable suggestions:");
  selectable.forEach((x) =>
    console.log(
      `${String(x.i + 1).padStart(3)} [${x.s.severity.toUpperCase()}] ${x.s.rule.padEnd(13)} ${x.s.message}`,
    ),
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const ans = await rl.question("\nselect (e.g. 1,3-5 / a=all / q=quit): ");
      const t = ans.trim();
      if (t === "q" || t === "") return [];
      if (t === "a") return selectable.map((x) => x.s);
      const chosen = parseIdx(t, suggestions.length);
      if (chosen.length) {
        return chosen
          .map((i) => suggestions[i])
          .filter((s) => s.fixes.length > 0);
      }
    }
  } finally {
    rl.close();
  }
}


function cssColor(c: RGBA): string {
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return c.a >= 1
    ? `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
    : `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${Number(c.a.toFixed(3))})`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hrefToLocalPath(href: string, projectDir: string): string | null {
  try {
    const u = new URL(href);
    if (u.hash.endsWith("#inline-style")) return null;
    return join(projectDir, decodeURIComponent(u.pathname));
  } catch {
    return null;
  }
}

/** Replace or insert one declaration inside the first matching rule block. */
function applyDecl(
  text: string,
  selector: string,
  prop: string,
  value: string,
): string {
  const open = text.match(new RegExp(escapeRegex(selector) + "\\s*\\{"));
  if (!open || open.index === undefined) {
    return `${text}\n${selector} { ${prop}: ${value}; }\n`;
  }
  const braceStart = text.indexOf("{", open.index);
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = text.slice(braceStart + 1, end);
  // Anchor the property to a declaration boundary so "color" cannot match
  // inside "background-color".
  const declRe = new RegExp(`(^|[;{])(\\s*)${prop}\\s*:\\s*[^;}]+;?`);
  const newBody = declRe.test(body)
    ? body.replace(declRe, `$1$2${prop}: ${value};`)
    : body.replace(/\s*$/, `\n  ${prop}: ${value};\n`);
  return text.slice(0, braceStart + 1) + newBody + text.slice(end);
}

function applySourceFixes(
  projectDir: string,
  doc: CaptureDoc,
  fixes: Fix[],
): string[] {
  const idx = indexNodes(doc);
  interface Item {
    file: string;
    selector: string;
    prop: string;
    value: string;
  }
  const items: Item[] = [];
  const notes: string[] = [];

  for (const f of fixes) {
    if (!f.nodeId) {
      notes.push("fix without a target node id (skipped)");
      continue;
    }
    const node = idx.byId(f.nodeId);
    const prov = node?.provenance;
    const decls: Array<[string, string]> = [];
    switch (f.kind) {
      case "setTextColor":
        decls.push(["color", cssColor(f.value)]);
        break;
      case "setBackgroundColor":
        decls.push(["background-color", cssColor(f.value)]);
        break;
      case "setFontSize":
        decls.push(["font-size", `${f.value}px`]);
        break;
      case "setSize":
        decls.push(["min-width", `${f.w}px`], ["min-height", `${f.h}px`]);
        break;
      case "setSnapY":
        notes.push(`${f.nodeId}: geometry snap not expressible in source CSS (skipped)`);
        continue;
    }
    if (!prov) {
      notes.push(`${f.nodeId}: no style provenance recorded (skipped)`);
      continue;
    }
    const file = hrefToLocalPath(prov.cssHref, projectDir);
    if (!file || !existsSync(file)) {
      notes.push(`${f.nodeId}: stylesheet ${prov.cssHref} not found locally (skipped)`);
      continue;
    }
    for (const [prop, value] of decls) {
      items.push({ file, selector: prov.selector, prop, value });
    }
  }

  const byFile = new Map<string, Item[]>();
  for (const it of items) {
    const list = byFile.get(it.file) ?? [];
    list.push(it);
    byFile.set(it.file, list);
  }
  for (const [file, list] of byFile) {
    let text = readFileSync(file, "utf8");
    for (const it of list) text = applyDecl(text, it.selector, it.prop, it.value);
    writeFileSync(file, text);
  }
  for (const n of notes) console.log(`  skip: ${n}`);
  return [...byFile.keys()].map((f) => relative(projectDir, f) || f);
}

async function cmdApply(p: Parsed): Promise<number> {
  const slug = p._[0];
  if (!slug) {
    console.error('usage: apply <slug> [--ids "1,3-5"] [--all]');
    return 2;
  }
  const doc = loadCapture(slug);
  const suggestions = loadSuggestions(slug);
  let selected: Suggestion[];
  if (p.flags.all === true) {
    selected = suggestions.filter((s) => s.fixes.length > 0);
  } else if (typeof p.flags.ids === "string") {
    selected = parseIdx(p.flags.ids, suggestions.length)
      .map((i) => suggestions[i])
      .filter((s) => s.fixes.length > 0);
  } else {
    selected = await pickInteractive(suggestions);
  }
  if (!selected.length) {
    console.log("nothing selected");
    return 0;
  }
  console.log(
    `applying ${selected.length} suggestion(s): ${selected.map((s) => s.id).join(", ")}`,
  );
  const fixes = selected.flatMap((s) => s.fixes);
  if (doc.projectDir) {
    const changed = applySourceFixes(doc.projectDir, doc, fixes);
    console.log(changed.length ? `rewrote:\n  ${changed.join("\n  ")}` : "no files changed");
    return changed.length ? 0 : 1;
  }
  const ops = fixesToFigmaOps(fixes);
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${slug}.ops.json`);
  writeFileSync(outPath, JSON.stringify({ slug, ops }, null, 2));
  const patched = applyFixesToDoc(doc, fixes);
  const appliedPath = join(OUT_DIR, `${slug}.applied.capture.json`);
  writeFileSync(appliedPath, JSON.stringify(patched));
  const st = loadState();
  st[slug] = { ...st[slug], appliedPath };
  saveState(st);
  console.log(
    `${ops.length} figma ops → ${outPath}\napplied baseline → ${appliedPath}\n` +
      `Plugin → Apply mode → select this ops file (page must contain frame "page:${slug}")\n` +
      `After running Apply: FIGMA_TOKEN=… npm run ua -- verify ${slug}   # compares against the APPLIED baseline`,
  );
  return 0;
}

// ---------------- dependency audit ----------------

function cmdAuditDeps(): number {
  let names: string[];
  try {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages?: Record<string, unknown>;
    };
    const set = new Set<string>();
    for (const k of Object.keys(lock.packages ?? {})) {
      const last = k.split("node_modules/").pop() ?? "";
      if (last) set.add(last);
    }
    names = [...set];
  } catch {
    console.error("package-lock.json not found — run npm install first");
    return 2;
  }
  const AI_PATTERN =
    /^(openai$|@anthropic-ai|anthropic$|cohere-ai|cohere$|@google\/generative-ai|google-auth-library$|mistral$|@mistralai|ollama$|@huggingface|huggingface$|transformers$|langchain|llama-|@llama-index|gpt-|@ai-sdk|ai-sdk$|replicate$|together-ai)/;
  const flagged = names.filter((n) => AI_PATTERN.test(n));
  if (flagged.length) {
    console.error(`AI SDK dependencies found:\n  ${flagged.join("\n  ")}`);
    return 1;
  }
  console.log(`dependency tree clean (${names.length} packages, no AI SDKs)`);
  return 0;
}

// ---------------- entry ----------------

const HELP = `uiuxaudit — zero-token code/web → Figma transfer with UI/UX audit

commands:
  convert <url> [--name slug] [--vw W] [--vh H]
  convert --project <dir> [--entry /index.html] [--name slug]
  register <slug> --link <figma-file-url>
  verify [slug…]          requires FIGMA_TOKEN
  suggest <slug>
  apply <slug> [--ids "1,3-5"] [--all]
  audit-deps`;

export async function main(argv: string[]): Promise<number> {
  const p = parse(argv);
  const [cmd, ...rest] = p._;
  const sub: Parsed = { _: rest, flags: p.flags };
  switch (cmd) {
    case "convert":
      return await cmdConvert(sub);
    case "register":
      return cmdRegister(sub);
    case "verify":
      return await cmdVerify(sub);
    case "suggest":
      return cmdSuggest(sub);
    case "apply":
      return await cmdApply(sub);
    case "audit-deps":
      return cmdAuditDeps();
    default:
      console.log(HELP);
      return cmd ? 2 : 0;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2)));
}
