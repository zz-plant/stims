<!--
These headings are a starting point, not a form. Write the description the
change deserves — a different shape is fine, and a better one is welcome. CI
insists on two things: the description says how you know the change works (a
command you ran, a test that covers it, or a before/after measurement), and the
title works as a commit subject. Squash-merging makes the title main's subject
with " (#<number>)" appended, so keep it a Conventional Commits subject of 64
characters or fewer, with one type.

Write for a reviewer skimming: lead with a sentence or two they could stop
after, then the detail. Leave out what does not apply rather than marking it
"n/a". Before opening, check the change against these and mention only the
ones that need saying:
  - null/undefined paths in changed logic
  - async and lifecycle transitions (loading, visibility, audio, teardown)
  - an existing shared helper that already does this
  - new visual literals use design tokens (or add a named token)
  - a test covers the behaviour change, or the reason none does
  - `bun run check` for JS/TS changes; `bun run build` if build output changed

`bun run pr:body` scaffolds this from the diff, and
.claude/skills/steward/SKILL.md and docs/COMMIT_CONVENTIONS.md cover the rest.
-->

## Summary

<!-- What changed and why, in a sentence or two; detail after. -->

## Testing

<!-- Each command or check you ran, with its result. Name anything skipped. -->

-

## Docs touched

<!-- Docs updated/added, or "None". -->

-
