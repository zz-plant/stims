# Copywriting audit (user-friendliness) — 2026-02

This audit identifies user-facing copy that may feel unclear, jargony, or less welcoming for first-time visitors.

## Library page copy to revisit

| Location | Current copy | Why it may feel unfriendly | Suggested direction |
| --- | --- | --- | --- |
| `index.html` hero CTA | "Launch a recommended stim" | "Stim" is brand language but can be unfamiliar to new users. "Recommended" is also vague without context. | Prefer plain-language action labels (for example, "Start a recommended visual"). |
| `index.html` library intro | "Hit a card and jump straight in." | "Hit" is slang and may read as abrupt on accessibility-first interfaces. | Use neutral verbs like "Select" or "Choose." |
| `index.html` search status | "Loading library…" | Functional, but misses reassurance for slower connections. | Add expectation framing (for example, "Loading visual library…"). |
| `index.html` filter helper | "Use filters to refine." | Repeats "filter/refine" with little guidance for how to start. | Give a concrete first step (mood, audio source, or device support). |

## Capability panel copy to revisit

| Location | Current copy | Why it may feel unfriendly | Suggested direction |
| --- | --- | --- | --- |
| `assets/js/core/capability-preflight.ts` | "Microphone permission is blocked" | Sounds final and punitive, even when users can still continue with demo audio. | Lead with available path first (continue now, then optional fix). |
| `assets/js/core/capability-preflight.ts` | "Audio permission flow" | Internal/process wording; less natural for end users. | Use outcome-focused heading (for example, "Set up audio access"). |
| `assets/js/core/capability-preflight.ts` | "WebGPU fallback reason: ..." | Exposes implementation detail and technical jargon that many users do not need. | Translate into user impact (quality/performance) rather than backend names. |
| `assets/js/core/capability-preflight.ts` | "No reduced-motion preference detected in system settings." | Reads diagnostic and mechanical. | Frame as user-facing behavior (for example, "Standard motion effects are enabled"). |

## Tone pattern to standardize

1. Prefer plain-language verbs over slang (`Hit`, `Launch` where unclear).
2. Lead with what users *can do now* before mentioning limitations.
3. Minimize backend terminology (WebGPU/WebGL) unless in an advanced details area.
4. Use supportive tone in permission/error states to reduce friction.
