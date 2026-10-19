import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');

process.on('uncaughtException', (err) => {
  console.error('Server uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

const server = http.createServer((req, res) => {
  req.on('error', (err) => {
    console.error('Request error:', err);
  });

  res.on('error', (err) => {
    console.error('Response error:', err);
  });

  const urlPath = req.url?.split('?')[0] || '/';

  // Handle direct extension download route
  if (urlPath === '/download/extension.zip' || urlPath === '/download/extension') {
    const zipPath = path.join(distDir, 'universal-voice-to-text-extension.zip');
    if (fs.existsSync(zipPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="universal-voice-to-text-extension.zip"',
        'Content-Length': fs.statSync(zipPath).size,
      });
      const zipStream = fs.createReadStream(zipPath);
      zipStream.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      zipStream.pipe(res);
      return;
    }
  }

  const reqPath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(distDir, reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    fileStream.pipe(res);
  } else {
    // SPA fallback
    const indexPath = path.join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const indexStream = fs.createReadStream(indexPath);
    indexStream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    indexStream.pipe(res);
  }
});

let currentPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

server.on('listening', () => {
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : currentPort;
  console.log(`Universal Voice-to-Text Web Platform running at http://localhost:${actualPort}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${currentPort} is in use. Trying port ${currentPort + 1}...`);
    currentPort += 1;
    server.close(() => {
      server.listen(currentPort, 'localhost');
    });
  } else {
    console.error('HTTP Server error:', err);
  }
});

server.listen(currentPort, 'localhost');
