---
description: "Run typecheck + lint"
agent: build
---
tsc --noEmit||bun run build||bun run test
