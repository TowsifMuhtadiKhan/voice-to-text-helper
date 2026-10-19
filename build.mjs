import * as esbuild from 'esbuild';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = new Set(process.argv.slice(2));
const extensionOnly = args.has('--extension-only');
const desktopOnly = args.has('--desktop-only');

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

function compileWin32Helper(desktopDistDir) {
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const speechDllPath =
    'C:\\Windows\\Microsoft.Net\\assembly\\GAC_MSIL\\System.Speech\\v4.0_4.0.0.0__31bf3856ad364e35\\System.Speech.dll';
  const csSource = path.join(__dirname, 'desktop', 'native', 'Win32VoiceHelper.cs');
  const exeOut = path.join(desktopDistDir, 'Win32VoiceHelper.exe');
  const rootLauncherOut = path.join(__dirname, 'Universal Voice-to-Text Helper.exe');

  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      'Stop-Process -Name "Win32VoiceHelper" -Force -ErrorAction SilentlyContinue',
    ]);
  } catch {
    // Ignore if not running
  }

  execFileSync(
    cscPath,
    ['/nologo', '/target:winexe', `/out:${exeOut}`, `/r:${speechDllPath}`, csSource],
    { stdio: 'inherit' }
  );
  fs.copyFileSync(exeOut, rootLauncherOut);
  console.log('✓ Native Windows Speech & Input helper compiled at desktop/dist/Win32VoiceHelper.exe');
  console.log('✓ Desktop GUI launcher created at Universal Voice-to-Text Helper.exe');

  // Compile Windows Installer Setup Wizard
  const setupSource = path.join(__dirname, 'desktop', 'native', 'SetupWizard.cs');
  const setupExeOut = path.join(desktopDistDir, 'Universal Voice-to-Text Helper Setup.exe');
  const rootSetupOut = path.join(__dirname, 'Universal Voice-to-Text Helper Setup.exe');

  execFileSync(
    cscPath,
    [
      '/nologo',
      '/target:winexe',
      `/out:${setupExeOut}`,
      '/r:System.Windows.Forms.dll,System.Drawing.dll,Microsoft.CSharp.dll,System.Core.dll',
      setupSource,
    ],
    { stdio: 'inherit' }
  );
  fs.copyFileSync(setupExeOut, rootSetupOut);
  console.log('✓ Windows Installer Setup Wizard compiled at Universal Voice-to-Text Helper Setup.exe');
}

