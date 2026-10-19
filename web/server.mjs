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

  // Handle Windows installer setup download routes (.exe)
  if (
    urlPath === '/download/windows' ||
    urlPath === '/download/windows.exe' ||
    urlPath === '/download/setup' ||
    urlPath === '/download/setup.exe' ||
    urlPath === '/download/installer' ||
    urlPath === '/download/installer.exe'
  ) {
    const setupDist = path.join(distDir, 'Universal Voice-to-Text Helper Setup.exe');
    const rootSetup = path.join(__dirname, '..', 'Universal Voice-to-Text Helper Setup.exe');
    const targetSetup = fs.existsSync(setupDist) ? setupDist : rootSetup;

    if (fs.existsSync(targetSetup)) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="Universal Voice-to-Text Helper Setup.exe"',
        'Content-Length': fs.statSync(targetSetup).size,
      });
      fs.createReadStream(targetSetup).pipe(res);
      return;
    }
  }

  // Handle direct standalone Windows desktop application download routes (.exe)
  if (
    urlPath === '/download/portable' ||
    urlPath === '/download/portable.exe' ||
    urlPath === '/download/desktop.exe' ||
    urlPath === '/download/app.exe'
  ) {
    const exeDist = path.join(distDir, 'Universal Voice-to-Text Helper.exe');
    const rootExe = path.join(__dirname, '..', 'Universal Voice-to-Text Helper.exe');
    const targetExe = fs.existsSync(exeDist) ? exeDist : rootExe;

    if (fs.existsSync(targetExe)) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="Universal Voice-to-Text Helper.exe"',
        'Content-Length': fs.statSync(targetExe).size,
      });
      fs.createReadStream(targetExe).pipe(res);
      return;
    }
  }

  // Handle full Windows zip package download route
  if (
    urlPath === '/download/windows.zip' ||
    urlPath === '/download/desktop.zip' ||
    urlPath === '/download/desktop'
  ) {
    const zipPath = path.join(distDir, 'universal-voice-to-text-windows.zip');
    if (fs.existsSync(zipPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="universal-voice-to-text-windows.zip"',
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
