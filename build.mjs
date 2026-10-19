import * as esbuild from 'esbuild';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildExtension() {
  const outDir = path.join(__dirname, 'extension', 'dist');
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [
      path.join(__dirname, 'extension', 'src', 'background.ts'),
      path.join(__dirname, 'extension', 'src', 'content.ts'),
      path.join(__dirname, 'extension', 'src', 'popup.tsx'),
      path.join(__dirname, 'extension', 'src', 'permission.ts'),
    ],
    bundle: true,
    outdir: outDir,
    format: 'iife',
    target: ['chrome114', 'edge114'],
    logLevel: 'info',
  });

  // Copy static extension assets and icons
  const iconDir = path.join(outDir, 'icons');
  fs.mkdirSync(iconDir, { recursive: true });
  for (const sz of [16, 32, 48, 128]) {
    const srcIcon = path.join(__dirname, 'assets', `icon${sz}.png`);
    if (fs.existsSync(srcIcon)) {
      fs.copyFileSync(srcIcon, path.join(iconDir, `icon${sz}.png`));
    }
  }

  fs.copyFileSync(
    path.join(__dirname, 'extension', 'manifest.json'),
    path.join(outDir, 'manifest.json')
  );
  fs.copyFileSync(
    path.join(__dirname, 'extension', 'src', 'popup.html'),
    path.join(outDir, 'popup.html')
  );
  fs.copyFileSync(
    path.join(__dirname, 'extension', 'src', 'popup.css'),
    path.join(outDir, 'popup.css')
  );
  fs.copyFileSync(
    path.join(__dirname, 'extension', 'src', 'permission.html'),
    path.join(outDir, 'permission.html')
  );

  console.log('✓ Chrome/Edge Manifest V3 extension built at extension/dist');
}

async function buildWeb() {
  const webDist = path.join(__dirname, 'web', 'dist');
  fs.mkdirSync(webDist, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(__dirname, 'web', 'src', 'index.tsx')],
    bundle: true,
    platform: 'browser',
    outfile: path.join(webDist, 'web.js'),
    format: 'iife',
    target: ['chrome114', 'edge114'],
    logLevel: 'info',
  });

  fs.copyFileSync(
    path.join(__dirname, 'web', 'src', 'index.html'),
    path.join(webDist, 'index.html')
  );
  fs.copyFileSync(
    path.join(__dirname, 'web', 'src', 'styles.css'),
    path.join(webDist, 'web.css')
  );

  const webAssets = path.join(webDist, 'assets');
  fs.mkdirSync(webAssets, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, 'assets', 'icon32.png'),
    path.join(webAssets, 'icon32.png')
  );
  fs.copyFileSync(
    path.join(__dirname, 'assets', 'logo-with-text.png'),
    path.join(webAssets, 'logo-with-text.png')
  );

  // Package unpacked extension into downloadable zip containing a named root folder
  const extDist = path.join(__dirname, 'extension', 'dist');
  const zipDest = path.join(webDist, 'universal-voice-to-text-extension.zip');
  const stagingDir = path.join(__dirname, 'web', 'staging');
  const targetFolder = path.join(stagingDir, 'universal-voice-to-text-helper');

  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(targetFolder, { recursive: true });
    fs.cpSync(extDist, targetFolder, { recursive: true });

    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path "${targetFolder}" -DestinationPath "${zipDest}" -Force`,
    ]);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    console.log('✓ Packaged extension zip with root folder at web/dist/universal-voice-to-text-extension.zip');
  } catch (err) {
    console.warn('Warning: Failed to create extension zip:', err);
  }

  console.log('✓ Web Platform built at web/dist');
}

async function main() {
  await buildExtension();
  await buildWeb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
