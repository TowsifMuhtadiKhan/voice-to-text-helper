import {
  ISpeechRecognitionEngine,
  RecognitionStatus,
  SpeechRecognitionCallbacks,
  SupportedLanguage,
} from './speech-interface';

// Minimal Web Speech API declarations for TypeScript
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

/**
 * Browser Web Speech API implementation of ISpeechRecognitionEngine.
 * Used by the Chrome and Edge Manifest V3 extension.
 *
 * Note: Chrome/Edge Web Speech API sends audio to the browser vendor's speech
 * recognition service. This is disclosed in the extension UI per Section 4.
 */
export class WebSpeechRecognitionEngine implements ISpeechRecognitionEngine {
  private recognition: SpeechRecognitionInstance | null = null;
  private status: RecognitionStatus = 'idle';
  private language: SupportedLanguage = 'en-US';
  private shouldBeListening = false;
  private callbacks: SpeechRecognitionCallbacks;

  constructor(callbacks: SpeechRecognitionCallbacks, initialLanguage: SupportedLanguage = 'en-US') {
    this.callbacks = callbacks;
    this.language = initialLanguage;
  }

  public static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    );
  }

  public async start(): Promise<void> {
    if (this.status === 'listening' || this.status === 'starting') {
      return;
    }

    const SpeechRecognitionCtor =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;

    if (!SpeechRecognitionCtor) {
      this.setStatus('error');
      this.callbacks.onError({
        code: 'unsupported',
        message: 'Speech recognition is not supported in this browser.',
      });
      return;
    }

    this.shouldBeListening = true;
    this.setStatus('starting');

    if (!this.recognition) {
      this.recognition = this.createRecognitionInstance(SpeechRecognitionCtor);
    }

    this.recognition.lang = this.language;

    try {
      this.recognition.start();
    } catch (err) {
      // If already started, ignore or reset
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes('already started')) {
        this.shouldBeListening = false;
        this.setStatus('error');
        this.callbacks.onError({
          code: 'start-failed',
          message,
        });
      }
    }
  }

  public async stop(): Promise<void> {
    this.shouldBeListening = false;
    if (this.recognition && (this.status === 'listening' || this.status === 'starting')) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop errors if already stopped
      }
    }
    this.setStatus('stopped');
  }

  public async toggle(): Promise<void> {
    if (this.status === 'listening' || this.status === 'starting') {
      await this.stop();
    } else {
      await this.start();
    }
  }

  public getStatus(): RecognitionStatus {
    return this.status;
  }

  public setLanguage(language: SupportedLanguage): void {
    this.language = language;
    if (this.recognition) {
      this.recognition.lang = language;
    }
  }

  public getLanguage(): SupportedLanguage {
    return this.language;
  }

  public async dispose(): Promise<void> {
    this.shouldBeListening = false;
    if (this.recognition) {
      this.recognition.onstart = null;
      this.recognition.onend = null;
      this.recognition.onerror = null;
      this.recognition.onresult = null;
      try {
        this.recognition.abort();
      } catch {
        // Ignore abort errors
      }
      this.recognition = null;
    }
    this.setStatus('idle');
  }

  private createRecognitionInstance(
    Ctor: new () => SpeechRecognitionInstance
  ): SpeechRecognitionInstance {
    const instance = new Ctor();
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 1;
    instance.lang = this.language;

    instance.onstart = () => {
      this.setStatus('listening');
    };

    instance.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const rawText = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalTranscript += rawText;
        } else {
          interimTranscript += rawText;
        }
      }

      if (finalTranscript.trim().length > 0) {
        // Emit finalized segment once without altering or rewriting words
        this.callbacks.onFinalResult(finalTranscript.trim());
      }

      // Emit current interim text (empty string if everything in this frame was finalized)
      this.callbacks.onInterimResult(interimTranscript.trim());
    };

    instance.onerror = (event: SpeechRecognitionErrorEvent) => {
      // 'no-speech' during continuous dictation just means silence occurred; keep listening
      if (event.error === 'no-speech' && this.shouldBeListening) {
        return;
      }
      if (event.error === 'aborted' && !this.shouldBeListening) {
        return;
      }

      // Chrome transient network hiccup: automatically attempt recovery if user wanted to keep listening
      if (event.error === 'network' && this.shouldBeListening) {
        this.setStatus('starting');
        setTimeout(() => {
          if (this.shouldBeListening && this.recognition) {
            try {
              this.recognition.start();
              return;
            } catch {
              // Fall through if restart fails
            }
          }
          if (this.shouldBeListening) {
            this.setStatus('error');
            this.callbacks.onError({
              code: 'network',
              message: 'Browser speech service connection lost. Please check internet or use the offline Desktop App.',
            });
          }
        }, 800);
        return;
      }

      this.shouldBeListening = false;
      this.setStatus('error');

      let friendlyMessage = event.message || `Speech recognition error: ${event.error}`;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        friendlyMessage = 'Microphone access denied. Please allow microphone permission in browser.';
      } else if (event.error === 'audio-capture') {
        friendlyMessage = 'No microphone detected. Please connect a microphone.';
      } else if (event.error === 'network') {
        friendlyMessage = 'Browser speech service connection error. Please check your internet connection.';
      }

      this.callbacks.onError({
        code: event.error,
        message: friendlyMessage,
      });
    };

    instance.onend = () => {
      if (this.shouldBeListening) {
        // Automatically resume continuous recognition after browser silence timeout
        try {
          instance.start();
          return;
        } catch {
          // Fall through to stopped state if restart fails
        }
      }
      if (this.status !== 'error' && this.status !== 'idle') {
        this.setStatus('stopped');
      }
    };

    return instance;
  }

  private setStatus(nextStatus: RecognitionStatus): void {
    this.status = nextStatus;
    this.callbacks.onStatusChange(nextStatus);
  }
}
