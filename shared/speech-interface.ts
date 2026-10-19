/**
 * Supported recognition languages.
 * English ('en-US') is enabled initially.
 * The interface is designed to support Bangla ('bn-BD') seamlessly.
 */
export type SupportedLanguage = 'en-US' | 'bn-BD';

export interface LanguageOption {
  code: SupportedLanguage;
  label: string;
  enabled: boolean;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en-US', label: 'English (US)', enabled: true },
  { code: 'bn-BD', label: 'Bangla (বাংলা)', enabled: false }, // Ready for future activation
];

export type RecognitionStatus = 'idle' | 'starting' | 'listening' | 'stopped' | 'error';

export interface TranscriptUpdateEvent {
  /** Interim (in-progress) recognized text that has not yet been finalized */
  interimText: string;
  /** Finalized recognized segment (only present when a phrase/utterance is committed) */
  finalizedSegment?: string;
  /** Full accumulated finalized transcript for the current temporary session */
  sessionTranscript: string;
}

export interface RecognitionErrorEvent {
  code: string;
  message: string;
}

export interface SpeechRecognitionCallbacks {
  onStatusChange: (status: RecognitionStatus) => void;
  onInterimResult: (interimText: string) => void;
  onFinalResult: (finalText: string) => void;
  onError: (error: RecognitionErrorEvent) => void;
}

/**
 * Unified Speech Recognition Engine Interface
 * Used across both the Chrome/Edge Browser Extension and the Electron Desktop Application.
 *
 * Strictly speech-to-text only:
 * - Preserves original recognized words verbatim.
 * - Never rewrites sentences or generates artificial content.
 */
export interface ISpeechRecognitionEngine {
  /** Start capturing microphone audio and recognizing speech */
  start(): Promise<void>;

  /** Stop capturing audio while keeping the current session transcript intact */
  stop(): Promise<void>;

  /** Toggle between listening and stopped states */
  toggle(): Promise<void>;

  /** Get current recognition status */
  getStatus(): RecognitionStatus;

  /** Set recognition language ('en-US' initially, structured for 'bn-BD' later) */
  setLanguage(language: SupportedLanguage): void;

  /** Get currently configured language */
  getLanguage(): SupportedLanguage;

  /** Clean up resources when the session is explicitly closed */
  dispose(): Promise<void>;
  /** Configure active word replacement rules */
  setReplacements?(replacements: any[]): void;
}
