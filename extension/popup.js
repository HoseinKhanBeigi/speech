const apiKeyInput = document.getElementById('apiKey');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');
const toggleBtn = document.getElementById('toggleBtn');
const transcriptionSection = document.getElementById('transcriptionSection');
const transcriptionOutput = document.getElementById('transcriptionOutput');
let finalTranscriptionText = '';

// Load saved API key
chrome.storage.sync.get(['assemblyai_api_key', 'showInMeet'], (result) => {
    if (result.assemblyai_api_key) {
        apiKeyInput.value = result.assemblyai_api_key;
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
    
    // Get stream ID from popup (user activation required for tabCapture)
    let streamId;
    try {
        if (!chrome.tabCapture || !chrome.tabCapture.getMediaStreamId) {
            status.textContent = 'tabCapture API not available. Please reload extension.';
            status.classList.add('error');
            return;
        }
        
        streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: tab.id
        });
        
        if (!streamId) {
            status.textContent = 'Failed to get stream ID';
            status.classList.add('error');
            return;
        }
    } catch (error) {
        status.textContent = `Error: ${error.message}`;
        status.classList.add('error');
        return;
    }
    
    chrome.runtime.sendMessage({
        action: 'startListening',
        apiKey: apiKey,
        streamId: streamId,
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
            transcriptionOutput.textContent = 'Waiting for audio...\n\n💡 Debug steps:\n1. Open chrome://extensions/\n2. Click "service worker" under this extension\n3. Check console for logs\n4. Speak in Google Meet call\n\nLook for:\n- 🎤 Audio chunks being sent\n- 📝 Transcriptions received';
            finalTranscriptionText = '';
            
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
    });
});
