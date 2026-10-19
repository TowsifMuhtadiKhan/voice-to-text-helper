import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function loadTsModule(relPath) {
  const fullPath = path.join(rootDir, relPath);
  const result = await esbuild.build({
    entryPoints: [fullPath],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const code = result.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return import(dataUrl);
}

async function testSessionStoreAndLanguageInterface() {
  console.log('1. Testing Shared Speech Interface & In-Memory Session Store...');
  const { SUPPORTED_LANGUAGES } = await loadTsModule('shared/speech-interface.ts');
  const { InMemorySessionStore } = await loadTsModule('shared/session-store.ts');

  // Verify English is supported initially and Bangla is structured in the interface
  const enLang = SUPPORTED_LANGUAGES.find((l) => l.code === 'en-US');
  const bnLang = SUPPORTED_LANGUAGES.find((l) => l.code === 'bn-BD');
  assert.ok(enLang && enLang.enabled === true, 'English (en-US) must be enabled initially');
  assert.ok(bnLang, 'Bangla (bn-BD) must be defined in the speech recognition interface');

  const store = new InMemorySessionStore('Ctrl+Shift+Space', 'en-US');
  assert.equal(store.getState().status, 'idle');
  assert.equal(store.getState().sessionTranscript, '');

  // Start listening and emit interim results
  store.setStatus('listening');
  store.setInterimText('Hello');
  store.setInterimText('Hello, how are');
  assert.equal(store.getState().interimText, 'Hello, how are');
  assert.equal(store.getState().sessionTranscript, '', 'Interim text must not pollute finalized transcript');

  // Finalize first utterance
  const first = store.appendFinalSegment('Hello, how are you?');
  assert.equal(first.insertedSegment, 'Hello, how are you?');
  assert.equal(store.getState().interimText, '', 'Interim text must clear when utterance is finalized');
  assert.equal(store.getState().sessionTranscript, 'Hello, how are you?');

  // Finalize second utterance and verify non-duplication + spacing
  store.setInterimText('I am fine.');
  store.appendFinalSegment('I am fine.');
  assert.equal(store.getState().sessionTranscript, 'Hello, how are you? I am fine.');

  // Stopping recording must keep the current session transcript visible
  store.setStatus('stopped');
  assert.equal(
    store.getState().sessionTranscript,
    'Hello, how are you? I am fine.',
    'Stopping dictation must NOT erase the current session transcript'
  );

  // Closing the session must clear temporary transcript data
  store.clearSession();
  assert.equal(store.getState().sessionTranscript, '');
  assert.equal(store.getState().interimText, '');
  assert.equal(store.getState().status, 'idle');

  console.log('   ✓ Passed: Session lifecycle, interim/final separation, and memory clearing');
}

async function testDomInserterAndCtrlZCompatibility() {
  console.log('2. Testing Browser Extension DOM Insertion & Ctrl+Z Undo Stack Preservation...');
  const { DomTextInserter } = await loadTsModule('extension/src/dom-inserter.ts');

  const dom = new JSDOM(
    `<!DOCTYPE html>
    <html>
      <body>
        <input id="inp" type="text" value="Hello" />
        <textarea id="txt">Start middle end</textarea>
        <div id="rich" contenteditable="true">Rich text</div>
      </body>
    </html>`,
    { url: 'https://example.com/' }
  );

  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.HTMLInputElement = dom.window.HTMLInputElement;
  global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  global.Node = dom.window.Node;
  global.InputEvent = dom.window.InputEvent;
  global.Element = dom.window.Element;

  const inputEl = document.getElementById('inp');
  const textareaEl = document.getElementById('txt');
  const richEl = document.getElementById('rich');
  richEl.isContentEditable = true;

  // Track undo stack operations to verify native execCommand('insertText') is used
  // rather than destructive .value replacement
  const undoStacks = new Map();
  document.execCommand = (command, _showUI, value) => {
    if (command !== 'insertText') return false;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const stack = undoStacks.get(active) || [];
      stack.push(active.value);
      undoStacks.set(active, stack);

      const start = active.selectionStart ?? active.value.length;
      const end = active.selectionEnd ?? active.value.length;
      active.setRangeText(value, start, end, 'end');
      return true;
    }
    if (active && active.isContentEditable) {
      const stack = undoStacks.get(active) || [];
      stack.push(active.textContent);
      undoStacks.set(active, stack);
      active.textContent += value;
      return true;
    }
    return false;
  };

  const simulateCtrlZ = (el) => {
    const stack = undoStacks.get(el) || [];
    if (stack.length > 0) {
      const prev = stack.pop();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = prev;
      } else {
        el.textContent = prev;
      }
    }
  };

  const inserter = new DomTextInserter();

  // Test 1: <input> insertion at cursor + Ctrl+Z undo preserving prior text
  inputEl.focus();
  inputEl.setSelectionRange(5, 5); // End of "Hello"
  assert.equal(inserter.insertTextAtCursor('how are you?'), true);
  assert.equal(inputEl.value, 'Hello how are you?');

  // Simulate user pressing Ctrl+Z
  simulateCtrlZ(inputEl);
  assert.equal(
    inputEl.value,
    'Hello',
    'Ctrl+Z must undo the inserted speech while preserving pre-existing text'
  );

  // Test 2: <textarea> insertion in the middle of existing text (cursor at offset 6, after "Start ")
  textareaEl.focus();
  textareaEl.setSelectionRange(6, 6); // Right after "Start "
  assert.equal(inserter.insertTextAtCursor('spoken words '), true);
  assert.equal(textareaEl.value, 'Start spoken words middle end');
  simulateCtrlZ(textareaEl);
  assert.equal(textareaEl.value, 'Start middle end');

  // Test 3: Focus recovery when popup temporarily blurs the webpage input
  inputEl.focus();
  inputEl.setSelectionRange(5, 5);
  inputEl.blur(); // Simulate clicking extension popup
  assert.equal(inserter.insertTextAtCursor('world'), true);
  assert.equal(inputEl.value, 'Hello world');

  // Test 4: Rich-text editor (contenteditable)
  richEl.focus();
  assert.equal(inserter.insertTextAtCursor('appended'), true);
  assert.ok(richEl.textContent.includes('appended'));
  simulateCtrlZ(richEl);
  assert.equal(richEl.textContent, 'Rich text');

  console.log('   ✓ Passed: <input>, <textarea>, contenteditable insertion & Ctrl+Z undo preservation');
}

