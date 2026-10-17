# Community remix showcase & intake

This guide defines the submission criteria, verification procedure, and credit policy for the Stims community remix showcase ([#1411](https://github.com/zz-plant/stims/issues/1411)).

The showcase is intended to highlight community-created MilkDrop remixes running live in Stims. In keeping with Stims core principles, **no contributor names, quotes, metrics, or sample works are fabricated**. Until at least three real, verified, and consented community contributions are received and verified, the public showcase gallery remains pending and only this intake protocol is active.

---

## 1. How to submit a remix

Submissions are collected in the [GitHub Discussions Remix Thread](https://github.com/zz-plant/stims/discussions/1341) or via a pull request.

To be featured in the credited showcase, each submission must include all of the following six fields:

1. **Title**: The title of your remix (e.g. `Cerebral Demons (Gentle Spin Mix)`).
2. **Creator handle & link**: Your preferred name or handle, and an optional link to your profile, portfolio, or social presence (e.g. GitHub username or personal website).
3. **Working remix link or `.milk` source**:
   - A shareable Stims URL generated with **Copy link to this edit** (carrying `#code=` or `?preset=...`), or
   - An exported `.milk` file attachment containing the full preset source.
4. **Lineage and original author provenance**:
   - The original preset name and author handle from the bundled catalog (e.g., `Krash & Rovastar — Cerebral Demons`).
   - If derived from an existing multi-author chain, all prior authors must be listed to preserve lineage according to [`docs/LINEAGE_AND_CREDITS.md`](./LINEAGE_AND_CREDITS.md).
5. **Preview capture**:
   - A screenshot (`.png` or `.webp`) or short video clip (`.mp4` or `.webm`) showing the remix in motion.
6. **Explicit permission and license consent**:
   - An affirmative statement granting permission to feature the remix, preview media, and handle in the Stims repository, documentation, and web app under the project's open-source terms.

---

## 2. Review and verification criteria

Every submission is reviewed in a clean browser session before acceptance:

1. **Cold-load verification**: The remix URL must load cleanly in an incognito/private window without requiring an active user account or pre-existing localStorage state.
2. **Visual correctness**: The edit must compile cleanly with 0 fatal errors in the MilkDrop editor and render without a blank/black canvas.
3. **Audio reactivity**: The preset must demonstrate real reactivity to incoming audio or the demo track, confirmed via `bun run lab:reactivity` or live inspection.
4. **Sensory safety**: The preview and preset must adhere to [`docs/SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md). Presets with unconstrained high-frequency full-screen strobing or extreme luminance oscillation will be requested to dampen flash intensity before listing.
5. **Credit preservation**: Bylines must follow the community's accretive standard: new creators join the credit chain; original authors are never removed or truncated.

---

## 3. Removals and corrections

Creators retain control over their featured works:
- To update a link, fix an author credit, or request removal of a featured remix from the showcase, open an issue or reply to your submission in [Discussion #1341](https://github.com/zz-plant/stims/discussions/1341).
- Requests for removal or correction will be addressed promptly.

---

## 4. Current status

- **Submissions open**: Yes ([Discussion #1341](https://github.com/zz-plant/stims/discussions/1341)).
- **Verified works featured**: 0 / 3 (public showcase pending first three consented submissions).
