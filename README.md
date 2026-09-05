# uiuxaudit

[![CI](https://github.com/chengmatt416/uiuxaudit/actions/workflows/ci.yml/badge.svg)](https://github.com/chengmatt416/uiuxaudit/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero-LLM-Tokens](https://img.shields.io/badge/Tokens-0%20(Deterministic)-10b981.svg)](#architecture)
[![Release](https://img.shields.io/github/v/release/chengmatt416/uiuxaudit?color=38bdf8)](https://github.com/chengmatt416/uiuxaudit/releases/latest)

**Live Web GUI Studio**: [chengmatt416.github.io/uiuxaudit](https://chengmatt416.github.io/uiuxaudit/)  
**GitHub Repo**: [github.com/chengmatt416/uiuxaudit](https://github.com/chengmatt416/uiuxaudit) · **Releases**: [Releases / Download](https://github.com/chengmatt416/uiuxaudit/releases/latest)

Zero-LLM-token tool that transfers any web page (URL or local/GitHub source)
into a complete Figma design file, then audits it with deterministic,
rule-based UI/UX checks you can selectively accept and auto-apply.

## Architecture

```
packages/core    capture engine (headless Chromium + raw CDP), baseline schema,
                 Figma REST verify comparer, rule-based suggestion engine
packages/cli     uiuxaudit CLI (convert / register / verify / suggest / apply / audit-deps)
packages/plugin  Figma plugin (plain JS, zero network access) — import & apply bridge
```

Pipeline: `convert` launches headless Chromium, drives it over CDP, and
extracts every visible painted element plus its text runs into a
deterministic baseline JSON (`absolute` px geometry, colors, typography,
image bytes inlined as data URLs). The Figma plugin rebuilds that document
1:1 as a flat node tree named by capture id (`e1`, `e2`, …). `verify` reads
the file back through the read-only Figma REST API and diffs every node.

No LLM is involved anywhere; network access is limited to target sites,
`api.figma.com` (verify only), and image CDNs during capture. The plugin
manifest declares `"networkAccess": "none"`.

## Setup

```sh
npm install
pkg install chromium        # or set UA_CHROMIUM=/path/to/chromium
```

Import the plugin once in Figma:
**Plugins → Development → Import plugin from manifest… → `packages/plugin/manifest.json`**

## Usage

```sh
# 0. Launch the Production GUI Workspace (Minimalist Dark Studio)
npm run gui                              # or: npm run ua -- gui [--port 4173]

# 1. Capture a page → .uiuxaudit/out/<slug>.capture.json
npm run ua -- convert https://example.com --name example

# Local project / git checkout (served over localhost so stylesheets are readable)
npm run ua -- convert --project ./my-site --entry /index.html --name my-site

# 2. In Figma: run the plugin → Import mode → select the capture JSON

# 3. Register the resulting file (key is embedded in its URL)
npm run ua -- register example --link "https://www.figma.com/design/<KEY>/Name"

# 4. Verify transfer fidelity against the baseline
FIGMA_TOKEN=<personal access token> npm run ua -- verify example   # exit 0 = pass
FIGMA_TOKEN=… npm run ua -- verify                                 # all registered slugs

# 5. Audit + selective apply
npm run ua -- suggest example            # numbered findings + UI/UX Health Score & WCAG level
npm run ua -- apply example --ids 1,3-5  # or --all, or interactive picker
#   URL mode      → writes <slug>.ops.json (plugin Apply mode) AND
#                   <slug>.applied.capture.json; later `verify` runs compare
#                   against the APPLIED baseline (--original forces pristine)
#   project mode  → rewrites the source CSS in place (color/font-size/min-* rules)

# 6. Production Reports, Design Tokens & Code Patches
npm run ua -- report example             # self-contained interactive HTML audit report
npm run ua -- report example --format md # GitHub-flavored markdown report for PRs / CI
npm run ua -- tokens example             # extract design tokens (CSS variables)
npm run ua -- tokens example --format dtcg # W3C DTCG tokens JSON (Tokens Studio / Style Dictionary)
npm run ua -- patch example --all        # export copy-pasteable CSS fix declarations
npm run ua -- diff example               # structural diff: original vs applied capture
npm run ua -- batch sites.json           # audit full suite of sites with matrix scorecard

# Guardrail
npm run ua -- audit-deps                 # exits non-zero if any AI SDK appears
```


## Verification thresholds (machine-checked)

- node coverage ≥ 95% of captured visible elements
- position/size error ≤ 2px per node
- background/text color within 3/255 per channel (+alpha ±0.02)
- text content equal after whitespace normalization; font size within ±0.5px
- suggestion rules: WCAG contrast (4.5:1 / 3:1 large), 24px touch targets,
  font-scale consolidation (>6 sizes), line-length >100 characters

## Test set (fixed acceptance suite)

Recorded in `sites.json`: example.com, news.ycombinator.com,
playwright.dev/docs/intro, tailwindcss.com, github.com/microsoft/TypeScript.

### Verification scripts (`scripts/`)

| Script | Proves |
| --- | --- |
| `capture-smoke.ts` | capture engine end-to-end on a live URL |
| `verify-mock.ts` | REST comparer: perfect copy passes, position/color/missing perturbations detected |
| `ops-loop-mock.ts` | suggest → ops → apply → re-verify loop against the APPLIED baseline |
| `plugin-sim.ts` | the real `code.js` import/apply logic against a mock Plugin API |
| `cli-verify-mock.ts` | full CLI `verify` chain (state → baseline → report → exit code) via `UA_FIGMA_API` |
| `ui-smoke.ts` / `pwa-smoke.ts` / `ext-smoke.ts` | web UI rendering, service worker, extension capture |
| `finalize.sh` | one-shot finisher after the manual Figma import |

## Applications

One shared web UI (`apps/web`), packaged for every target:

| Target | Build | Artifact |
| --- | --- | --- |
| Web / PWA | `npm run build:web` | `apps/web/dist` — installable PWA (manifest + offline service worker); serve over http(s) |
| Chrome extension | `npm run build:ext` | `apps/extension/dist/chrome` (+`.zip`) — load unpacked via `chrome://extensions` |
| Firefox extension | `npm run build:ext` | `apps/extension/dist/firefox` (+`.zip`) — load via `about:debugging#/runtime/this-firefox` |
| macOS app (adhoc-signed) | `npm run build:desktop && npm run package:desktop -- darwin:arm64 darwin:x64` | `apps/desktop/release/uiuxaudit-<p>-<a>.zip` — every Mach-O ad-hoc signed with `rcodesign` (no Apple cert needed; Gatekeeper requires right-click→Open or `xattr -cr`) |
| Windows app | `npm run package:desktop -- win32:x64` | `uiuxaudit-win32-x64.zip` (portable `uiuxaudit.exe`) |
| Linux app | `npm run package:desktop -- linux:x64 linux:arm64` | `uiuxaudit-linux-*.tar.gz` |
| Android APK | push a `v*` tag or run manually → `android-apk` GitHub Action | `uiuxaudit-debug-apk` artifact (Capacitor shell; on-device SDK builds are not possible in the dev environment, CI is the supported path) |

Desktop shells expose the full pipeline in-app (Convert URL → audit → apply
→ Figma verify) over IPC; the PWA/extensions cover audit + apply + verify,
and the extensions additionally capture the current tab directly
(`activeTab` + scripting, no telemetry).

## Known limitations (v1)

- Flat layer structure (no CSS nesting reconstruction); visual fidelity unaffected.
- Fixed-position elements are captured at scroll-top snapshot position.
- Gradients/shadows are dropped (first SOLID paint wins); cross-origin SVG
  images fall back to a gray fill.
- Source-mode suggestions rewrite static CSS files; runtime JS-injected
  styles are outside provenance reach.
