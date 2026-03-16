# Code review comment patterns (GitHub PR comments snapshot)

> Historical context note (2026-03): This document predates the MilkDrop-led repositioning. Treat it as historical review-pattern context rather than the current product-positioning baseline.

Snapshot date: 2026-03-04

## Scope and method

- Source: GitHub Pull Request **review comments** API for `zz-plant/stims`.
- Endpoint queried: `GET /repos/zz-plant/stims/pulls/comments`.
- Dataset size: 775 review comments across pages 1-8 (`per_page=100`).
- Date range represented: 2025-11-17 through 2026-03-04.

## What comes up most often

### 1) Type safety, nullability, and defensive logic

Recurring feedback calls out:
- nullable assumptions,
- `null`/`undefined` edge behavior,
- unnecessary nullable checks,
- bypassing TypeScript safety (for example `@ts-nocheck`).

Why it repeats:
- rapid iteration across mixed JS/TS surfaces,
- browser API behavior that differs from assumed types,
- lifecycle-heavy code paths (loader, audio, preflight) where state changes quickly.

### 2) Correctness in edge cases

Frequent comments flag logic that is "mostly right" but breaks at boundaries:
- bucket/average math mismatches,
- duplicated calls or side-effects,
- visibility/audio lifecycle transitions,
- stale state after async operations.

Why it repeats:
- interactive runtime behavior is stateful and timing-sensitive,
- visual/audio toys often depend on per-frame or per-event calculations.

### 3) Consistency and hardcoded values (especially CSS tokens)

Reviewers repeatedly ask to replace near-duplicate literal values with shared tokens/constants.

Why it repeats:
- many small UI refinements land incrementally,
- local tweaks happen faster than tokenization/system updates.

### 4) Duplication that should become shared abstractions

Repeated requests to extract common classes/functions across toys and pages.

Why it repeats:
- similar toy patterns are implemented in parallel,
- copy-adapt cycles outpace later refactors.

### 5) Audio lifecycle and permission handling

Recurring issues in:
- permission state transitions,
- context suspend/resume/cleanup semantics,
- MediaStream source ownership.

Why it repeats:
- Web Audio + browser permission APIs are subtle,
- state transitions differ by tab visibility and user interaction timing.

## What to put in place to reduce/prevent this

## A. Add targeted CI lint/type gates for recurring classes

1. Enforce **no `@ts-nocheck`** in tracked source (except explicit allowlist).
2. Enable strict TS options where feasible (`strictNullChecks`, `noUncheckedIndexedAccess`) for touched modules first.
3. Add lint rule(s) for **duplicate literals** in CSS/TS where practical (or token-usage checks in style files).

## B. Introduce review checklists matched to failure modes

Use a small PR checklist template with explicit prompts:
- Null/undefined path reviewed?
- Async state transition reviewed?
- Shared helper already exists?
- New literal should be token/constant?
- Behavior change covered by test?

This catches many "high-frequency medium" issues before reviewer time.

## C. Extract and standardize high-churn shared utilities

Prioritize shared modules where comments cluster:
- audio lifecycle/permission helper,
- common toy base abstractions,
- shared numeric utilities for bucketing/normalization.

This turns repeated review comments into one-time library hardening.

## D. Add narrow regression tests for known weak spots

Add small, focused tests for:
- permission-state transitions after successful `getUserMedia`,
- visibility change behavior (`running`/`suspended`/cleanup),
- bucket math with non-divisible lengths,
- null-ish config defaults.

These are cheap tests that block recurring comment themes.

## E. Add "token-first" styling guardrails

- Document: "new visual values must use existing token or add a named token."
- Add PR checklist item: "Any new shadow/spacing/radius/color literal justified?"

## F. Measure improvement monthly

Track a simple trend from the same API endpoint each month:
- count comments by theme,
- top 10 files with repeated review issues,
- % of comments in "preventable" themes.

A lightweight monthly report keeps the quality loop visible.
