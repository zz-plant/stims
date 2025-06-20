// patternRecognition.js: A pattern recognition and predictive listening script for audio-based visualizers

import * as THREE from 'three';

class PatternRecognizer {
  analyser: THREE.AudioAnalyser;
  bufferSize: number;
  patternBuffer: number[][];
  constructor(analyser: THREE.AudioAnalyser, bufferSize = 30) {
    // Reduced buffer size for performance
    this.analyser = analyser;
    this.bufferSize = bufferSize;
    this.patternBuffer = [];
  }

  updatePatternBuffer(): void {
    // Get current frequency data and add to pattern buffer
    const data = this.analyser.getFrequencyData();
    this.patternBuffer.push([...data]);

    // Limit buffer size
    if (this.patternBuffer.length > this.bufferSize) {
      this.patternBuffer.shift();
    }
  }

  detectPattern(): number[] | null {
    // Compare the current pattern to past patterns in the buffer
    if (this.patternBuffer.length < this.bufferSize) return null;

    const lastPattern = this.patternBuffer[this.bufferSize - 1];
    const secondLastPattern = this.patternBuffer[this.bufferSize - 2];

    // Check if the last two patterns are similar
    if (this.comparePatterns(lastPattern, secondLastPattern)) {
      return lastPattern;
    }

    return null;
  }

  comparePatterns(
    pattern1: number[],
    pattern2: number[],
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
