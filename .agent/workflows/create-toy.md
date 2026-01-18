---
description: Create a new toy module using the scaffold script
---

# Create a New Toy

This workflow guides agents through creating a new toy module.

## Quick Start

// turbo

1. Use the scaffold script to create a new toy:
```bash
bun run scripts/scaffold-toy.ts --slug my-toy --title "My Toy" --type module --with-test
```

Replace `my-toy` with your toy slug and `"My Toy"` with the display title.

## Manual Creation Steps

If you need more control over the toy creation:

### Step 1: Create the Module

Create a new TypeScript file at `assets/js/toys/<slug>.ts`:

```typescript
import { registerToyGlobals, type ToyAudioRequest } from '../core/toy-globals';

export async function start({ container }: { container: HTMLElement }) {
  // Create your canvas
  const canvas = document.createElement('canvas');
  canvas.className = 'toy-canvas';
  container.appendChild(canvas);

  // Set up animation
  let animationId: number;
  
  function animate() {
    // Your animation logic here
    animationId = requestAnimationFrame(animate);
  }

  // Start animation
  animate();

  // Register audio handlers for the loader
  registerToyGlobals(window, {
    startAudio: async (source: ToyAudioRequest) => {
      // Handle microphone or sample audio
    },
    startAudioFallback: async () => {
      // Handle demo audio fallback
    },
  });

  // Return cleanup function
  return () => {
    cancelAnimationFrame(animationId);
    canvas.remove();
  };
}
```

### Step 2: Register in toys-data.js

Add your toy to `assets/js/toys-data.js`:

```javascript
{
  slug: 'my-toy',
  title: 'My Toy',
  description: 'A description of what this toy does.',
  module: 'assets/js/toys/my-toy.ts',
  type: 'module',
  requiresWebGPU: false,
  capabilities: {
    microphone: true,
    demoAudio: true,
  },
  moods: ['calm'],  // or 'energetic', 'immersive', etc.
  tags: ['visualizer'],
},
```

### Step 3: Verify Registration

// turbo

1. Check that the toy is properly registered:
```bash
bun run check:toys
```

2. Run the type checker:
```bash
bun run typecheck
```

### Step 4: Test the Toy

1. Start the dev server:
```bash
bun run dev
```

2. Navigate to `http://localhost:5173/toy.html?toy=my-toy`

3. Verify the toy loads and functions correctly

## Adding Audio Reactivity

For toys that respond to audio:

1. Import the audio handler:
```typescript
import { AudioHandler, type AudioAnalysis } from '../core/audio-handler';
```

2. Create an audio handler in your start function:
```typescript
let audioHandler: AudioHandler | null = null;

registerToyGlobals(window, {
  startAudio: async (source) => {
    audioHandler = new AudioHandler(source);
    await audioHandler.initialize();
  },
});
```

3. Use audio data in your animation loop:
```typescript
function animate() {
  if (audioHandler) {
    const analysis = audioHandler.getAnalysis();
    // Use analysis.bass, analysis.mids, analysis.highs, analysis.volume
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
```

## Common File Locations

- **Toy modules**: `assets/js/toys/`
- **Toy registry**: `assets/js/toys-data.js`
- **Audio utilities**: `assets/js/core/audio-handler.ts`
- **Renderer setup**: `assets/js/core/renderer-setup.ts`
- **Test helpers**: `tests/toy-test-helpers.ts`
