const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

const server = http.createServer((req, res) => {
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

    // Handle OPTIONS for CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
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

