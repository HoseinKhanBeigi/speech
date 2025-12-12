// Content script to inject UI into Google Meet
let transcriptionContainer = null;
let isVisible = false;

// Wait for DOM to be ready
function init() {
    // Check if extension context is still valid
    try {
        chrome.storage.sync.get(['showInMeet'], (result) => {
            if (chrome.runtime.lastError) {
                // Extension context invalidated
                console.log('Extension context invalidated');
                return;
            }
            if (result.showInMeet) {
                createTranscriptionUI();
            }
        });
    } catch (error) {
        // Extension context invalidated
        if (error.message && error.message.includes('Extension context')) {
            console.log('Extension context invalidated during init');
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Listen for storage changes
try {
    chrome.storage.onChanged.addListener((changes) => {
        if (chrome.runtime.lastError) {
            // Extension context invalidated
            return;
        }
        if (changes.showInMeet) {
            if (changes.showInMeet.newValue) {
                createTranscriptionUI();
            } else {
                removeTranscriptionUI();
            }
        }
    });
} catch (error) {
    // Extension context might be invalidated
    console.log('Could not set up storage listener:', error);
}

// Listen for transcription messages
try {
    // Check if extension context is valid before setting up listener
    if (!chrome.runtime || !chrome.runtime.id) {
        console.log('Extension context invalidated, cannot set up message listener');
    } else {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            // Check if extension context is still valid
            try {
                if (chrome.runtime.lastError) {
                    return false;
                }
                
                if (request && request.action === 'showTranscription') {
                    // Always update if container exists, or create it if showInMeet is enabled
                    if (transcriptionContainer || isVisible) {
                        if (!transcriptionContainer && isVisible) {
                            createTranscriptionUI();
                        }
                        updateTranscription(request.text, request.isFinal);
                    }
                }
            } catch (error) {
                // Extension context might be invalidated
                if (error.message && error.message.includes('Extension context')) {
                    console.log('Extension context invalidated during message handling');
                    return false;
                }
                console.error('Error handling transcription message:', error);
            }
            return false; // No async response needed
        });
    }
} catch (error) {
    // Extension context might be invalidated
    if (error.message && error.message.includes('Extension context')) {
        console.log('Extension context invalidated, cannot set up message listener');
    } else {
        console.log('Could not set up message listener:', error);
    }
}

function createTranscriptionUI() {
    if (transcriptionContainer) return;
    
    try {
        // Wait for body to be available
        if (!document.body) {
            setTimeout(createTranscriptionUI, 100);
            return;
        }
        
        transcriptionContainer = document.createElement('div');
        transcriptionContainer.id = 'meet-transcription-container';
        transcriptionContainer.innerHTML = `
            <div class="transcription-header">
                <span>📝 Live Transcription</span>
                <button id="close-transcription">×</button>
            </div>
            <div class="transcription-content" id="transcription-text"></div>
        `;
        
        document.body.appendChild(transcriptionContainer);
        isVisible = true;
        
    // Close button
    const closeBtn = transcriptionContainer.querySelector('#close-transcription');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            try {
                // Check if extension context is still valid
                if (!chrome.runtime || !chrome.runtime.id) {
                    removeTranscriptionUI();
                    return;
                }
                chrome.storage.sync.set({ showInMeet: false });
            } catch (error) {
                // Extension context might be invalidated
                if (error.message && error.message.includes('Extension context')) {
                    console.log('Extension context invalidated, removing UI manually');
                }
                removeTranscriptionUI();
            }
        });
    }
    } catch (error) {
        console.error('Error creating transcription UI:', error);
    }
}

function removeTranscriptionUI() {
    if (transcriptionContainer) {
        transcriptionContainer.remove();
        transcriptionContainer = null;
        isVisible = false;
    }
}

let finalText = '';
function updateTranscription(text, isFinal) {
    try {
        if (!transcriptionContainer) {
            // Try to create it if it doesn't exist
            if (isVisible) {
                createTranscriptionUI();
            } else {
                return;
            }
        }
        
        const textElement = transcriptionContainer.querySelector('#transcription-text');
        if (!textElement) {
            console.error('Transcription text element not found');
            return;
        }
        
        if (isFinal) {
            finalText += (finalText ? ' ' : '') + text;
            textElement.textContent = finalText;
        } else {
            textElement.innerHTML = finalText + (finalText ? ' ' : '') + `<span class="interim">${text}</span>`;
        }
        
        // Auto-scroll
        textElement.scrollTop = textElement.scrollHeight;
    } catch (error) {
        console.error('Error updating transcription:', error);
    }
}
