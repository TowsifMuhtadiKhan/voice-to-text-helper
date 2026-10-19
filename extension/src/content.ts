import { SessionState } from '../../shared/session-store';
import { RecognitionErrorEvent, RecognitionStatus } from '../../shared/speech-interface';
import { WebSpeechRecognitionEngine } from '../../shared/web-speech-engine';
import { applyWordReplacements, DEFAULT_REPLACEMENTS, WordReplacement } from '../../shared/word-replacer';
import { DomTextInserter } from './dom-inserter';
import { ExtensionMessage } from './messages';

declare global {
  interface Window {
    __universalVoiceToTextLoaded?: boolean;
  }
}

if (!window.__universalVoiceToTextLoaded) {
  window.__universalVoiceToTextLoaded = true;
  initContentScript();
}

function initContentScript(): void {
  let currentShortcut = 'Ctrl+Shift+Space';
  let currentReplacements: WordReplacement[] = [...DEFAULT_REPLACEMENTS];

  const domInserter = new DomTextInserter();

  const engine = new WebSpeechRecognitionEngine({
    onStatusChange: (status: RecognitionStatus) => {
      sendMessageSafe({ type: 'CONTENT_STATUS_UPDATE', status });
    },
    onInterimResult: (interimText: string) => {
      const processed = applyWordReplacements(interimText, currentReplacements);
      sendMessageSafe({ type: 'CONTENT_INTERIM_RESULT', interimText: processed });
    },
    onFinalResult: (finalText: string) => {
      const processed = applyWordReplacements(finalText, currentReplacements);
      domInserter.insertTextAtCursor(processed);
      sendMessageSafe({ type: 'CONTENT_FINAL_RESULT', finalText: processed });
    },
    onError: (err: RecognitionErrorEvent) => {
      sendMessageSafe({
        type: 'CONTENT_STATUS_UPDATE',
        status: 'error',
        errorMessage: err.message,
      });
    },
  });

  function sendMessageSafe(msg: ExtensionMessage): void {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {
        // Ignore if background worker is waking up
      });
    } catch {
      // Extension context invalidated
    }
  }

  // Handle messages from Background Service Worker & Popup
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'START_DICTATION': {
        engine.start();
        sendResponse({ ok: true });
        return false;
      }

      case 'STOP_DICTATION': {
        engine.stop();
        sendResponse({ ok: true });
        return false;
      }

      case 'TOGGLE_DICTATION': {
        engine.toggle();
        sendResponse({ ok: true });
        return false;
      }

      case 'TOGGLE_FLOATING_WIDGET': {
        sendResponse({ ok: true });
        return false;
      }

      case 'CLOSE_SESSION': {
        engine.dispose();
        sendResponse({ ok: true });
        return false;
      }

      case 'SET_LANGUAGE': {
        engine.setLanguage(message.language);
        sendResponse({ ok: true });
        return false;
      }

      case 'SET_SHORTCUT': {
        currentShortcut = message.shortcut;
        sendResponse({ ok: true });
        return false;
      }

      case 'SET_REPLACEMENTS': {
        currentReplacements = message.replacements;
        sendResponse({ ok: true });
        return false;
      }

      case 'INSERT_TEXT_AT_CURSOR': {
        const inserted = domInserter.insertTextAtCursor(message.text);
        sendResponse({ ok: inserted });
        return false;
      }

      case 'STATE_BROADCAST': {
        currentShortcut = message.state.shortcut || currentShortcut;
        return false;
      }

      default:
        return false;
    }
  });

  // Support configurable keyboard shortcut directly on the page (e.g. Ctrl+Shift+Space)
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (matchesShortcut(e, currentShortcut)) {
        e.preventDefault();
        e.stopPropagation();
        engine.toggle();
      }
    },
    true
  );

  function matchesShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
    if (!shortcutStr) return false;
    const parts = shortcutStr
      .split('+')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    const needCtrl = parts.includes('ctrl') || parts.includes('control');
    const needShift = parts.includes('shift');
    const needAlt = parts.includes('alt');
    const needMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('win');

    if (e.ctrlKey !== needCtrl) return false;
    if (e.shiftKey !== needShift) return false;
    if (e.altKey !== needAlt) return false;
    if (e.metaKey !== needMeta) return false;

    const mainKey = parts.find(
      (p) => !['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd', 'win'].includes(p)
    );
    if (!mainKey) return false;

    const pressedKey = e.code === 'Space' || e.key === ' ' ? 'space' : e.key.toLowerCase();
    return pressedKey === mainKey;
  }

  // Synchronize initial state from background service worker
  try {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state?: SessionState) => {
      if (chrome.runtime.lastError || !state) return;
      currentShortcut = state.shortcut || currentShortcut;
    });
  } catch {
    // Ignore initialization error
  }
}
