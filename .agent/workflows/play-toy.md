---
description: Launch and interact with a toy in the browser
---

# Play a Toy

This workflow helps agents launch toys and make them react to audio, just like a human would.

## Step 1: Start the Dev Server

// turbo

First, start the development server:

```bash
bun run dev
```

Wait for the server to start (usually shows "Local: http://localhost:5173").

## Step 2: Launch and Play a Toy

Use the `browser_subagent` tool to launch a toy and interact with it. Here's an example task:

```
Task: "Navigate to http://localhost:5173/toy.html?toy=holy and make the visualization react to audio.

Steps:
1. Navigate to the toy URL
2. Wait for the page to load completely
3. Look for and click the 'Use demo audio' button (or similar button to start audio)
4. Wait 5 seconds to observe the visualization reacting to the audio
5. Take a screenshot to capture the active visualization
6. Report what you observed - describe the visual effects and how they respond to the audio

Return: Describe what the visualization looks like and how it responds to the audio."
```

## Available Toys to Try

| Slug | Title | What to Expect |
|------|-------|----------------|
| `holy` | Halo Flow | Glowing halos and particles that pulse with bass |
| `spiral-burst` | Spiral Burst | Colorful spirals that expand on beats |
| `neon-wave` | Neon Wave | Retro synthwave grid that ripples with music |
| `geom` | Geometry Visualizer | 3D shapes that morph with frequency |
| `defrag` | Defrag Visualizer | Retro blocks that shuffle to rhythm |
| `milkdrop` | MilkDrop Proto | Psychedelic feedback patterns |
| `star-field` | Star Field | Stars that shimmer with audio |
| `rainbow-tunnel` | Rainbow Tunnel | Rings that spin faster with bass |

## How the Audio Works

1. **Demo Audio Mode**: Click "Use demo audio" - this plays procedural audio that the toy reacts to. No microphone needed!

2. **What to observe**:
   - Bass hits → Large visual movements, pulses, size changes
   - Mid frequencies → Color shifts, rotations
   - High frequencies → Sparkles, fine details, shimmer effects

## Example Browser Subagent Tasks

### Quick Visual Check
```
Navigate to http://localhost:5173/toy.html?toy=spiral-burst, click the 'Use demo audio' button when it appears, wait 3 seconds, then screenshot the result. Describe how the spirals are moving.
```

### Compare Multiple Toys
```
1. Navigate to http://localhost:5173/toy.html?toy=holy
2. Click 'Use demo audio'
3. Wait 3 seconds and take a screenshot
4. Press Escape to return to library
5. Click on 'Neon Wave' toy card
6. Click 'Use demo audio'
7. Wait 3 seconds and take a screenshot
8. Compare: which toy had more dramatic audio reactions?
```

### Test Audio Reactivity
```
Navigate to http://localhost:5173/toy.html?toy=neon-wave, enable demo audio, and observe for 10 seconds. Note:
- Does the grid move with the beat?
- Do colors change with frequency?
- Are there bloom/glow effects on bass hits?
Take screenshots at different moments to capture the variation.
```

## Tips for Agents

1. **Always click "Use demo audio"** - this bypasses microphone permissions and gives consistent audio input

2. **Wait a few seconds** after enabling audio before judging the visualization - it takes a moment to "warm up"

3. **Take multiple screenshots** - the visualizations are dynamic, so one screenshot may not capture the full range of effects

4. **Use the Escape key** to return to the library from any toy

5. **Watch for these audio-reactive behaviors**:
   - Pulsing/scaling on bass beats
   - Color cycling with melody
   - Particle bursts on transients
   - Camera movement with energy levels

## Programmatic Control via window.stim State

The app exposes a `window.stimState` API for programmatic interaction:

```javascript
// Get current state
const state = window.stimState.getState();
console.log(state.currentToy);  // Current toy slug
console.log(state.audioActive);  // Is audio playing?

// Enable demo audio programmatically
await window.stimState.enableDemoAudio();

// Wait for toy to load
const toySlug = await window.stimState.waitForToyLoad();

// Wait for audio to activate
const audioSource = await window.stimState.waitForAudioActive();

// Listen to events
const unlisten = window.stimState.onToyLoad((slug) => {
  console.log(`Toy loaded: ${slug}`);
});

// Return to library
window.stimState.returnToLibrary();
```

The body element also gets data attributes for easy querying:
- `data-current-toy` - slug of active toy
- `data-toy-loaded` - "true" when toy is ready
- `data-audio-active` - "true" when audio is playing
- `data-audio-source` - "microphone" or "demo"

## Agent Mode

Add `?agent=true` to the URL to enable agent mode:
```
http://localhost:5173/toy.html?toy=holy&agent=true
```

In agent mode:
- State tracking is enabled
- Data attributes are added to body
- window.stimState API is available
