import React, { useEffect, useRef, useState } from 'react';
import { SessionState } from '../../shared/session-store';
import {
  RecognitionErrorEvent,
  RecognitionStatus,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
} from '../../shared/speech-interface';
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

  const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version ? chrome.runtime.getManifest().version : '1.0.0';

  useEffect(() => {
    // Check microphone permission status if supported
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((perm) => {
          setHasPermission(perm.state === 'granted');
          perm.onchange = () => {
            setHasPermission(perm.state === 'granted');
          };
        })
        .catch(() => {});
    }

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

  useEffect(() => {
    if (sessionBoxRef.current) {
      sessionBoxRef.current.scrollTop = sessionBoxRef.current.scrollHeight;
    }
  }, [state.sessionTranscript, state.interimText]);

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

  const handlePause = async () => {
    if (engineRef.current) {
      await engineRef.current.pause();
    }
    chrome.runtime.sendMessage({ type: 'PAUSE_DICTATION' }).catch(() => {});
  };

  const handleResume = async () => {
    if (engineRef.current) {
      await engineRef.current.resume();
    }
    chrome.runtime.sendMessage({ type: 'RESUME_DICTATION' }).catch(() => {});
  };

  const handleLanguageChange = (code: SupportedLanguage) => {
    setState((prev) => ({ ...prev, language: code }));
    if (engineRef.current) {
      engineRef.current.setLanguage(code);
    }
    chrome.runtime.sendMessage({ type: 'SET_LANGUAGE', language: code }).catch(() => {});
  };

  const isListening = state.status === 'listening' || state.status === 'starting';
  const isPaused = state.status === 'paused';
  const hasInterim = Boolean(state.interimText && state.interimText.trim().length > 0);
  const isSpeaking = isListening && hasInterim;

  const statusLabel = (() => {
    if (isSpeaking) {
      return 'Speaking...';
    }
    switch (state.status) {
      case 'listening':
        return 'Listening...';
      case 'paused':
        return 'Paused';
      case 'starting':
        return 'Starting...';
      case 'mic-blocked':
        return 'Mic Blocked';
      case 'mic-disconnected':
        return 'Mic Disconnected';
      case 'unavailable':
        return 'Unavailable';
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
      {/* Header with Title, Version Badge, Permission Button, and Close */}
      <header className="header">
        <div className="brand-group">
          <img src="icons/icon32.png" alt="VoiceText" className="header-logo" width="20" height="20" />
          <span className="app-brand-name">VoiceText</span>
          <span className="version-pill" title="Installed Extension Version">v{version}</span>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className={`perm-action-btn ${hasPermission === false ? 'needs-perm' : ''}`}
            onClick={openPermissionTab}
            title="Enable or check Microphone Permissions"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span>{hasPermission === false ? 'Grant Mic' : 'Mic Access'}</span>
          </button>

          <button
            type="button"
            className="action-icon-header-btn"
            onClick={() => window.close()}
            title="Minimize popup (–)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <button
            type="button"
            className="close-btn"
            onClick={handleCloseSession}
            title="End session and close (×)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      {/* Language Selector Bar */}
      <div className="popup-lang-bar">
        <label className="lang-bar-label">Language:</label>
        <select
          className="popup-lang-select"
          value={state.language}
          onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
        >
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {/* Permission Warning Card if mic permission is needed or denied */}
      {hasPermission === false && (
        <div className="permission-prompt-card">
          <div className="prompt-header">
            <span className="prompt-title">Microphone Access Required</span>
          </div>
          <p className="prompt-sub">
            The browser requires microphone permissions to convert your speech into text.
          </p>
          <button className="grant-btn" onClick={openPermissionTab}>
            Enable Microphone Permission
          </button>
        </div>
      )}

      {/* Restricted Page Notice for chrome:// and edge:// tabs */}
      {isRestricted && (
        <div className="restricted-notice">
          <span>Note: On browser internal tabs (<code>chrome://</code>), dictation works inside this popup. To type directly into webpages, navigate to any website.</span>
        </div>
      )}

      {/* Sleek Recorder Pill Dock with Visual Alarm for Speaking & Listening States */}
      <section
        className={`popup-mic-dock ${isListening ? 'listening' : ''} ${
          isSpeaking ? 'speaking-alarm-active' : ''
        } ${isPaused ? 'paused' : ''}`}
      >
        <button
          className={`big-mic-btn ${isListening ? 'recording' : ''} ${
            isSpeaking ? 'speaking-pulsing' : ''
          }`}
          onClick={handleToggle}
          title={isListening ? 'Click to Stop Dictation' : 'Click to Speak'}
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
          <div className="mic-title-row">
            <span
              className={`status-dot ${isListening ? 'listening' : ''} ${
                isSpeaking ? 'speaking' : ''
              } ${isPaused ? 'paused' : ''} ${state.status === 'error' || state.status.startsWith('mic') ? 'error' : ''}`}
            />
            <span className={`mic-title ${isSpeaking ? 'speaking-title' : ''}`}>
              {statusLabel}
            </span>
            {isSpeaking && <span className="speaking-badge">SPEAKING</span>}
          </div>

          <div className="mic-hint">
            {isSpeaking ? (
              <span className="live-speaking-text">&ldquo;{state.interimText}&rdquo;</span>
            ) : isListening ? (
              'Listening... Speak now'
            ) : isPaused ? (
              'Recording paused'
            ) : isRestricted ? (
              'Click Start to record in popup'
            ) : (
              'Click mic or Start to begin'
            )}
          </div>
        </div>

        {/* Dynamic Sound Wave visualizer */}
        {isListening && (
          <SoundWave
            isListening={isListening}
            hasSpeechActivity={isSpeaking}
          />
        )}

        {/* Pause / Resume Button */}
        {isListening && (
          <button
            type="button"
            className="dock-pause-btn"
            onClick={handlePause}
            title="Pause Recording"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </button>
        )}

        {isPaused && (
          <button
            type="button"
            className="dock-pause-btn resume"
            onClick={handleResume}
            title="Resume Recording"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
        )}

        <button
          className={`dock-action-btn ${isListening ? 'stop' : isPaused ? 'stop' : 'start'}`}
          onClick={handleToggle}
        >
          {isListening ? 'Stop' : isPaused ? 'Stop' : 'Start'}
        </button>
      </section>

      {/* Word Replacement Card */}
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
