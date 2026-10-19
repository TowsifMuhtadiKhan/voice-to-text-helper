import { RecognitionStatus, SupportedLanguage } from './speech-interface';

export interface SessionState {
  status: RecognitionStatus;
  language: SupportedLanguage;
  /** Currently active interim hypothesis (not yet finalized) */
  interimText: string;
  /** Accumulated finalized text for the current active session only (stored purely in volatile memory) */
  sessionTranscript: string;
  /** Optional error message if status === 'error' or mic blocked/disconnected */
  errorMessage: string | null;
  /** Current shortcut display string */
  shortcut: string;
}

/**
 * Purely in-memory session state manager.
 *
 * Guarantees:
 * - Never persists to localStorage, IndexedDB, cookies, files, or external storage.
 * - Preserves finalized transcript when dictation is stopped or paused.
 * - Shows interim results separately so finalized text is never duplicated.
 * - Clears all transcript data immediately when clearSession() is called.
 */
export class InMemorySessionStore {
  private state: SessionState;
  private listeners: Set<(state: SessionState) => void> = new Set();

  constructor(initialShortcut = 'Ctrl+Shift+Space', initialLanguage: SupportedLanguage = 'en-US') {
    this.state = {
      status: 'idle',
      language: initialLanguage,
      interimText: '',
      sessionTranscript: '',
      errorMessage: null,
      shortcut: initialShortcut,
    };
  }

  public getState(): SessionState {
    return { ...this.state };
  }

  public setStatus(status: RecognitionStatus, errorMessage: string | null = null): SessionState {
    this.state.status = status;
    if (status !== 'listening' && status !== 'paused') {
      this.state.interimText = '';
    }
    this.state.errorMessage = errorMessage;
    this.notify();
    return this.getState();
  }

  public setInterimText(interim: string): SessionState {
    this.state.interimText = interim.trim();
    this.notify();
    return this.getState();
  }

  public appendFinalSegment(rawSegment: string): {
    insertedSegment: string;
    state: SessionState;
  } {
    const cleaned = rawSegment.trim();
    this.state.interimText = '';

    if (!cleaned) {
      this.notify();
      return { insertedSegment: '', state: this.getState() };
    }

    const needsLeadingSpace =
      this.state.sessionTranscript.length > 0 &&
      !this.state.sessionTranscript.endsWith(' ') &&
      !this.state.sessionTranscript.endsWith('\n');

    this.state.sessionTranscript += (needsLeadingSpace ? ' ' : '') + cleaned;
    this.notify();

    return {
      insertedSegment: cleaned,
      state: this.getState(),
    };
  }

  public setLanguage(language: SupportedLanguage): SessionState {
    this.state.language = language;
    this.notify();
    return this.getState();
  }

  public setShortcut(shortcut: string): SessionState {
    this.state.shortcut = shortcut;
    this.notify();
    return this.getState();
  }

  public clearSession(): SessionState {
    this.state.status = 'idle';
    this.state.interimText = '';
    this.state.sessionTranscript = '';
    this.state.errorMessage = null;
    this.notify();
    return this.getState();
  }

  public subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
