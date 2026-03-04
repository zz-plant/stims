## Summary

<!-- Briefly describe the changes and their purpose. -->

## Testing

<!-- List the tests you ran and the results. Include commands when possible. -->

-

## Docs touched

<!-- List docs updated/added, or write "None". -->

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
