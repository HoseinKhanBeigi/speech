// AudioWorklet processor for processing audio in real-time
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        // Smoothing factor for gain to avoid sudden changes
        this.currentGain = 3.0;
        this.targetGain = 3.0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        
        if (input.length > 0 && input[0].length > 0) {
            const inputChannel = input[0];
            
            // Convert Float32Array to Int16Array (PCM 16-bit) for transcription
            // Use moderate gain to avoid distortion - too much gain causes poor transcription
            // Check audio level first to apply adaptive gain
            let maxInput = 0;
            for (let i = 0; i < inputChannel.length; i++) {
                maxInput = Math.max(maxInput, Math.abs(inputChannel[i]));
            }
            
            // Adaptive gain: if audio is already loud, use less gain
            // If audio is quiet, use more gain (but cap at 5x to avoid distortion)
            const adaptiveGain = maxInput > 0.3 ? 1.5 : (maxInput > 0.1 ? 3.0 : 4.0);
            
            const int16Array = new Int16Array(inputChannel.length);
            for (let i = 0; i < inputChannel.length; i++) {
                let s = Math.max(-1, Math.min(1, inputChannel[i]));
                // Apply adaptive gain for transcription (avoid clipping)
                s = s * adaptiveGain;
                // Clamp to prevent clipping (clipping causes poor transcription)
                s = Math.max(-1, Math.min(1, s));
                int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // Send amplified audio data to main thread for transcription
            const uint8Array = new Uint8Array(int16Array.buffer);
            this.port.postMessage({
                type: 'audioData',
                data: Array.from(uint8Array)
            });
            
            // IMPORTANT: Pass through original audio (without gain) to output for playback
            // This allows you to hear the audio while it's being captured
            if (output.length > 0 && output[0].length > 0) {
                const outputChannel = output[0];
                for (let i = 0; i < Math.min(inputChannel.length, outputChannel.length); i++) {
                    // Pass through original audio (no gain) so playback sounds normal
                    outputChannel[i] = inputChannel[i];
                }
            }
        }

        return true; // Keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
