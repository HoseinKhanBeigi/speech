let socket = null;
let isListening = false;
let sessionReady = false;
let currentTabId = null;
let offscreenDocumentId = null;
let audioChunkCount = 0; // Track audio chunks sent
let audioWarningShown = false; // Track if warning was shown
let conversationHistory = []; // Track conversation for GPT context
let questionAnswerPairs = []; // Track numbered Q&A pairs: [{question: "...", answer: "...", number: 1}, ...]
let currentQuestionNumber = 0; // Current question number

// Audio buffering - AssemblyAI requires chunks between 50-1000ms
// At 16kHz, 50ms = 800 samples, 1000ms = 16000 samples
// We'll buffer to ~200ms = 3200 samples for good balance
const AUDIO_BUFFER_SIZE = 3200; // ~200ms at 16kHz
let audioBuffer = new Int16Array(0);

// Note: tabCapture API should be available with "tabCapture" permission

// Listen for messages from popup, content script, and offscreen document
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startListening') {
        startListening(request.apiKey, sendResponse, request.streamId, request.tabId, request.captureMethod);
        return true; // Keep channel open for async response
    } else if (request.action === 'stopListening') {
        stopListening();
        sendResponse({ success: true });
    } else if (request.action === 'getStatus') {
        sendResponse({ isListening: isListening });
    } else if (request.action === 'transcription') {
        // Forward transcription to content script
        chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'showTranscription',
                    text: request.text,
                    isFinal: request.isFinal
                });
            });
        });
    } else if (request.action === 'audioTrackMuted' || request.action === 'audioTrackEnded') {
        // Forward audio track warnings to popup
        chrome.runtime.sendMessage({
            action: 'audioWarning',
            message: request.message
        }).catch(() => {});
    } else if (request.action === 'audioData') {
        // Handle audio data from offscreen document
        if (socket && socket.readyState === WebSocket.OPEN && sessionReady && isListening) {
            // Convert array back to Int16Array properly
            // request.data is a Uint8Array sent as an array, reconstruct the buffer
            const uint8Array = new Uint8Array(request.data);
            // Create Int16Array view of the same buffer (little-endian, 2 bytes per sample)
            const newData = new Int16Array(uint8Array.buffer);
            
            // Check if audio contains actual sound (not just silence)
            // Note: newData is Int16Array, so values range from -32768 to 32767
            let hasSound = false;
            let maxAmplitude = 0;
            for (let i = 0; i < newData.length; i++) {
                const amplitude = Math.abs(newData[i]);
                if (amplitude > maxAmplitude) maxAmplitude = amplitude;
                if (amplitude > 100) { // Threshold for detecting sound
                    hasSound = true;
                }
            }
            
            // Debug: Check if amplification is working
            if (audioChunkCount % 200 === 0 && maxAmplitude < 500) {
                console.log('⚠️ Amplification check - max amplitude still very low:', maxAmplitude);
                console.log('   This suggests audio input is extremely quiet or amplification not applied');
            }
            
            // Log audio levels occasionally
            if (audioChunkCount % 200 === 0) {
                const amplitudePercent = (maxAmplitude / 32767 * 100).toFixed(1);
                console.log('🔊 Audio level check - Max amplitude:', maxAmplitude, '/ 32767 (' + amplitudePercent + '%)', 'Has sound:', hasSound);
                if (maxAmplitude < 1000) {
                    console.log('   ⚠️ Very low audio level - might be too quiet for speech detection');
                    console.log('   💡 Try increasing Meet volume or speaking louder');
                } else if (maxAmplitude > 20000) {
                    console.log('   ✅ Good audio level for speech detection');
                }
            }
            
            // Add to buffer
            const combinedLength = audioBuffer.length + newData.length;
            const combined = new Int16Array(combinedLength);
            combined.set(audioBuffer, 0);
            combined.set(newData, audioBuffer.length);
            audioBuffer = combined;
            
            // Send when buffer reaches target size (~200ms = 3200 samples at 16kHz)
            if (audioBuffer.length >= AUDIO_BUFFER_SIZE) {
                try {
                    // Send the buffered audio
                    socket.send(audioBuffer.buffer);
                    
                    // Keep any remainder in buffer
                    const remainder = audioBuffer.length - AUDIO_BUFFER_SIZE;
                    if (remainder > 0) {
                        audioBuffer = audioBuffer.slice(AUDIO_BUFFER_SIZE);
                    } else {
                        audioBuffer = new Int16Array(0);
                    }
                    
                    // Log every 50 sends (about every 10 seconds)
                    audioChunkCount++;
                    if (audioChunkCount % 50 === 0) {
                        console.log('🎤 Sent', audioChunkCount, 'buffered audio chunks to AssemblyAI');
                        if (hasSound) {
                            console.log('   ✅ Audio contains sound');
                        } else {
                            console.log('   ⚠️ Audio appears to be silence');
                        }
                    }
                } catch (error) {
                    console.error('❌ Error sending audio:', error);
                    console.error('Socket state:', socket?.readyState);
                }
            }
        } else {
            // Only show warning once, and only if we're actually trying to send
            if (!audioWarningShown && (socket || isListening)) {
                console.log('⚠️ Not ready to send audio:', {
                    isListening,
                    socketExists: !!socket,
                    socketReady: socket?.readyState,
                    sessionReady
                });
                audioWarningShown = true;
            }
        }
    } else if (request.action === 'captureTab') {
        // This message is for offscreen document, forward it
        // The offscreen document will handle it
    }
    return true;
});

