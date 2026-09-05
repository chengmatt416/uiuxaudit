# Contributing to uiuxaudit

Thank you for your interest in contributing to **uiuxaudit**! We welcome contributions, bug fixes, feature proposals, and documentation improvements.

## Guiding Principles

1. **Zero-LLM-Token Guarantee**:
   `uiuxaudit` is strictly deterministic. No AI/LLM SDKs (OpenAI, Anthropic, Google Generative AI, LangChain, etc.) may ever be added to dependencies. This is machine-enforced by `npm run ua -- audit-deps` and tested in CI.
2. **Strict Determinism**:
   All audit suggestions, scoring, diffs, and Figma ops generation must be 100% deterministic and reproducible across machines.
3. **High Fidelity**:
   Any Figma generation or CSS parsing changes must maintain $\ge 95\%$ coverage and $\le 2\text{px}$ alignment thresholds against verified baselines.

---

## Development Setup

### Prerequisites
- Node.js 20+ (Node 22 recommended)
- Chromium (or set `UA_CHROMIUM=/path/to/chromium` / installed via `pkg install chromium` / Chrome installed)

### Quick Start
```sh
# Clone the repository
git clone https://github.com/chengmatt416/uiuxaudit.git
cd uiuxaudit

# Install dependencies
npm install

# Run the local Minimalist GUI Studio
npm run gui

# Run the test suite
npm test
```

---

## Testing & Quality Assurance

Before submitting a Pull Request, verify that all test suites pass:

```sh
# Run full suite (Typecheck, Zero-token audit, REST verifier, loop, features, UI, PWA, extensions)
npm test

# Run individual checks
npm run typecheck       # TypeScript compilation
npm run audit-deps      # Verify no AI SDK dependencies
npm run smoke:features  # Engine scoring, tokens, reports, patches, and diffs
npm run smoke:ui        # Headless Chromium canvas rendering
```

---

## Pull Request Guidelines

1. Branch from `main` with a descriptive name (e.g., `feat/rule-focus-visible` or `fix/canvas-zoom`).
2. Include tests for any new rules, parsers, or token extractors in `scripts/features-smoke.ts` or corresponding smoke tests.
3. Ensure `npm test` passes with exit code 0.
4. Keep commit messages clear and descriptive following conventional commits (e.g., `feat: ...`, `fix: ...`, `docs: ...`).

---

## Code of Conduct

Please review and adhere to our [Code of Conduct](CODE_OF_CONDUCT.md) in all community interactions.
