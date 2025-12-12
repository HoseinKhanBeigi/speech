# Google Meet Speech to Text Extension

A Chrome/Edge browser extension that provides real-time speech-to-text transcription for Google Meet interviews.

## Features

- 🎤 Real-time transcription of Google Meet audio
- 🔒 Secure API key storage
- 📝 Optional on-screen transcription display
- 🚀 Powered by AssemblyAI Universal Streaming API

## Installation

1. Open Chrome/Edge and go to `chrome://extensions/` (or `edge://extensions/`)
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder from this project

## Setup

1. Get your AssemblyAI API key from [assemblyai.com](https://www.assemblyai.com)
2. Click the extension icon
3. Enter your API key
4. (Optional) Toggle "Show transcription in Meet" to display transcriptions on the Google Meet page

## Usage

1. Open a Google Meet call
2. Click the extension icon
3. Click "Start Listening"
4. The extension will capture audio from the Google Meet tab and transcribe it in real-time
5. View transcriptions in the extension popup or on the Meet page (if enabled)

## Requirements

- Chrome/Edge browser
- AssemblyAI API key
- The server.js must be running on localhost:3000 (for token generation)

## Next Steps

- Add GPT API integration for AI responses
- Add export functionality for transcriptions
- Add word-level timestamps
