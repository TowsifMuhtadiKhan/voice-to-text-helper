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
  let hostEl: HTMLElement | null = null;
  let shadowRoot: ShadowRoot | null = null;
  let currentShortcut = 'Ctrl+Shift+Space';
  let currentReplacements: WordReplacement[] = [...DEFAULT_REPLACEMENTS];

  const domInserter = new DomTextInserter((el) => {
    return Boolean(hostEl && el && (el === hostEl || hostEl.contains(el)));
  });

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
        if (hostEl && hostEl.style.display !== 'none') {
          hideFloatingWidget();
        } else {
          showFloatingWidget();
          try {
            chrome.runtime.sendMessage({ type: 'GET_STATE' }, (st?: SessionState) => {
              if (st) updateFloatingWidget(st);
            });
          } catch {
            // Ignore
          }
        }
        sendResponse({ ok: true });
        return false;
      }

      case 'CLOSE_SESSION': {
        engine.dispose();
        hideFloatingWidget();
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
        if (hostEl && hostEl.style.display !== 'none') {
          updateFloatingWidget(message.state);
        }
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

  /**
   * Builds and displays the minimal, draggable on-page microphone window inside a Shadow DOM
   * so that users can see live transcription and session text even when the toolbar popup is closed.
   */
  function ensureFloatingWidget(): void {
    if (hostEl && shadowRoot) {
      return;
    }

    hostEl = document.createElement('div');
    hostEl.id = 'uvt-floating-host';
    hostEl.style.all = 'initial';
    hostEl.style.position = 'fixed';
    hostEl.style.bottom = '20px';
    hostEl.style.right = '20px';
    hostEl.style.zIndex = '2147483647';
    hostEl.style.display = 'none';

    shadowRoot = hostEl.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .uvt-card {
          width: 290px;
          background: #18181b;
          color: #f4f4f5;
          border: 1px solid #27272a;
          border-radius: 10px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.45);
          overflow: hidden;
          user-select: none;
          font-size: 13px;
        }
        .uvt-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: #27272a;
          cursor: move;
        }
        .uvt-status-wrap {
          display: flex;
          align-items: center;
          gap: 7px;
          font-weight: 600;
          font-size: 12px;
        }
        .uvt-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #71717a;
        }
        .uvt-dot.listening {
          background: #ef4444;
          box-shadow: 0 0 8px #ef4444;
        }
        .uvt-close-btn {
          background: transparent;
          border: none;
          color: #a1a1aa;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .uvt-close-btn:hover {
          background: #3f3f46;
          color: #ffffff;
        }
        .uvt-body {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .uvt-controls {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .uvt-mic-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: #2563eb;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }
        .uvt-mic-btn.listening {
          background: #dc2626;
        }
        .uvt-start-stop-btn {
          flex: 1;
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid #3f3f46;
          background: #27272a;
          color: #f4f4f5;
          font-weight: 500;
          font-size: 12px;
          cursor: pointer;
        }
        .uvt-start-stop-btn:hover {
          background: #3f3f46;
        }
        .uvt-box {
          background: #09090b;
          border: 1px solid #27272a;
          border-radius: 6px;
          padding: 7px 9px;
        }
        .uvt-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #a1a1aa;
          margin-bottom: 3px;
        }
        .uvt-live-text {
          min-height: 18px;
          color: #93c5fd;
          font-style: italic;
          word-break: break-word;
        }
        .uvt-session-text {
          min-height: 44px;
          max-height: 90px;
          overflow-y: auto;
          color: #e4e4e7;
          white-space: pre-wrap;
          word-break: break-word;
          user-select: text;
        }
      </style>
      <div class="uvt-card">
        <div class="uvt-header" id="uvt-drag-handle">
          <div class="uvt-status-wrap">
            <span class="uvt-dot" id="uvt-status-dot"></span>
            <span id="uvt-status-text">Ready</span>
          </div>
          <button class="uvt-close-btn" id="uvt-close-btn" title="Close Session">Close</button>
        </div>
        <div class="uvt-body">
          <div class="uvt-controls">
            <button class="uvt-mic-btn" id="uvt-mic-btn" title="Microphone">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            </button>
            <button class="uvt-start-stop-btn" id="uvt-start-stop-btn">Start Dictation</button>
          </div>
          <div class="uvt-box">
            <div class="uvt-label">Live Transcription</div>
            <div class="uvt-live-text" id="uvt-live-text">—</div>
          </div>
          <div class="uvt-box">
            <div class="uvt-label">Current Session Text</div>
            <div class="uvt-session-text" id="uvt-session-text"></div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(hostEl);

    // Prevent buttons from stealing focus from the target input/textarea/editor
    const preventFocusSteal = (e: MouseEvent) => {
      e.preventDefault();
    };

    const micBtn = shadowRoot.getElementById('uvt-mic-btn')!;
    const startStopBtn = shadowRoot.getElementById('uvt-start-stop-btn')!;
    const closeBtn = shadowRoot.getElementById('uvt-close-btn')!;
    const dragHandle = shadowRoot.getElementById('uvt-drag-handle')!;

    micBtn.addEventListener('mousedown', preventFocusSteal);
    startStopBtn.addEventListener('mousedown', preventFocusSteal);
    closeBtn.addEventListener('mousedown', preventFocusSteal);
    dragHandle.addEventListener('mousedown', preventFocusSteal);

    micBtn.addEventListener('click', () => {
      engine.toggle();
    });

    startStopBtn.addEventListener('click', () => {
      engine.toggle();
    });

    closeBtn.addEventListener('click', () => {
      hideFloatingWidget();
    });

    // Make widget draggable
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    dragHandle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.id === 'uvt-close-btn') return;
      isDragging = true;
      const rect = hostEl!.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;
      hostEl!.style.right = 'auto';
      hostEl!.style.bottom = 'auto';
      hostEl!.style.left = `${initialLeft}px`;
      hostEl!.style.top = `${initialTop}px`;
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isDragging || !hostEl) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      hostEl.style.left = `${Math.max(0, initialLeft + dx)}px`;
      hostEl.style.top = `${Math.max(0, initialTop + dy)}px`;
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  function showFloatingWidget(): void {
    ensureFloatingWidget();
    if (hostEl) {
      hostEl.style.display = 'block';
    }
  }

  function hideFloatingWidget(): void {
    if (hostEl) {
      hostEl.style.display = 'none';
    }
  }

  function updateFloatingWidget(state: SessionState): void {
    if (!shadowRoot) return;

    const dot = shadowRoot.getElementById('uvt-status-dot')!;
    const statusText = shadowRoot.getElementById('uvt-status-text')!;
    const micBtn = shadowRoot.getElementById('uvt-mic-btn')!;
    const startStopBtn = shadowRoot.getElementById('uvt-start-stop-btn')!;
    const liveText = shadowRoot.getElementById('uvt-live-text')!;
    const sessionText = shadowRoot.getElementById('uvt-session-text')!;

    const isListening = state.status === 'listening' || state.status === 'starting';

    dot.className = isListening ? 'uvt-dot listening' : 'uvt-dot';
    micBtn.className = isListening ? 'uvt-mic-btn listening' : 'uvt-mic-btn';

    if (state.status === 'listening') {
      statusText.textContent = 'Listening...';
      startStopBtn.textContent = 'Stop';
    } else if (state.status === 'starting') {
      statusText.textContent = 'Starting...';
      startStopBtn.textContent = 'Stop';
    } else if (state.status === 'stopped') {
      statusText.textContent = 'Stopped';
      startStopBtn.textContent = 'Start';
    } else if (state.status === 'error') {
      statusText.textContent = state.errorMessage || 'Error';
      startStopBtn.textContent = 'Start';
    } else {
      statusText.textContent = 'Idle';
      startStopBtn.textContent = 'Start';
    }

    liveText.textContent = state.interimText || '—';
    sessionText.textContent = state.sessionTranscript || '';
    sessionText.scrollTop = sessionText.scrollHeight;
  }

  // Synchronize initial state from background service worker
  try {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state?: SessionState) => {
      if (chrome.runtime.lastError || !state) return;
      currentShortcut = state.shortcut || currentShortcut;
      if (hostEl && hostEl.style.display !== 'none') {
        updateFloatingWidget(state);
      }
    });
  } catch {
    // Ignore initialization error
  }
}