async function startListening(apiKey, sendResponse, streamIdFromPopup, tabIdFromPopup, captureMethodFromPopup) {
    try {
        // Stop any existing capture first to avoid "active stream" error
        if (isListening) {
            console.log('⚠️ Already listening, stopping previous session...');
            stopListening();
            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Use stream ID from popup if provided (user activation required)
        let streamId = streamIdFromPopup;
        let currentTabId = tabIdFromPopup;
        const captureMethod = captureMethodFromPopup || 'tabCapture';
        
        // If not provided, try to get it (might fail without user activation)
        if (!streamId) {
            const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
            if (tabs.length === 0) {
                sendResponse({ success: false, error: 'No Google Meet tab found' });
                return;
            }
            currentTabId = tabs[0].id;
            
            // Try to get stream ID (may fail without user activation)
            try {
                if (chrome.tabCapture && chrome.tabCapture.getMediaStreamId) {
                    streamId = await chrome.tabCapture.getMediaStreamId({
                        targetTabId: currentTabId
                    });
                }
            } catch (error) {
                console.log('Could not get stream ID in background:', error);
            }
        }
        
        if (!streamId) {
            sendResponse({ 
                success: false, 
                error: 'Failed to get stream ID. Please click Start from the extension popup.' 
            });
            return;
        }

        // Create offscreen document if it doesn't exist
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        
        if (existingContexts.length === 0) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: [chrome.offscreen.Reason.USER_MEDIA],
                justification: 'Capturing tab audio for transcription'
            });
        }

        // Wait a moment for offscreen document to be ready
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Request tab capture from offscreen document with the stream ID
        const captureResponse = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ success: false, error: 'Timeout waiting for offscreen document' });
            }, 10000); // Increased timeout for displayMedia
            
            // Set up one-time listener for response
            const listener = (message, sender, sendResponse) => {
                if (message && message.action === 'captureTabResponse') {
                    chrome.runtime.onMessage.removeListener(listener);
                    clearTimeout(timeout);
                    resolve(message);
                    return true; // Indicate we handled the message
                }
            };
            
            chrome.runtime.onMessage.addListener(listener);
            
            // Send message to offscreen document
            chrome.runtime.sendMessage({
                action: 'captureTab',
                streamId: streamId,
                captureMethod: captureMethod
            }, (response) => {
                // Handle direct response if channel is still open
                if (chrome.runtime.lastError) {
                    // Error sending, wait for listener response instead
                    return;
                }
                if (response && response.action === 'captureTabResponse') {
                    chrome.runtime.onMessage.removeListener(listener);
                    clearTimeout(timeout);
                    resolve(response);
                }
            });
        });

        if (!captureResponse || !captureResponse.success) {
            const errorMsg = captureResponse?.error || 'Failed to capture audio. Please check permissions.';
            console.error('❌ Capture failed:', errorMsg);
            
            // If displayMedia failed, suggest using tabCapture
            if (captureMethod === 'displayMedia' && errorMsg.includes('Not supported') || errorMsg.includes('getDisplayMedia')) {
                sendResponse({ 
                    success: false, 
                    error: 'Screen Share Audio not supported in this context. Please use "Tab Capture" method instead (note: it will mute Meet audio, but transcriptions will work).' 
                });
            } else {
                sendResponse({ 
                    success: false, 
                    error: errorMsg 
                });
            }
            return;
        }

        // Set up listener for audio data from offscreen document (if not already set)
        // This will be handled in the main message listener

        // Get token from server
        const tokenResponse = await fetch('http://localhost:3000/api/get-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: apiKey })
        });

        if (!tokenResponse.ok) {
            const error = await tokenResponse.text();
            sendResponse({ success: false, error: `Failed to get token: ${error}` });
            return;
        }

        const { token } = await tokenResponse.json();

        // Connect to AssemblyAI WebSocket
        // Add format_turns=true to get formatted transcripts
        // Adjust turn detection parameters for better detection and accuracy
        const wsUrl = `wss://streaming.assemblyai.com/v3/ws?token=${token}&sample_rate=16000&speech_model=universal-streaming-multilingual&encoding=pcm_s16le&format_turns=true&end_of_turn_confidence_threshold=0.5&min_end_of_turn_silence_when_confident=500&max_turn_silence=3000&word_boost=["interview","yourself","experience","project","background","skills"]`;
        console.log('🔗 Connecting to:', wsUrl.replace(token, 'TOKEN_HIDDEN'));
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('✅ WebSocket connected to AssemblyAI');
            console.log('WebSocket readyState:', socket.readyState);
            isListening = true;
            // Don't set sessionReady here - wait for Begin message
        };

        let messageCount = 0;
        socket.onmessage = (event) => {
            try {
                messageCount++;
                const data = JSON.parse(event.data);
                console.log(`📨 Message #${messageCount} from AssemblyAI - Type:`, data.type);
                
                // Only log full message for non-Begin messages to reduce noise
                if (data.type !== 'Begin') {
                    console.log('   Full message:', JSON.stringify(data, null, 2));
                }
                
                if (data.type === 'Begin') {
                    console.log('✅ Session started with AssemblyAI, ID:', data.id);
                    console.log('   Session expires at:', new Date(data.expires_at * 1000).toLocaleString());
                    setTimeout(() => {
                        sessionReady = true;
                        isListening = true; // Make sure this is set
                        console.log('✅ Session ready - audio will now be sent to AssemblyAI');
                        console.log('   Waiting for Turn messages...');
                    }, 100);
                } else if (data.type === 'Error') {
                    console.error('❌ AssemblyAI error:', data);
                    console.error('Error message:', data.message || data.error);
                    stopListening();
                } else if (data.type === 'Turn') {
                    console.log('🎉📝 RECEIVED TURN MESSAGE FROM ASSEMBLYAI!');
                    console.log('   Full Turn data:', JSON.stringify(data, null, 2));
                    
                    const transcript = data.transcript || '';
                    const formatted = data.turn_is_formatted;
                    const endOfTurn = data.end_of_turn;
                    
                    console.log('   Transcript:', transcript);
                    console.log('   Transcript length:', transcript.length);
                    console.log('   Formatted:', formatted, '| End of turn:', endOfTurn);
                    console.log('   Words:', data.words?.length || 0, 'words');
                    console.log('   Turn order:', data.turn_order);
                    
                    // Handle both empty and non-empty transcripts
                    // AssemblyAI may send Turn messages with empty transcripts during silence
                    if (transcript && transcript.trim()) {
                        console.log('✅✅✅ VALID TRANSCRIPT FOUND:', transcript);
                        // Send transcription to content script (if enabled)
                        chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
                            tabs.forEach(tab => {
                                chrome.tabs.sendMessage(tab.id, {
                                    action: 'showTranscription',
                                    text: transcript,
                                    isFinal: formatted || data.end_of_turn
                                }).then(() => {
                                    console.log('✅ Sent transcription to content script');
                                }).catch(() => {
                                    // Content script might not be ready, that's okay
                                });
                            });
                        });
                        
                        // Send to popup if open
                        chrome.runtime.sendMessage({
                            action: 'transcription',
                            text: transcript,
                            isFinal: formatted || endOfTurn
                        }).then(() => {
                            console.log('✅ Sent transcription to popup:', transcript);
                        }).catch((err) => {
                            // Popup might not be open, that's okay
                            console.log('ℹ️ Popup not open (this is normal if popup is closed)');
                        });

                        // Trigger RAG + GPT answer when we have an end-of-turn (or formatted) transcript
                        // Only treat as a new question if it's a complete turn (end_of_turn = true)
                        // This ensures we don't count partial/interim transcripts as separate questions
                        if (endOfTurn) {
                            // Increment question number for new complete question
                            currentQuestionNumber++;
                            console.log(`📝 New Question ${currentQuestionNumber} detected: "${transcript.substring(0, 80)}..."`);
                            fetchRagAnswer(transcript, currentQuestionNumber).catch(err => {
                                console.error('❌ RAG/GPT call failed:', err);
                            });
                        } else if (formatted) {
                            // For formatted but not end-of-turn, use current question number (might be continuation)
                            // Only call if we don't already have an answer for this question
                            const hasAnswer = questionAnswerPairs.some(pair => pair.number === currentQuestionNumber);
                            if (!hasAnswer && currentQuestionNumber > 0) {
                                console.log(`📝 Formatted transcript for Question ${currentQuestionNumber}: "${transcript.substring(0, 80)}..."`);
                                fetchRagAnswer(transcript, currentQuestionNumber).catch(err => {
                                    console.error('❌ RAG/GPT call failed:', err);
                                });
                            }
                        }
                    } else {
                        console.log('ℹ️ Turn message with empty transcript (silence or no speech detected)');
                    }
                } else if (data.type === 'Termination') {
                    console.log('⚠️ Session terminated by AssemblyAI:', data);
                    if (data.reason) {
                        console.log('Termination reason:', data.reason);
                    }
                    stopListening();
                } else if (data.type === 'Error') {
                    console.error('❌ AssemblyAI error received:', data);
                    console.error('Error details:', JSON.stringify(data, null, 2));
                    stopListening();
                } else {
                    // Log any other message types we might be missing
                    console.log('ℹ️ Other message type from AssemblyAI:', data.type);
                    console.log('   Full message:', JSON.stringify(data, null, 2));
                }
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        socket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            console.error('Error details:', {
                type: error.type,
                target: error.target,
                readyState: socket?.readyState
            });
            stopListening();
        };

        socket.onclose = (event) => {
            console.log('⚠️ WebSocket closed:', {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean,
                totalMessagesReceived: messageCount
            });
            
            // Common close codes:
            // 1000 = Normal closure
            // 1006 = Abnormal closure (no close frame)
            // 1008 = Policy violation
            // 1011 = Internal error
            // 3005 = Custom error from AssemblyAI
            
            if (event.code === 1006) {
                console.error('❌ WebSocket closed abnormally - connection lost');
            } else if (event.code === 1008) {
                console.error('❌ WebSocket closed - policy violation. Check API key and permissions.');
            } else if (event.code === 1011) {
                console.error('❌ WebSocket closed - server error');
            } else if (event.reason) {
                console.error('❌ WebSocket closed reason:', event.reason);
            }
            
            if (messageCount === 1) {
                console.warn('⚠️ Only received Begin message, no Turn messages. Possible issues:');
                console.warn('   - No speech detected in audio');
                console.warn('   - Audio format might be incorrect');
                console.warn('   - Need to wait longer for speech processing');
            }
            
            if (isListening) {
                stopListening();
            }
        };

        sendResponse({ success: true });
    } catch (error) {
        console.error('Error starting listening:', error);
        sendResponse({ success: false, error: error.message });
    }
}

