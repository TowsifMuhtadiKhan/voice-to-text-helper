import { SessionState } from '../../shared/session-store';
import { RecognitionStatus, SupportedLanguage } from '../../shared/speech-interface';

import { WordReplacement } from '../../shared/word-replacer';

export type ExtensionMessage =
  | { type: 'GET_STATE' }
  | { type: 'START_DICTATION' }
  | { type: 'STOP_DICTATION' }
  | { type: 'TOGGLE_DICTATION' }
  | { type: 'TOGGLE_FLOATING_WIDGET' }
  | { type: 'CLOSE_SESSION' }
  | { type: 'SET_LANGUAGE'; language: SupportedLanguage }
  | { type: 'SET_SHORTCUT'; shortcut: string }
  | { type: 'SET_REPLACEMENTS'; replacements: WordReplacement[] }
  | { type: 'CONTENT_STATUS_UPDATE'; status: RecognitionStatus; errorMessage?: string | null }
  | { type: 'CONTENT_INTERIM_RESULT'; interimText: string }
  | { type: 'CONTENT_FINAL_RESULT'; finalText: string }
  | { type: 'INSERT_TEXT_AT_CURSOR'; text: string }
  | { type: 'STATE_BROADCAST'; state: SessionState };
