# New-user route critique (browser traversal)

## Priority order (suggested fixes first)
1. **Route 1 modal/action hierarchy cleanup** (largest first-session friction)
2. **Route 2 capability card action hierarchy** (largest list-scanning friction)
3. **Navigation and language consistency polish** (important, but secondary)

## Route 1: Home → “Launch a recommended stim” → Toy page with capability-check modal

### What can be removed
- Remove either **“Launch a recommended stim”** or **“Run quick system check first”** from the primary hero action row. Showing both at the same visual priority creates first-click hesitation.
- Remove duplicate back affordances shown simultaneously on toy page entry (`←Back`, `← Back to library`, plus browser-back mental model).

### What needs to be rebuilt
- Rebuild the capability-check modal structure so it behaves like a short gate, not a multi-branch control center. The current set of same-priority paths (continue, skip, lighten mode, browse toys, rerun check) weakens user confidence.
- Rebuild toy-page action hierarchy so one primary “start now” path is visually dominant, with mic/capture alternatives clearly secondary.

### What needs modification
- Modify first-pass modal copy density: reduce stacked explanatory lines so status + next step are immediately scannable.
- Modify action ordering so the most reliable quick-start path is first and all fallback paths are visually demoted.
- Modify check terminology consistency (`check details`, `check again`, `skip this check`) so users can distinguish inspect vs rerun vs bypass instantly.

## Route 2: Home/Browse → Capabilities → Microphone capability listing

### What can be removed
- Remove repeated helper copy on every card (for example repeated “Tap anywhere on this card to open”) where clickability is already clear.
- Remove same-weight card actions that currently compete with each other at scan time.

### What needs to be rebuilt
- Rebuild capability-card action architecture so each card communicates one dominant outcome and subordinate outcomes as clearly secondary.
- Rebuild top-of-page filtering context so users understand inclusion/exclusion rules before parsing individual cards.

### What needs modification
- Modify first viewport balance to reduce competition between global navigation and page-local browsing controls.
- Modify card metadata rhythm (badges, “best for” cues, helper text) so users can compare cards quickly without full-description reading.
- Modify route language consistency (library vs browse vs open toy) so destination expectations are predictable.

## Overall judgment
- Discovery breadth is strong, but first-session confidence drops where too many controls share equal visual priority.
- The strongest path to improvement is **subtraction + hierarchy tightening**, not adding new interface elements.
