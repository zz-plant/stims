# EEL conformance specification

The corpus has moved to [`packages/eel-conformance/`](../../packages/eel-conformance/README.md),
published to npm as `eel-conformance`, so projectM, Butterchurn and other
MilkDrop implementations can run the same cases. Its README holds the runner
contract, the section list, the gotchas and the open questions.

What stays here:

| Path | What it is |
| --- | --- |
| `index.ts` | Re-exports the package loader, so in-repo imports keep working. |
| `reference-runner.ts` | A conforming runner written against this repo's three tiers (`expression`, `interpreter`, `jit`): the worked example for anyone porting the corpus. |

Run it against this repo's tiers:

```bash
bun run spec:eel
```

`bun run check` enforces the same corpus through
`tests/unit/eel-conformance-spec.test.ts`.

To add or change a case, edit `packages/eel-conformance/cases/*.json` and
read the package README's "Contributing a case" section first: ids are
tracked by other implementations, and changing a pinned value is a
platform-semantics decision.
