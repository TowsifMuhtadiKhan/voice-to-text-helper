/**
 * Supported recognition languages.
 */
export type SupportedLanguage =
  | 'en-US'
  | 'en-GB'
  | 'bn-BD'
  | 'hi-IN'
  | 'ar-SA'
  | 'es-ES'
  | 'fr-FR';

export interface LanguageOption {
  code: SupportedLanguage;
  label: string;
  enabled: boolean;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en-US', label: 'English (US)', enabled: true },
  { code: 'en-GB', label: 'English (UK)', enabled: true },
  { code: 'bn-BD', label: 'Bengali / বাংলা (BD)', enabled: true },
  { code: 'hi-IN', label: 'Hindi / हिन्दी (IN)', enabled: true },
  { code: 'ar-SA', label: 'Arabic / العربية', enabled: true },
  { code: 'es-ES', label: 'Spanish / Español', enabled: true },
  { code: 'fr-FR', label: 'French / Français', enabled: true },
];

export type RecognitionStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'paused'
  | 'stopped'
  | 'error'
  | 'mic-blocked'
  | 'mic-disconnected'
  | 'unavailable';

export interface TranscriptUpdateEvent {
  interimText: string;
  finalizedSegment?: string;
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

export interface ISpeechRecognitionEngine {
  start(): Promise<void>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  stop(): Promise<void>;
  toggle(): Promise<void>;
  getStatus(): RecognitionStatus;
  setLanguage(language: SupportedLanguage): void;
  getLanguage(): SupportedLanguage;
  dispose(): Promise<void>;
  setReplacements?(replacements: any[]): void;
}
