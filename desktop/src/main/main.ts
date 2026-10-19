import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray } from 'electron';
import * as path from 'path';
import { InMemorySessionStore, SessionState } from '../../../shared/session-store';
import {
  ISpeechRecognitionEngine,
  RecognitionErrorEvent,
  RecognitionStatus,
} from '../../../shared/speech-interface';
import { WindowsSpeechRecognitionEngine } from './windows-speech-engine';
import { MacSpeechRecognitionEngine } from './mac-speech-engine';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let speechEngine: ISpeechRecognitionEngine | null = null;

const defaultShortcut = process.platform === 'darwin' ? 'Cmd+Shift+Space' : 'Ctrl+Shift+Space';
const sessionStore = new InMemorySessionStore(defaultShortcut, 'en-US');
let registeredAccelerator = 'CommandOrControl+Shift+Space';

function toElectronAccelerator(shortcut: string): string {
  return shortcut
    .replace(/\bCmd\b/gi, 'CommandOrControl')
    .replace(/\bCommand\b/gi, 'CommandOrControl')
    .replace(/\bCtrl\b/gi, 'CommandOrControl')
    .replace(/\bControl\b/gi, 'CommandOrControl')
    .replace(/\bOption\b/gi, 'Alt');
}

function popUpAndToggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.focus();
  }
  if (speechEngine) {
    speechEngine.toggle();
  }
}

function registerGlobalShortcut(shortcutDisplay: string): boolean {
  const nextAccelerator = toElectronAccelerator(shortcutDisplay);
  try {
    globalShortcut.unregisterAll();
    const ok = globalShortcut.register(nextAccelerator, () => {
      popUpAndToggleWindow();
    });
    if (ok) {
      registeredAccelerator = nextAccelerator;
      sessionStore.setShortcut(shortcutDisplay);
      return true;
    }
  } catch {
    // Fallback to previous shortcut if registration error
  }

  // Restore previous shortcut if new registration failed
  try {
    globalShortcut.register(registeredAccelerator, () => {
      popUpAndToggleWindow();
    });
  } catch {
    // Ignore
  }
  return false;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 620,
    minWidth: 380,
    minHeight: 500,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    alwaysOnTop: true,
    title: 'Universal Voice-to-Text Helper',
    icon: path.join(__dirname, '..', '..', '..', 'assets', 'icon256.png'),
    backgroundColor: '#121318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    // When the user closes the window, minimize/hide to background/tray
    // so the global shortcut remains active across the operating system
    if (!isQuitting && !process.argv.includes('--e2e-test')) {
      e.preventDefault();
      mainWindow?.hide();
      return false;
    }
    sessionStore.clearSession();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  const iconPath = path.join(__dirname, '..', '..', '..', 'assets', 'icon32.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  } else if (process.platform === 'darwin') {
    icon = icon.resize({ width: 18, height: 18 });
  }

  try {
    tray = new Tray(icon);
    tray.setToolTip('Universal Voice-to-Text Helper');

    const updateContextMenu = () => {
      const isListening = sessionStore.getState().status === 'listening';
      const isVisible = mainWindow && mainWindow.isVisible();
      const currentShortcut = sessionStore.getState().shortcut;

      const contextMenu = Menu.buildFromTemplate([
        {
          label: isVisible ? 'Hide Window' : 'Open Voice Helper',
          click: () => {
            popUpAndToggleWindow();
          },
        },
        {
          label: isListening ? 'Stop Listening' : 'Start Listening',
          click: () => {
            speechEngine?.toggle();
          },
        },
        { type: 'separator' },
        {
          label: `Shortcut: ${currentShortcut}`,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Quit Universal Voice-to-Text',
          click: () => {
            isQuitting = true;
            if (speechEngine) {
              speechEngine.dispose?.();
              speechEngine = null;
            }
            sessionStore.clearSession();
            app.quit();
          },
        },
      ]);
      tray?.setContextMenu(contextMenu);
    };

    updateContextMenu();
    sessionStore.subscribe(() => updateContextMenu());

    tray.on('click', () => {
      popUpAndToggleWindow();
    });
  } catch {
    // Tray creation safe fallback
  }
}

