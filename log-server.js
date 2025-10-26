const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'app-logs.txt');

// Create/clear log file on startup
fs.writeFileSync(LOG_FILE, `=== MetaView Debug Logs - ${new Date().toISOString()} ===\n\n`, 'utf8');

const server = https.createServer({
  key: fs.readFileSync('./192.168.1.100-key.pem'),
  cert: fs.readFileSync('./192.168.1.100.pem')
}, (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const logData = JSON.parse(body);
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${logData.level || 'LOG'}: ${logData.message}\n`;
        const dataLine = logData.data ? `   Data: ${JSON.stringify(logData.data)}\n` : '';
        
        fs.appendFileSync(LOG_FILE, logLine + dataLine, 'utf8');
        console.log(logLine.trim(), logData.data || '');
        
        res.writeHead(200);
        res.end('OK');
      } catch (e) {
        console.error('Failed to write log:', e);
        res.writeHead(500);
        res.end('Error');
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const PORT = 8444;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Log server running on https://0.0.0.0:${PORT}`);
  console.log(`Logs being written to: ${LOG_FILE}`);
});
