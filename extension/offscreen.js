// Offscreen document for tab capture (required in Manifest V3)
let audioStream = null;
let audioContext = null;
let audioProcessor = null;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureTab') {
        // Handle async operation properly
        const captureMethod = request.captureMethod || 'tabCapture';
        if (captureMethod === 'displayMedia') {
            // Use getDisplayMedia instead
            captureDisplayMedia().then(result => {
                try {
                    sendResponse({ action: 'captureTabResponse', ...result });
                } catch (e) {
                    chrome.runtime.sendMessage({
                        action: 'captureTabResponse',
                        ...result
                    }).catch(() => {});
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
            return true;
        }
        // Default: tabCapture method
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
        // DON'T connect to destination - we only want to capture, not play back
        // This prevents interfering with the original tab's audio playback
        // audioProcessor.connect(audioContext.destination); // REMOVED
        
        console.log('✅ Audio processing started (capture only, no playback), context state:', audioContext.state);
        console.log('Audio stream tracks:', audioStream.getAudioTracks().length);
        if (audioStream.getAudioTracks().length > 0) {
            const track = audioStream.getAudioTracks()[0];
            console.log('Audio track enabled:', track.enabled);
            console.log('Audio track muted:', track.muted);
            console.log('Audio track readyState:', track.readyState);
            console.log('Audio track settings:', track.getSettings());
            
            // Ensure track is enabled
            track.enabled = true;
            
            // Monitor track state changes
            track.onended = () => {
                console.log('⚠️ Audio track ended');
                chrome.runtime.sendMessage({
                    action: 'audioTrackEnded',
                    message: 'Audio capture ended. You may need to restart.'
                }).catch(() => {});
            };
            track.onmute = () => {
                console.log('⚠️ Audio track muted - this may affect tab audio playback');
                chrome.runtime.sendMessage({
                    action: 'audioTrackMuted',
                    message: 'Audio track muted. Check if you can still hear Meet audio.'
                }).catch(() => {});
            };
            track.onunmute = () => {
                console.log('✅ Audio track unmuted');
            };
            
            // Warn if track becomes muted (Chrome limitation)
            if (track.muted) {
                console.warn('⚠️ WARNING: Audio track is muted. This is a Chrome limitation with tabCapture.');
                console.warn('   The tab audio may be muted. Try refreshing the Meet tab or check system volume.');
            }
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
        // DON'T connect to destination - we only want to capture, not play back
        // This prevents interfering with the original tab's audio playback
        // audioProcessor.connect(audioContext.destination); // REMOVED
        
        return { success: true };
    } catch (error) {
        console.error('Error in fallback capture:', error);
        return { success: false, error: error.message };
    }
}

// Capture audio using getDisplayMedia (preserves tab audio playback)
async function captureDisplayMedia() {
    try {
        console.log('📺 Attempting getDisplayMedia for audio capture (preserves playback)');
        
        // Check if getDisplayMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            throw new Error('getDisplayMedia is not supported in offscreen documents. Please use Tab Capture method instead.');
        }
        
        // Request display media with audio
        audioStream = await navigator.mediaDevices.getDisplayMedia({
            video: false,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                sampleRate: 16000
            }
        });
        
        const audioTracks = audioStream.getAudioTracks();
        if (audioTracks.length === 0) {
            throw new Error('No audio track selected. Please select "Share tab audio" when prompted.');
        }
        
        console.log('✅ Display media audio captured');
        
        // Create audio context
        audioContext = new AudioContext({ sampleRate: 16000 });
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        // Load AudioWorklet processor
        try {
            const workletUrl = chrome.runtime.getURL('audio-processor.js');
            await audioContext.audioWorklet.addModule(workletUrl);
            console.log('✅ AudioWorklet loaded for display media');
        } catch (error) {
            console.error('❌ Error loading AudioWorklet:', error);
            return await captureDisplayMediaFallback();
        }
        
        const source = audioContext.createMediaStreamSource(audioStream);
        audioProcessor = new AudioWorkletNode(audioContext, 'audio-processor');
        
        let audioChunkCount = 0;
        let lastSendTime = Date.now();
        
        audioProcessor.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                const uint8Data = new Uint8Array(event.data.data);
                chrome.runtime.sendMessage({
                    action: 'audioData',
                    data: event.data.data
                }).catch(() => {});
                
                audioChunkCount++;
                const now = Date.now();
                if (now - lastSendTime > 5000) {
                    console.log('🎤 Captured', audioChunkCount, 'audio chunks (display media)');
                    lastSendTime = now;
                }
            }
        };
        
        source.connect(audioProcessor);
        console.log('✅ Display media audio processing started');
        
        // Monitor track
        audioTracks[0].onended = () => {
            console.log('⚠️ Display media audio track ended');
            chrome.runtime.sendMessage({
                action: 'audioTrackEnded',
                message: 'Screen share ended. Please restart.'
            }).catch(() => {});
        };
        
        return { success: true };
    } catch (error) {
        console.error('Error capturing display media:', error);
        return { success: false, error: error.message };
    }
}

// Fallback for display media
async function captureDisplayMediaFallback() {
    // Similar to tabCapture fallback but for display media
    const source = audioContext.createMediaStreamSource(audioStream);
    audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
    
    let audioChunkCount = 0;
    
    audioProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const GAIN = 20.0;
        const int16Array = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            let s = Math.max(-1, Math.min(1, inputData[i]));
            s = s * GAIN;
            s = Math.max(-1, Math.min(1, s));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        const uint8Array = new Uint8Array(int16Array.buffer);
        chrome.runtime.sendMessage({
            action: 'audioData',
            data: Array.from(uint8Array)
        }).catch(() => {});
        
        audioChunkCount++;
    };
    
    source.connect(audioProcessor);
    return { success: true };
}

function stopCapture() {
    console.log('🛑 Stopping audio capture...');
    
    if (audioProcessor) {
        try {
            audioProcessor.disconnect();
            if (audioProcessor.port) {
                audioProcessor.port.close();
            }
        } catch (e) {
            console.log('Error disconnecting audio processor:', e);
        }
        audioProcessor = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
        try {
            audioContext.close();
        } catch (e) {
            console.log('Error closing audio context:', e);
        }
        audioContext = null;
    }

    if (audioStream) {
        try {
            audioStream.getTracks().forEach(track => {
                track.stop();
                console.log('Stopped audio track:', track.id);
            });
        } catch (e) {
            console.log('Error stopping audio tracks:', e);
        }
        audioStream = null;
    }
    
    console.log('✅ Audio capture stopped');
}
