// patternRecognition.js: A pattern recognition and predictive listening script for audio-based visualizers

import type { FrequencyAnalyser } from './audio-handler';

class PatternRecognizer {
  analyser: FrequencyAnalyser;
  bufferSize: number;
  patternBuffer: Uint8Array[];
  writeIndex: number;
  filled: number;
  constructor(analyser: FrequencyAnalyser, bufferSize = 30) {
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
        () => new (data.constructor as typeof Uint8Array)(data.length),
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
    tolerance = 0.85,
  ): boolean {
    if (pattern1.length === 0 || pattern1.length !== pattern2.length) {
      return false;
    }

    // Higher tolerance means stricter matching.
    const normalizedTolerance = Number.isFinite(tolerance)
      ? Math.min(1, Math.max(0, tolerance))
      : 0.85;
    const maxDifference = 255 * (1 - normalizedTolerance);
    const requiredMatches = Math.ceil(pattern1.length * normalizedTolerance);

    if (requiredMatches <= 0) {
      return true;
    }

    // Calculate similarity score between two patterns.
    let matchCount = 0;
    let remaining = pattern1.length;
    for (let i = 0; i < pattern1.length; i++) {
      const delta = pattern1[i] - pattern2[i];
      const difference = delta >= 0 ? delta : -delta;
      if (difference < maxDifference) {
        matchCount++;
        if (matchCount >= requiredMatches) {
          return true;
        }
      }

      remaining--;
      if (matchCount + remaining < requiredMatches) {
        return false;
      }
    }

    return false;
  }
}

export default PatternRecognizer;
