// patternRecognition.js: A pattern recognition and predictive listening script for audio-based visualizers

import type { AudioAnalyser } from 'three';

class PatternRecognizer {
  analyser: AudioAnalyser;
  bufferSize: number;
  patternBuffer: Uint8Array[];
  writeIndex: number;
  filled: number;
  constructor(analyser: AudioAnalyser, bufferSize = 30) {
    // Reduced buffer size for performance
    this.analyser = analyser;
    this.bufferSize = bufferSize;
    this.patternBuffer = [];
    this.writeIndex = 0;
    this.filled = 0;
  }

  updatePatternBuffer(): void {
    // Get current frequency data and add to pattern buffer
    const data = this.analyser.getFrequencyData();
    if (this.patternBuffer.length === 0) {
      this.patternBuffer = Array.from(
        { length: this.bufferSize },
        () => new (data.constructor as typeof Uint8Array)(data.length)
      );
    }

    const target = this.patternBuffer[this.writeIndex];
    target.set(data);

    this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    if (this.filled < this.bufferSize) {
      this.filled++;
    }
  }

  detectPattern(): Uint8Array | null {
    // Compare the current pattern to past patterns in the buffer
    if (this.filled < this.bufferSize) return null;

    const lastIndex = (this.writeIndex + this.bufferSize - 1) % this.bufferSize;
    const secondLastIndex =
      (this.writeIndex + this.bufferSize - 2) % this.bufferSize;

    const lastPattern = this.patternBuffer[lastIndex];
    const secondLastPattern = this.patternBuffer[secondLastIndex];

    // Check if the last two patterns are similar
    if (this.comparePatterns(lastPattern, secondLastPattern)) {
      return lastPattern.slice();
    }

    return null;
  }

  comparePatterns(
    pattern1: Uint8Array,
    pattern2: Uint8Array,
    tolerance = 0.85
  ): boolean {
    // Higher tolerance for stricter matching
    // Calculate similarity score between two patterns
    let matchCount = 0;
    for (let i = 0; i < pattern1.length; i++) {
      if (Math.abs(pattern1[i] - pattern2[i]) < 255 * (1 - tolerance)) {
        matchCount++;
      }
    }
    return matchCount / pattern1.length >= tolerance;
  }
}

export default PatternRecognizer;
