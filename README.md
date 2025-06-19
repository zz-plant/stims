# Stim Webtoys Library

Welcome to the **Stim Webtoys Library**, hosted at [no.toil.fyi](https://no.toil.fyi). This is a collection of interactive web-based toys designed to provide some fun sensory stimulation. They’re built with **Three.js**, **WebGL**, and live **audio interaction** for anyone who enjoys engaging, responsive visuals. These are great for casual play, or as a form of sensory exploration, especially for neurodiverse folks.

## Getting Started

### What You’ll Need:
- **A Modern Web Browser**: Anything that supports WebGL should work (think Chrome, Firefox, Edge).
- **Microphone Access**: A lot of these toys respond to sound, so you’ll want to enable that.
- **Touch Devices**: Some toys are enhanced by touch, but that’s optional.

### How to Play:
Head to [no.toil.fyi](https://no.toil.fyi) and jump right in. The toys respond to sound, touch, and other inputs to create a chill or stimulating experience, depending on what you're looking for. If you’d rather poke around locally, feel free to clone this repo and open the HTML files in your browser.

## Toys in the Collection

### 1. [**Evolutionary Weirdcore**](https://no.toil.fyi/evol.html) (New)
- **Description**: A next-level weirdcore visualizer with fractal geometry, glitchy effects, and distortions that evolve as the audio changes.
- **Technologies**: WebGL, GLSL shaders, real-time audio input.
- **Key Features**:
  - **Fractals**: Dynamic fractals that shift and evolve with the audio.
  - **Glitches**: Audio peaks trigger glitch effects for that extra weirdcore vibe.
  - **Customizable**: Tweak the fractal intensity yourself and mess with visual behavior.

### 2. [**3dtoy.html**](https://no.toil.fyi/3dtoy.html)
- **Description**: Dive into a surreal 3D space with a twisting torus knot, swirling particles, and random procedural shapes that move with the sound.
- **Technologies**: Three.js, WebGL, microphone input.
- **Key Features**:
  - Audio-reactive visuals.
  - Moving camera and dynamic lighting.
  - Procedural shapes for variety.

### 3. [**brand.html**](https://no.toil.fyi/brand.html)
- **Description**: Inspired by *Star Guitar*, this visual toy procedurally generates scenery—buildings, trees, tracks—that pulse to the beat.
- **Technologies**: Three.js, WebGL, microphone input.
- **Key Features**:
  - Audio-reactive scenery.
  - Dynamic fog and lighting.
  - Buildings, tracks, and more created on the fly.

### 4. [**seary.html**](https://no.toil.fyi/seary.html)
- **Description**: A kaleidoscopic visualizer that reacts to both microphone and device audio. Multi-touch and device orientation effects make it even more engaging.
- **Technologies**: WebGL, multi-touch input, audio input.
- **Key Features**:
  - Reacts to touch and device orientation.
  - Trippy patterns synced with the audio.

### 5. [**symph.html**](https://no.toil.fyi/symph.html)
- **Description**: A dreamy spectrograph that blends WebGL and 2D visuals, transforming audio input into a visual journey.
- **Technologies**: WebGL, 2D Canvas, microphone input.
- **Key Features**:
  - Spectrograph overlays that respond to sound.
  - Gradients and ripples for a smooth, immersive experience.

---

## What’s in the Pipeline

### **WebGL Compatibility**
- **Issue**: Some users with older or unsupported browsers/devices might run into issues.
- **Fix**: Add fallback options or messages for users without WebGL support.

### **Performance Tweaks**
- **Issue**: Some toys are heavy on resources and might lag on lower-end devices.
- **Fix**: Add settings to adjust visual quality (e.g., reduce particle count or resolution).

### **Audio Permissions**
- **Issue**: Not much feedback when audio permissions are denied or unavailable.
- **Fix**: Add error messages or alternative audio input options when microphone access isn’t granted.

### **Touch Responsiveness**
- **Issue**: Some toys are touch-sensitive, but they don’t always work well on mobile.
- **Fix**: Improve multi-touch support and make the toys more mobile-friendly.

---

## Local Setup

If you want to mess around with the toys locally, clone the repo and run the local server. Here’s the quick setup:

1. Clone the repository:
   ```bash
   git clone https://github.com/zz-plant/stims.git
   cd stims
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

   This serves the project at `http://localhost:8080`. Open any of the HTML files (e.g., `evol.html`, `index.html`) in your browser.

### Running Tests

This project uses [Jest](https://jestjs.io/) for its test suite. To install
dependencies and run the tests:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the tests:
   ```bash
   npm test
   ```

---

## License

This project is released under the [Unlicense](https://unlicense.org/), so you’re free to copy, modify, sell, and distribute it however you like. Do whatever you want with it—there are no restrictions. 

Feel free to add more toys, tweak the visuals, or contribute in any way.
