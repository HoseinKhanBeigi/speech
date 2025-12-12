# Debugging Guide

## How to Verify Audio Flow

### Step 1: Open Service Worker Console
1. Go to `chrome://extensions/`
2. Find "Google Meet Speech to Text Assistant"
3. Click "service worker" or "background page"
4. This opens the console where you'll see logs

### Step 2: Check Audio Capture
Look for these logs in the service worker console:
- `🎤 Captured X audio chunks from tab` - Audio is being captured from Google Meet
- `🎤 Sent X audio chunks to AssemblyAI` - Audio is being sent to AssemblyAI

### Step 3: Check WebSocket Connection
Look for:
- `✅ WebSocket connected to AssemblyAI` - Connection established
- `✅ Session started with AssemblyAI` - Session ready
- `✅ Session ready - audio will now be sent` - Audio processing started

### Step 4: Check Transcriptions
Look for:
- `📝 Received transcription from AssemblyAI: [text]` - Transcription received
- `✅ Sent transcription to popup` - Sent to popup
- `✅ Sent transcription to content script` - Sent to Meet page

### Step 5: Check Popup Console
1. Open the extension popup
2. Right-click in the popup → Inspect
3. Check console for:
   - `📝 Popup received transcription: [text]`
   - `✅ Updated final transcription in popup`

### Step 6: Check Content Script Console
1. Open Google Meet page
2. Press F12 to open DevTools
3. Check console for transcription messages

## Common Issues

### No audio chunks being sent
- Check if audio track is enabled: Look for `Audio track enabled: true`
- Check if audio track is muted: Look for `Audio track muted: false`
- Make sure you're in a Google Meet call with audio

### WebSocket not connecting
- Check if server.js is running on localhost:3000
- Check if API key is correct
- Look for token errors in console

### No transcriptions received
- Check if audio is being sent (Step 2)
- Check if WebSocket is connected (Step 3)
- Make sure someone is speaking in the Meet call
- Check AssemblyAI account has credits

## Test Flow Summary

1. ✅ Audio captured from tab → `🎤 Captured X audio chunks`
2. ✅ Audio sent to background → `🎤 Sent X audio chunks to AssemblyAI`
3. ✅ WebSocket connected → `✅ WebSocket connected`
4. ✅ Session started → `✅ Session started`
5. ✅ Transcription received → `📝 Received transcription`
6. ✅ Displayed in popup → Check popup UI
7. ✅ Displayed in Meet (if enabled) → Check Meet page
