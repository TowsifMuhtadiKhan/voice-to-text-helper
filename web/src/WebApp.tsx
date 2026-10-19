import React, { useEffect, useRef, useState } from 'react';
import { InMemorySessionStore, SessionState } from '../../shared/session-store';
import { RecognitionErrorEvent, RecognitionStatus } from '../../shared/speech-interface';
import { WebSpeechRecognitionEngine } from '../../shared/web-speech-engine';
import { applyWordReplacements, DEFAULT_REPLACEMENTS, WordReplacement } from '../../shared/word-replacer';
import { DomTextInserter } from '../../extension/src/dom-inserter';
import { SoundWave } from './SoundWave';

export const WebApp: React.FC = () => {
  const storeRef = useRef<InMemorySessionStore | null>(null);
  const engineRef = useRef<WebSpeechRecognitionEngine | null>(null);
  const inserterRef = useRef<DomTextInserter | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  if (!storeRef.current) {
    storeRef.current = new InMemorySessionStore('Ctrl+Shift+Space', 'en-US');
  }

  const [state, setState] = useState<SessionState>(() => storeRef.current!.getState());
  const [replacements, setReplacements] = useState<WordReplacement[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [copied, setCopied] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  const replacementsRef = useRef<WordReplacement[]>(replacements);
  replacementsRef.current = replacements;
  const committedTextRef = useRef<string>('');

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      alert(
        "To open VoiceText as a standalone PC App window (without Google Chrome tabs or address bar):\n\n" +
        "1. In Chrome / Edge, click the 3 dots menu (⋮) in the top right.\n" +
        "2. Select 'Cast, save, and share' (or 'Apps') -> 'Install VoiceText as an app'.\n\n" +
        "It will open in its own clean window with its own icon in the Windows taskbar!"
      );
    }
  };

  useEffect(() => {
    const store = storeRef.current!;

    const inserter = new DomTextInserter();
    inserterRef.current = inserter;

    const engine = new WebSpeechRecognitionEngine({
      onStatusChange: (status: RecognitionStatus) => {
        store.setStatus(status);
        if (status !== 'listening' && editorRef.current) {
          // Reset textarea to committed text if stopped mid-utterance
          editorRef.current.value = committedTextRef.current;
          updateWordCount();
        }
      },
      onInterimResult: (interimText: string) => {
        store.setInterimText(interimText);
        // Live streaming speech directly into the right-side text document
        if (editorRef.current) {
          const el = editorRef.current;
          const processedInterim = applyWordReplacements(interimText, replacementsRef.current);
          if (processedInterim) {
            const base = committedTextRef.current;
            const needsSpace = base.length > 0 && !/\s$/.test(base);
            el.value = base + (needsSpace ? ' ' : '') + processedInterim;
            el.scrollTop = el.scrollHeight;
            updateWordCount();
          }
        }
      },
      onFinalResult: (finalText: string) => {
        const processed = applyWordReplacements(finalText, replacementsRef.current);
        const { insertedSegment } = store.appendFinalSegment(processed);
        if (insertedSegment && editorRef.current) {
          const el = editorRef.current;
          const base = committedTextRef.current;
          const needsSpace = base.length > 0 && !/\s$/.test(base);
          committedTextRef.current = base + (needsSpace ? ' ' : '') + insertedSegment;
          el.value = committedTextRef.current;
          el.scrollTop = el.scrollHeight;
        }
        updateWordCount();
      },
      onError: (err: RecognitionErrorEvent) => {
        store.setStatus('error', err.message);
      },
    });
    engineRef.current = engine;

    const unsubscribe = store.subscribe((nextState) => {
      setState(nextState);
    });

    if (editorRef.current) {
      editorRef.current.focus();
    }

    return () => {
      unsubscribe();
      engine.dispose();
    };
  }, []);

  const updateWordCount = () => {
    const text = editorRef.current?.value || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    setWordCount(words);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    committedTextRef.current = e.target.value;
    updateWordCount();
  };

  const handleToggle = () => {
    engineRef.current?.toggle();
  };

  const handleClear = () => {
    storeRef.current?.clearSession();
    committedTextRef.current = '';
    if (editorRef.current) {
      editorRef.current.value = '';
      editorRef.current.focus();
    }
    setWordCount(0);
  };

  const handleCopy = () => {
    const text = editorRef.current?.value || '';
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleApplyReplaceInText = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const fromText = newFrom.trim();
    const toText = newTo;
    if (!fromText) return;

    // 1. Add to active replacement rules if not already present
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

    // 2. Immediately replace inside the right side editor textarea
    if (editorRef.current) {
      const currentVal = committedTextRef.current || editorRef.current.value;
      const replacedVal = applyWordReplacements(currentVal, [{ from: fromText, to: toText }]);
      committedTextRef.current = replacedVal;
      editorRef.current.value = replacedVal;
      storeRef.current?.clearSession();
      storeRef.current?.appendFinalSegment(replacedVal);
      updateWordCount();
    }

    setNewFrom('');
    setNewTo('');
  };

  const handleRemoveReplacement = (index: number) => {
    setReplacements((prev) => prev.filter((_, i) => i !== index));
  };

  const isListening = state.status === 'listening' || state.status === 'starting';
  const hasInterim = Boolean(state.interimText && state.interimText.trim().length > 0);
  const isSpeaking = isListening && hasInterim;

  return (
    <div className={`easy-layout theme-${theme}`}>
      {/* Top Header */}
      <header className="easy-header">
        <div className="brand">
          <img src="assets/icon32.png" alt="Logo" width="28" height="28" />
          <span>VoiceText</span>
          <span className="version-pill" style={{ fontSize: '11px', fontWeight: 700, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '10px', padding: '1px 7px' }}>v1.0.0</span>
        </div>

        <div className="header-actions">
          <button
            className="theme-toggle-btn"
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          >
            {theme === 'dark' ? (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"></circle>
                  <line x1="12" y1="1" x2="12" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="23"></line>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                  <line x1="1" y1="12" x2="3" y2="12"></line>
                  <line x1="21" y1="12" x2="23" y2="12"></line>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
                <span>Light</span>
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
                <span>Dark</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="extension-btn"
            style={{ background: '#059669', borderColor: '#10b981', color: '#ffffff' }}
            onClick={handleInstallApp}
            title="Open or install VoiceText as a standalone PC application without Chrome tabs or address bar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            App Window Mode
          </button>
          <a
            href="/download/extension.zip"
            download="universal-voice-to-text-extension.zip"
            className="extension-btn"
            title="Download Chrome/Edge extension (.zip)"
          >
            Download Extension (v1.0.0)
          </a>
        </div>
      </header>

      {/* Main Two-Column Workspace: Left Sidebar Controls + Right Text Notepad */}
      <div className="workspace-container">
        {/* Left Sidebar Controls */}
        <aside className="sidebar-left">
          {/* Top Section: Word Replacement Card */}
          <div className="sidebar-section replacement-card">
            <span className="section-label">Word Replacement</span>
            <form className="replace-form" onSubmit={handleApplyReplaceInText}>
              <div className="form-field">
                <label>Find Word</label>
                <input
                  type="text"
                  placeholder="e.g. 805 Health Care"
                  value={newFrom}
                  onChange={(e) => setNewFrom(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>Replace With</label>
                <input
                  type="text"
                  placeholder="e.g. ata-healthcare"
                  value={newTo}
                  onChange={(e) => setNewTo(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="replace-btn"
                disabled={!newFrom.trim()}
              >
                Replace
              </button>
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
                    }}
                    title="Clear all replacement rules"
                  >
                    Clear All
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
                        title="Delete rule"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Right Document Editor with internal toolbar */}
        <main className="editor-main">
          <div className="editor-container">
            {/* Editor Toolbar with Word Count, Live Streaming Status, Copy Text, and Clear All */}
            <div className="editor-toolbar">
              <div className="editor-meta">
                <span className="editor-title">Text Document</span>
                <span className="meta-word-count">
                  {wordCount} {wordCount === 1 ? 'word' : 'words'}
                </span>
                {isListening && (
                  <span className={`live-stream-indicator ${state.interimText ? 'streaming' : 'idle'}`}>
                    <span className="stream-dot" />
                    {state.interimText ? 'Live Streaming' : 'Listening...'}
                  </span>
                )}
              </div>
              <div className="editor-actions">
                <button
                  className="editor-btn copy-btn"
                  onClick={handleCopy}
                  disabled={!editorRef.current?.value}
                >
                  {copied ? '✓ Copied' : 'Copy Text'}
                </button>
                <button
                  className="editor-btn clear-btn"
                  onClick={handleClear}
                  disabled={!editorRef.current?.value}
                >
                  Clear All
                </button>
              </div>
            </div>

            <textarea
              ref={editorRef}
              className="document-textarea"
              placeholder="Click Start Recording at the bottom, then speak naturally. Your spoken words will automatically appear right here in real time..."
              onChange={handleTextareaChange}
              defaultValue=""
            />
          </div>
        </main>
      </div>

      {/* Floating Bottom Microphone Dock - Centered in the middle of the website */}
      <div className="floating-mic-dock">
        <div className={`mic-pill-container ${isListening ? 'listening' : ''} ${isSpeaking ? 'speaking-alarm-active' : ''}`}>
          <button
            className={`big-mic-btn ${isListening ? 'recording' : ''} ${isSpeaking ? 'speaking-pulsing' : ''}`}
            onClick={handleToggle}
            title={isListening ? 'Click to Stop' : 'Click to Speak'}
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
            <div className="mic-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: isSpeaking ? '#38bdf8' : isListening ? '#f87171' : '#ffffff' }}>
                {isSpeaking ? 'Speaking...' : isListening ? 'Listening...' : 'Tap to Record'}
              </span>
              {isSpeaking && (
                <span style={{ fontSize: '9px', fontWeight: 800, color: '#ffffff', background: '#0284c7', borderRadius: '4px', padding: '1px 5px', letterSpacing: '0.04em' }}>
                  SPEAKING
                </span>
              )}
            </div>
            <div className="mic-hint">
              {isSpeaking ? (
                <span style={{ color: '#67e8f9', fontWeight: 600 }}>&ldquo;{state.interimText}&rdquo;</span>
              ) : isListening ? (
                'Listening... speak naturally'
              ) : (
                'Click mic or Start to begin speaking'
              )}
            </div>
          </div>

          {/* Sound Wave */}
          {isListening && (
            <SoundWave
              isListening={isListening}
              hasSpeechActivity={isSpeaking}
            />
          )}

          <button
            className={`dock-action-btn ${isListening ? 'stop' : 'start'}`}
            onClick={handleToggle}
          >
            {isListening ? 'Stop' : 'Start Recording'}
          </button>
        </div>
      </div>
    </div>
  );
};
