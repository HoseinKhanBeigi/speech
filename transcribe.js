// Using AssemblyAI REST API directly
// Install axios: npm install axios

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_KEY = "bdd09a630e3244d88b75df44169e3667";

// Get audio file from command line argument or use default
const audioFile = process.argv[2] || 'https://assembly.ai/wildfires.mp3';
const outputFile = process.argv[3] || null; // Optional output file

const uploadAudio = async (audioUrl) => {
  // If it's a URL, use it directly
  if (audioUrl.startsWith('http')) {
    return audioUrl;
  }
  
  // If it's a local file, upload it first
  const audioData = fs.readFileSync(audioUrl);
  const response = await axios.post('https://api.assemblyai.com/v2/upload', audioData, {
    headers: {
      'authorization': API_KEY,
      'content-type': 'application/octet-stream',
    },
  });
  return response.data.upload_url;
};

const transcribeAudio = async (audioUrl) => {
  const response = await axios.post('https://api.assemblyai.com/v2/transcript', {
    audio_url: audioUrl,
    speech_model: 'universal'
  }, {
    headers: {
      'authorization': API_KEY,
      'content-type': 'application/json',
    },
  });
  return response.data;
};

const checkTranscriptStatus = async (transcriptId) => {
  const response = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
    headers: {
      'authorization': API_KEY,
    },
  });
  return response.data;
};

const run = async () => {
  try {
    console.log('Starting transcription...');
    
    // Upload or get audio URL
    const audioUrl = await uploadAudio(audioFile);
    console.log('Audio URL ready:', audioUrl);
    
    // Start transcription
    const transcript = await transcribeAudio(audioUrl);
    console.log('Transcription started. ID:', transcript.id);
    console.log('Status:', transcript.status);
    
    // Poll for results
    let transcriptData = transcript;
    while (transcriptData.status !== 'completed' && transcriptData.status !== 'error') {
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
      transcriptData = await checkTranscriptStatus(transcript.id);
      console.log(`Status: ${transcriptData.status}...`);
    }
    
    if (transcriptData.status === 'error') {
      throw new Error(transcriptData.error || 'Transcription failed');
    }
    
    console.log('\n=== Transcription Result ===');
    console.log(transcriptData.text);
    
    // Save to file if output file is specified
    if (outputFile) {
      const output = {
        text: transcriptData.text,
        words: transcriptData.words || [],
        metadata: {
          id: transcriptData.id,
          status: transcriptData.status,
          audio_url: audioUrl,
          created_at: transcriptData.created_at,
          completed_at: transcriptData.completed_at
        }
      };
      
      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
      console.log(`\n✅ Saved transcription to: ${outputFile}`);
      
      // Also save plain text version
      const txtFile = outputFile.replace(/\.json$/, '.txt') || outputFile + '.txt';
      fs.writeFileSync(txtFile, transcriptData.text);
      console.log(`✅ Saved plain text to: ${txtFile}`);
    }
    
    if (transcriptData.words) {
      console.log('\n=== Word Timestamps ===');
      console.log(`Total words: ${transcriptData.words.length}`);
      // Only show first 10 words in console to avoid clutter
      transcriptData.words.slice(0, 10).forEach(word => {
        console.log(`${word.text}: ${word.start}ms - ${word.end}ms`);
      });
      if (transcriptData.words.length > 10) {
        console.log(`... and ${transcriptData.words.length - 10} more words (see output file for full list)`);
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
};

run();

