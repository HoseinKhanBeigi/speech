# Speech to Text App

A simple, reliable speech-to-text application with multiple options:

## Five Options Available

### 1. `mic-realtime.html` - Simple Real-time Transcription ⭐ (Recommended)
- ✅ Real-time microphone transcription (live as you speak)
- ✅ Shows interim results in gray, final text in black
- ✅ Simple and clean interface
- ✅ Requires free API key
- Uses AssemblyAI's real-time WebSocket API

### 2. `mic-record.html` - Microphone Recorder
- ✅ Record audio from microphone
- ✅ Preview recorded audio
- ✅ Transcribe recorded audio
- ✅ Simple 3-step process: Record → Stop → Transcribe
- ✅ Requires free API key
- Uses AssemblyAI's file transcription API

### 3. `index.html` - Full-Featured App
- ✅ Real-time microphone transcription (live)
- ✅ File upload transcription
- ✅ Highest accuracy
- ✅ No duplicate text issues
- ✅ Requires free API key
- Uses AssemblyAI's real-time and file transcription APIs

### 3. `index-simple.html` - Web Speech API Version
- ✅ No API key needed
- ✅ Works immediately
- ✅ Fixed duplicate text issue
- Uses browser's native Web Speech API

### 4. `transcribe.js` - Node.js Script
- ✅ Transcribe audio files from command line
- ✅ Supports local files and URLs
- ✅ Uses AssemblyAI SDK

## Features

- ✅ Real-time speech transcription
- ✅ Clean, modern UI
- ✅ Works in all modern browsers
- ✅ Start/Stop controls
- ✅ Clear text button

## Quick Start

### Real-time Microphone Transcription (`mic-realtime.html`) ⭐ Easiest Option

**Important:** Due to browser security (CORS), you need to run a local server. Don't open the HTML file directly!

1. **Start the local server:**
   ```bash
   npm start
   ```
   This will start a server at `http://localhost:3000`

2. **Open in browser:**
   - Go to `http://localhost:3000/mic-realtime.html`
   - Or just `http://localhost:3000` (it opens mic-realtime.html by default)

3. **Get a free API key:**
   - Visit [AssemblyAI](https://www.assemblyai.com/)
   - Sign up for a free account
   - Copy your API key from the dashboard

4. **Use the app:**
   - Enter your API key in the page
   - Click "Start Listening" and speak
   - See your words appear in real-time as you speak!
   - Click "Stop Listening" when done

### Microphone Recorder (`mic-record.html`)

1. **Get a free API key** (same as above)

2. **Use the app:**
   - Open `mic-record.html` in your web browser
   - Enter your API key
   - Click "Start Recording" and speak
   - Click "Stop Recording" when done
   - Click "Transcribe" to convert to text

### Full-Featured App (`index.html`)

1. **Get a free API key:**
   - Visit [AssemblyAI](https://www.assemblyai.com/)
   - Sign up for a free account
   - Copy your API key from the dashboard

2. **Run the app:**
   - Open `index.html` in your web browser
   - Enter your API key in the input field
   - **For real-time transcription:** Click "Start Listening" and begin speaking
   - **For file transcription:** Upload an audio file and click "Transcribe File"

### Simple Version (`index-simple.html`)

1. Open `index-simple.html` in your browser
2. Click "Start Listening"
3. Allow microphone access
4. Start speaking!

### Node.js Script (`transcribe.js`)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Update API key in `transcribe.js`:**
   - Replace the API key with your own

3. **Run the script:**
   ```bash
   # Use default audio file (wildfires.mp3)
   npm run transcribe
   
   # Transcribe your own file (local file or URL)
   npm run transcribe "path/to/your/audio.mp3"
   
   # Save output to JSON file
   npm run transcribe "path/to/audio.mp3" "output.json"
   ```

4. **Examples:**
   ```bash
   # Transcribe from URL
   node transcribe.js "https://example.com/audio.mp3"
   
   # Transcribe local file and save
   node transcribe.js "./my-audio.mp3" "transcript.json"
   ```

## Browser Support

**Web Speech API version** (`index-simple.html`):
- Chrome/Edge (best support)
- Safari (limited)
- Firefox (not supported)

**AssemblyAI version** (`index.html`):
- All modern browsers (Chrome, Firefox, Safari, Edge)

## Notes

- Both apps require microphone permissions
- AssemblyAI free tier includes 5 hours of transcription per month
- API key is stored locally in your browser (localStorage) for AssemblyAI version

