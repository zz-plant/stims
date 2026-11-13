# Embedding Stims

Stims can be embedded on another page as a chromeless player for a single preset. The embed is the same app, in `?embed=true` mode: no browse chrome, just the stage, with audio capture and full-screen supported.

## Quick start

Paste this where you want the player:

```html
<iframe
  src="https://toil.fyi/?embed=true&preset=shifter-curlique"
  title="Stims — Shifter's Curlique"
  width="800" height="450"
  style="border:0;border-radius:12px;max-width:100%;height:auto;aspect-ratio:16/9"
  allow="autoplay; microphone; display-capture; fullscreen"
  allowfullscreen loading="lazy"></iframe>
```

Replace `shifter-curlique` with any preset id from the catalog. Omit `preset` for the default stage.

## oEmbed

Stims exposes an oEmbed endpoint at `https://toil.fyi/api/oembed?url=...`. Notion, Discord, Ghost and other oEmbed consumers fetch the iframe snippet from it, so pasting a Stims preset URL into a supported editor embeds it automatically. The snippet is built in one place (`src/js/core/embed-snippet.ts`) so the oEmbed response and the in-app "Copy embed code" stay in sync.

## Permissions

The `allow` attribute matters: `microphone` and `display-capture` back the Mic and Tab audio sources inside the frame, `autoplay` lets the demo track start from a tap on the frame, and `fullscreen` backs the dock's full-screen button. Leaving any out fails silently inside the frame.

## Notes

- Only `?embed=true` (and aliases) is framable in production; the middleware drops `frame-ancestors` for those requests and nothing else.
- Embeds are lazy-loaded (`loading="lazy"`) and keep their 16:9 shape on narrow columns.
- Preset titles can contain quotes and angle brackets; escape them if you build the iframe by hand (the snippet helper does this).
- Embedding is read-only playback. Editing requires the full app at `toil.fyi`.
