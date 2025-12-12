// Offscreen document for tab capture (required in Manifest V3)
let audioStream = null;
let audioContext = null;
let audioProcessor = null;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureTab') {
        // Handle async operation properly
        captureTabAudio(request.streamId).then(result => {
            // Send response back to background using sendResponse if channel is still open
            try {
                sendResponse({ action: 'captureTabResponse', ...result });
            } catch (e) {
                // Channel might be closed, send via runtime message instead
                chrome.runtime.sendMessage({
                    action: 'captureTabResponse',
                    ...result
                }).catch(() => {
                    // Ignore if background script isn't ready
                });
            }
        }).catch(error => {
            try {
                sendResponse({ action: 'captureTabResponse', success: false, error: error.message });
            } catch (e) {
                chrome.runtime.sendMessage({
                    action: 'captureTabResponse',
                    success: false,
                    error: error.message
                }).catch(() => {});
            }
        });
        return true; // Keep channel open for async response
    } else if (request.action === 'stopCapture') {
        stopCapture();
        sendResponse({ success: true });
        return false; // Synchronous response
    }
    return false; // No async response needed
});

async function captureTabAudio(streamId) {
    try {
        // Stream ID is passed from background script (tabCapture API not available in offscreen)
        // Capture the audio stream using getUserMedia with the stream ID
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            },
            video: false
        });

        // Create audio context
        audioContext = new AudioContext({ sampleRate: 16000 });
        
        // Ensure audio context is running
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Load AudioWorklet processor
        try {
            const workletUrl = chrome.runtime.getURL('audio-processor.js');
            await audioContext.audioWorklet.addModule(workletUrl);
            console.log('✅ AudioWorklet loaded successfully - using 20x gain amplification');
        } catch (error) {
            console.error('❌ Error loading AudioWorklet:', error);
            console.log('⚠️ Falling back to ScriptProcessorNode (deprecated but will work)');
            // Fallback to ScriptProcessorNode if AudioWorklet fails
            return await captureTabAudioFallback(streamId);
        }

        const source = audioContext.createMediaStreamSource(audioStream);
        
        // Create AudioWorklet node
        audioProcessor = new AudioWorkletNode(audioContext, 'audio-processor');
        
        let audioChunkCount = 0;
        let lastSendTime = Date.now();
        
        // Listen for audio data from the worklet
        audioProcessor.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                // Reconstruct Int16Array from the Uint8Array data to check amplitude
                const uint8Data = new Uint8Array(event.data.data);
                // Create Int16Array view of the same buffer
                const audioData = new Int16Array(uint8Data.buffer);
                
                let maxAmplitude = 0;
                for (let i = 0; i < audioData.length; i++) {
                    maxAmplitude = Math.max(maxAmplitude, Math.abs(audioData[i]));
                }
                
                // Send audio data to background script
                chrome.runtime.sendMessage({
                    action: 'audioData',
                    data: event.data.data
                }).catch(() => {
                    // Silently ignore errors
                });
                
                audioChunkCount++;
                const now = Date.now();
                if (now - lastSendTime > 5000) { // Log every 5 seconds
                    const amplitudePercent = (maxAmplitude / 32767 * 100).toFixed(1);
                    console.log('🎤 Captured', audioChunkCount, 'audio chunks from tab (AudioWorklet)');
                    console.log('   Output amplitude:', maxAmplitude, '/ 32767 (' + amplitudePercent + '%)');
                    console.log('   Audio track enabled:', audioStream.getAudioTracks()[0]?.enabled);
                    console.log('   Audio track muted:', audioStream.getAudioTracks()[0]?.muted);
                    if (maxAmplitude < 1000) {
                        console.log('   ⚠️ Audio level very low - amplification may not be working');
                        console.log('   💡 Check if AudioWorklet is actually processing audio');
                    } else if (maxAmplitude > 5000) {
                        console.log('   ✅ Good audio level - amplification working!');
                    }
                    lastSendTime = now;
                }
            }
        };

        source.connect(audioProcessor);
        audioProcessor.connect(audioContext.destination);
        
        console.log('✅ Audio processing started, context state:', audioContext.state);
        console.log('Audio stream tracks:', audioStream.getAudioTracks().length);
        if (audioStream.getAudioTracks().length > 0) {
            const track = audioStream.getAudioTracks()[0];
            console.log('Audio track enabled:', track.enabled);
            console.log('Audio track muted:', track.muted);
            console.log('Audio track readyState:', track.readyState);
            console.log('Audio track settings:', track.getSettings());
            
            // Monitor track state changes
            track.onended = () => console.log('⚠️ Audio track ended');
            track.onmute = () => console.log('⚠️ Audio track muted');
            track.onunmute = () => console.log('✅ Audio track unmuted');
        } else {
            console.error('❌ No audio tracks found in stream!');
        }

        return { success: true };
    } catch (error) {
        console.error('Error capturing tab audio:', error);
        return { success: false, error: error.message };
    }
}

// Fallback to ScriptProcessorNode if AudioWorklet is not available
async function captureTabAudioFallback(streamId) {
    try {
        if (!audioStream) {
            audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: streamId
                    }
                },
                video: false
            });
        }

        if (!audioContext) {
            audioContext = new AudioContext({ sampleRate: 16000 });
        }
        
        const source = audioContext.createMediaStreamSource(audioStream);
        
        // Fallback: Use deprecated ScriptProcessorNode
        audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        let audioChunkCount = 0;
        let lastSendTime = Date.now();
        
        audioProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Apply very strong gain amplification to boost audio levels
            const GAIN = 20.0; // Amplify by 20x to make audio much louder
            const int16Array = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                let s = Math.max(-1, Math.min(1, inputData[i]));
                // Apply gain
                s = s * GAIN;
                // Clamp to prevent clipping
                s = Math.max(-1, Math.min(1, s));
                int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // Send audio data to background script
            const uint8Array = new Uint8Array(int16Array.buffer);
            chrome.runtime.sendMessage({
                action: 'audioData',
                data: Array.from(uint8Array)
            }).catch(() => {
                // Silently ignore errors - background script might not be ready
                // This is expected during normal operation
            });
            
            audioChunkCount++;
            const now = Date.now();
            if (now - lastSendTime > 5000) {
                console.log('Sent', audioChunkCount, 'audio chunks (fallback mode)');
                lastSendTime = now;
            }
        };

        source.connect(audioProcessor);
        audioProcessor.connect(audioContext.destination);
        
        return { success: true };
    } catch (error) {
        console.error('Error in fallback capture:', error);
        return { success: false, error: error.message };
    }
}

function stopCapture() {
    if (audioProcessor) {
        audioProcessor.disconnect();
        if (audioProcessor.port) {
            audioProcessor.port.close();
        }
        audioProcessor = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
    }

    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
}
