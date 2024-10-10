// patternRecognition.js: A pattern recognition and predictive listening script for audio-based visualizers

class PatternRecognizer {
    constructor(audioContext, analyser, bufferSize = 60) {
        this.audioContext = audioContext;
        this.analyser = analyser;
        this.bufferSize = bufferSize;
        this.patternBuffer = [];
        this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    }

    updatePatternBuffer() {
        // Get current frequency data and add to pattern buffer
        this.analyser.getByteFrequencyData(this.frequencyData);
        this.patternBuffer.push([...this.frequencyData]);

        // Limit buffer size
        if (this.patternBuffer.length > this.bufferSize) {
            this.patternBuffer.shift();
        }
    }

    detectPattern() {
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

    comparePatterns(pattern1, pattern2, tolerance = 0.9) {
        // Calculate similarity score between two patterns
        let matchCount = 0;
        for (let i = 0; i < pattern1.length; i++) {
            if (Math.abs(pattern1[i] - pattern2[i]) < (255 * (1 - tolerance))) {
                matchCount++;
            }
        }
        return matchCount / pattern1.length >= tolerance;
    }

    predictNextPattern() {
        // Predict the next pattern based on the detected pattern
        const detectedPattern = this.detectPattern();
        if (detectedPattern) {
            return detectedPattern;
        }
        return null;
    }
}

// Usage Example:
// Create an audio context and analyser
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 128;

// Create a pattern recognizer
const patternRecognizer = new PatternRecognizer(audioContext, analyser);

function updateAudio() {
    // Update pattern buffer and get prediction
    patternRecognizer.updatePatternBuffer();
    const predictedPattern = patternRecognizer.predictNextPattern();

    if (predictedPattern) {
        // Use predicted pattern to control visual elements
        console.log('Predicted Pattern Detected:', predictedPattern);
        // Custom logic to update visual elements can be placed here
    }

    requestAnimationFrame(updateAudio);
}

// Example: Start audio processing
navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function (stream) {
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        updateAudio();
    })
    .catch(function (err) {
        console.error('Error accessing microphone:', err);
    });

// Export for use in other visualizers
export default PatternRecognizer;
