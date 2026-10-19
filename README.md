# Universal Voice-to-Text Helper

A lightweight, private speech-to-text utility available as both a **Windows & Mac Desktop Application** (Electron, React, TypeScript) and a **Chrome / Microsoft Edge Browser Extension** (Manifest V3, TypeScript), plus a companion **Web Platform**.

Its core purpose is to convert microphone audio into clean text and insert recognized words at the current cursor position while preserving native application undo history and keeping transcripts strictly in temporary session memory.

---

## Architecture & Project Structure

- [`shared/speech-interface.ts`](shared/speech-interface.ts) — Unified `ISpeechRecognitionEngine` interface shared across desktop and browser targets. Supports English (`en-US`) initially and is structured to enable Bangla (`bn-BD`) seamlessly.
- [`shared/session-store.ts`](shared/session-store.ts) — Volatile in-memory session state manager (`InMemorySessionStore`). Separates live interim hypotheses from finalized utterances so finalized words are never duplicated, keeps the transcript visible when recording stops, and wipes all transcript data when the session is closed.
- [`shared/word-replacer.ts`](shared/word-replacer.ts) — Real-time word and acronym replacement engine with case-insensitive boundary matching.
- [`shared/web-speech-engine.ts`](shared/web-speech-engine.ts) — Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) implementation of `ISpeechRecognitionEngine`.
- [`extension/`](extension/) — Chrome & Microsoft Edge Manifest V3 extension:
  - [`extension/manifest.json`](extension/manifest.json) — Manifest V3 configuration with default shortcut `Ctrl+Shift+Space` (`Cmd+Shift+Space` on macOS).
  - [`extension/src/background.ts`](extension/src/background.ts) — Service worker holding temporary in-memory session state.
  - [`extension/src/content.ts`](extension/src/content.ts) — Content script with focus tracking, text insertion, word replacements, and compact floating dock.
  - [`extension/src/dom-inserter.ts`](extension/src/dom-inserter.ts) — Detects focused `<input>`, `<textarea>`, and `contenteditable` editors and inserts finalized text at the cursor while preserving native undo history.
  - [`extension/src/PopupApp.tsx`](extension/src/PopupApp.tsx) — Sleek popup UI with center-bottom floating recorder dock and live Word Replacement tool.
- [`desktop/`](desktop/) — Electron + React + TypeScript Windows and Mac desktop application:
  - [`desktop/native/Win32VoiceHelper.cs`](desktop/native/Win32VoiceHelper.cs) — Native Windows speech and input helper. Uses Windows OS Speech Recognition locally and inserts finalized words at the active cursor via Win32 `SendInput`.
  - [`desktop/native/SetupWizard.cs`](desktop/native/SetupWizard.cs) — Native Windows installation wizard creating Desktop & Start Menu shortcuts and registering in Windows Installed Apps.
  - [`desktop/src/main/windows-speech-engine.ts`](desktop/src/main/windows-speech-engine.ts) — Windows engine implementation of `ISpeechRecognitionEngine`.
  - [`desktop/src/main/mac-speech-engine.ts`](desktop/src/main/mac-speech-engine.ts) — macOS engine implementation supporting native AppleScript text insertion and clipboard fallback.
  - [`desktop/src/main/main.ts`](desktop/src/main/main.ts) & [`desktop/src/main/preload.ts`](desktop/src/main/preload.ts) — Electron main process (system tray, single-instance lock, minimize to taskbar, global shortcut `Ctrl+Shift+Space` / `Cmd+Shift+Space`).
  - [`desktop/src/renderer/App.tsx`](desktop/src/renderer/App.tsx) — Sleek React UI with center-bottom dock, soundwave animation, and live Word Replacement.
- [`web/`](web/) — Full web application platform with light/dark theme toggle, document editor, live word replacement, and direct download links for the Windows Installer and Extension package.
- [`tests/run-tests.mjs`](tests/run-tests.mjs) — Automated verification test suite.

---

## Build & Run Instructions

### 1. Install Dependencies & Build Everything

```powershell
npm install
npm run typecheck
npm run build
```

### 2. Run the Desktop Application (Electron)

```powershell
npm start
```

- Launches the desktop application with system tray integration.
- Focus any application (**Notepad**, **Microsoft Word**, **VS Code**, browser, etc.) and press **`Ctrl+Shift+Space`** (or **`Cmd+Shift+Space`** on macOS) to pop up the dictation window and start speaking.
- Use the **Minimize** (`–`) button to minimize to taskbar or **Close** (`×`) to minimize to tray.

### 3. Windows Setup Installer

Run `npm run build` to generate `Universal Voice-to-Text Helper Setup.exe` or download directly from the web platform. The installer:
- Installs the app to `%LOCALAPPDATA%\Programs\Universal Voice-to-Text Helper`
- Creates a Desktop shortcut
- Creates a Start Menu shortcut
- Registers in Windows Settings > Apps > Installed apps

### 4. Load the Chrome / Edge Browser Extension (Manifest V3)

1. Open Google Chrome (`chrome://extensions`) or Microsoft Edge (`edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the compiled folder:
   ```text
   d:\Voice-to-Text Helper\extension\dist
   ```
4. Press **`Ctrl+Shift+Space`** on any webpage to open the extension and speak.

### 5. Run the Web Platform Server

```powershell
npm run web
```
Visit `http://localhost:3000` to access the full web application, document editor, and download links.

### 6. Run Automated Tests

```powershell
npm test
```

---

## Speech Recognition & Audio Processing

- **Windows Desktop Application**: Uses the native Windows speech recognition service locally on-device. Audio is processed **100% locally on your computer** without external cloud services.
- **macOS Desktop Application**: Uses native macOS speech dictation and system events keystroke typing.
- **Browser Extension & Web Platform**: Uses the W3C Web Speech API (`SpeechRecognition`).
