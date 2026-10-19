# Universal Voice-to-Text Helper

A lightweight, high-performance speech-to-text utility available as a **Chrome / Microsoft Edge Browser Extension** (Manifest V3, TypeScript) and a companion **Web Platform**.

Its core purpose is to convert microphone speech into clean, accurate text and insert recognized words directly at the current cursor position in any web input or editor while preserving native undo history and keeping transcripts strictly in temporary volatile memory.

---

## Architecture & Project Structure

- [`shared/speech-interface.ts`](shared/speech-interface.ts) — Unified `ISpeechRecognitionEngine` interface. Supports English (`en-US`) initially and is structured to enable Bangla (`bn-BD`) seamlessly.
- [`shared/session-store.ts`](shared/session-store.ts) — Volatile in-memory session state manager (`InMemorySessionStore`). Separates live interim hypotheses from finalized utterances so finalized words are never duplicated, keeps the transcript visible when recording stops, and wipes all transcript data when the session is closed.
- [`shared/word-replacer.ts`](shared/word-replacer.ts) — Real-time word and acronym replacement engine with case-insensitive boundary matching.
- [`shared/web-speech-engine.ts`](shared/web-speech-engine.ts) — Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) implementation of `ISpeechRecognitionEngine`.
- [`shared/SoundWave.tsx`](shared/SoundWave.tsx) — Visual audio wave indicator for active dictation feedback.
- [`extension/`](extension/) — Chrome & Microsoft Edge Manifest V3 extension:
  - [`extension/manifest.json`](extension/manifest.json) — Manifest V3 configuration with configurable shortcut `Ctrl+Shift+Space` (`Cmd+Shift+Space` on macOS).
  - [`extension/src/background.ts`](extension/src/background.ts) — Service worker managing session state, hotkey commands, and tab coordination.
  - [`extension/src/content.ts`](extension/src/content.ts) — Content script providing cursor focus detection and text insertion directly into web pages without duplicate UI overlays.
  - [`extension/src/dom-inserter.ts`](extension/src/dom-inserter.ts) — Detects focused `<input>`, `<textarea>`, and `contenteditable` editors and inserts finalized text at the cursor while preserving native undo history.
  - [`extension/src/PopupApp.tsx`](extension/src/PopupApp.tsx) — Clean extension toolbar popup with mic controls, live audio feedback, word replacements, and session transcript.
- [`web/`](web/) — Full web application platform with light/dark theme toggle, document notepad editor, live word replacement, and extension download package.
- [`tests/run-tests.mjs`](tests/run-tests.mjs) — Automated verification test suite.

---

## Build & Run Instructions

### 1. Install Dependencies & Build Everything

```powershell
npm install
npm run typecheck
npm run build
```

### 2. Load the Chrome / Edge Browser Extension (Manifest V3)

1. Open Google Chrome (`chrome://extensions`) or Microsoft Edge (`edge://extensions`).
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked** and select the compiled directory:
   ```text
   D:\Voice-to-Text Helper\extension\dist
   ```
4. If already loaded, click the circular **Reload** icon on the extension card.
5. Focus any text field on any webpage and press **`Ctrl+Shift+Space`** (or click the extension icon in the toolbar) to start dictation.

### 3. Run the Web Platform Server

```powershell
npm run web
```
Visit `http://localhost:3000` to access the full web application and document editor.

### 4. Run Automated Tests

```powershell
npm test
```
