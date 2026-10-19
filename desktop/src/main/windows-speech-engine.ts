import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import {
  ISpeechRecognitionEngine,
  RecognitionStatus,
  SpeechRecognitionCallbacks,
  SupportedLanguage,
} from '../../../shared/speech-interface';
import { WordReplacement } from '../../../shared/word-replacer';

interface HelperEvent {
  event: 'ready' | 'status' | 'interim' | 'final' | 'error';
  status?: RecognitionStatus;
  text?: string;
  code?: string;
  message?: string;
}

/**
 * Windows OS Speech Recognition Engine implementation of ISpeechRecognitionEngine.
 *
 * Uses the native Windows Speech Recognition service (System.Speech) via Win32VoiceHelper.exe
 * so audio is processed 100% locally on the operating system without external cloud services,
 * and finalized words are inserted directly at the active cursor via Win32 SendInput
 * while preserving the target application's native Ctrl+Z undo stack.
 */
export class WindowsSpeechRecognitionEngine implements ISpeechRecognitionEngine {
  private helperProcess: ChildProcessWithoutNullStreams | null = null;
  private status: RecognitionStatus = 'idle';
  private language: SupportedLanguage = 'en-US';
  private callbacks: SpeechRecognitionCallbacks;
  private helperPath: string;

  constructor(callbacks: SpeechRecognitionCallbacks, initialLanguage: SupportedLanguage = 'en-US') {
    this.callbacks = callbacks;
    this.language = initialLanguage;
    this.helperPath = path.join(__dirname, '..', 'Win32VoiceHelper.exe');
    this.ensureProcessStarted();
  }

  public async start(): Promise<void> {
    this.ensureProcessStarted();
    this.sendCommand({ cmd: 'start', lang: this.language });
  }

  public async stop(): Promise<void> {
    this.sendCommand({ cmd: 'stop' });
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
    this.sendCommand({ cmd: 'reset_session' });
  }

  public setReplacements(replacements: WordReplacement[]): void {
    const rulesStr = replacements.map((r) => `${r.from.trim()}=${r.to}`).join('|');
    this.sendCommand({ cmd: 'set_replacements', rules: rulesStr });
  }

  public simulateSpeech(text: string, noInsert = false): void {
    this.ensureProcessStarted();
    this.sendCommand({
      cmd: 'simulate_speech',
      text,
      noInsert: noInsert ? 'true' : 'false',
    });
  }

  public async dispose(): Promise<void> {
    if (this.helperProcess) {
      try {
        this.sendCommand({ cmd: 'reset_session' });
        this.helperProcess.kill();
      } catch {
        // Ignore kill error
      }
      this.helperProcess = null;
    }
    this.setStatus('idle');
  }

  private ensureProcessStarted(): void {
    if (this.helperProcess && !this.helperProcess.killed) {
      return;
    }

    try {
      this.helperProcess = spawn(this.helperPath, ['--worker'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const rl = readline.createInterface({
        input: this.helperProcess.stdout,
        crlfDelay: Infinity,
      });

      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const parsed = JSON.parse(trimmed) as HelperEvent;
          this.handleHelperEvent(parsed);
        } catch {
          // Ignore malformed stdout lines
        }
      });

      this.helperProcess.on('exit', () => {
        this.helperProcess = null;
        if (this.status === 'listening' || this.status === 'starting') {
          this.setStatus('stopped');
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus('error');
      this.callbacks.onError({
        code: 'helper-spawn-failed',
        message: `Failed to start Windows speech service helper: ${message}`,
      });
    }
  }

  private handleHelperEvent(evt: HelperEvent): void {
    switch (evt.event) {
      case 'status': {
        if (evt.status) {
          this.setStatus(evt.status);
        }
        break;
      }
      case 'interim': {
        this.callbacks.onInterimResult(evt.text ?? '');
        break;
      }
      case 'final': {
        if (evt.text) {
          this.callbacks.onFinalResult(evt.text);
        }
        break;
      }
      case 'error': {
        this.setStatus('error');
        this.callbacks.onError({
          code: evt.code || 'unknown',
          message: evt.message || 'Speech recognition error',
        });
        break;
      }
      default:
        break;
    }
  }

  private sendCommand(payload: Record<string, string>): void {
    if (!this.helperProcess || !this.helperProcess.stdin.writable) {
      return;
    }
    try {
      this.helperProcess.stdin.write(JSON.stringify(payload) + '\n');
    } catch {
      // Ignore write error
    }
  }

  private setStatus(status: RecognitionStatus): void {
    this.status = status;
    this.callbacks.onStatusChange(status);
  }
}