function stopListening() {
    isListening = false;
    sessionReady = false;

    // Send any remaining buffered audio before closing
    if (socket && socket.readyState === WebSocket.OPEN && audioBuffer.length > 0) {
        try {
            socket.send(audioBuffer.buffer);
            console.log('📤 Sent final', audioBuffer.length, 'samples before closing');
        } catch (error) {
            console.error('Error sending final audio:', error);
        }
    }
    audioBuffer = new Int16Array(0); // Clear buffer

    if (socket) {
        socket.close();
        socket = null;
    }

    // Stop capture in offscreen document
    chrome.runtime.sendMessage({
        action: 'stopCapture'
    });

    currentTabId = null;
    audioChunkCount = 0; // Reset counter
    audioWarningShown = false; // Reset warning flag
    conversationHistory = []; // Reset conversation history
    questionAnswerPairs = []; // Reset Q&A pairs
    currentQuestionNumber = 0; // Reset question number
}

// Fetch GPT answer using local RAG service
async function fetchRagAnswer(transcript, questionNumber) {
    if (!transcript || !transcript.trim()) {
        console.log('⚠️ Skipping RAG call - empty transcript');
        return;
    }
    
    // Check if we already have an answer for this question number
    const existingPair = questionAnswerPairs.find(pair => pair.number === questionNumber);
    if (existingPair) {
        console.log(`ℹ️ Already have Answer ${questionNumber}, skipping duplicate call`);
        return;
    }
    
    console.log(`🔍 Calling RAG/GPT for Question ${questionNumber}:`, transcript.substring(0, 100) + '...');
    
    try {
        // Add transcript to conversation history as interviewer question
        conversationHistory.push({
            role: 'user',
            content: `Interviewer Question ${questionNumber}: "${transcript}"`
        });
        
        // Keep only last 10 messages to avoid token limits
        if (conversationHistory.length > 10) {
            conversationHistory = conversationHistory.slice(-10);
        }
        
        const response = await fetch('http://localhost:3000/api/rag/answer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                transcript: transcript.trim(),
                chatHistory: conversationHistory.slice(0, -1) // Send history without current message
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ RAG API error:', response.status, errorText);
            throw new Error(`RAG answer failed: ${response.status} ${errorText}`);
        }

        const { answer, context } = await response.json();
        console.log(`✅ GPT Answer ${questionNumber} received:`, answer);
        console.log('📚 Context used:', context?.map(c => c.title).join(', ') || 'none');

        // Add GPT response to conversation history
        conversationHistory.push({
            role: 'assistant',
            content: answer
        });

        // Store Q&A pair (replace if exists, otherwise add)
        const existingIndex = questionAnswerPairs.findIndex(pair => pair.number === questionNumber);
        const newPair = {
            number: questionNumber,
            question: transcript.trim(),
            answer: answer
        };
        
        if (existingIndex >= 0) {
            questionAnswerPairs[existingIndex] = newPair;
            console.log(`🔄 Updated Q&A pair ${questionNumber}`);
        } else {
            questionAnswerPairs.push(newPair);
            console.log(`➕ Added new Q&A pair ${questionNumber}`);
        }
        
        // Sort pairs by number to ensure correct order
        questionAnswerPairs.sort((a, b) => a.number - b.number);

        chrome.runtime.sendMessage({
            action: 'gptResponse',
            questionNumber: questionNumber,
            question: transcript.trim(),
            answer,
            context,
            allPairs: [...questionAnswerPairs] // Send copy of all pairs for display
        }).then(() => {
            console.log(`✅ Sent Q&A pair ${questionNumber} to popup (total: ${questionAnswerPairs.length} pairs)`);
        }).catch(err => {
            console.error('❌ Failed to send GPT response to popup:', err);
        });
    } catch (error) {
        console.error('❌ Error fetching RAG answer:', error);
        console.error('   Error details:', error.message);
    }
}
