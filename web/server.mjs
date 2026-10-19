import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const port = 3000;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.zip': 'application/zip',
};

const server = http.createServer((req, res) => {
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
      fs.createReadStream(zipPath).pipe(res);
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
    fs.createReadStream(filePath).pipe(res);
  } else {
    // SPA fallback
    const indexPath = path.join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(indexPath).pipe(res);
  }
});

server.listen(port, 'localhost', () => {
  console.log(`Universal Voice-to-Text Web Platform running at http://localhost:${port}`);
});