async function buildDesktop() {
  const desktopDist = path.join(__dirname, 'desktop', 'dist');
  const mainDist = path.join(desktopDist, 'main');
  const rendererDist = path.join(desktopDist, 'renderer');

  fs.mkdirSync(mainDist, { recursive: true });
  fs.mkdirSync(rendererDist, { recursive: true });

  if (process.platform === 'win32') {
    compileWin32Helper(desktopDist);
  }

  // Bundle Electron Main & Preload
  await esbuild.build({
    entryPoints: [
      path.join(__dirname, 'desktop', 'src', 'main', 'main.ts'),
      path.join(__dirname, 'desktop', 'src', 'main', 'preload.ts'),
    ],
    bundle: true,
    platform: 'node',
    external: ['electron'],
    outdir: mainDist,
    format: 'cjs',
    target: ['node20'],
    logLevel: 'info',
  });

  // Bundle React Renderer
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'desktop', 'src', 'renderer', 'index.tsx')],
    bundle: true,
    platform: 'browser',
    outfile: path.join(rendererDist, 'renderer.js'),
    format: 'iife',
    target: ['chrome120'],
    logLevel: 'info',
  });

  fs.copyFileSync(
    path.join(__dirname, 'desktop', 'src', 'renderer', 'index.html'),
    path.join(rendererDist, 'index.html')
  );

  const desktopAssets = path.join(rendererDist, 'assets');
  fs.mkdirSync(desktopAssets, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, 'assets', 'icon32.png'),
    path.join(desktopAssets, 'icon32.png')
  );

  console.log('✓ Electron Desktop application built at desktop/dist');
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

  // Copy and package Windows Desktop install/executable files
  const rootExe = path.join(__dirname, 'Universal Voice-to-Text Helper.exe');
  if (fs.existsSync(rootExe)) {
    const webExeDest = path.join(webDist, 'Universal Voice-to-Text Helper.exe');
    fs.copyFileSync(rootExe, webExeDest);

    const winZipDest = path.join(webDist, 'universal-voice-to-text-windows.zip');
    const winStagingDir = path.join(__dirname, 'web', 'staging-win');
    const winTargetFolder = path.join(winStagingDir, 'Universal-Voice-to-Text-Windows');

    try {
      fs.rmSync(winStagingDir, { recursive: true, force: true });
      fs.mkdirSync(winTargetFolder, { recursive: true });
      fs.copyFileSync(rootExe, path.join(winTargetFolder, 'Universal Voice-to-Text Helper.exe'));

      // Copy desktop dist, assets, and package.json to staging folder
      const stagingDesktopDist = path.join(winTargetFolder, 'desktop', 'dist');
      fs.mkdirSync(stagingDesktopDist, { recursive: true });
      fs.cpSync(path.join(__dirname, 'desktop', 'dist'), stagingDesktopDist, { recursive: true });

      const stagingAssets = path.join(winTargetFolder, 'assets');
      fs.mkdirSync(stagingAssets, { recursive: true });
      fs.cpSync(path.join(__dirname, 'assets'), stagingAssets, { recursive: true });

      fs.copyFileSync(
        path.join(__dirname, 'package.json'),
        path.join(winTargetFolder, 'package.json')
      );

      const batchRunner = [
        '@echo off',
        'cd /d "%~dp0"',
        'start "" "Universal Voice-to-Text Helper.exe"',
      ].join('\r\n');
      fs.writeFileSync(path.join(winTargetFolder, 'Run-Voice-Helper.bat'), batchRunner);

      const readmeContent = [
        'Universal Voice-to-Text Helper - Windows Desktop App',
        '====================================================',
        '',
        'Quick Start:',
        '1. Double-click "Universal Voice-to-Text Helper.exe" to launch.',
        '2. The app will run in your background system tray.',
        '3. Press Ctrl+Shift+Space anywhere on your PC to pop up and dictate text!',
        '4. Click Close to minimize back to tray anytime without exiting.',
        '',
      ].join('\r\n');
      fs.writeFileSync(path.join(winTargetFolder, 'README.txt'), readmeContent);

      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path "${winTargetFolder}" -DestinationPath "${winZipDest}" -Force`,
      ]);
      fs.rmSync(winStagingDir, { recursive: true, force: true });
      console.log('✓ Packaged Windows app zip at web/dist/universal-voice-to-text-windows.zip');

      // Update user's Downloads folder executable if it exists
      const userDownloadsExe = path.join(
        process.env.USERPROFILE || 'C:\\Users\\Towsif',
        'Downloads',
        'Universal Voice-to-Text Helper.exe'
      );
      if (fs.existsSync(path.dirname(userDownloadsExe))) {
        try {
          fs.copyFileSync(rootExe, userDownloadsExe);
          console.log('✓ Updated Downloads/Universal Voice-to-Text Helper.exe with working launcher');
        } catch {}
      }

      // Copy Setup installer to web dist and Downloads folder
      const rootSetup = path.join(__dirname, 'Universal Voice-to-Text Helper Setup.exe');
      if (fs.existsSync(rootSetup)) {
        fs.copyFileSync(rootSetup, path.join(webDist, 'Universal Voice-to-Text Helper Setup.exe'));
        const userDownloadsSetup = path.join(
          process.env.USERPROFILE || 'C:\\Users\\Towsif',
          'Downloads',
          'Universal Voice-to-Text Helper Setup.exe'
        );
        if (fs.existsSync(path.dirname(userDownloadsSetup))) {
          try {
            fs.copyFileSync(rootSetup, userDownloadsSetup);
            console.log('✓ Updated Downloads/Universal Voice-to-Text Helper Setup.exe');
          } catch {}
        }
      }
    } catch (err) {
      console.warn('Warning: Failed to create Windows zip:', err);
    }
  }

  console.log('✓ Web Platform built at web/dist');
}

async function main() {
  if (!extensionOnly) {
    await buildDesktop();
  }
  if (!desktopOnly) {
    await buildExtension();
    await buildWeb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
