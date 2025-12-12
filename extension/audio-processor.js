// AudioWorklet processor for processing audio in real-time
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input.length > 0 && input[0].length > 0) {
            const inputChannel = input[0];
            
            // Convert Float32Array to Int16Array (PCM 16-bit)
            // Apply very strong gain amplification to boost audio levels
            const GAIN = 20.0; // Amplify by 20x to make audio much louder
            const int16Array = new Int16Array(inputChannel.length);
            for (let i = 0; i < inputChannel.length; i++) {
                let s = Math.max(-1, Math.min(1, inputChannel[i]));
                // Apply gain
                s = s * GAIN;
                // Clamp to prevent clipping
                s = Math.max(-1, Math.min(1, s));
                int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // Send audio data to main thread
            const uint8Array = new Uint8Array(int16Array.buffer);
            this.port.postMessage({
                type: 'audioData',
                data: Array.from(uint8Array)
            });
        }

        return true; // Keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
