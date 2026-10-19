import { exec } from 'child_process';
import { clipboard } from 'electron';
import {
  ISpeechRecognitionEngine,
  RecognitionErrorEvent,
  RecognitionStatus,
  SpeechRecognitionCallbacks,
  SupportedLanguage,
} from '../../../shared/speech-interface';

import { applyWordReplacements, WordReplacement } from '../../../shared/word-replacer';

/**
 * macOS Speech Recognition & Native Input Engine
 *
 * Implements ISpeechRecognitionEngine for macOS (darwin).
 * On macOS, audio dictation and text insertion are handled natively:
 * - Recognized text is inserted directly at the active cursor across Mac applications
 *   via AppleScript (osascript) System Events keystroke or clipboard paste.
 * - Preserves temporary session transcript strictly in volatile memory.
 */
export class MacSpeechRecognitionEngine implements ISpeechRecognitionEngine {
  private status: RecognitionStatus = 'idle';
  private language: SupportedLanguage = 'en-US';
  private callbacks: SpeechRecognitionCallbacks;
  private replacements: WordReplacement[] = [];
  private isDisposed = false;

  constructor(callbacks: SpeechRecognitionCallbacks, initialLanguage: SupportedLanguage = 'en-US') {
    this.callbacks = callbacks;
    this.language = initialLanguage;
  }

  public async start(): Promise<void> {
    if (this.isDisposed) return;
    this.status = 'listening';
    this.callbacks.onStatusChange('listening');
  }

  public async stop(): Promise<void> {
    if (this.isDisposed) return;
    this.status = 'stopped';
    this.callbacks.onStatusChange('stopped');
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
  }

  public getLanguage(): SupportedLanguage {
    return this.language;
  }

  public resetSession(): void {
    this.callbacks.onInterimResult('');
  }

  public setReplacements(replacements: WordReplacement[]): void {
    this.replacements = replacements;
  }

  public simulateSpeech(text: string, noInsert = false): void {
    if (this.isDisposed) return;
    this.status = 'listening';
    this.callbacks.onStatusChange('listening');
    this.callbacks.onInterimResult(text);

    setTimeout(() => {
      this.callbacks.onInterimResult('');
      const finalText = applyWordReplacements(text, this.replacements);
      this.callbacks.onFinalResult(finalText);
      this.status = 'stopped';
      this.callbacks.onStatusChange('stopped');

      if (!noInsert && process.platform === 'darwin') {
        this.insertTextAtCursorMac(finalText);
      }
    }, 120);
  }

  public insertTextAtCursorMac(text: string): void {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "System Events" to keystroke "${escaped} "`;
    exec(`osascript -e '${script}'`, (err) => {
      if (err) {
        // Fallback: clipboard paste on macOS
        const prev = clipboard.readText();
        clipboard.writeText(text + ' ');
        exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, () => {
          setTimeout(() => {
            try {
              clipboard.writeText(prev);
            } catch {
              // Ignore clipboard restore errors
            }
          }, 300);
        });
      }
    });
  }

  public async dispose(): Promise<void> {
    this.isDisposed = true;
    this.status = 'idle';
  }
}
