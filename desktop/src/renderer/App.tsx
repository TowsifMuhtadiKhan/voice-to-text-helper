import React, { useEffect, useRef, useState } from 'react';
import { SessionState } from '../../../shared/session-store';
import { SoundWave } from '../../../shared/SoundWave';
import { applyWordReplacements, WordReplacement } from '../../../shared/word-replacer';
import type { VoiceDesktopAPI } from '../main/preload';

declare global {
  interface Window {
    voiceHelper: VoiceDesktopAPI;
  }
}

const INITIAL_STATE: SessionState = {
  status: 'idle',
  language: 'en-US',
  interimText: '',
  sessionTranscript: '',
  errorMessage: null,
  shortcut: 'Ctrl+Shift+Space',
};

export const App: React.FC = () => {
  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [replacements, setReplacements] = useState<WordReplacement[]>([]);
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [copied, setCopied] = useState(false);
  const sessionBoxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let unsubscribe = () => {};
    if (window.voiceHelper) {
      window.voiceHelper.getState().then((initial) => {
        setState(initial);
      });
      unsubscribe = window.voiceHelper.onStateChanged((nextState) => {
        setState(nextState);
      });
    }
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (sessionBoxRef.current) {
      sessionBoxRef.current.scrollTop = sessionBoxRef.current.scrollHeight;
    }
  }, [state.sessionTranscript]);

  useEffect(() => {
    if (!recordingShortcut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      if (e.key === 'Escape') {
        setRecordingShortcut(false);
        return;
      }

      const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
      const mods: string[] = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push(isMac ? 'Option' : 'Alt');
      if (e.shiftKey) mods.push('Shift');
      if (e.metaKey) mods.push(isMac ? 'Cmd' : 'Win');

      const keyName =
        e.code === 'Space' || e.key === ' '
          ? 'Space'
          : e.key.length === 1
            ? e.key.toUpperCase()
            : e.key;

      const shortcutStr = [...mods, keyName].join('+');
      setRecordingShortcut(false);
      window.voiceHelper?.setShortcut(shortcutStr);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [recordingShortcut]);

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
        return 'Idle';
    }
  })();

  const handleToggle = () => {
    window.voiceHelper?.toggle();
  };

  const handleClose = () => {
    window.voiceHelper?.closeApp();
  };

  const handleMinimize = () => {
    window.voiceHelper?.minimizeApp();
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
    window.voiceHelper?.setReplacements(updatedRules);

    // Apply immediately to current session transcript
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
    window.voiceHelper?.setReplacements(updated);
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

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setState((prev) => ({ ...prev, sessionTranscript: val, interimText: '' }));
  };

  const wordCount = state.sessionTranscript
    ? state.sessionTranscript.trim().split(/\s+/).filter(Boolean).length
    : 0;

  return (
    <div className="app-shell">
      {/* Draggable Titlebar: Brand + Status + Close (Minimize to Tray) */}
      <header className="titlebar">
        <div className="status-group">
          <img src="assets/icon32.png" alt="Logo" className="app-logo" width="18" height="18" />
          <span
            className={`status-dot ${isListening ? 'listening' : ''} ${
              state.status === 'error' ? 'error' : ''
            }`}
          />
          <span className="status-label" data-testid="recording-status">
            {statusLabel}
          </span>
        </div>
        <div className="titlebar-controls no-drag">
          <button
            className="window-control-btn minimize-btn"
            onClick={handleMinimize}
            title="Minimize to taskbar"
            aria-label="Minimize"
            data-testid="minimize-btn"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect fill="currentColor" width="10" height="1.6" x="1" y="6" rx="0.8" />
            </svg>
          </button>
          <button
            className="window-control-btn close-btn"
            onClick={handleClose}
            title="Minimize to background tray (press shortcut anytime to pop up)"
            aria-label="Close"
            data-testid="close-btn"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.2 2.2L9.8 9.8M9.8 2.2L2.2 9.8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main className="content">
        {/* Sleek Recorder Dock - matching the bottom pill container from web */}
        <section className={`desktop-mic-dock ${isListening ? 'listening' : ''}`}>
          <button
            className={`big-mic-btn ${isListening ? 'recording' : ''}`}
            onClick={handleToggle}
            title={isListening ? 'Click to Stop' : 'Click to Speak'}
            data-testid="mic-btn"
          >
            <svg
              width="24"
              height="24"
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
            <div className="mic-hint" data-testid="live-transcription">
              {isListening
                ? (state.interimText ? `"${state.interimText}"` : 'Speak now...')
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
            data-testid="start-stop-btn"
          >
            {isListening ? 'Stop' : 'Start'}
          </button>
        </section>

        {/* Word Replacement Section */}
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
                placeholder="Replace with (e.g. ata-healthcare)"
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
                    window.voiceHelper?.setReplacements([]);
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

        {/* Current Session Transcribed Text Panel */}
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
                title="Clear current text"
              >
                Clear
              </button>
            </div>
          </div>
          <textarea
            ref={sessionBoxRef}
            className="session-text"
            data-testid="session-transcript"
            value={
              state.sessionTranscript +
              (state.interimText ? (state.sessionTranscript ? ' ' : '') + state.interimText : '')
            }
            onChange={handleTextChange}
            placeholder="Transcribed text appears here. Click anywhere to edit, type, or use Backspace..."
            rows={6}
            spellCheck={false}
          />
        </section>

        {/* Global Shortcut Footer */}
        <footer className="shortcut-bar">
          <span className="shortcut-label">Global Shortcut:</span>
          <button
            className={`shortcut-btn ${recordingShortcut ? 'recording' : ''}`}
            onClick={() => setRecordingShortcut(true)}
            title="Click to configure global shortcut"
            data-testid="shortcut-btn"
          >
            {recordingShortcut ? 'Press keys...' : state.shortcut}
          </button>
        </footer>
        <div className="tray-hint">
          Runs in background &bull; Press {state.shortcut} anywhere to pop up
        </div>
      </main>
    </div>
  );
};