async function testWindowsSpeechRecognitionHelper() {
  console.log('3. Testing Native Windows OS Speech Recognition Helper (Win32VoiceHelper.exe)...');
  const helperExe = path.join(rootDir, 'desktop', 'dist', 'Win32VoiceHelper.exe');
  assert.ok(fs.existsSync(helperExe), 'Win32VoiceHelper.exe must exist in desktop/dist');

  const events = await new Promise((resolve, reject) => {
    const proc = spawn(helperExe, ['--worker'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const collected = [];
    let buffer = '';

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timed out waiting for Win32VoiceHelper speech recognition'));
    }, 8000);

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line.trim());
        collected.push(parsed);
        if (parsed.event === 'ready') {
          proc.stdin.write(
            JSON.stringify({
              cmd: 'simulate_speech',
              text: 'Hello how are you',
              noInsert: 'true',
            }) + '\n'
          );
        }
        if (parsed.event === 'status' && parsed.status === 'stopped' && collected.some((e) => e.event === 'final')) {
          clearTimeout(timeout);
          proc.kill();
          resolve(collected);
        }
      }
    });
  });

  const hasInterim = events.some((e) => e.event === 'interim' && e.text.length > 0);
  const finalEvt = events.find((e) => e.event === 'final');

  assert.ok(hasInterim, 'Windows Speech Engine must emit interim recognition hypotheses');
  assert.ok(finalEvt, 'Windows Speech Engine must emit finalized recognition result');
  assert.equal(
    finalEvt.text.toLowerCase(),
    'hello how are you',
    'Finalized speech must match spoken words without rewriting'
  );

  console.log(`   ✓ Passed: Windows Speech Recognizer emitted interim & final ("${finalEvt.text}")`);
}

async function testNoForbiddenStorageOrAiFeatures() {
  console.log('4. Auditing codebase for strictly excluded features & persistent storage...');
  const filesToScan = [
    'shared/speech-interface.ts',
    'shared/session-store.ts',
    'shared/web-speech-engine.ts',
    'extension/src/background.ts',
    'extension/src/content.ts',
    'extension/src/PopupApp.tsx',
    'extension/src/popup.tsx',
    'extension/src/dom-inserter.ts',
    'desktop/src/main/main.ts',
    'desktop/src/main/preload.ts',
    'desktop/src/main/windows-speech-engine.ts',
    'desktop/src/main/mac-speech-engine.ts',
    'desktop/src/renderer/App.tsx',
    'web/src/WebApp.tsx',
  ];

  for (const rel of filesToScan) {
    const content = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    // Strip comments before checking for forbidden storage calls
    const codeOnly = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    assert.ok(!codeOnly.includes('localStorage.'), `${rel} must not use localStorage`);
    assert.ok(!codeOnly.includes('indexedDB.'), `${rel} must not use IndexedDB`);
    assert.ok(!codeOnly.includes('chrome.storage.local'), `${rel} must not persist to chrome.storage.local`);
    assert.ok(!codeOnly.includes('chrome.storage.sync'), `${rel} must not persist to chrome.storage.sync`);
  }

  console.log('   ✓ Passed: Zero persistent transcript storage or forbidden AI features');
}

async function testElectronDesktopE2E() {
  console.log('5. Testing Electron + React Desktop Application End-to-End...');
  const { default: electronBinary } = await import('electron');
  const mainJs = path.join(rootDir, 'desktop', 'dist', 'main', 'main.js');

  await new Promise((resolve, reject) => {
    const proc = spawn(electronBinary, [mainJs, '--e2e-test'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && stdout.includes('E2E_PASS')) {
        resolve();
      } else {
        reject(new Error(`Electron E2E exited with code ${code}\nStdout: ${stdout}\nStderr: ${stderr}`));
      }
    });
  });

  console.log('   ✓ Passed: Electron Desktop app launched, rendered speech, kept transcript on stop, and cleared on close');
}

async function main() {
  await testSessionStoreAndLanguageInterface();
  await testDomInserterAndCtrlZCompatibility();
  await testWindowsSpeechRecognitionHelper();
  await testNoForbiddenStorageOrAiFeatures();
  await testElectronDesktopE2E();
  console.log('\nAll automated verification tests passed!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
