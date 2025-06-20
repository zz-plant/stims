# Stim Webtoys Library

Welcome to the **Stim Webtoys Library**, hosted at [no.toil.fyi](https://no.toil.fyi). This is a collection of interactive web-based toys designed to provide some fun sensory stimulation. They’re built with **Three.js**, **WebGL**, and live **audio interaction** for anyone who enjoys engaging, responsive visuals. These are great for casual play, or as a form of sensory exploration, especially for neurodiverse folks.

## Quick Start

1. Clone the repo and `cd` into it.
2. Use Node.js 22: run `nvm use` if you have nvm installed.
3. Install dependencies with `npm install`.
4. Start the dev server with `npm run dev` and open `http://localhost:5173` in your browser.

## Getting Started

### What You’ll Need:

- **A Modern Web Browser**: Anything that supports WebGL should work (think Chrome, Firefox, Edge).
- **Microphone Access**: A lot of these toys respond to sound, so you’ll want to enable that.
- **Touch Devices**: Some toys are enhanced by touch, but that’s optional.

### How to Play:

Head to [no.toil.fyi](https://no.toil.fyi) and jump right in. The toys respond to sound, touch, and other inputs to create a chill or stimulating experience, depending on what you're looking for. If you’d rather poke around locally, feel free to clone this repo and open the HTML files in your browser.

## Toys in the Collection

| Toy | Description |
| --- | --- |
| [3D Toy](./toy.html?toy=3dtoy) | Dive into a twisting 3D tunnel that responds to sound. |
| [Star Guitar Visualizer](./brand.html) | A visual journey inspired by an iconic music video, synced to your music. |
| [Defrag Visualizer](./defrag.html) | A nostalgic, sound-reactive visualizer evoking old defragmentation screens. |
| [Evolutionary Weirdcore](./evol.html) | Watch surreal landscapes evolve with fractals and glitches that react to music. |
| [Multi-Capability Visualizer](./multi.html) | Shapes and lights move with both sound and device motion. |
| [Trippy Synesthetic Visualizer](./seary.html) | Blend audio and visuals in a rich synesthetic experience. |
| [Pattern Recognition Visualizer](./sgpat.html) | See patterns form dynamically in response to sound. |
| [SVG + Three.js Visualizer](./svgtest.html) | A hybrid visualizer blending 2D and 3D elements, reacting in real time. |
| [Dreamy Spectrograph](./symph.html) | A relaxing spectrograph that moves gently with your audio. |
| [Interactive Word Cloud](./words.html) | Speak and watch the word cloud react and shift with your voice. |
| [Cube Wave](./toy.html?toy=cube-wave) | A grid of cubes that rise and fall with your audio. |
| [Particle Orbit](./toy.html?toy=particle-orbit) | Thousands of particles swirling faster as the music intensifies. |
| [Spiral Burst](./toy.html?toy=spiral-burst) | Colorful spirals rotate and expand with every beat. |
| [Bouncy Spheres](./toy.html?toy=bouncy-spheres) | Lines of spheres bounce and change color with audio. |
| [Rainbow Tunnel](./toy.html?toy=rainbow-tunnel) | Fly through colorful rings that spin to your music. |
| [Star Field](./toy.html?toy=star-field) | A field of shimmering stars reacts to the beat. |

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

To play with the toys locally you’ll need to run them from a local web server. Opening the HTML files directly won’t work because the TypeScript modules and JSON fetches can’t load over `file://`. Here’s the quick setup:

1. Clone the repository:

   ```bash
   git clone https://github.com/zz-plant/stims.git
   cd stims
   ```

2. Use Node.js 22 (see `.nvmrc`). If you have nvm installed, run `nvm use`.

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

   Open `http://localhost:5173` in your browser.

   If you’d rather use a simple Python server, run:

   ```bash
   python3 -m http.server
   ```

   Then open `http://localhost:8000`.

All JavaScript dependencies are installed via npm and bundled locally with Vite, so everything works offline without hitting a CDN.

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

### Linting and Formatting

Before committing, run `npm run lint` to check code style and `npm run format` to automatically format your files. This keeps the project consistent.

---

## License

This project is released under the [Unlicense](https://unlicense.org/), so you’re free to copy, modify, sell, and distribute it however you like. Do whatever you want with it—there are no restrictions.

Feel free to add more toys, tweak the visuals, or contribute in any way.
