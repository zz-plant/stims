# Three typical user journeys: constructive critique

This note walks through three high-frequency journeys in Stim and calls out what is already working plus practical improvements.

## Journey 1: First-time visitor trying to find a fitting toy quickly

### Typical path
1. Land on the library page and scan hero CTAs.
2. Use search (for terms like “calm”, “microphone”, or “webgpu”) and curated filter chips.
3. Open a card from the resulting list.

### What works well
- The hero section gives immediate “start now” options and an explicit path to the full library.
- Search guidance is specific (“name, mood, tags, capabilities”), and search has focused affordances (keyboard hint, clear button, result status).
- The search haystack includes title, slug, description, tags, moods, capabilities, and WebGPU markers, so user wording is likely to match.

### Friction observed
- The search hint promises broad discovery, but users still need to infer *which* capability matters for their context (mic required vs demo audio available vs motion).
- If users are undecided, the current card experience can still feel metadata-heavy before they experience visual “wow”.

### Constructive improvements
- Add a compact “best for” line on cards (e.g., “quiet room”, “headphones”, “mobile tilt”) to reduce cognitive load before click-through.
- Add one-click “Play in demo mode” secondary actions on cards where demo audio is available, so users can skip permission anxiety at discovery time.
- Consider a tiny “new user route” toggle near search (e.g., “show me easiest starts first”) that boosts toys with low setup friction.

## Journey 2: Permission-cautious user launching a toy

### Typical path
1. Open `toy.html?toy=<slug>` from library or direct link.
2. Encounter capability preflight and audio source controls.
3. Choose between microphone, demo audio, or advanced capture options.

### What works well
- Audio controls now present microphone and demo audio as parallel first-class choices instead of hiding demo behind failure states.
- Preflight logic explicitly prefers demo audio when microphone is unsupported/denied and communicates fallback guidance.
- Starter tips and status messaging reduce ambiguity during first interaction.

### Friction observed
- “Choose how this toy listens” is clear, but users who are privacy-sensitive may still hesitate because tradeoffs are not summarized inline at decision moment.
- Advanced options (tab/YouTube) are useful, but users may not know when to use them versus demo audio.

### Constructive improvements
- Add one sentence under the row labels comparing outcomes (“Mic reacts to your room now; demo starts instantly with no permissions”).
- Add a subtle default badge (e.g., “Recommended first try”) that follows preflight outcomes (demo when mic denied; mic otherwise).
- For advanced options, include trigger copy such as “Use these when you want to react to media already playing.”

## Journey 3: User on unsupported hardware/browser opening a WebGPU-first toy

### Typical path
1. Open a WebGPU-first toy (for example `multi`).
2. Hit capability handling in the toy shell.
3. Either continue with WebGL fallback (when allowed) or return to library.

### What works well
- The capability error copy is concrete: it distinguishes “works best with WebGPU” from “requires WebGPU”.
- The fallback path is action-oriented (“Continue with WebGL”) and not just a dead-end warning.
- Messaging points users to browser alternatives for best quality.

### Friction observed
- The decision still happens after context switch into the toy page; for many users this feels like a false start.
- If a user sees repeated WebGPU limitations across toys, there is no immediate “show me compatible toys only” escape hatch in-place.

### Constructive improvements
- In the capability warning action area, add a direct “Browse compatible toys” action that pre-applies filters in library view.
- Surface compatibility confidence earlier in card previews (e.g., “Runs best in WebGPU, fallback available”).
- Persist a short-lived “compatibility mode” preference after fallback so subsequent opens bias toward smoother defaults.

## Suggested prioritization

1. **Fast win (copy/UI only):** clarify mic vs demo tradeoffs inline in audio rows.
2. **Fast win (routing):** add “Browse compatible toys” from capability warnings.
3. **Medium effort:** card-level “Play demo now” quick action and “best for” labels.
4. **Higher leverage:** compatibility-mode preference that adapts future launches.
