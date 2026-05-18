# Test visualizer workflow

Use this runbook when the task is mainly validation, CI reproduction, or narrowing a visualizer regression.

## 1. Reproduce the failure first

- Start with the command from CI, docs, or the failing report.
- Record the first failing command and exact error before making changes.

## 2. Pick the narrowest useful check

For a focused unit or integration spec:

```bash
bun run test tests/path/to/spec.test.ts
```

For fast lint and type feedback:

```bash
bun run check:quick
```

For browser-backed runtime behavior:

```bash
bun run test:integration
```

For compatibility or preset-support behavior:

```bash
bun run test:compat
```

## 3. Run the full gate before sign-off

```bash
bun run check
```

Use `bun run` wrappers instead of raw test commands so repo scripts, setup, and environment defaults stay aligned.
