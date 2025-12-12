const apiKeyInput = document.getElementById('apiKey');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');
const toggleBtn = document.getElementById('toggleBtn');
const transcriptionSection = document.getElementById('transcriptionSection');
const transcriptionOutput = document.getElementById('transcriptionOutput');
const gptSection = document.getElementById('gptSection');
const gptOutput = document.getElementById('gptOutput');
const captureMethodSelect = document.getElementById('captureMethod');
let finalTranscriptionText = '';
let qaPairs = []; // Store all Q&A pairs

// Load saved API key
chrome.storage.sync.get(['assemblyai_api_key', 'showInMeet'], (result) => {
    // Default API key for testing (can be overridden by saved value)
    const defaultApiKey = 'bdd09a630e3244d88b75df44169e3667';
    
    if (result.assemblyai_api_key) {
        apiKeyInput.value = result.assemblyai_api_key;
    } else {
        // Use default for testing if nothing saved
        apiKeyInput.value = defaultApiKey;
        // Also save it so it persists
        chrome.storage.sync.set({ assemblyai_api_key: defaultApiKey });
    }
    if (result.showInMeet) {
        toggleBtn.classList.add('active');
    }
});

// Save API key on input
apiKeyInput.addEventListener('input', () => {
    chrome.storage.sync.set({ assemblyai_api_key: apiKeyInput.value });
});

// Toggle show in Meet
toggleBtn.addEventListener('click', () => {
    const isActive = toggleBtn.classList.toggle('active');
    chrome.storage.sync.set({ showInMeet: isActive });
});

// Listen for transcription messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Popup received message:', request);
    if (request.action === 'transcription') {
        console.log('📝 Popup received transcription:', request.text, 'isFinal:', request.isFinal);
        updateTranscription(request.text, request.isFinal);
    } else if (request.action === 'audioWarning') {
        console.warn('⚠️ Audio warning:', request.message);
        if (status) {
            status.textContent = '⚠️ ' + request.message;
            status.classList.add('error');
        }
    } else if (request.action === 'gptResponse') {
        console.log(`🤖 Popup received GPT response for Q${request.questionNumber}:`, request.answer);
        if (request.allPairs) {
            qaPairs = request.allPairs;
        } else {
            // Fallback: add single pair
            qaPairs.push({
                number: request.questionNumber,
                question: request.question,
                answer: request.answer
            });
        }
        updateGptResponse();
    }
    return false;
});

function updateTranscription(text, isFinal) {
    if (!transcriptionSection || !transcriptionOutput) {
        console.log('⚠️ Transcription UI not ready');
        return;
    }
    
    transcriptionSection.style.display = 'block';
    
    if (isFinal) {
        finalTranscriptionText += (finalTranscriptionText ? ' ' : '') + text;
        transcriptionOutput.textContent = finalTranscriptionText;
        console.log('✅ Updated final transcription in popup:', finalTranscriptionText);
    } else {
        transcriptionOutput.innerHTML = finalTranscriptionText + (finalTranscriptionText ? ' ' : '') + 
            `<span style="color: #999; font-style: italic;">${text}</span>`;
        console.log('📝 Updated interim transcription in popup');
    }
    
    // Auto-scroll
    transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
}

function updateGptResponse() {
    if (!gptSection || !gptOutput) {
        console.log('⚠️ GPT UI elements not found');
        return;
    }
    
    if (qaPairs.length === 0) {
        gptSection.style.display = 'none';
        return;
    }
    
    gptSection.style.display = 'block';
    
    // Show ALL Q&A pairs in conversation format, sorted by number
    const sortedPairs = [...qaPairs].sort((a, b) => a.number - b.number);
    
    let html = '';
    
    if (sortedPairs.length === 0) {
        html = '<div style="color: #666; font-style: italic; text-align: center; padding: 20px;">Waiting for questions and answers...</div>';
    } else {
        // Display all Q&A pairs in conversation format
        sortedPairs.forEach(pair => {
            html += `<div style="margin-bottom: 24px; padding: 0;">`;
            // Question
            html += `<div style="font-weight: 700; font-size: 15px; color: #667eea; margin-bottom: 8px;">Question ${pair.number}:</div>`;
            html += `<div style="color: #1f2937; margin-bottom: 16px; font-size: 14px; line-height: 1.7; padding: 12px 16px; background: #f0f4ff; border-radius: 6px; border-left: 4px solid #667eea;">"${pair.question}"</div>`;
            // Answer
            html += `<div style="font-weight: 700; font-size: 15px; color: #10b981; margin-bottom: 8px;">Answer ${pair.number}:</div>`;
            html += `<div style="color: #1f2937; line-height: 1.7; padding: 12px 16px; background: #f0fdf4; border-radius: 6px; border-left: 4px solid #10b981; font-size: 14px; margin-bottom: 8px;">${pair.answer}</div>`;
            html += `</div>`;
        });
    }
    
    gptOutput.innerHTML = html;
    console.log(`✅ Updated GPT responses in popup: ${sortedPairs.length} Q&A pairs`);
    // Auto-scroll to bottom to show latest
    gptOutput.scrollTop = gptOutput.scrollHeight;
}

