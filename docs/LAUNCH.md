# Stims launch material

Prepared copy, not a record of publication. The workflow clip is a local capture of the running app. Publish the assets with the source before using their GitHub links in a post.

## Assets and destinations

- [Full workflow video](./assets/clips/stims-workflow.mp4): Play demo → Edit this visual → Add a slow spin → copy the remix link. Silent, at recorded speed.
- [README preview](./assets/clips/stims-workflow.gif): the same capture at three times speed.
- [Try Stims](https://toil.fyi/): no account or install.
- [Source](https://github.com/zz-plant/stims).
- [Remix thread](https://github.com/zz-plant/stims/discussions/1341).
- [Starter issues](https://github.com/zz-plant/stims/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22).
- [Standalone packages](../packages/README.md): compiler, EEL conformance, audio analysis and flash analysis, each with examples and its own mirror.
- [Individual package launches](./PACKAGE_LAUNCHES.md): four audience-specific drafts and the first-release checks.
- [OBS setup](./OBS.md): Browser Source demo and regular-browser capture recipes, with audio-routing and native-validation limits.

## Show HN

Title: **Show HN: Stims – play and live-edit Winamp MilkDrop presets in a browser**

Submission URL: https://toil.fyi/

First comment:

> Stims runs original .milk presets in a browser. Press Play demo, then Edit this visual: the editor shows the equations and which audio signals reach each control. Add a slow spin appends one rotation equation; you can undo it or change the code while playback continues. Copy link to this edit puts the source in the URL, so a remix does not need an account or server-side storage.
>
> WebGL2 is the baseline; WebGPU is an optional path. Compiling a preset is not proof that it matches MilkDrop visually. The README links both the compiler corpus tests and the much smaller set of measured comparisons against native projectM.
>
> The parser/compiler, audio analysis, flash analysis and EEL conformance cases are also standalone packages. The code and runnable examples are at https://github.com/zz-plant/stims.
>
> I would like feedback on the first edit: was it easy to find, did the change appear on the stage, and did the shared link restore it?

Submit when the maintainer can answer questions. Use the runnable app as the submission URL. Check for an earlier Stims submission first; do not repost the same project as a minor release. The [Show HN guidelines](https://news.ycombinator.com/showhn.html) explain the try-it requirement and prohibit soliciting votes.

## MilkDrop and Winamp communities

Title: **Original MilkDrop presets, with live editing and remix links in a browser**

> I built Stims to play and edit original MilkDrop .milk files in a browser. No preset conversion, account or install. The live editor has compiler diagnostics and controls that name the audio signals reaching them.
>
> This clip shows the whole loop: play, append one rotation equation, watch it run, then copy a link carrying the edited source. The presets remain credited to their original authors.
>
> Try it: https://toil.fyi/
> Share a remix or a rendering problem: https://github.com/zz-plant/stims/discussions/1341
>
> If a preset looks different from MilkDrop or projectM, a session link and reference screenshot would help. Visual matching is still being measured preset by preset.

Attach the workflow video. Choose a community that permits project showcases and disclose authorship. Ask for a remix or reproducible rendering report rather than generic engagement.

## Creative coding and graphics developers

Title: **A live MilkDrop editor, plus the compiler and EEL runtime as reusable packages**

> Stims is a browser app for playing and editing .milk presets. Its compiler parses EEL2 equations into an IR, runs them with an interpreter or JavaScript JIT, and lowers supported equation blocks to WGSL. The editor also reads the code to show which audio reaches each visual control.
>
> The compiler is available separately as milkdrop-toolchain, with runnable examples for compiling a preset, evaluating expressions and generating WGSL. The repo also contains EEL conformance cases, audio analysis and flash analysis packages.
>
> Try the live editor: https://toil.fyi/
> Code and examples: https://github.com/zz-plant/stims/tree/main/packages
>
> The workflow video shows an actual edit and its share link. Backend support varies by shader; the README explains the compatibility and measurement limits.

Link to the specific package example that answers the audience's interest. GPU lowering support does not establish a speedup; include a benchmark only when its inputs and hardware are published.

## Measurement

Record the date and URL of each actual post below after publishing. Take a GitHub star and 14-day traffic snapshot before the first post and again after seven days. GitHub's historical traffic window is short, so retain the snapshots locally.

```bash
mkdir -p output/launch
gh repo view zz-plant/stims --json stargazerCount > output/launch/stars-before.json
gh api repos/zz-plant/stims/traffic/views > output/launch/views-before.json
bun run telemetry:report -- --days=7
```

The telemetry report already includes audible starts, editor opens, applied example edits, and successful shares or saves. Event totals are not unique people or an attributable conversion rate. `growth-github-clicked` measures visits to GitHub, not stars; inspect it in Events by type. Capture runs use agent mode so they do not inflate audience telemetry.

## Current limits to retain in launch copy

- Recording is a beta feature; the launch clip is a silent browser capture, not a claim about exported audio/video fidelity.
- Most presets lack native projectM visual measurements and flash-risk measurements.
- A report on October 10 in the remix thread describes a black stage after the spin example in the Codex in-app browser. A successful Chromium capture does not resolve that report or prove all browsers work. [The browser verification issue](https://github.com/zz-plant/stims/issues/1408) tracks the remaining checks; [PR #1407](https://github.com/zz-plant/stims/pull/1407) fixes a separately confirmed startup restoration race.
- The current capture can include unrelated local fixes. Its evidence records what ran locally; it is not proof that the deployed site has the same revision.

## Publication record

No external launch posts were sent from this preparation workflow.
