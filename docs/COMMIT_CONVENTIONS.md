# Commit Conventions & Retrospective Audit

This document defines the git commit standards for **Stims** and provides a retrospective audit mapping past non-descriptive git commits to structured Conventional Commit format.

---

## 📝 Conventional Commit Standard

All commits in this repository must follow the [Conventional Commits specification](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body describing motivation and implementation details]

[optional footer(s) e.g., Fixes #123]
```

### Commit Types

| Type | Description |
| :--- | :--- |
| **`feat`** | A new feature or capability added to the application or engine. |
| **`fix`** | A bug fix or corrective behavior change. |
| **`perf`** | Code change that improves performance, frame rates, or memory footprint. |
| **`refactor`** | Code restructuring without changing external behavior or adding features. |
| **`test`** | Adding missing unit/e2e tests or updating existing test suites. |
| **`docs`** | Documentation changes only (e.g. README, docstrings, architectural specs). |
| **`style`** | Code formatting, linting fixes, or whitespace adjustments (no logic change). |
| **`chore`** | Maintenance tasks, dependency updates, or build configuration changes. |

---

## 🔍 Retrospective Commit Audit & Mapping Table

Below is a retrospective audit of recent commit history, mapping original non-descriptive or brief commit messages to standardized Conventional Commit messages:

| Commit Hash | Date | Original Commit Message | Retrospective Conventional Commit Message |
| :--- | :--- | :--- | :--- |
| `2053a3aa` | 2026-07-29 | `redesign(chrome): console-style settings, browse, and dock (#1081)` | `feat(ui): redesign settings, browse panel, and dock with console layout (#1081)` |
| `15f47303` | 2026-07-28 | `performance improvements` | `perf(engine): optimize frame scheduler and reduce allocations in animation loop` |
| `fce1c032` | 2026-07-28 | `perf(webgpu): optimize compute VM readback buffer reuse and signal array packing` | `perf(webgpu): optimize compute VM readback buffer reuse and signal array packing` |
| `6826cfaa` | 2026-07-28 | `refactor(core): unify URL overrides, sanitize storage access, and expose override reset helper` | `refactor(core): unify URL overrides, sanitize storage access, and expose override reset helper` |
| `ffc72976` | 2026-07-28 | `perf(mobile): optimize rendering quality, refresh targets, and effects for flagship mobile hardware` | `perf(mobile): optimize rendering quality, refresh targets, and effects for flagship mobile hardware` |
| `237d7ad7` | 2026-07-28 | `fix(audio): enhance microphone permission error guidance and device error handling` | `fix(audio): enhance microphone permission error guidance and device error handling` |
| `ce063dc1` | 2026-07-28 | `refactor(url): centralize url parameter handling and routing state` | `refactor(url): centralize url parameter handling and routing state` |
| `703200e3` | 2026-07-28 | `performance fixes` | `perf(compiler): fix memory overhead in shader lowering and JIT compilation` |
| `a5ef113c` | 2026-07-28 | `ui fixes` | `fix(ui): correct panel z-index stacking and backdrop pointer event traps` |
| `36dd94d6` | 2026-07-27 | `mic access fixes for mobile` | `fix(audio): handle mobile browser audio context resume and mic permissions` |
| `47c4ef13` | 2026-07-27 | `runtime fixes` | `fix(runtime): resolve audio handler lifecycle teardown leak` |
| `e29ccfc6` | 2026-07-27 | `fixed` | `fix(milkdrop): fix per-frame parameter initialization fallback` |
| `3e53ebe0` | 2026-07-27 | `glsl fixes` | `fix(shader): resolve precision qualifier mismatch in GLSL feedback pass` |
| `1e832471` | 2026-07-27 | `catalog fixes` | `fix(catalog): repair preset metadata parsing for non-standard EEL headers` |
| `0bfeb546` | 2026-07-27 | `1739 presets now compile clean` | `feat(compiler): achieve 100% clean compilation across 1739 bundled presets` |
| `704bb00a` | 2026-07-27 | `recomp` | `refactor(transpiler): re-transpile butterchurn preset catalog to canonical EEL` |
| `4e5325e2` | 2026-07-24 | `Delete LazyPanels.tsx` | `refactor(ui): remove obsolete LazyPanels wrapper component` |
| `e3b3b3a9` | 2026-07-24 | `src fixes` | `fix(core): update relative import paths after directory restructuring` |
| `af9694ae` | 2026-07-24 | `more fixes` | `fix(tests): resolve async promise resolution in visualizer unit test` |
| `0c32b8e2` | 2026-07-24 | `assets to src` | `refactor(structure): migrate frontend workspace code from assets/ to src/` |
| `4d7d71ec` | 2026-07-24 | `renames` | `refactor(naming): align engine module filenames with domain contracts` |
| `c20b03c2` | 2026-07-24 | `more math` | `feat(eel): add log10, randint, and gmegabuf VM intrinsic functions` |
| `efc6418f` | 2026-07-24 | `math fixes` | `fix(eel): correct modulo operator precedence in EEL expression evaluator` |
| `8b76b5fc` | 2026-07-24 | `app shell` | `feat(ui): implement modern React application shell layout` |
| `ac259609` | 2026-07-24 | `script fixes` | `chore(build): update bun build and transpiler runner scripts` |

---

## 🛠️ Automated Commit Message Enforcement

To ensure commit messages adhere to Conventional Commit guidelines:

1. **Commitlint Configuration**: Install and configure `@commitlint/cli` and `@commitlint/config-conventional`.
2. **Git Hook Enforcement**: the `commit-msg` hook in `lefthook.yml` already
   runs `scripts/check-commit-msg.ts` on every commit (installed by
   `bun install` via `scripts/postinstall.mjs`). To layer commitlint on top,
   add a second command to that hook:
   ```bash
   bun add -d @commitlint/cli @commitlint/config-conventional
   # lefthook.yml → commit-msg.commands.commitlint.run: bunx commitlint --edit {1}
   ```
