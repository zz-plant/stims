# Stims documentation

Start with [the app](https://toil.fyi), the [user guide](./USER_GUIDE.md), or [contributor setup](../CONTRIBUTING.md). Stims plays and edits MilkDrop presets in one browser workspace. Playback and local editing work without an AI service.

## Use Stims

| Task                                      | Read                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Play, choose audio, edit, save, and share | [User guide](./USER_GUIDE.md)                                                  |
| Write your first preset                   | [Authoring curriculum](./authoring/README.md)                                  |
| Look up functions and signals             | [Language reference](./authoring/reference.md), generated from the compiler    |
| Work with equations and shaders           | [MilkDrop coding guide](./MILKDROP_CODING_GUIDE.md)                            |
| Adjust sensory controls                   | [Accessibility guide](./guides/accessibility.md)                               |
| Run an unattended screen or sensory room  | [Sensory room setup](./guides/sensory-room.md)                                 |
| Capture a visual in OBS                   | [OBS setup](./OBS.md)                                                          |
| Share the project                         | [Launch material](./LAUNCH.md), [package launch drafts](./PACKAGE_LAUNCHES.md) |
| Understand project credits                | [Lineage and credits](./LINEAGE_AND_CREDITS.md)                                |
| Track upstream PRs and proposals          | [Upstream contributions](./UPSTREAM_CONTRIBUTIONS.md)                          |
| Submit a remix or view community showcase | [Community showcase & intake](./COMMUNITY_SHOWCASE.md)                         |

## Contribute

| Task                                | Read                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install and run locally             | [Setup](../CONTRIBUTING.md#set-up), [development](./DEVELOPMENT.md)                                                                                                            |
| Find the right module or instrument | [Onboarding](./ONBOARDING.md)                                                                                                                                                  |
| Choose tests and understand CI      | [Testing](./TESTING.md), [test directory map](../tests/INDEX.md)                                                                                                               |
| Check a user flow by hand           | [QA plan](./QA_PLAN.md)                                                                                                                                                        |
| Review enforced rules               | [Guardrails](./GUARDRAILS.md), generated from guard scripts                                                                                                                    |
| Prepare a commit or release         | [Commit conventions](./COMMIT_CONVENTIONS.md), [release checklist](./DEPLOYMENT.md#release-checklist), [changelog](../CHANGELOG.md), [dated release notes](./RELEASE_NOTES.md) |
| Deploy or preview                   | [Deployment](./DEPLOYMENT.md)                                                                                                                                                  |
| Maintain documentation              | [Maintenance rules](./DOCS_MAINTENANCE.md), [public docs site map](./PUBLIC_DOCS_SITE_MAP.md)                                                                                  |
| Work through an agent               | [Agent instructions](../AGENTS.md), [agent docs](./agents/README.md), [MCP server](./MCP_SERVER.md)                                                                            |
| Work on extracted libraries         | [Packages](../packages/README.md), [package promotion](./PACKAGE_PROMOTION.md)                                                                                                 |

`bun run help` lists every script with the purpose its source docblock gives.

## Understand the implementation

| Area                                                   | Read                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Current capabilities and limits                        | [Implementation status](./IMPLEMENTATION_STATUS.md), [page specifications](./PAGE_SPECIFICATIONS.md)                                     |
| Shell, URL state, and engine ownership                 | [Architecture](./ARCHITECTURE.md), [source map](./agents/src-map.md)                                                                     |
| Preset execution and audio signals                     | [Preset runtime](./MILKDROP_PRESET_RUNTIME.md), [EEL guest memory](./architecture/eel-guest-memory.md)                                   |
| WebGPU and WebGL rendering                             | [Rendering backends](./ARCHITECTURE.md#rendering-backends), [WebGPU flags](./MILKDROP_PRESET_RUNTIME.md#webgpu-descriptor-rollout-flags) |
| Measured runtime cost                                  | [Performance evidence](./RUNTIME_PERFORMANCE.md)                                                                                         |
| Reference capture and fidelity work                    | [Parity plan](./MILKDROP_PROJECTM_PARITY_PLAN.md)                                                                                        |
| Typed visual/audio judgments, curation, and evaluation | [Decision models](./DECISION_MODELS.md)                                                                                                  |
| Optional hosted endpoints                              | [API reference](./api.md), [OpenAPI schema](../public/openapi.json)                                                                      |
| Implemented systems and evidence limits                | [Technical foundations](./TECHNICAL_ACHIEVEMENTS.md)                                                                                     |
| Sensory research and literature                        | [Sensory accessibility](./SENSORY_ACCESSIBILITY.md), [literature map](./LITERATURE.md)                                                   |
| Dataset and model evaluation                           | [Training models](./guides/training-models.md)                                                                                           |

Certification targets, reference images, and measured results are separate records under `src/data/milkdrop-parity/`. Corpus membership or a successful compile does not establish visual parity. Dated reports below retain their original measurement scope.

## Plans and design studies

These documents describe priorities, proposed behavior, or an investigation at a particular revision. Consult source code and tests for what runs today.
- [Roadmap](./ROADMAP.md) and [product moments](./PRODUCT_MOMENTS.md); [the product record](../PRODUCT.md) (users, positioning, evidence) that design work starts from
- [Generative AI proposals](./GENERATIVE_AI_USE_CASES.md)
- [Learning-loop specification](./LEARNING_LOOPS_SPEC.md): planned retrieval, remix, repair, teaching, performance, and feedback contracts

## Historical evidence

- [May release evidence ledger](./evidence/RELEASE_EVIDENCE_LEDGER_2026-05.md)
- [May recurring-fix audit](./evidence/RECURRING_FIX_PATTERNS_AUDIT_2026-05.md)
- [Public-claim audit](./evidence/public-claim-audit.md)
- [Archive](./archive/) of superseded plans and dated reports, including the parity backlog, the frontend performance audit, the WebGPU revamp plan, the September architecture proposal and toolchain audit, the authoring curriculum plan, and the fallback, shader and rasterization studies

Historical reports, reference provenance, and license texts are preserved. Generated references and public pages are updated through their generators; see [maintenance rules](./DOCS_MAINTENANCE.md).
