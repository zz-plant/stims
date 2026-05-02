---
name: audit-recurring-fixes
description: "Audit commit history to find recurring fix patterns and update prevention skills. Use when analyzing what keeps breaking, updating review skills, or refreshing the fix-pattern audit doc."
---

# Audit Recurring Fix Patterns

Use this skill when you need to understand what the codebase keeps getting wrong, update the prevention skills, or refresh the audit doc.

## Why this exists

Fixes cluster in predictable categories. This skill turns commit archaeology into actionable prevention by:
1. Sampling recent commits for fix/regression/revert patterns
2. Categorizing them by subsystem
3. Cross-referencing with existing audit docs
4. Updating or creating review skills that gate the high-churn surfaces

## Quick audit loop

### 1. Gather commit sample

```bash
# Last 300-400 commits, fix-focused
git log --oneline -400 > /tmp/all_commits.txt
git log --oneline --grep="fix" -i -300 > /tmp/fix_commits.txt
git log --oneline --grep="revert" -i -300 > /tmp/revert_commits.txt
```

### 2. Categorize fixes

Look for these recurring themes:

| Theme | Keywords in commit messages | Typical files |
|-------|---------------------------|---------------|
| **Parity drift** | `parity`, `blend`, `feedback`, `shader`, `wave`, `webgpu` | `feedback-manager-*`, `renderer-adapter*`, `compiler/gpu-descriptor-plan.ts` |
| **Fallback fragility** | `fallback`, `timeout`, `renderScale`, `capability`, `probe` | `renderer-setup.ts`, `renderer-capabilities.ts`, `render-service.ts`, `backend-fallback.ts` |
| **Test harness drift** | `test`, `expect`, `fixture`, `harness` | `tests/milkdrop-renderer-adapter.test.ts`, `tests/environment/*` |
| **UI/state races** | `toast`, `toggle`, `url`, `workspace`, `panel` | `frontend/App.tsx`, `frontend/workspace-hooks.ts`, `frontend/url-state.ts` |
| **Deploy/tooling** | `deploy`, `config`, `wrangler`, `ci` | `scripts/deploy-cloudflare.mjs`, `wrangler.toml` |

### 3. Find the hottest files

```bash
git log --format="%H" -300 | while read h; do
  git show --stat --oneline $h 2>/dev/null | grep -E "^\s+.*\|"
done | awk -F'|' '{print $1}' | sed 's/^[[:space:]]*//' | sort | uniq -c | sort -rn | head -20
```

High-churn + high-fix-density files are **instability clusters**.

### 4. Update prevention skills

If a new fix category is emerging or an existing one is growing:

1. Read the relevant review skill:
   - `.agent/skills/review-webgpu-parity/SKILL.md`
   - `.agent/skills/review-renderer-fallback/SKILL.md`
   - `.agent/skills/review-test-harness/SKILL.md`
   - `.agent/skills/review-workspace-ui-state/SKILL.md`

2. Add new checklist items or tighten existing ones based on the fresh fix patterns.

3. If a *new* category appears (e.g., "audio permission regressions"), create a new review skill following the pattern:
   - `name` and `description` frontmatter
   - "Why this exists" paragraph
   - Pre-merge checklist with file-specific validation commands
   - "What to reject in review" section
   - Related skills cross-links

### 5. Refresh the audit doc

Update `docs/RECURRING_FIX_PATTERNS_AUDIT_YYYY-MM.md` with:
- New fix counts and percentages
- Updated hottest-files list
- New root-cause themes
- Revised recommendations

## Maintenance rules

- Run this audit quarterly or after any sprint with >5 fix commits.
- When creating a new review skill, register it in:
  - `scripts/mcp-shared.ts` (import, `markdownSources`, `agentCapabilities`)
  - `docs/agents/custom-capabilities.md` (skills table)
  - `docs/agents/visualizer-workflows.md` (review skills section)
- Keep the audit doc and review skills aligned: if a skill checklist changes, mention the date in the audit doc.

## Related skills

- [`review-webgpu-parity`](../review-webgpu-parity/SKILL.md)
- [`review-renderer-fallback`](../review-renderer-fallback/SKILL.md)
- [`review-test-harness`](../review-test-harness/SKILL.md)
- [`review-workspace-ui-state`](../review-workspace-ui-state/SKILL.md)