function initSpeechEngine(): void {
  const callbacks = {
    onStatusChange: (status: RecognitionStatus) => {
      sessionStore.setStatus(status);
    },
    onInterimResult: (interimText: string) => {
      sessionStore.setInterimText(interimText);
    },
    onFinalResult: (finalText: string) => {
      sessionStore.appendFinalSegment(finalText);
    },
    onError: (err: RecognitionErrorEvent) => {
      sessionStore.setStatus('error', err.message);
    },
  };

  if (process.platform === 'win32') {
    speechEngine = new WindowsSpeechRecognitionEngine(callbacks);
  } else {
    speechEngine = new MacSpeechRecognitionEngine(callbacks);
  }

  sessionStore.subscribe((state: SessionState) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('voice:state-changed', state);
    }
  });
}

const gotTheLock = process.argv.includes('--e2e-test') || app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    popUpAndToggleWindow();
  });

  app.whenReady().then(() => {
    initSpeechEngine();
    createWindow();
    createTray();
    registerGlobalShortcut(defaultShortcut);

  ipcMain.handle('voice:get-state', () => {
    return sessionStore.getState();
  });

  ipcMain.handle('voice:start', async () => {
    if (speechEngine) {
      await speechEngine.start();
    }
    return sessionStore.getState();
  });

  ipcMain.handle('voice:stop', async () => {
    if (speechEngine) {
      await speechEngine.stop();
    }
    return sessionStore.getState();
  });

  ipcMain.handle('voice:toggle', async () => {
    if (speechEngine) {
      await speechEngine.toggle();
    }
    return sessionStore.getState();
  });

  ipcMain.handle('voice:set-shortcut', (_event, shortcut: string) => {
    registerGlobalShortcut(shortcut);
    return sessionStore.getState();
  });

  ipcMain.handle('voice:set-replacements', (_event, replacements: any[]) => {
    if (speechEngine?.setReplacements) {
      speechEngine.setReplacements(replacements);
    }
    return true;
  });

  ipcMain.handle('voice:simulate-speech', (_event, text: string, noInsert?: boolean) => {
    if (speechEngine) {
      speechEngine.simulateSpeech(text, Boolean(noInsert));
    }
    return sessionStore.getState();
  });

  ipcMain.handle('voice:close-app', async () => {
    if (process.argv.includes('--e2e-test')) {
      isQuitting = true;
      if (speechEngine) {
        await speechEngine.dispose?.();
        speechEngine = null;
      }
      sessionStore.clearSession();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
      app.quit();
    } else {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
    }
  });

  ipcMain.handle('voice:minimize-app', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.handle('voice:hide-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  ipcMain.handle('voice:quit-app', async () => {
    isQuitting = true;
    if (speechEngine) {
      await speechEngine.dispose?.();
      speechEngine = null;
    }
    sessionStore.clearSession();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    app.quit();
  });

  if (process.argv.includes('--e2e-test') && mainWindow) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 300));

        const initialDomCheck = await mainWindow!.webContents.executeJavaScript(`
          Boolean(
            document.querySelector('[data-testid="recording-status"]') &&
            document.querySelector('[data-testid="mic-btn"]') &&
            document.querySelector('[data-testid="start-stop-btn"]') &&
            document.querySelector('[data-testid="live-transcription"]') &&
            document.querySelector('[data-testid="session-transcript"]') &&
            document.querySelector('[data-testid="close-btn"]')
          )
        `);
        if (!initialDomCheck) {
          console.error('E2E_FAIL: Missing required minimal UI elements');
          app.exit(1);
          return;
        }

        speechEngine?.simulateSpeech('Hello how are you', true);

        let matched = false;
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 150));
          const snapshot = await mainWindow!.webContents.executeJavaScript(`({
            status: document.querySelector('[data-testid="recording-status"]')?.textContent || '',
            transcript: document.querySelector('[data-testid="session-transcript"]')?.textContent || ''
          })`);
          if (
            snapshot.transcript.toLowerCase() === 'hello how are you' &&
            snapshot.status === 'Stopped'
          ) {
            matched = true;
            break;
          }
        }

        if (!matched) {
          console.error('E2E_FAIL: Transcript did not render or persist after stopping');
          app.exit(1);
          return;
        }

        console.log('E2E_PASS: Electron React UI rendered speech & preserved transcript on stop');
        await mainWindow!.webContents.executeJavaScript(`window.voiceHelper.closeApp()`);
      } catch (err) {
        console.error('E2E_FAIL:', err);
        app.exit(1);
      }
    });
  }
});
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (speechEngine) {
    speechEngine.dispose?.();
    speechEngine = null;
  }
  sessionStore.clearSession();
});

app.on('window-all-closed', () => {
  if (isQuitting || process.argv.includes('--e2e-test')) {
    sessionStore.clearSession();
    app.quit();
  }
});
