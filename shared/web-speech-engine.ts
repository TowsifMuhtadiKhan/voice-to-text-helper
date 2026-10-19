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
 * Supports start, pause, resume, stop, silence detection, and continuous recovery.
 */
export class WebSpeechRecognitionEngine implements ISpeechRecognitionEngine {
  private recognition: SpeechRecognitionInstance | null = null;
  private status: RecognitionStatus = 'idle';
  private language: SupportedLanguage = 'en-US';
  private shouldBeListening = false;
  private isPaused = false;
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
      this.setStatus('unavailable');
      this.callbacks.onError({
        code: 'unsupported',
        message: 'Speech recognition is not supported in this browser.',
      });
      return;
    }

    this.shouldBeListening = true;
    this.isPaused = false;
    this.setStatus('starting');

    if (!this.recognition) {
      this.recognition = this.createRecognitionInstance(SpeechRecognitionCtor);
    }

    this.recognition.lang = this.language;

    try {
      this.recognition.start();
    } catch (err) {
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

  public async pause(): Promise<void> {
    if (!this.shouldBeListening || this.isPaused) return;
    this.isPaused = true;
    this.shouldBeListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
    }
    this.setStatus('paused');
  }

  public async resume(): Promise<void> {
    if (!this.isPaused && this.status !== 'paused') return;
    this.isPaused = false;
    await this.start();
  }

  public async stop(): Promise<void> {
    this.shouldBeListening = false;
    this.isPaused = false;
    if (this.recognition && (this.status === 'listening' || this.status === 'starting' || this.status === 'paused')) {
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
    } else if (this.status === 'paused') {
      await this.resume();
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
    this.isPaused = false;
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
      if (!this.isPaused) {
        this.setStatus('listening');
      }
    };

    instance.onresult = (event: SpeechRecognitionEvent) => {
      if (this.isPaused) return;

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
        this.callbacks.onFinalResult(finalTranscript.trim());
      }

      this.callbacks.onInterimResult(interimTranscript.trim());
    };

    instance.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' && this.shouldBeListening) {
        return;
      }
      if (event.error === 'aborted') {
        if (this.shouldBeListening && !this.isPaused) {
          try {
            this.recognition?.start();
          } catch {
            // Ignore
          }
        }
        return;
      }

      if (event.error === 'network' && this.shouldBeListening && !this.isPaused) {
        this.setStatus('starting');
        setTimeout(() => {
          if (this.shouldBeListening && !this.isPaused && this.recognition) {
            try {
              this.recognition.start();
              return;
            } catch {
              // Ignore
            }
          }
          if (this.shouldBeListening && !this.isPaused) {
            this.setStatus('error');
            this.callbacks.onError({
              code: 'network',
              message: 'Browser speech service connection lost. Please check your internet connection.',
            });
          }
        }, 800);
        return;
      }

      this.shouldBeListening = false;

      let friendlyMessage = event.message || `Speech recognition error: ${event.error}`;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.setStatus('mic-blocked');
        friendlyMessage = 'Microphone access denied. Please click the lock or camera icon in the address bar to allow microphone permission.';
      } else if (event.error === 'audio-capture') {
        this.setStatus('mic-disconnected');
        friendlyMessage = 'No microphone detected or microphone disconnected. Please connect a microphone.';
      } else if (event.error === 'network') {
        this.setStatus('error');
        friendlyMessage = 'Browser speech service connection error. Please check your internet connection.';
      } else {
        this.setStatus('error');
      }

      this.callbacks.onError({
        code: event.error,
        message: friendlyMessage,
      });
    };

    instance.onend = () => {
      if (this.shouldBeListening && !this.isPaused) {
        try {
          instance.start();
          return;
        } catch {
          // Ignore
        }
      }
      if (!this.isPaused && this.status !== 'error' && this.status !== 'idle' && this.status !== 'mic-blocked' && this.status !== 'mic-disconnected') {
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
