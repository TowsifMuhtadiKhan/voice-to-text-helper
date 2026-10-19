import React, { useEffect, useRef, useState } from 'react';
import { SessionState } from '../../shared/session-store';
import { RecognitionErrorEvent, RecognitionStatus } from '../../shared/speech-interface';
import { WebSpeechRecognitionEngine } from '../../shared/web-speech-engine';
import { SoundWave } from '../../shared/SoundWave';
import { applyWordReplacements, DEFAULT_REPLACEMENTS, WordReplacement } from '../../shared/word-replacer';
import { ExtensionMessage } from './messages';

export const PopupApp: React.FC = () => {
  const [state, setState] = useState<SessionState>({
    status: 'idle',
    language: 'en-US',
    interimText: '',
    sessionTranscript: '',
    errorMessage: null,
    shortcut: 'Ctrl+Shift+Space',
  });

  const [isRestricted, setIsRestricted] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [replacements, setReplacements] = useState<WordReplacement[]>([]);
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [copied, setCopied] = useState(false);

  const engineRef = useRef<WebSpeechRecognitionEngine | null>(null);
  const sessionBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const replacementsRef = useRef<WordReplacement[]>(replacements);
  replacementsRef.current = replacements;

  useEffect(() => {
    // Check if active tab is restricted (chrome://, edge://, etc.)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || '';
      const restricted =
        url.startsWith('chrome://') ||
        url.startsWith('edge://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('view-source:');
      setIsRestricted(restricted);
    });

    // Fetch initial session state
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp?: SessionState) => {
      if (resp) {
        setState(resp);
      }
    });

    const messageListener = (msg: ExtensionMessage) => {
      if (msg.type === 'STATE_BROADCAST') {
        setState(msg.state);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      engineRef.current?.dispose();
    };
  }, []);

  const openPermissionTab = () => {
    const permUrl = chrome.runtime.getURL('permission.html');
    chrome.tabs.create({ url: permUrl });
  };

  const switchToWebTab = () => {
    chrome.tabs.query({}, (tabs) => {
      const webTab =
        tabs.find((t) => t.url && t.url.includes('localhost:3000')) ||
        tabs.find((t) => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));

      if (webTab && typeof webTab.id === 'number') {
        chrome.tabs.update(webTab.id, { active: true });
        window.close();
      } else {
        chrome.tabs.create({ url: 'http://localhost:3000' });
        window.close();
      }
    });
  };

  useEffect(() => {
    if (sessionBoxRef.current) {
      sessionBoxRef.current.scrollTop = sessionBoxRef.current.scrollHeight;
    }
  }, [state.sessionTranscript]);

  const initLocalEngine = (): WebSpeechRecognitionEngine => {
    if (engineRef.current) return engineRef.current;

    const engine = new WebSpeechRecognitionEngine({
      onStatusChange: (status: RecognitionStatus) => {
        setState((prev) => ({ ...prev, status }));
        chrome.runtime.sendMessage({ type: 'CONTENT_STATUS_UPDATE', status }).catch(() => {});
      },
      onInterimResult: (interimText: string) => {
        const processed = applyWordReplacements(interimText, replacementsRef.current);
        setState((prev) => ({ ...prev, interimText: processed }));
        chrome.runtime.sendMessage({ type: 'CONTENT_INTERIM_RESULT', interimText: processed }).catch(() => {});
      },
      onFinalResult: (finalText: string) => {
        const processed = applyWordReplacements(finalText, replacementsRef.current);
        chrome.runtime.sendMessage({ type: 'CONTENT_FINAL_RESULT', finalText: processed }, (resp: SessionState) => {
          if (resp) {
            setState(resp);
          }
        });
      },
      onError: (err: RecognitionErrorEvent) => {
        if (err.code === 'not-allowed') {
          setHasPermission(false);
          openPermissionTab();
        }
        setState((prev) => ({ ...prev, status: 'error', errorMessage: err.message }));
      },
    });

    engineRef.current = engine;
    return engine;
  };

  const handleToggle = async () => {
    if (state.status === 'listening' || state.status === 'starting') {
      if (engineRef.current) {
        await engineRef.current.stop();
      }
      chrome.runtime.sendMessage({ type: 'STOP_DICTATION' }).catch(() => {});
    } else {
      if (isRestricted) {
        // Active tab is chrome:// or edge:// where content scripts cannot inject.
        // Run recognition directly inside the popup!
        const engine = initLocalEngine();
        await engine.start();
        return;
      }

      chrome.runtime.sendMessage(
        { type: 'START_DICTATION' },
        (resp?: SessionState & { contentScriptSent?: boolean }) => {
          if (chrome.runtime.lastError || (resp && resp.contentScriptSent === false)) {
            const engine = initLocalEngine();
            engine.start();
          }
        }
      );
    }
  };

  const handleCloseSession = () => {
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
    chrome.runtime.sendMessage({ type: 'CLOSE_SESSION' }, () => {
      window.close();
    });
  };

  const handleApplyReplace = (e: React.FormEvent) => {
    e.preventDefault();
    const fromText = newFrom.trim();
    if (!fromText) return;

    const toText = newTo.trim();
    const exists = replacements.some((r) => r.from.toLowerCase() === fromText.toLowerCase());

    let updatedRules: WordReplacement[];
    if (!exists) {
      updatedRules = [...replacements, { from: fromText, to: toText }];
    } else {
      updatedRules = replacements.map((r) =>
        r.from.toLowerCase() === fromText.toLowerCase() ? { from: fromText, to: toText } : r
      );
    }

    setReplacements(updatedRules);
    replacementsRef.current = updatedRules;
    chrome.runtime.sendMessage({ type: 'SET_REPLACEMENTS', replacements: updatedRules }).catch(() => {});

    // Immediately replace inside active session transcript
    if (state.sessionTranscript) {
      const replaced = applyWordReplacements(state.sessionTranscript, [{ from: fromText, to: toText }]);
      setState((prev) => ({ ...prev, sessionTranscript: replaced }));
    }

    setNewFrom('');
    setNewTo('');
  };

  const handleRemoveReplacement = (index: number) => {
    const updated = replacements.filter((_, i) => i !== index);
    setReplacements(updated);
    replacementsRef.current = updated;
    chrome.runtime.sendMessage({ type: 'SET_REPLACEMENTS', replacements: updated }).catch(() => {});
  };

  const handleCopyText = async () => {
    if (!state.sessionTranscript) return;
    try {
      await navigator.clipboard.writeText(state.sessionTranscript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy error
    }
  };

  const handleClearText = () => {
    setState((prev) => ({ ...prev, sessionTranscript: '', interimText: '' }));
  };

  const isListening = state.status === 'listening' || state.status === 'starting';

  const statusLabel = (() => {
    switch (state.status) {
      case 'listening':
        return 'Listening...';
      case 'starting':
        return 'Starting...';
      case 'stopped':
        return 'Stopped';
      case 'error':
        return state.errorMessage || 'Error';
      default:
        return 'Ready';
    }
  })();

  const wordCount = state.sessionTranscript
    ? state.sessionTranscript.trim().split(/\s+/).filter(Boolean).length
    : 0;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
  const displayShortcut = isMac ? 'Cmd+Shift+Space' : state.shortcut || 'Ctrl+Shift+Space';

  return (
    <div className="popup-container">
      {/* Header */}
      <header className="header">
        <div className="brand-group">
          <img src="icons/icon32.png" alt="VoiceText" className="header-logo" width="20" height="20" />
          <div className="status-indicator">
            <span
              className={`status-dot ${isListening ? 'listening' : ''} ${
                state.status === 'error' ? 'error' : ''
              }`}
            />
            <span className="status-text">{statusLabel}</span>
          </div>
        </div>
        <button
          className="close-btn"
          onClick={handleCloseSession}
          title="End session and clear transcript"
        >
          Close
        </button>
      </header>

      {/* Permission Request Banner */}
      {hasPermission === false && (
        <div className="permission-prompt-card">
          <div className="prompt-title">Microphone Access Needed</div>
          <p className="prompt-sub">Click below to allow microphone access in Chrome:</p>
          <button className="grant-btn" onClick={openPermissionTab}>
            Allow Microphone Access
          </button>
        </div>
      )}

      {/* Restricted Page Notice */}
      {isRestricted && (
        <div className="restricted-notice">
          <span>Note: On <code>chrome://</code> system pages, text is transcribed in the box below. To type into pages, open any website.</span>
        </div>
      )}

      {/* Sleek Recorder Pill Dock ("below things" design) */}
      <section className={`popup-mic-dock ${isListening ? 'listening' : ''}`}>
        <button
          className={`big-mic-btn ${isListening ? 'recording' : ''}`}
          onClick={handleToggle}
          title={isListening ? 'Click to Stop' : 'Click to Speak'}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>

        <div className="mic-info" onClick={handleToggle}>
          <div className="mic-title">
            {isListening ? 'Listening...' : 'Tap to Record'}
          </div>
          <div className="mic-hint">
            {isListening
              ? (state.interimText ? `"${state.interimText}"` : 'Speak now...')
              : isRestricted
                ? 'Click to open web page'
                : 'Click mic or Start to begin'}
          </div>
        </div>

        {/* Sound Wave */}
        {isListening && (
          <SoundWave
            isListening={isListening}
            hasSpeechActivity={Boolean(state.interimText)}
          />
        )}

        <button
          className={`dock-action-btn ${isListening ? 'stop' : 'start'}`}
          onClick={handleToggle}
        >
          {isRestricted ? 'Web' : isListening ? 'Stop' : 'Start'}
        </button>
      </section>

      {/* Word Replacement Section ("and the replace") */}
      <section className="replacement-card">
        <div className="section-header">
          <span className="section-title">Word Replacement</span>
        </div>

        <form className="replace-form" onSubmit={handleApplyReplace}>
          <div className="form-row">
            <input
              type="text"
              placeholder="Find word (e.g. 805 Health Care)"
              value={newFrom}
              onChange={(e) => setNewFrom(e.target.value)}
              className="replace-input"
            />
            <input
              type="text"
              placeholder="Replace with"
              value={newTo}
              onChange={(e) => setNewTo(e.target.value)}
              className="replace-input"
            />
            <button
              type="submit"
              className="replace-btn"
              disabled={!newFrom.trim()}
            >
              Replace
            </button>
          </div>
        </form>

        {/* Active Replacement Rules */}
        {replacements.length > 0 && (
          <div className="rules-section">
            <div className="rules-header">
              <span className="rules-label">Active Rules:</span>
              <button
                type="button"
                className="rules-clear-all-btn"
                onClick={() => {
                  setReplacements([]);
                  replacementsRef.current = [];
                  chrome.runtime.sendMessage({ type: 'SET_REPLACEMENTS', replacements: [] }).catch(() => {});
                }}
                title="Clear all replacement rules"
              >
                Clear Rules
              </button>
            </div>
            <div className="rules-chip-list">
            {replacements.map((r, i) => (
              <span key={i} className="rule-chip">
                <span className="rule-from">{r.from}</span>
                <span className="rule-arrow">&rarr;</span>
                <span className="rule-to">{r.to || '""'}</span>
                <button
                  type="button"
                  className="rule-del"
                  onClick={() => handleRemoveReplacement(i)}
                  title="Remove rule"
                >
                  &times;
                </button>
              </span>
            ))}
            </div>
          </div>
        )}
      </section>

      {/* Transcribed Text Panel */}
      <section className="panel session-panel">
        <div className="panel-header">
          <div className="panel-meta">
            <span className="panel-title">Transcribed Text</span>
            <span className="meta-word-count">
              {wordCount} {wordCount === 1 ? 'word' : 'words'}
            </span>
          </div>
          <div className="panel-actions">
            <button
              type="button"
              className="action-btn copy-btn"
              onClick={handleCopyText}
              disabled={!state.sessionTranscript}
              title="Copy transcribed text"
            >
              {copied ? '✓ Copied' : 'Copy Text'}
            </button>
            <button
              type="button"
              className="action-btn clear-btn"
              onClick={handleClearText}
              disabled={!state.sessionTranscript}
              title="Clear text"
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          ref={sessionBoxRef}
          className="session-text"
          value={
            state.sessionTranscript +
            (state.interimText ? (state.sessionTranscript ? ' ' : '') + state.interimText : '')
          }
          onChange={(e) => {
            const val = e.target.value;
            setState((prev) => ({ ...prev, sessionTranscript: val, interimText: '' }));
          }}
          placeholder="Transcribed text appears here. Click anywhere to edit, type, or use Backspace..."
          rows={5}
          spellCheck={false}
        />
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="shortcut-row">
          <span className="shortcut-label">Shortcut:</span>
          <span className="shortcut-key">{displayShortcut}</span>
        </div>
      </footer>
    </div>
  );
};
