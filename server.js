require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const url = require('url');
const { OpenAI } = require('openai');

const PORT = 3000;

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
};

// ---------- Simple in-memory RAG store ----------
const openaiApiKey = process.env.OPENAI_API_KEY || '';
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;
const backgroundPath = path.join(__dirname, 'data', 'background.json');
let backgroundEntries = [];
let backgroundEmbeddings = [];
let embeddingsLoaded = false;

async function loadBackgroundEmbeddings() {
    if (!openai) {
        throw new Error('OPENAI_API_KEY is required for RAG endpoints.');
    }
    if (embeddingsLoaded) return;

    const fileExists = fs.existsSync(backgroundPath);
    if (!fileExists) {
        throw new Error(`Background file not found at ${backgroundPath}`);
    }

    const raw = await fsPromises.readFile(backgroundPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Background file must be a non-empty JSON array of {id, title, text}.');
    }

    backgroundEntries = parsed;
    backgroundEmbeddings = [];

    for (const entry of parsed) {
        const inputText = [entry.title, entry.text].filter(Boolean).join('\n');
        const result = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: inputText
        });
        backgroundEmbeddings.push({
            id: entry.id,
            embedding: result.data[0].embedding,
            title: entry.title,
            text: entry.text
        });
    }

    embeddingsLoaded = true;
    console.log(`✅ Loaded ${backgroundEmbeddings.length} background embeddings for RAG.`);
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-12);
}

