# Agent Ergonomics Skill

Use this skill to work effectively with the repo's agent infrastructure — skills, workflows, sessions, and quality gates.

## When to use

- You feel friction navigating the agent docs
- You want to understand how pieces fit together
- You're improving the agent infrastructure itself

## Architecture of agent support

```
AGENTS.md  ─────────────────┐
    │                        │
    ▼                        │
.claude/CLAUDE.md ◄─────────┘  (Cline-specific overlay)
    │
    ├── docs/agents/README.md  (progressive disclosure index)
    │       ├── agent-handoffs.md       (bootstrap + delegation)
    │       ├── custom-capabilities.md  (skills vs workflows)
    │       ├── tooling-and-quality.md  (commands reference)
    │       ├── visual-testing.md       (browser QA)
    │       └── reference-docs.md       (unfamiliar areas)
    │
    ├── .agent/skills/*/SKILL.md  (concise playbooks)
    │   └── Use for repeatable task classes
    │
    └── .agent/workflows/*.md     (step-by-step runbooks)
        └── Use for multi-phase tasks
```

## Skill vs workflow — quick decision

| Need | Use |
|------|-----|
| "Tell me what to check after I edit X" | `.agent/skills/*/SKILL.md` |
| "Walk me through implementing X from scratch" | `.agent/workflows/*.md` |
| "I just need the commands" | `docs/agents/tooling-and-quality.md` |
| "I'm not sure where to start" | `.claude/CLAUDE.md` |

## Session lifecycle

### Start of day

```bash
bun run agent:status        # one-shot health check
bun run check:quick         # confirm codebase is clean
```

### During implementation

```bash
bun run check:quick         # after every significant edit
bun run test tests/…        # when behavior changed
```

### Before browser QA

```bash
bun run dev                 # start dev server
# open http://localhost:5173/?agent=true
```

### Before commit / PR

```bash
bun run check               # full gate
```

### End of day

```bash
bun run session:codex -- --stop   # clean up managed processes
```

## Shortcuts worth memorizing

| Shortcut | What it does |
|----------|--------------|
| `bun run agent:status` | Setup + session status combined |
| `bun run agent:verify` | Quick iterative validation loop |
| `bun run session:codex -- --profile review` | Warm dev server + typecheck watcher |
| `bun run check:quick` | Fast syntax / lint / type / catalog check |
| `bun run test:integration` | Browser-backed runtime tests |
| `bun run test:compat` | Preset / compatibility tests |

## VS Code tasks

The repo provides VS Code tasks for common agent actions. Open the Command Palette → "Run Task" to see:

- `agent:check:quick`
- `agent:test:integration`
- `agent:test:compat`
- `agent:session:start`
- `agent:session:stop`
- `agent:dev`

## Adding new skills or workflows

1. Create the file under `.agent/skills/<name>/SKILL.md` or `.agent/workflows/<name>.md`
2. Add it to the tables in:
   - `docs/agents/custom-capabilities.md`
   - `docs/agents/visualizer-workflows.md`
3. Update `docs/agents/README.md` if routing changed
4. Update `.claude/CLAUDE.md` if it's a top-tier skill
5. Run `bun run check:quick`

## Maintenance contract

When `.agent/skills/*` or `.agent/workflows/*` changes, update in the same change:

- `docs/agents/custom-capabilities.md`
- `docs/agents/visualizer-workflows.md` (if commands changed)
- `docs/agents/README.md` (if routing changed)
- `.claude/CLAUDE.md` (if top-tier skill list changed)
- `AGENTS.md` (if non-negotiable defaults changed)

## Getting help

- Stuck on which skill to use? Read `.claude/CLAUDE.md` → Task routing.
- Stuck on commands? Read `docs/agents/tooling-and-quality.md`.
- Stuck on delegation? Read `docs/agents/agent-handoffs.md`.
- Stuck on verification? Read `docs/agents/visual-testing.md`.
