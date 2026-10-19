import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');

process.on('uncaughtException', (err) => {
  // Gracefully log without crashing
  if (err?.code !== 'ECONNRESET' && err?.code !== 'EPIPE') {
    console.error('Server notice:', err?.message || err);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

const server = http.createServer((req, res) => {
  req.on('error', () => {
    // Client aborted request; safe to ignore
  });

  res.on('error', () => {
    // Client socket reset; safe to ignore
  });

  const urlPath = req.url?.split('?')[0] || '/';

  // Handle direct extension download route
  if (urlPath === '/download/extension.zip' || urlPath === '/download/extension') {
    const zipPath = path.join(distDir, 'universal-voice-to-text-extension.zip');
    if (fs.existsSync(zipPath)) {
      fs.readFile(zipPath, (err, data) => {
        if (err) {
          if (!res.headersSent) res.writeHead(500);
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="universal-voice-to-text-extension.zip"',
          'Content-Length': data.length,
        });
        res.end(data);
      });
      return;
    }
  }

  const reqPath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(distDir, reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (!res.headersSent) res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': data.length,
      });
      res.end(data);
    });
  } else {
    // SPA fallback to index.html
    const indexPath = path.join(distDir, 'index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        if (!res.headersSent) res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': data.length,
      });
      res.end(data);
    });
  }
});

// Gracefully handle client connection errors like ECONNRESET
server.on('clientError', (err, socket) => {
  if (err.code === 'ECONNRESET' || !socket.writable) {
    socket.destroy();
    return;
  }
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
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
