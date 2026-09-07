<!--
These headings are a starting point, not a form. Write the description the
change deserves — a different shape is fine, and a better one is welcome. The
only thing CI insists on is that the description is not empty and that it says
how you know the change works: a command you ran, a test that covers it, or a
before/after measurement.
-->

## Summary

<!-- What changed and why. -->

## Testing

<!-- The tests or checks you ran, with commands and results. -->

-

## Docs touched

<!-- Docs updated/added, or "None". -->

-

## Review risk checklist

- [ ] Null/undefined paths reviewed for changed logic
- [ ] Async/lifecycle state transitions reviewed (loading, visibility, audio, teardown)
- [ ] Existing shared helper/module checked before introducing duplicate logic
- [ ] New visual literals use existing design tokens (or include a new named token)
- [ ] Behavior change is covered by tests (or reason provided)

## Quality checklist

- [ ] `bun run check:quick`
- [ ] `bun run check` (required for JS/TS changes)
- [ ] `bun run build` (if build/runtime output changed)
