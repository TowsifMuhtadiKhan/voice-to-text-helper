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
  let isMinimized = false;
  let isClosedByUser = false;
  let currentShortcut = 'Ctrl+Shift+Space';
  let currentReplacements: WordReplacement[] = [...DEFAULT_REPLACEMENTS];

  // Do not show on-page floating widget on the web platform (localhost:3000) to prevent duplicate interface
  const isWebPlatform =
    window.location.hostname === 'localhost' && window.location.port === '3000';

  const domInserter = new DomTextInserter((el) => {
    return Boolean(hostEl && el && (el === hostEl || hostEl.contains(el)));
  });

  const engine = new WebSpeechRecognitionEngine({
    onStatusChange: (status: RecognitionStatus) => {
      sendMessageSafe({ type: 'CONTENT_STATUS_UPDATE', status });
      if (status === 'listening' && !isClosedByUser && !isWebPlatform) {
        showFloatingWidget();
      }
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
        isClosedByUser = false;
        engine.start();
        if (!isWebPlatform) {
          showFloatingWidget();
        }
        sendResponse({ ok: true });
        return false;
      }

      case 'STOP_DICTATION': {
        engine.stop();
        sendResponse({ ok: true });
        return false;
      }

      case 'PAUSE_DICTATION': {
        engine.pause();
        sendResponse({ ok: true });
        return false;
      }

      case 'RESUME_DICTATION': {
        engine.resume();
        sendResponse({ ok: true });
        return false;
      }

      case 'TOGGLE_DICTATION': {
        if (engine.getStatus() === 'listening' || engine.getStatus() === 'starting') {
          engine.stop();
        } else {
          isClosedByUser = false;
          engine.start();
          if (!isWebPlatform) {
            showFloatingWidget();
          }
        }
        sendResponse({ ok: true });
        return false;
      }

      case 'TOGGLE_FLOATING_WIDGET': {
        if (isWebPlatform) {
          sendResponse({ ok: true });
          return false;
        }
        if (hostEl && hostEl.style.display !== 'none') {
          hideFloatingWidget();
        } else {
          isClosedByUser = false;
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
        if (engine.getStatus() === 'listening' || engine.getStatus() === 'starting') {
          engine.stop();
        } else {
          isClosedByUser = false;
          engine.start();
          if (!isWebPlatform) {
            showFloatingWidget();
          }
        }
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
   * Builds and displays the draggable on-page widget inside a Shadow DOM
   * with proper Minimize (–), Maximize (+), and Close (×) controls.
   */
  function ensureFloatingWidget(): void {
    if (hostEl && shadowRoot) {
      return;
    }

    hostEl = document.createElement('div');
    hostEl.id = 'uvt-floating-host';
    hostEl.style.all = 'initial';
    hostEl.style.position = 'fixed';
    hostEl.style.bottom = '24px';
    hostEl.style.right = '24px';
    hostEl.style.zIndex = '2147483647';
    hostEl.style.display = 'none';

    shadowRoot = hostEl.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          user-select: none;
        }

        /* Full Card */
        .uvt-card {
          width: 300px;
          background: #14151b;
          color: #f4f4f5;
          border: 1px solid #27272a;
          border-radius: 12px;
          box-shadow: 0 14px 35px rgba(0, 0, 0, 0.55);
          overflow: hidden;
          transition: box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .uvt-card.speaking-alarm {
          border-color: #38bdf8;
          box-shadow: 0 0 25px rgba(56, 189, 248, 0.45);
        }

        .uvt-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: #1f2029;
          border-bottom: 1px solid #27272a;
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
          transition: all 0.2s ease;
        }

        .uvt-dot.listening {
          background: #ef4444;
          box-shadow: 0 0 8px #ef4444;
        }

        .uvt-dot.speaking {
          background: #38bdf8;
          box-shadow: 0 0 10px #38bdf8;
          animation: uvt-pulse-dot 0.9s infinite alternate;
        }

        @keyframes uvt-pulse-dot {
          0% { transform: scale(1); box-shadow: 0 0 4px #38bdf8; }
          100% { transform: scale(1.35); box-shadow: 0 0 12px #38bdf8; }
        }

        .uvt-status-title {
          font-size: 12px;
          font-weight: 700;
          color: #e4e4e7;
        }

        .uvt-status-title.speaking {
          color: #38bdf8;
        }

        .uvt-speaking-pill {
          display: none;
          font-size: 8px;
          font-weight: 800;
          color: #ffffff;
          background: #0284c7;
          border-radius: 3px;
          padding: 1px 4px;
          letter-spacing: 0.04em;
        }

        .uvt-speaking-pill.show {
          display: inline-block;
        }

        .uvt-header-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .uvt-action-icon-btn {
          background: transparent;
          border: none;
          color: #a1a1aa;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          width: 22px;
          height: 22px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .uvt-action-icon-btn:hover {
          background: #27272a;
          color: #ffffff;
        }

        .uvt-action-icon-btn.close:hover {
          background: #dc2626;
          color: #ffffff;
        }

        .uvt-body {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }

        .uvt-controls {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .uvt-mic-btn {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: none;
          background: #2563eb;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.2s ease;
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.4);
        }

        .uvt-mic-btn.listening {
          background: #dc2626;
          box-shadow: 0 0 12px rgba(220, 38, 38, 0.7);
        }

        .uvt-mic-btn.speaking {
          background: #0284c7;
          box-shadow: 0 0 18px rgba(56, 189, 248, 0.9);
          animation: uvt-pulse-mic 0.9s infinite;
        }

        @keyframes uvt-pulse-mic {
          0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.85); }
          70% { box-shadow: 0 0 0 10px rgba(56, 189, 248, 0); }
          100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
        }

        .uvt-start-stop-btn {
          flex: 1;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid #3f3f46;
          background: #27272a;
          color: #f4f4f5;
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .uvt-start-stop-btn:hover {
          background: #3f3f46;
        }

        .uvt-start-stop-btn.stop {
          background: #dc2626;
          border-color: #ef4444;
          color: #ffffff;
        }

        .uvt-box {
          background: #09090b;
          border: 1px solid #27272a;
          border-radius: 7px;
          padding: 7px 9px;
        }

        .uvt-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #a1a1aa;
          margin-bottom: 3px;
        }

        .uvt-live-text {
          min-height: 18px;
          color: #93c5fd;
          font-weight: 500;
          word-break: break-word;
        }

        .uvt-live-text.speaking {
          color: #38bdf8;
          font-weight: 600;
        }

        .uvt-session-text {
          min-height: 44px;
          max-height: 80px;
          overflow-y: auto;
          color: #e4e4e7;
          white-space: pre-wrap;
          word-break: break-word;
          user-select: text;
          font-size: 12px;
          line-height: 1.4;
        }

        /* Minimized Floating Pill */
        .uvt-min-pill {
          display: none;
          align-items: center;
          gap: 8px;
          background: #14151b;
          border: 1px solid #3f3f46;
          border-radius: 24px;
          padding: 6px 10px 6px 6px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
          cursor: move;
          transition: all 0.2s ease;
        }

        .uvt-min-pill.speaking-alarm {
          border-color: #38bdf8;
          box-shadow: 0 0 18px rgba(56, 189, 248, 0.6);
        }

        .uvt-min-mic-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: none;
          background: #2563eb;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .uvt-min-mic-btn.listening {
          background: #dc2626;
        }

        .uvt-min-mic-btn.speaking {
          background: #0284c7;
          animation: uvt-pulse-mic 0.9s infinite;
        }

        .uvt-min-text {
          font-size: 11px;
          font-weight: 600;
          color: #f4f4f5;
          max-width: 140px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .uvt-min-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }
      </style>

      <!-- Full Expanded Card -->
      <div class="uvt-card" id="uvt-full-card">
        <div class="uvt-header" id="uvt-drag-handle">
          <div class="uvt-status-wrap">
            <span class="uvt-dot" id="uvt-status-dot"></span>
            <span class="uvt-status-title" id="uvt-status-text">Ready</span>
            <span class="uvt-speaking-pill" id="uvt-speaking-pill">SPEAKING</span>
          </div>

          <div class="uvt-header-actions">
            <button class="uvt-action-icon-btn" id="uvt-min-btn" title="Minimize (–)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button class="uvt-action-icon-btn close" id="uvt-close-btn" title="Close (×)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div class="uvt-body">
          <div class="uvt-controls">
            <button class="uvt-mic-btn" id="uvt-mic-btn" title="Toggle Dictation">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
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

      <!-- Minimized Compact Pill -->
      <div class="uvt-min-pill" id="uvt-min-pill">
        <button class="uvt-min-mic-btn" id="uvt-min-mic-btn" title="Toggle Dictation">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </button>
        <span class="uvt-min-text" id="uvt-min-text">VoiceText</span>
        <div class="uvt-min-actions">
          <button class="uvt-action-icon-btn" id="uvt-expand-btn" title="Maximize (+)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
          <button class="uvt-action-icon-btn close" id="uvt-min-close-btn" title="Close (×)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(hostEl);

    // Prevent button clicks from stealing focus from webpage input elements
    const preventFocusSteal = (e: MouseEvent) => {
      e.preventDefault();
    };

    const fullCard = shadowRoot.getElementById('uvt-full-card')!;
    const minPill = shadowRoot.getElementById('uvt-min-pill')!;
    const micBtn = shadowRoot.getElementById('uvt-mic-btn')!;
    const minMicBtn = shadowRoot.getElementById('uvt-min-mic-btn')!;
    const startStopBtn = shadowRoot.getElementById('uvt-start-stop-btn')!;
    const minBtn = shadowRoot.getElementById('uvt-min-btn')!;
    const expandBtn = shadowRoot.getElementById('uvt-expand-btn')!;
    const closeBtn = shadowRoot.getElementById('uvt-close-btn')!;
    const minCloseBtn = shadowRoot.getElementById('uvt-min-close-btn')!;
    const dragHandle = shadowRoot.getElementById('uvt-drag-handle')!;

    micBtn.addEventListener('mousedown', preventFocusSteal);
    minMicBtn.addEventListener('mousedown', preventFocusSteal);
    startStopBtn.addEventListener('mousedown', preventFocusSteal);
    minBtn.addEventListener('mousedown', preventFocusSteal);
    expandBtn.addEventListener('mousedown', preventFocusSteal);
    closeBtn.addEventListener('mousedown', preventFocusSteal);
    minCloseBtn.addEventListener('mousedown', preventFocusSteal);
    dragHandle.addEventListener('mousedown', preventFocusSteal);
    minPill.addEventListener('mousedown', preventFocusSteal);

    micBtn.addEventListener('click', () => engine.toggle());
    minMicBtn.addEventListener('click', () => engine.toggle());
    startStopBtn.addEventListener('click', () => engine.toggle());

    // Minimize button (–)
    minBtn.addEventListener('click', () => {
      isMinimized = true;
      fullCard.style.display = 'none';
      minPill.style.display = 'flex';
    });

    // Expand button (+)
    expandBtn.addEventListener('click', () => {
      isMinimized = false;
      minPill.style.display = 'none';
      fullCard.style.display = 'block';
    });

    // Close buttons (×)
    closeBtn.addEventListener('click', () => {
      isClosedByUser = true;
      engine.stop();
      hideFloatingWidget();
    });

    minCloseBtn.addEventListener('click', () => {
      isClosedByUser = true;
      engine.stop();
      hideFloatingWidget();
    });

    // Make widget draggable on page
    setupDraggable(dragHandle, hostEl);
    setupDraggable(minPill, hostEl);
  }

  function setupDraggable(handle: HTMLElement, target: HTMLElement): void {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    handle.addEventListener('mousedown', (e: MouseEvent) => {
      // Don't drag when clicking buttons inside handle
      if ((e.target as HTMLElement)?.closest('button')) return;
      isDragging = true;
      const rect = target.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;
      target.style.right = 'auto';
      target.style.bottom = 'auto';
      target.style.left = `${initialLeft}px`;
      target.style.top = `${initialTop}px`;
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      target.style.left = `${Math.max(10, Math.min(window.innerWidth - 80, initialLeft + dx))}px`;
      target.style.top = `${Math.max(10, Math.min(window.innerHeight - 50, initialTop + dy))}px`;
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  function showFloatingWidget(): void {
    if (isWebPlatform) return;
    ensureFloatingWidget();
    if (hostEl && shadowRoot) {
      hostEl.style.display = 'block';
      const fullCard = shadowRoot.getElementById('uvt-full-card');
      const minPill = shadowRoot.getElementById('uvt-min-pill');
      if (fullCard && minPill) {
        if (isMinimized) {
          fullCard.style.display = 'none';
          minPill.style.display = 'flex';
        } else {
          fullCard.style.display = 'block';
          minPill.style.display = 'none';
        }
      }
    }
  }

  function hideFloatingWidget(): void {
    if (hostEl) {
      hostEl.style.display = 'none';
    }
  }

  function updateFloatingWidget(state: SessionState): void {
    if (!shadowRoot) return;

    const fullCard = shadowRoot.getElementById('uvt-full-card');
    const minPill = shadowRoot.getElementById('uvt-min-pill');
    const dot = shadowRoot.getElementById('uvt-status-dot');
    const statusText = shadowRoot.getElementById('uvt-status-text');
    const speakingPill = shadowRoot.getElementById('uvt-speaking-pill');
    const micBtn = shadowRoot.getElementById('uvt-mic-btn');
    const minMicBtn = shadowRoot.getElementById('uvt-min-mic-btn');
    const startStopBtn = shadowRoot.getElementById('uvt-start-stop-btn');
    const liveText = shadowRoot.getElementById('uvt-live-text');
    const sessionText = shadowRoot.getElementById('uvt-session-text');
    const minText = shadowRoot.getElementById('uvt-min-text');

    if (!dot || !statusText || !micBtn || !startStopBtn || !liveText || !sessionText) {
      return;
    }

    const isListening = state.status === 'listening' || state.status === 'starting';
    const isSpeaking = isListening && Boolean(state.interimText && state.interimText.trim().length > 0);

    // Apply alarm pulse when speaking
    if (fullCard) {
      fullCard.className = isSpeaking ? 'uvt-card speaking-alarm' : 'uvt-card';
    }
    if (minPill) {
      minPill.className = isSpeaking ? 'uvt-min-pill speaking-alarm' : 'uvt-min-pill';
    }

    if (isSpeaking) {
      dot.className = 'uvt-dot speaking';
      statusText.textContent = 'Speaking...';
      statusText.className = 'uvt-status-title speaking';
      if (speakingPill) speakingPill.className = 'uvt-speaking-pill show';
      micBtn.className = 'uvt-mic-btn speaking';
      if (minMicBtn) minMicBtn.className = 'uvt-min-mic-btn speaking';
      startStopBtn.textContent = 'Stop';
      startStopBtn.className = 'uvt-start-stop-btn stop';
      liveText.className = 'uvt-live-text speaking';
      if (minText) minText.textContent = state.interimText || 'Speaking...';
    } else if (isListening) {
      dot.className = 'uvt-dot listening';
      statusText.textContent = state.status === 'starting' ? 'Starting...' : 'Listening...';
      statusText.className = 'uvt-status-title';
      if (speakingPill) speakingPill.className = 'uvt-speaking-pill';
      micBtn.className = 'uvt-mic-btn listening';
      if (minMicBtn) minMicBtn.className = 'uvt-min-mic-btn listening';
      startStopBtn.textContent = 'Stop';
      startStopBtn.className = 'uvt-start-stop-btn stop';
      liveText.className = 'uvt-live-text';
      if (minText) minText.textContent = 'Listening...';
    } else if (state.status === 'error') {
      dot.className = 'uvt-dot';
      statusText.textContent = state.errorMessage || 'Error';
      statusText.className = 'uvt-status-title';
      if (speakingPill) speakingPill.className = 'uvt-speaking-pill';
      micBtn.className = 'uvt-mic-btn';
      if (minMicBtn) minMicBtn.className = 'uvt-min-mic-btn';
      startStopBtn.textContent = 'Start';
      startStopBtn.className = 'uvt-start-stop-btn';
      liveText.className = 'uvt-live-text';
      if (minText) minText.textContent = 'Error';
    } else {
      dot.className = 'uvt-dot';
      statusText.textContent = state.status === 'stopped' ? 'Stopped' : 'Ready';
      statusText.className = 'uvt-status-title';
      if (speakingPill) speakingPill.className = 'uvt-speaking-pill';
      micBtn.className = 'uvt-mic-btn';
      if (minMicBtn) minMicBtn.className = 'uvt-min-mic-btn';
      startStopBtn.textContent = 'Start';
      startStopBtn.className = 'uvt-start-stop-btn';
      liveText.className = 'uvt-live-text';
      if (minText) minText.textContent = 'VoiceText';
    }

    liveText.textContent = state.interimText ? `"${state.interimText}"` : '—';
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