// Check if already listening
chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response && response.isListening) {
        startBtn.disabled = true;
        startBtn.style.display = 'none';
        stopBtn.disabled = false;
        stopBtn.style.display = 'block';
        status.textContent = 'Listening...';
        status.classList.add('active');
        transcriptionSection.style.display = 'block';
        transcriptionOutput.textContent = 'Listening... Speak in Google Meet to see transcriptions.';
    }
});

startBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
        status.textContent = 'Please enter your API key';
        status.classList.add('error');
        return;
    }

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.includes('meet.google.com')) {
        status.textContent = 'Please open a Google Meet tab first';
        status.classList.add('error');
        return;
    }

    status.textContent = 'Starting...';
    status.classList.remove('error');
    
    const captureMethod = captureMethodSelect?.value || 'tabCapture';
    let streamId = null;
    
    // First, stop any existing capture to avoid "active stream" error
    try {
        status.textContent = 'Stopping previous session...';
        chrome.runtime.sendMessage({ action: 'stopListening' }, () => {
            // Continue after stopping
        });
        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
        console.log('Error stopping previous session:', e);
    }
    
    // Use tabCapture (works but mutes audio - Chrome limitation)
    try {
        if (!chrome.tabCapture || !chrome.tabCapture.getMediaStreamId) {
            status.textContent = 'tabCapture API not available. Please reload extension.';
            status.classList.add('error');
            return;
        }
        
        // Try to get stream ID (single attempt - retries handled by background)
        try {
            status.textContent = 'Getting stream ID...';
            streamId = await chrome.tabCapture.getMediaStreamId({
                targetTabId: tab.id
            });
        } catch (error) {
            const errorMsg = error.message || error.toString();
            if (errorMsg.includes('active stream') || errorMsg.includes('Cannot capture')) {
                status.textContent = '⚠️ Tab is busy. Please:\n1. Refresh the Google Meet tab\n2. Click "Stop Listening" if running\n3. Click "Start Listening" again';
                status.classList.add('error');
                return;
            }
            throw error;
        }
        
        if (!streamId) {
            status.textContent = 'Failed to get stream ID. Try refreshing the Meet tab and try again.';
            status.classList.add('error');
            return;
        }
    } catch (error) {
        const errorMsg = error.message || error.toString();
        if (errorMsg.includes('active stream') || errorMsg.includes('Cannot capture')) {
            status.textContent = '⚠️ Tab is already being captured. Please:\n1. Refresh the Google Meet tab\n2. Click "Stop Listening" if it\'s running\n3. Then click "Start Listening" again';
        } else {
            status.textContent = `Error: ${errorMsg}`;
        }
        status.classList.add('error');
        return;
    }
    
    chrome.runtime.sendMessage({
        action: 'startListening',
        apiKey: apiKey,
        streamId: streamId,
        captureMethod: captureMethod,
        tabId: tab.id
    }, (response) => {
        if (response && response.success) {
            startBtn.disabled = true;
            startBtn.style.display = 'none';
            stopBtn.disabled = false;
            stopBtn.style.display = 'block';
            status.textContent = 'Listening to Google Meet...';
            status.classList.add('active');
            transcriptionSection.style.display = 'block';
            transcriptionOutput.textContent = 'Waiting for audio...\n\n✅ LISTENING STARTED!\n\n⚠️ IMPORTANT: Meet audio is now muted (this is normal!)\n\n✅ WHAT\'S WORKING:\n- Audio capture: ✅ Working\n- Transcriptions: ✅ Will appear here\n- GPT answers: ✅ Will appear below\n\n💡 HOW TO USE:\n1. Mute yourself in Google Meet (click mic icon)\n2. Read transcriptions below as interviewer speaks\n3. Check GPT answers below for help responding\n4. Click "Stop Listening" when done (audio will return)\n\n📝 Transcriptions will appear here in real-time...';
            finalTranscriptionText = '';
            qaPairs = []; // Reset Q&A pairs for new session
            if (gptOutput) gptOutput.innerHTML = '';
            if (gptSection) gptSection.style.display = 'none';
            
            // Test message listener is working
            console.log('✅ Popup ready, listening for transcriptions...');
            
            // Test if we can receive messages
            setTimeout(() => {
                chrome.runtime.sendMessage({ action: 'test' }, (response) => {
                    console.log('Popup can send messages:', !chrome.runtime.lastError);
                });
            }, 1000);
        } else {
            status.textContent = response?.error || 'Failed to start';
            status.classList.add('error');
        }
    });
});

stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopListening' }, () => {
        startBtn.disabled = false;
        startBtn.style.display = 'block';
        stopBtn.disabled = true;
        stopBtn.style.display = 'none';
        status.textContent = 'Stopped';
        status.classList.remove('active');
        transcriptionSection.style.display = 'none';
        finalTranscriptionText = '';
        qaPairs = []; // Clear Q&A pairs
        if (gptOutput) gptOutput.innerHTML = '';
        if (gptSection) gptSection.style.display = 'none';
    });
});
