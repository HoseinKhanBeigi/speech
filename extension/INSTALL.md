# Installation Guide

## Step 1: Generate Icons (Optional but Recommended)

1. Open `create-icons.html` in your browser
2. Click the download links to save `icon16.png`, `icon48.png`, and `icon128.png`
3. Save them in the `extension` folder

Or create simple placeholder icons - the extension will work without them.

## Step 2: Start the Server

The extension needs the server running for token generation:

```bash
cd /Users/hossein/Documents/speech
node server.js
```

Keep this running in a terminal.

## Step 3: Load the Extension

1. Open Chrome/Edge
2. Go to `chrome://extensions/` (Chrome) or `edge://extensions/` (Edge)
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `extension` folder: `/Users/hossein/Documents/speech/extension`

## Step 4: Setup

1. Open a Google Meet tab
2. Click the extension icon in your browser toolbar
3. Enter your AssemblyAI API key
4. (Optional) Toggle "Show transcription in Meet" to see transcriptions on the Meet page

## Step 5: Use It!

1. Join a Google Meet call
2. Click the extension icon
3. Click **Start Listening**
4. The extension will capture audio from the Meet tab and transcribe it

## Troubleshooting

- **"Failed to capture audio"**: Make sure you're on a Google Meet page and have granted permissions
- **"Failed to get token"**: Make sure `server.js` is running on localhost:3000
- **No transcription**: Check that your API key is correct and you have credits in AssemblyAI

## Next: Add GPT Integration

Once this works, we can add GPT API integration to generate responses to the interviewer's questions!
