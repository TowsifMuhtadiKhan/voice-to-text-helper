import React, { useEffect, useRef, useState } from 'react';
import { InMemorySessionStore, SessionState } from '../../shared/session-store';
import {
  RecognitionErrorEvent,
  RecognitionStatus,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
} from '../../shared/speech-interface';
import { WebSpeechRecognitionEngine } from '../../shared/web-speech-engine';
import {
  applyWordReplacements,
  DEFAULT_REPLACEMENTS,
  WordReplacement,
} from '../../shared/word-replacer';
import {
  cleanText,
  computeTextStatistics,
  convertTextCase,
  formatList,
  TextCaseType,
  TextCleaningAction,
  TextStatistics,
} from '../../shared/text-tools';
import {
  checkVoiceCommand,
  processInlineVoicePunctuation,
} from '../../shared/voice-commands';
import {
  exportAsMarkdown,
  exportAsPdf,
  exportAsTxt,
} from '../../shared/export-utils';
import { SoundWave } from './SoundWave';
import { MicTester } from './MicTester';

type NavSection = 'workspace' | 'text-tools' | 'voice-tools' | 'export' | 'settings';

export const WebApp: React.FC = () => {
  const storeRef = useRef<InMemorySessionStore | null>(null);
  const engineRef = useRef<WebSpeechRecognitionEngine | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  if (!storeRef.current) {
    storeRef.current = new InMemorySessionStore('Ctrl+Shift+Space', 'en-US');
  }

  // Navigation & View
  const [activeNav, setActiveNav] = useState<NavSection>('workspace');
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Core Session State
  const [state, setState] = useState<SessionState>(() => storeRef.current!.getState());
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [copied, setCopied] = useState<boolean>(false);
  const [stats, setStats] = useState<TextStatistics>({
    wordCount: 0,
    charCount: 0,
    charCountNoSpaces: 0,
    sentenceCount: 0,
    paragraphCount: 0,
    readingTimeMinutes: 0,
    speakingTimeMinutes: 0,
  });

  // Recording Time & Speed
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const recordingTimerRef = useRef<any>(null);

  // Settings & Preferences
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('en-US');
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [fontSize, setFontSize] = useState<number>(18);
  const [autoCopyOnStop, setAutoCopyOnStop] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [voiceCommandsEnabled, setVoiceCommandsEnabled] = useState<boolean>(true);
  const [silencePauseEnabled, setSilencePauseEnabled] = useState<boolean>(false);

  // Word Replacements
  const [replacements, setReplacements] = useState<WordReplacement[]>(() => {
    return [...DEFAULT_REPLACEMENTS];
  });
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [newWholeWord, setNewWholeWord] = useState(true);
  const [newCaseSensitive, setNewCaseSensitive] = useState(false);

  // Find and Replace Tool
  const [findQuery, setFindQuery] = useState('');
  const [replaceTarget, setReplaceTarget] = useState('');
  const [findMatchCase, setFindMatchCase] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [matchCount, setMatchCount] = useState<number>(0);

  // PWA Install Prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  const replacementsRef = useRef<WordReplacement[]>(replacements);
  replacementsRef.current = replacements;
  const committedTextRef = useRef<string>('');
  const voiceCommandsRef = useRef<boolean>(voiceCommandsEnabled);
  voiceCommandsRef.current = voiceCommandsEnabled;
  const autoCopyRef = useRef<boolean>(autoCopyOnStop);
  autoCopyRef.current = autoCopyOnStop;
  const lastSpeechTimeRef = useRef<number>(Date.now());

  // Listen for PWA install prompt
  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  // Enumerate Audio Devices
  useEffect(() => {
    async function getDevices() {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const mics = devices.filter((d) => d.kind === 'audioinput');
          setAudioDevices(mics);
        } catch {
          // Ignore
        }
      }
    }
    getDevices();
  }, []);

  // Main Speech Engine Lifecycle
  useEffect(() => {
    const store = storeRef.current!;

    const engine = new WebSpeechRecognitionEngine({
      onStatusChange: (status: RecognitionStatus) => {
        store.setStatus(status);

        if (status === 'listening') {
          lastSpeechTimeRef.current = Date.now();
          if (!recordingTimerRef.current) {
            recordingTimerRef.current = setInterval(() => {
              setRecordingSeconds((prev) => prev + 1);
            }, 1000);
          }
        } else if (status === 'stopped' || status === 'idle' || status === 'error') {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          if (editorRef.current) {
            editorRef.current.value = committedTextRef.current;
            updateStats();
          }
          if (autoCopyRef.current && committedTextRef.current) {
            navigator.clipboard.writeText(committedTextRef.current).catch(() => {});
          }
        } else if (status === 'paused') {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
        }
      },

      onInterimResult: (interimText: string) => {
        lastSpeechTimeRef.current = Date.now();
        store.setInterimText(interimText);

        if (editorRef.current) {
          const el = editorRef.current;
          let processedInterim = interimText;
          if (voiceCommandsRef.current) {
            processedInterim = processInlineVoicePunctuation(processedInterim);
          }
          processedInterim = applyWordReplacements(processedInterim, replacementsRef.current);

          if (processedInterim) {
            const base = committedTextRef.current;
            const needsSpace = base.length > 0 && !/\s$/.test(base);
            el.value = base + (needsSpace ? ' ' : '') + processedInterim;
            if (autoScroll) {
              el.scrollTop = el.scrollHeight;
            }
            updateStats();
          }
        }
      },

      onFinalResult: (finalText: string) => {
        lastSpeechTimeRef.current = Date.now();

        // 1. Check standalone Voice Commands
        if (voiceCommandsRef.current) {
          const command = checkVoiceCommand(finalText);
          if (command) {
            handleExecuteVoiceCommand(command.type);
            return;
          }
        }

        // 2. Process inline punctuation & word replacements
        let processed = finalText;
        if (voiceCommandsRef.current) {
          processed = processInlineVoicePunctuation(processed);
        }
        processed = applyWordReplacements(processed, replacementsRef.current);

        // 3. Commit to session store and editor
        const { insertedSegment } = store.appendFinalSegment(processed);
        if (insertedSegment && editorRef.current) {
          const el = editorRef.current;
          const base = committedTextRef.current;
          const needsSpace = base.length > 0 && !/\s$/.test(base) && !insertedSegment.startsWith('\n');
          committedTextRef.current = base + (needsSpace ? ' ' : '') + insertedSegment;
          el.value = committedTextRef.current;
          if (autoScroll) {
            el.scrollTop = el.scrollHeight;
          }
        }
        updateStats();
      },

      onError: (err: RecognitionErrorEvent) => {
        store.setStatus('error', err.message);
      },
    }, selectedLanguage);

    engineRef.current = engine;

    const unsubscribe = store.subscribe((nextState) => {
      setState(nextState);
    });

    if (editorRef.current) {
      editorRef.current.focus();
    }

    return () => {
      unsubscribe();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      engine.dispose();
    };
  }, [selectedLanguage]);

  // Silence Monitor (Optional automatic pause on prolonged inactivity)
  useEffect(() => {
    if (!silencePauseEnabled) return;
    const interval = setInterval(() => {
      if (state.status === 'listening') {
        const elapsedSinceSpeech = Date.now() - lastSpeechTimeRef.current;
        if (elapsedSinceSpeech > 25000) {
          // Pause recording after 25s of complete silence
          engineRef.current?.pause();
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [silencePauseEnabled, state.status]);

  const updateStats = () => {
    const text = editorRef.current?.value || '';
    setStats(computeTextStatistics(text));
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    committedTextRef.current = e.target.value;
    updateStats();
  };

  const handleToggle = () => {
    engineRef.current?.toggle();
  };

  const handlePause = () => {
    engineRef.current?.pause();
  };

  const handleResume = () => {
    engineRef.current?.resume();
  };

  const handleClear = () => {
    if (editorRef.current && editorRef.current.value.trim().length > 0) {
      if (!window.confirm('Are you sure you want to clear the entire transcription?')) {
        return;
      }
    }
    storeRef.current?.clearSession();
    committedTextRef.current = '';
    setRecordingSeconds(0);
    if (editorRef.current) {
      editorRef.current.value = '';
      editorRef.current.focus();
    }
    updateStats();
  };

  const handleCopy = () => {
    const text = editorRef.current?.value || '';
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSelectAll = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      editorRef.current.select();
    }
  };

  // Keyboard Shortcuts (Section 5.6)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Focus Editor: Alt+E
      if (e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        editorRef.current?.focus();
      }
      // Toggle Text Tools: Alt+T
      if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        setActiveNav((prev) => (prev === 'text-tools' ? 'workspace' : 'text-tools'));
      }
      // Pause/Resume: Alt+P
      if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (state.status === 'listening') {
          handlePause();
        } else if (state.status === 'paused') {
          handleResume();
        }
      }
      // Fullscreen / Focus Mode: F11 or Alt+F
      if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setFocusMode((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.status]);

  // Voice Command Dispatcher
  const handleExecuteVoiceCommand = (type: string) => {
    const el = editorRef.current;
    if (!el) return;

    if (type === 'new-line') {
      committedTextRef.current += '\n';
      el.value = committedTextRef.current;
    } else if (type === 'new-paragraph') {
      committedTextRef.current += '\n\n';
      el.value = committedTextRef.current;
    } else if (type === 'copy-text') {
      handleCopy();
    } else if (type === 'select-all') {
      handleSelectAll();
    } else if (type === 'clear-text') {
      handleClear();
    }
    updateStats();
  };

  // Text Case Transformation
  const handleApplyCase = (type: TextCaseType) => {
    const el = editorRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const fullText = el.value;

    if (start !== end && start !== null && end !== null) {
      // Apply to selected text
      const selected = fullText.substring(start, end);
      const converted = convertTextCase(selected, type);
      const newText = fullText.substring(0, start) + converted + fullText.substring(end);
      committedTextRef.current = newText;
      el.value = newText;
      el.setSelectionRange(start, start + converted.length);
    } else {
      // Apply to full document
      const converted = convertTextCase(fullText, type);
      committedTextRef.current = converted;
      el.value = converted;
    }
    updateStats();
  };

  // Text Cleaning Transformation
  const handleApplyClean = (action: TextCleaningAction) => {
    const el = editorRef.current;
    if (!el || !el.value) return;

    const cleaned = cleanText(el.value, action);
    committedTextRef.current = cleaned;
    el.value = cleaned;
    updateStats();
  };

  // List Transformation
  const handleApplyList = (type: 'bullet' | 'numbered' | 'remove') => {
    const el = editorRef.current;
    if (!el || !el.value) return;

    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? el.value.length;
    const fullText = el.value;

    if (start !== end) {
      const selected = fullText.substring(start, end);
      const formatted = formatList(selected, type);
      const newText = fullText.substring(0, start) + formatted + fullText.substring(end);
      committedTextRef.current = newText;
      el.value = newText;
    } else {
      const formatted = formatList(fullText, type);
      committedTextRef.current = formatted;
      el.value = formatted;
    }
    updateStats();
  };

  // Advanced Find and Replace
  const handleFindCount = () => {
    if (!findQuery || !editorRef.current) {
      setMatchCount(0);
      return;
    }
    const text = editorRef.current.value;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startB = findWholeWord ? '\\b' : '';
    const endB = findWholeWord ? '\\b' : '';
    const flags = findMatchCase ? 'g' : 'gi';
    const regex = new RegExp(`${startB}${escaped}${endB}`, flags);
    const matches = text.match(regex);
    setMatchCount(matches ? matches.length : 0);
  };

  useEffect(() => {
    handleFindCount();
  }, [findQuery, findMatchCase, findWholeWord]);

  const handleReplaceNext = () => {
    if (!findQuery || !editorRef.current) return;
    const el = editorRef.current;
    const text = el.value;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startB = findWholeWord ? '\\b' : '';
    const endB = findWholeWord ? '\\b' : '';
    const flags = findMatchCase ? '' : 'i';
    const regex = new RegExp(`${startB}${escaped}${endB}`, flags);

    const newText = text.replace(regex, replaceTarget);
    committedTextRef.current = newText;
    el.value = newText;
    updateStats();
    handleFindCount();
  };

  const handleReplaceAll = () => {
    if (!findQuery || !editorRef.current) return;
    const el = editorRef.current;
    const text = el.value;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startB = findWholeWord ? '\\b' : '';
    const endB = findWholeWord ? '\\b' : '';
    const flags = findMatchCase ? 'g' : 'gi';
    const regex = new RegExp(`${startB}${escaped}${endB}`, flags);

    const newText = text.replace(regex, replaceTarget);
    committedTextRef.current = newText;
    el.value = newText;
    updateStats();
    handleFindCount();
  };

  // Custom Word Replacement Rules Management
  const handleAddReplacement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFrom.trim()) return;

    const newRule: WordReplacement = {
      id: String(Date.now()),
      from: newFrom.trim(),
      to: newTo,
      enabled: true,
      caseSensitive: newCaseSensitive,
      wholeWord: newWholeWord,
    };

    setReplacements((prev) => [...prev, newRule]);
    setNewFrom('');
    setNewTo('');
  };

  const handleToggleRule = (index: number) => {
    setReplacements((prev) =>
      prev.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleDeleteRule = (index: number) => {
    setReplacements((prev) => prev.filter((_, i) => i !== index));
  };

  // Change Language
  const handleLanguageChange = (code: SupportedLanguage) => {
    setSelectedLanguage(code);
    engineRef.current?.setLanguage(code);
    storeRef.current?.setLanguage(code);
  };

  // PWA Installation Trigger
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

  // Speaking state detection
  const isListening = state.status === 'listening' || state.status === 'starting';
  const isPaused = state.status === 'paused';
  const hasInterim = Boolean(state.interimText && state.interimText.trim().length > 0);
  const isSpeaking = isListening && hasInterim;

  // Words per minute calculation
  const wordsPerMinute = recordingSeconds > 0 ? Math.round((stats.wordCount / (recordingSeconds / 60))) : 0;
  const formattedDuration = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`;

  // Recording status display label
  const statusLabel = (() => {
    switch (state.status) {
      case 'listening':
        return isSpeaking ? 'Speaking...' : 'Listening';
      case 'paused':
        return 'Paused';
      case 'starting':
        return 'Connecting...';
      case 'mic-blocked':
        return 'Microphone Blocked';
      case 'mic-disconnected':
        return 'Microphone Disconnected';
      case 'unavailable':
        return 'Recognition Unavailable';
      case 'stopped':
        return 'Stopped';
      case 'error':
        return state.errorMessage || 'Error';
      default:
        return 'Ready';
    }
  })();

  return (
    <div className={`easy-layout theme-${theme} ${focusMode ? 'focus-mode' : ''}`}>
      {/* Top Header */}
      {!focusMode && (
        <header className="easy-header">
          <div className="brand">
            <button
              type="button"
              className="mobile-menu-toggle"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              title="Toggle sidebar menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <img src="assets/icon32.png" alt="Logo" width="28" height="28" />
            <span className="brand-name">VoiceText</span>
            <span className="version-pill">v2.0</span>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            >
              {theme === 'dark' ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                  </svg>
                  <span>Dark</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="extension-btn app-window-btn"
              onClick={handleInstallApp}
              title="Open or install VoiceText as a standalone PC application without Chrome tabs"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: '6px' }}>
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
              Download Extension
            </a>
          </div>
        </header>
      )}

      {/* Main Container: Collapsible Sidebar + Editor */}
      <div className="workspace-container">
        {/* Left Sidebar Navigation & Functional Panels */}
        {!focusMode && (
          <aside className={`sidebar-left ${mobileMenuOpen ? 'mobile-open' : ''}`}>
            {/* Navigation Tabs (5 Defined Sections) */}
            <nav className="sidebar-nav-tabs">
              <button
                type="button"
                className={`nav-tab-btn ${activeNav === 'workspace' ? 'active' : ''}`}
                onClick={() => { setActiveNav('workspace'); setMobileMenuOpen(false); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <span>Workspace</span>
              </button>

              <button
                type="button"
                className={`nav-tab-btn ${activeNav === 'text-tools' ? 'active' : ''}`}
                onClick={() => { setActiveNav('text-tools'); setMobileMenuOpen(false); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 7 4 4 20 4 20 7" />
                  <line x1="9" y1="20" x2="15" y2="20" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
                <span>Text Tools</span>
              </button>

              <button
                type="button"
                className={`nav-tab-btn ${activeNav === 'voice-tools' ? 'active' : ''}`}
                onClick={() => { setActiveNav('voice-tools'); setMobileMenuOpen(false); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                <span>Voice Tools</span>
              </button>

              <button
                type="button"
                className={`nav-tab-btn ${activeNav === 'export' ? 'active' : ''}`}
                onClick={() => { setActiveNav('export'); setMobileMenuOpen(false); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Export & Share</span>
              </button>

              <button
                type="button"
                className={`nav-tab-btn ${activeNav === 'settings' ? 'active' : ''}`}
                onClick={() => { setActiveNav('settings'); setMobileMenuOpen(false); }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Settings</span>
              </button>
            </nav>

            {/* SECTION 1: WORKSPACE SIDEBAR PANEL */}
            {activeNav === 'workspace' && (
              <div className="sidebar-content-panel">
                <div className="panel-card">
                  <span className="panel-card-title">Live Session Statistics</span>
                  <div className="stats-grid">
                    <div className="stat-box">
                      <span className="stat-num">{stats.wordCount}</span>
                      <span className="stat-label">Words</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-num">{stats.charCount}</span>
                      <span className="stat-label">Characters</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-num">{stats.charCountNoSpaces}</span>
                      <span className="stat-label">Chars (no space)</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-num">{stats.paragraphCount}</span>
                      <span className="stat-label">Paragraphs</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-num">{formattedDuration}</span>
                      <span className="stat-label">Duration</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-num">{wordsPerMinute}</span>
                      <span className="stat-label">Words / Min</span>
                    </div>
                  </div>
                </div>

                {/* Quick Word Replacements Card */}
                <div className="panel-card">
                  <span className="panel-card-title">Word Replacement</span>
                  <form className="replace-form" onSubmit={handleAddReplacement}>
                    <div className="form-field">
                      <label>Find Word / Phrase</label>
                      <input
                        type="text"
                        placeholder="e.g. 805 health care"
                        value={newFrom}
                        onChange={(e) => setNewFrom(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label>Replace With</label>
                      <input
                        type="text"
                        placeholder="e.g. 805 HealthCare"
                        value={newTo}
                        onChange={(e) => setNewTo(e.target.value)}
                      />
                    </div>
                    <button type="submit" className="action-submit-btn" disabled={!newFrom.trim()}>
                      Add Replacement Rule
                    </button>
                  </form>

                  {replacements.length > 0 && (
                    <div className="rules-chip-list">
                      {replacements.map((r, i) => (
                        <div key={i} className={`rule-chip ${r.enabled === false ? 'disabled' : ''}`}>
                          <input
                            type="checkbox"
                            checked={r.enabled !== false}
                            onChange={() => handleToggleRule(i)}
                            title="Toggle rule"
                          />
                          <span className="rule-from">{r.from}</span>
                          <span className="rule-arrow">&rarr;</span>
                          <span className="rule-to">{r.to || '""'}</span>
                          <button
                            type="button"
                            className="rule-del"
                            onClick={() => handleDeleteRule(i)}
                            title="Delete rule"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 2: TEXT TOOLS PANEL */}
            {activeNav === 'text-tools' && (
              <div className="sidebar-content-panel">
                {/* Advanced Find & Replace */}
                <div className="panel-card">
                  <span className="panel-card-title">Advanced Find & Replace</span>
                  <div className="form-field">
                    <label>Find</label>
                    <input
                      type="text"
                      placeholder="Word or phrase..."
                      value={findQuery}
                      onChange={(e) => setFindQuery(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>Replace With</label>
                    <input
                      type="text"
                      placeholder="New text..."
                      value={replaceTarget}
                      onChange={(e) => setReplaceTarget(e.target.value)}
                    />
                  </div>

                  <div className="checkbox-row">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={findMatchCase}
                        onChange={(e) => setFindMatchCase(e.target.checked)}
                      />
                      Match Case
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={findWholeWord}
                        onChange={(e) => setFindWholeWord(e.target.checked)}
                      />
                      Whole Word
                    </label>
                  </div>

                  {findQuery && (
                    <div className="find-matches-count">
                      {matchCount} {matchCount === 1 ? 'match found' : 'matches found'}
                    </div>
                  )}

                  <div className="button-group-row">
                    <button
                      type="button"
                      className="sub-btn"
                      onClick={handleReplaceNext}
                      disabled={!findQuery}
                    >
                      Replace Next
                    </button>
                    <button
                      type="button"
                      className="sub-btn primary"
                      onClick={handleReplaceAll}
                      disabled={!findQuery}
                    >
                      Replace All
                    </button>
                  </div>
                </div>

                {/* Text Case Conversion */}
                <div className="panel-card">
                  <span className="panel-card-title">Change Text Case</span>
                  <div className="btn-grid-2">
                    <button type="button" className="tool-chip-btn" onClick={() => handleApplyCase('upper')}>
                      UPPERCASE
                    </button>
                    <button type="button" className="tool-chip-btn" onClick={() => handleApplyCase('lower')}>
                      lowercase
                    </button>
                    <button type="button" className="tool-chip-btn" onClick={() => handleApplyCase('title')}>
                      Title Case
                    </button>
                    <button type="button" className="tool-chip-btn" onClick={() => handleApplyCase('sentence')}>
                      Sentence case
                    </button>
                    <button type="button" className="tool-chip-btn full" onClick={() => handleApplyCase('capitalize')}>
                      Capitalize Each Word
                    </button>
                  </div>
                </div>

                {/* Text Cleaning Utilities */}
                <div className="panel-card">
                  <span className="panel-card-title">Text Cleaning Utilities</span>
                  <div className="cleaning-btn-list">
                    <button type="button" className="tool-list-btn" onClick={() => handleApplyClean('remove-extra-spaces')}>
                      Remove extra spaces
                    </button>
                    <button type="button" className="tool-list-btn" onClick={() => handleApplyClean('remove-blank-lines')}>
                      Remove unnecessary blank lines
                    </button>
                    <button type="button" className="tool-list-btn" onClick={() => handleApplyClean('trim')}>
                      Trim leading/trailing whitespace
                    </button>
                    <button type="button" className="tool-list-btn" onClick={() => handleApplyClean('remove-duplicate-words')}>
                      Remove duplicate adjacent words
                    </button>
                    <button type="button" className="tool-list-btn" onClick={() => handleApplyClean('remove-repeated-punct')}>
                      Remove repeated punctuation
                    </button>
                    <button type="button" className="tool-list-btn" onClick={() => handleApplyClean('tabs-to-spaces')}>
                      Convert tabs into spaces
                    </button>
                    <button type="button" className="tool-list-btn" onClick={() => handleApplyClean('paragraphs-to-single')}>
                      Convert multiple paragraphs to single text
                    </button>
                  </div>
                </div>

                {/* Lists and Formatting */}
                <div className="panel-card">
                  <span className="panel-card-title">Lists & Formatting</span>
                  <div className="btn-grid-2">
                    <button type="button" className="tool-chip-btn" onClick={() => handleApplyList('bullet')}>
                      • Bullet List
                    </button>
                    <button type="button" className="tool-chip-btn" onClick={() => handleApplyList('numbered')}>
                      1. Numbered List
                    </button>
                    <button type="button" className="tool-chip-btn full" onClick={() => handleApplyList('remove')}>
                      Remove List Formatting
                    </button>
                  </div>
                </div>

                {/* Local Text Analysis */}
                <div className="panel-card">
                  <span className="panel-card-title">Detailed Text Analysis</span>
                  <div className="analysis-list">
                    <div className="analysis-row">
                      <span>Total Sentences:</span> <strong>{stats.sentenceCount}</strong>
                    </div>
                    <div className="analysis-row">
                      <span>Total Paragraphs:</span> <strong>{stats.paragraphCount}</strong>
                    </div>
                    <div className="analysis-row">
                      <span>Estimated Reading Time:</span> <strong>~{stats.readingTimeMinutes} min</strong>
                    </div>
                    <div className="analysis-row">
                      <span>Estimated Speaking Time:</span> <strong>~{stats.speakingTimeMinutes} min</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 3: VOICE TOOLS PANEL */}
            {activeNav === 'voice-tools' && (
              <div className="sidebar-content-panel">
                {/* Language Selection */}
                <div className="panel-card">
                  <span className="panel-card-title">Speech Recognition Language</span>
                  <div className="form-field">
                    <select
                      className="form-select"
                      value={selectedLanguage}
                      onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                    >
                      {SUPPORTED_LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="field-hint">Uses native browser speech recognition for the selected language.</span>
                </div>

                {/* Microphone Selection */}
                <div className="panel-card">
                  <span className="panel-card-title">Microphone Selection</span>
                  <div className="form-field">
                    <select
                      className="form-select"
                      value={selectedDeviceId}
                      onChange={(e) => setSelectedDeviceId(e.target.value)}
                    >
                      <option value="">Default Microphone</option>
                      {audioDevices.map((d, i) => (
                        <option key={d.deviceId || i} value={d.deviceId}>
                          {d.label || `Microphone ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Live Microphone Hardware Test */}
                <div className="panel-card">
                  <MicTester selectedDeviceId={selectedDeviceId} />
                </div>

                {/* Voice Commands Section */}
                <div className="panel-card">
                  <div className="toggle-header-row">
                    <span className="panel-card-title" style={{ margin: 0 }}>Voice Commands</span>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={voiceCommandsEnabled}
                        onChange={(e) => setVoiceCommandsEnabled(e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                  <span className="field-hint" style={{ marginTop: '4px', marginBottom: '10px' }}>
                    Speak punctuation and commands naturally while dictating:
                  </span>

                  <div className="commands-table">
                    <div className="cmd-row"><code>"New line"</code> &rarr; Inserts line break</div>
                    <div className="cmd-row"><code>"New paragraph"</code> &rarr; Inserts paragraph break</div>
                    <div className="cmd-row"><code>"Comma"</code> &rarr; Inserts ,</div>
                    <div className="cmd-row"><code>"Period"</code> &rarr; Inserts .</div>
                    <div className="cmd-row"><code>"Question mark"</code> &rarr; Inserts ?</div>
                    <div className="cmd-row"><code>"Exclamation mark"</code> &rarr; Inserts !</div>
                    <div className="cmd-row"><code>"Copy text"</code> &rarr; Copies transcript</div>
                    <div className="cmd-row"><code>"Select all"</code> &rarr; Selects editor text</div>
                    <div className="cmd-row"><code>"Clear text"</code> &rarr; Confirms & clears</div>
                  </div>
                </div>

                {/* Silence Detection */}
                <div className="panel-card">
                  <div className="toggle-header-row">
                    <span className="panel-card-title" style={{ margin: 0 }}>Silence Detection</span>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={silencePauseEnabled}
                        onChange={(e) => setSilencePauseEnabled(e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                  <span className="field-hint" style={{ marginTop: '6px' }}>
                    Automatically pauses recognition after 25 seconds of prolonged silence to save battery and memory.
                  </span>
                </div>
              </div>
            )}

            {/* SECTION 4: EXPORT & SHARE PANEL */}
            {activeNav === 'export' && (
              <div className="sidebar-content-panel">
                <div className="panel-card">
                  <span className="panel-card-title">Clipboard Actions</span>
                  <div className="btn-stack">
                    <button type="button" className="action-submit-btn" onClick={handleCopy}>
                      {copied ? '✓ Copied to Clipboard' : 'Copy All Text'}
                    </button>
                    <button type="button" className="sub-btn" onClick={handleSelectAll}>
                      Select All Text
                    </button>
                  </div>

                  <div className="checkbox-row" style={{ marginTop: '12px' }}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={autoCopyOnStop}
                        onChange={(e) => setAutoCopyOnStop(e.target.checked)}
                      />
                      Auto-copy to clipboard when recording stops
                    </label>
                  </div>
                </div>

                <div className="panel-card">
                  <span className="panel-card-title">Export Document</span>
                  <div className="export-btn-list">
                    <button
                      type="button"
                      className="tool-list-btn export-btn"
                      onClick={() => exportAsTxt(editorRef.current?.value || '')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                      <span>Download Plain Text (.txt)</span>
                    </button>

                    <button
                      type="button"
                      className="tool-list-btn export-btn"
                      onClick={() => exportAsMarkdown(editorRef.current?.value || '')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="7 15 10 9 13 15" />
                        <line x1="17" y1="9" x2="17" y2="15" />
                      </svg>
                      <span>Download Markdown (.md)</span>
                    </button>

                    <button
                      type="button"
                      className="tool-list-btn export-btn"
                      onClick={() => exportAsPdf(editorRef.current?.value || '')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9V2h12v7" />
                        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                        <path d="M6 14h12v8H6z" />
                      </svg>
                      <span>Export as PDF Document</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 5: SETTINGS & PRIVACY PANEL */}
            {activeNav === 'settings' && (
              <div className="sidebar-content-panel">
                <div className="panel-card">
                  <span className="panel-card-title">Editor Appearance</span>
                  <div className="form-field">
                    <label>Editor Font Size: {fontSize}px</label>
                    <input
                      type="range"
                      min="14"
                      max="32"
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                    />
                  </div>

                  <div className="checkbox-row" style={{ marginTop: '8px' }}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={autoScroll}
                        onChange={(e) => setAutoScroll(e.target.checked)}
                      />
                      Auto-scroll editor to newly spoken words
                    </label>
                  </div>
                </div>

                <div className="panel-card">
                  <span className="panel-card-title">Keyboard Shortcuts</span>
                  <div className="shortcuts-info-list">
                    <div className="shortcut-item">
                      <span>Start / Stop Dictation</span>
                      <kbd>Ctrl+Shift+Space</kbd>
                    </div>
                    <div className="shortcut-item">
                      <span>Pause / Resume</span>
                      <kbd>Alt+P</kbd>
                    </div>
                    <div className="shortcut-item">
                      <span>Focus Editor</span>
                      <kbd>Alt+E</kbd>
                    </div>
                    <div className="shortcut-item">
                      <span>Open Text Tools</span>
                      <kbd>Alt+T</kbd>
                    </div>
                    <div className="shortcut-item">
                      <span>Fullscreen Focus Mode</span>
                      <kbd>Alt+F</kbd>
                    </div>
                  </div>
                </div>

                <div className="panel-card privacy-card">
                  <span className="panel-card-title">Privacy & Security Guarantee</span>
                  <p className="privacy-text">
                    • <strong>100% Volatile Session:</strong> Transcripts are kept strictly in memory during your active tab session and are wiped when cleared.
                  </p>
                  <p className="privacy-text">
                    • <strong>Zero Persistent Storage:</strong> No database, no cloud storage, and no tracking history.
                  </p>
                  <p className="privacy-text">
                    • <strong>No Generative AI:</strong> Word replacements, formatting, case transformations, and voice commands operate using deterministic algorithms.
                  </p>
                  <p className="privacy-text">
                    • <strong>Audio Processing:</strong> Audio recognition uses the W3C Web Speech API built into your browser. Audio streams are released immediately when stopped.
                  </p>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* Right Transcription Editor Document */}
        <main className={`editor-main ${focusMode ? 'focus' : ''}`}>
          <div className="editor-container">
            {/* Editor Top Toolbar */}
            <div className="editor-toolbar">
              <div className="editor-meta">
                <span className="editor-title">Document</span>
                <span className="meta-word-count">
                  {stats.wordCount} {stats.wordCount === 1 ? 'word' : 'words'}
                </span>
                <span className="meta-word-count">
                  {stats.charCount} chars
                </span>

                {/* Status Indicator */}
                <div className="recording-status-badge">
                  <span
                    className={`status-dot ${isListening ? 'listening' : ''} ${
                      isSpeaking ? 'speaking' : ''
                    } ${isPaused ? 'paused' : ''} ${state.status.startsWith('mic') || state.status === 'error' ? 'error' : ''}`}
                  />
                  <span className="status-label-text">{statusLabel}</span>
                </div>
              </div>

              <div className="editor-actions">
                <button
                  type="button"
                  className="editor-icon-btn"
                  onClick={() => setFocusMode((prev) => !prev)}
                  title={focusMode ? 'Exit Focus Mode (Alt+F)' : 'Expand Editor / Focus Mode (Alt+F)'}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {focusMode ? (
                      <>
                        <polyline points="4 14 10 14 10 20" />
                        <polyline points="20 10 14 10 14 4" />
                        <line x1="14" y1="10" x2="21" y2="3" />
                        <line x1="3" y1="21" x2="10" y2="14" />
                      </>
                    ) : (
                      <>
                        <polyline points="15 3 21 3 21 9" />
                        <polyline points="9 21 3 21 3 15" />
                        <line x1="21" y1="3" x2="14" y2="10" />
                        <line x1="3" y1="21" x2="10" y2="14" />
                      </>
                    )}
                  </svg>
                </button>

                <button
                  type="button"
                  className="editor-btn copy-btn"
                  onClick={handleCopy}
                  title="Copy full transcription"
                  disabled={!editorRef.current?.value}
                >
                  {copied ? '✓ Copied' : 'Copy All'}
                </button>

                <button
                  type="button"
                  className="editor-btn clear-btn"
                  onClick={handleClear}
                  title="Clear document"
                  disabled={!editorRef.current?.value}
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Main Textarea Document */}
            <textarea
              ref={editorRef}
              className="document-textarea"
              style={{ fontSize: `${fontSize}px` }}
              placeholder="Click Start Recording at the bottom, then speak naturally. Your spoken words will automatically appear right here in real time..."
              onChange={handleTextareaChange}
              defaultValue=""
              spellCheck={false}
            />
          </div>
        </main>
      </div>

      {/* Floating Center-Bottom Microphone Control Dock */}
      <div className="floating-mic-dock">
        <div
          className={`mic-pill-container ${isListening ? 'listening' : ''} ${
            isSpeaking ? 'speaking-alarm-active' : ''
          } ${isPaused ? 'paused' : ''}`}
        >
          {/* Main Mic Button */}
          <button
            className={`big-mic-btn ${isListening ? 'recording' : ''} ${
              isSpeaking ? 'speaking-pulsing' : ''
            }`}
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
              <span style={{ color: isSpeaking ? '#38bdf8' : isListening ? '#f87171' : isPaused ? '#fbbf24' : '#ffffff' }}>
                {statusLabel}
              </span>
              {isSpeaking && (
                <span className="speaking-badge">SPEAKING</span>
              )}
            </div>

            <div className="mic-hint">
              {isSpeaking ? (
                <span style={{ color: '#67e8f9', fontWeight: 600 }}>&ldquo;{state.interimText}&rdquo;</span>
              ) : isListening ? (
                'Listening... speak naturally'
              ) : isPaused ? (
                'Recording paused — click Resume'
              ) : (
                'Click mic or Start to begin speaking'
              )}
            </div>
          </div>

          {/* Dynamic Live Sound Wave */}
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
              title="Pause Recording (Alt+P)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
              title="Resume Recording (Alt+P)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}

          {/* Start / Stop Action Button */}
          <button
            className={`dock-action-btn ${isListening ? 'stop' : 'start'}`}
            onClick={handleToggle}
          >
            {isListening ? 'Stop' : isPaused ? 'Stop' : 'Start Recording'}
          </button>
        </div>
      </div>
    </div>
  );
};