async function queryRag({ query, topK = 3 }) {
    await loadBackgroundEmbeddings();
    const embeddingRes = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query
    });
    const queryEmbedding = embeddingRes.data[0].embedding;
    const scored = backgroundEmbeddings.map(entry => ({
        ...entry,
        score: cosineSimilarity(queryEmbedding, entry.embedding)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

async function answerWithRag({ transcript, chatHistory = [] }) {
    const top = await queryRag({ query: transcript, topK: 3 });
    const context = top.map((item, idx) => `(${idx + 1}) ${item.title}\n${item.text}`).join('\n\n');

    const messages = [
        {
            role: 'system',
            content: 'You are a concise interview assistant. Use the provided background to tailor answers. Keep replies short (2-4 sentences) unless asked for more detail.'
        },
        {
            role: 'system',
            content: `Background context:\n${context || 'No background available.'}`
        },
        ...chatHistory,
        {
            role: 'user',
            content: `Interviewer said: "${transcript}". Respond briefly using the background context.`
        }
    ];

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.6,
        max_tokens: 160
    });

    const answer = completion.choices[0].message.content || '';
    return { answer, context: top };
}

// ---------- HTTP server ----------
const server = http.createServer(async (req, res) => {
    console.log(`${req.method} ${req.url}`);

    const parsedUrl = url.parse(req.url, true);

    // Proxy endpoint for AssemblyAI Universal Streaming API v3 token
    if (parsedUrl.pathname === '/api/get-token' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const { apiKey } = JSON.parse(body);
                
                if (!apiKey) {
                    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: 'API key required' }));
                    return;
                }

                // Request token from AssemblyAI Universal Streaming API v3
                // Token expiration: 1-600 seconds (default: 600 seconds = 10 minutes)
                const expiresIn = 600;
                const options = {
                    hostname: 'streaming.assemblyai.com',
                    path: `/v3/token?expires_in_seconds=${expiresIn}`,
                    method: 'GET',
                    headers: {
                        'authorization': apiKey
                    }
                };

                const assemblyReq = https.request(options, (assemblyRes) => {
                    let data = '';
                    assemblyRes.on('data', (chunk) => {
                        data += chunk;
                    });
                    assemblyRes.on('end', () => {
                        console.log(`Token request status: ${assemblyRes.statusCode}`);
                        if (assemblyRes.statusCode !== 200) {
                            console.log('Token response error:', data);
                        }
                        res.writeHead(assemblyRes.statusCode, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'POST, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type'
                        });
                        res.end(data);
                    });
                });

                assemblyReq.on('error', (error) => {
                    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: error.message }));
                });

                assemblyReq.end();
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
        });
        return;
    }

    // RAG: query top-k context
    if (parsedUrl.pathname === '/api/rag/query' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { query, topK = 3 } = JSON.parse(body || '{}');
                if (!query) {
                    res.writeHead(400, corsHeaders());
                    res.end(JSON.stringify({ error: 'query is required' }));
                    return;
                }
                const results = await queryRag({ query, topK });
                res.writeHead(200, corsHeaders());
                res.end(JSON.stringify({ results }));
            } catch (err) {
                console.error('RAG query error:', err);
                res.writeHead(500, corsHeaders());
                res.end(JSON.stringify({ error: err.message || 'RAG query failed' }));
            }
        });
        return;
    }

    // RAG: answer with GPT using retrieved context
    if (parsedUrl.pathname === '/api/rag/answer' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { transcript, chatHistory = [], topK = 3 } = JSON.parse(body || '{}');
                if (!transcript) {
                    res.writeHead(400, corsHeaders());
                    res.end(JSON.stringify({ error: 'transcript is required' }));
                    return;
                }
                const top = await queryRag({ query: transcript, topK });
                const context = top.map((item, idx) => `(${idx + 1}) ${item.title}\n${item.text}`).join('\n\n');
                const messages = [
                    {
                        role: 'system',
                        content: `You are an interview assistant helping a candidate prepare answers. Your job is to:
1. FIRST: Analyze what the interviewer is asking - what are they really trying to learn?
2. SECOND: Think about what makes a strong answer to that specific question
3. THIRD: Craft a natural, confident response the candidate can say, using their background information
4. Keep answers concise (2-4 sentences) unless the question requires more detail
5. Make it sound conversational and authentic, not robotic
6. Reference specific skills/projects from the background when relevant

IMPORTANT: Don't just repeat what the candidate said. Think about what the interviewer wants to know and craft a thoughtful answer that addresses their question using the candidate's background.

Background information about the candidate:
${context || 'No background available.'}`
                    },
                    ...chatHistory,
                    {
                        role: 'user',
                        content: `The interviewer just said: "${transcript}"

Analyze what they're asking, then craft a thoughtful answer the candidate can give. Use the background information to make it specific and relevant. Make it sound natural and confident - like the candidate is speaking, not reading a script.`
                    }
                ];

                console.log(`🤖 Processing RAG answer for transcript: "${transcript.substring(0, 100)}..."`);
                console.log(`📚 Retrieved ${top.length} context items`);
                
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages,
                    temperature: 0.7,
                    max_tokens: 250
                });

                const answer = completion.choices[0].message.content || '';
                console.log(`✅ GPT answer generated: ${answer.substring(0, 100)}...`);
                res.writeHead(200, corsHeaders());
                res.end(JSON.stringify({ answer, context: top }));
            } catch (err) {
                console.error('RAG answer error:', err);
                res.writeHead(500, corsHeaders());
                res.end(JSON.stringify({ error: err.message || 'RAG answer failed' }));
            }
        });
        return;
    }

    // Handle OPTIONS for CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, corsHeaders());
        res.end();
        return;
    }

    // Serve static files
    let filePath = '.' + parsedUrl.pathname;
    if (filePath === './') {
        filePath = './mic-realtime.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                // Ignore favicon.ico 404 errors
                if (filePath.includes('favicon.ico')) {
                    res.writeHead(204);
                    res.end();
                    return;
                }
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 - File Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end(`Server Error: ${error.code}`, 'utf-8');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}/`);
    console.log(`📝 Open mic-realtime.html: http://localhost:${PORT}/mic-realtime.html`);
    console.log(`📝 Open mic-record.html: http://localhost:${PORT}/mic-record.html`);
    console.log(`📝 Open index.html: http://localhost:${PORT}/index.html`);
    console.log(`\nPress Ctrl+C to stop the server\n`);
});

function corsHeaders() {
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}

