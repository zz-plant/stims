# README - Stim Webtoys Library

Welcome to the **Stim Webtoys Library** hosted at [no.toil.fyi](https://no.toil.fyi). This repository is a collection of interactive web-based toys designed to provide sensory stimulation and visual enjoyment. These toys are built using technologies like **Three.js**, **WebGL**, and real-time **audio interaction** to create engaging, responsive experiences. The toys are suitable for casual use or as a form of sensory play, tailored especially for neurodiverse individuals.

[![ReadMeSupportPalestine](https://raw.githubusercontent.com/Safouene1/support-palestine-banner/master/banner-support.svg)](https://techforpalestine.org/learn-more)

## Getting Started

### Requirements
- **Web Browser**: A modern web browser that supports WebGL (e.g., Chrome, Firefox, Edge).
- **Microphone Access**: Most toys use audio input from your device's microphone to create interactive visual effects.
- **Touch-Enabled Device** (Optional): For an enhanced experience, especially with certain toys that support multi-touch interaction.

### Usage
Simply visit [no.toil.fyi](https://no.toil.fyi) to access and enjoy the collection of stim webtoys. Each toy is designed to respond to sound, touch, and other inputs, providing a soothing or stimulating sensory experience. For local development or testing, you can clone this repository and open the individual HTML files in a browser.

## Available Toys

### 1. [**3dtoy.html**](https://no.toil.fyi/3dtoy.html)
- **Description**: A 3D interactive visual toy featuring a surreal torus knot, dynamic particle effects, and responsive procedural shapes.
- **Technologies**: Three.js, WebGL, microphone audio interaction.
- **Key Features**:
  - Audio-reactive animations.
  - Dynamic camera movement and lighting effects.
  - Procedural generation of shapes and rings for visual diversity.
  
### 2. [**95.html**](https://no.toil.fyi/95.html)
- **Description**: A weirdcore-inspired visualizer with fluid, shifting patterns and colors, perfect for creating a trippy sensory experience.
- **Technologies**: WebGL, GLSL shaders, microphone input.
- **Key Features**:
  - Real-time visual patterns that distort and react to audio input.
  - Random noise generation for unpredictable visuals.

### 3. [**brand.html**](https://no.toil.fyi/brand.html) / [**brand2.html**](https://no.toil.fyi/brand2.html)
- **Description**: A visual toy inspired by *Star Guitar*, featuring procedurally generated scenery like buildings, tracks, and modular elements. The visuals react to audio beats, creating a calming, rhythmic experience.
- **Technologies**: Three.js, WebGL, microphone input.
- **Key Features**:
  - Audio-reactive scenery generation.
  - Dynamic fog and lighting effects.
  - Procedural elements like buildings, trees, and train tracks.

### 4. [**combo.html**](https://no.toil.fyi/combo.html)
- **Description**: Combines fractal geometry, particle effects, and a torus knot that reacts to audio input for a mesmerizing visual experience.
- **Technologies**: Three.js, TensorFlow.js, microphone input.
- **Key Features**:
  - Fractal geometry and particle effects.
  - Audio-responsive color changes and dynamic scaling.

### 5. [**demo.html**](https://no.toil.fyi/demo.html)
- **Description**: A customizable visual toy where users can adjust color modes and sensitivity to audio input.
- **Technologies**: WebGL, microphone input.
- **Key Features**:
  - Adjustable color schemes and sensitivity settings.
  - Responsive visuals that change based on real-time audio input.

### 6. [**index.html**](https://no.toil.fyi/seary.html)
- **Description**: A trippy, synesthetic visualizer that reacts to both microphone and device audio input, providing a hypnotic, kaleidoscopic effect.
- **Technologies**: WebGL, microphone and device audio input.
- **Key Features**:
  - Multi-touch interaction and device orientation effects.
  - Dynamic, colorful visuals with responsive audio analysis.

### 7. [**stickman.html**](https://no.toil.fyi/stickman.html)
- **Description**: A playful visual toy with a stick figure that interacts with audio input for a lighthearted and fun experience.
- **Technologies**: WebGL, SVG, microphone input.
- **Key Features**:
  - Stick figure animations that react to audio.
  - Smooth, dynamic color transitions and audio-reactive movements.

### 8. [**sum.html**](https://no.toil.fyi/sum.html)
- **Description**: Another synesthetic visualizer with multi-touch and sound interaction. Combines smooth, flowing visuals with real-time audio analysis.
- **Technologies**: WebGL, microphone/device audio input.
- **Key Features**:
  - Responsive visuals that react to sound and touch.
  - Dynamic colors and shifting patterns.

### 9. [**symph.html**](https://no.toil.fyi/symph.html)
- **Description**: A dreamy spectrograph visualizer that blends WebGL and 2D canvas visuals, reacting to music or sound input to create stunning visualizations.
- **Technologies**: WebGL, 2D Canvas, microphone input.
- **Key Features**:
  - Audio-reactive spectrograph overlays.
  - Gradients and dynamic ripples for a more immersive experience.

---

## Known Issues and Improvements

### **Critical: WebGL Compatibility**
- **Issue**: Some users may experience issues if their browser/device does not support WebGL.
- **Solution**: Implement a fallback message or mechanism for users without WebGL support.

### **Performance Optimization**
- **Issue**: Certain toys are resource-intensive and may cause performance issues on lower-end devices.
- **Solution**: Add performance settings to allow users to adjust quality, such as particle count and resolution.

### **Audio Permissions**
- **Issue**: Lack of feedback when audio permissions are denied, or the device lacks a microphone.
- **Solution**: Add clear error messages when microphone access is unavailable, and offer alternative audio sources like device audio.

### **Touch Interaction for Mobile**
- **Issue**: Some toys do not respond optimally to touch input, especially on mobile devices.
- **Solution**: Improve touch responsiveness and include more intuitive multi-touch gestures, as well as device orientation support.

### **Beat Detection Improvements**
- **Issue**: The beat detection in *brand.html* and *brand2.html* could be more accurate.
- **Solution**: Fine-tune the beat detection algorithm to provide more interesting visual responses to changes in the audio signal.

### **Customization Options**
- **Issue**: Limited customization options in toys like *demo.html* and *symph.html*.
- **Solution**: Expand customization options, allowing users to adjust more parameters, such as color schemes, sensitivity, and visual intensity.

---

## Future Enhancements

- **Procedural Geometry and Lighting**: Continue experimenting with procedural geometry and lighting effects to create more dynamic and unpredictable experiences.
- **AI-Powered Interactivity**: Integrate TensorFlow.js into more toys for AI-enhanced visuals and smarter user interactions.
- **More Stim Toys**: Add additional stim webtoys that explore different sensory modalities (e.g., haptic feedback, sound synthesis).

---

## Installation for Local Development

To run the stim toys locally, clone this repository and open the HTML files in your browser. Here’s how to get started:

1. Clone the repository:
   ```bash
   git clone https://github.com/kanavjain/stims.git
   cd stims
   ```

2. Open any of the HTML files in your browser (e.g., `3dtoy.html`, `index.html`).

3. Enjoy the experience! If you’re contributing or debugging, you may also want to use a local web server:
   ```bash
   python3 -m http.server
   ```

   This will serve the files locally on `http://localhost:8000`.

---

## Libraries and Technologies Used
- **Three.js**: A powerful JavaScript library for creating 3D web experiences.
- **WebGL**: The core technology used to render 2D and 3D graphics.
- **GLSL**: Custom shaders used for visual distortions and effects.
- **Web Audio API**: Used to capture and analyze microphone audio for real-time visual interaction.

---

## License
Feel free to explore and play with the toys, modify the code, and create your own sensory experiences. See the LICENSE file for more information.
