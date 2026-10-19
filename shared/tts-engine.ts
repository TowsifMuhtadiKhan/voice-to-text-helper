/**
 * Native Browser Text-to-Speech Engine
 * Uses window.speechSynthesis without external APIs or cloud services.
 */

export interface TTSState {
  isPlaying: boolean;
  isPaused: boolean;
  rate: number;
  pitch: number;
  voiceURI: string | null;
  currentWordIndex?: number;
}

export class NativeTTSEngine {
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private stateChangeCb?: (state: TTSState) => void;
  private state: TTSState = {
    isPlaying: false,
    isPaused: false,
    rate: 1.0,
    pitch: 1.0,
    voiceURI: null,
  };

  constructor(onStateChange?: (state: TTSState) => void) {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
    this.stateChangeCb = onStateChange;
  }

  public isSupported(): boolean {
    return Boolean(this.synth);
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    return this.synth.getVoices();
  }

  public setRate(rate: number): void {
    this.state.rate = Math.max(0.5, Math.min(2.0, rate));
    this.notify();
  }

  public setPitch(pitch: number): void {
    this.state.pitch = Math.max(0.5, Math.min(1.5, pitch));
    this.notify();
  }

  public setVoiceURI(uri: string): void {
    this.state.voiceURI = uri;
    this.notify();
  }

  public speak(text: string, language?: string): void {
    if (!this.synth) return;
    this.stop();

    const cleanText = text.trim();
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = this.state.rate;
    utterance.pitch = this.state.pitch;

    const voices = this.getVoices();
    if (this.state.voiceURI) {
      const selected = voices.find((v) => v.voiceURI === this.state.voiceURI);
      if (selected) utterance.voice = selected;
    } else if (language) {
      const langPrefix = language.split('-')[0].toLowerCase();
      const match = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
      if (match) utterance.voice = match;
    }

    utterance.onstart = () => {
      this.state.isPlaying = true;
      this.state.isPaused = false;
      this.notify();
    };

    utterance.onend = () => {
      this.state.isPlaying = false;
      this.state.isPaused = false;
      this.currentUtterance = null;
      this.notify();
    };

    utterance.onerror = () => {
      this.state.isPlaying = false;
      this.state.isPaused = false;
      this.currentUtterance = null;
      this.notify();
    };

    utterance.onpause = () => {
      this.state.isPaused = true;
      this.notify();
    };

    utterance.onresume = () => {
      this.state.isPaused = false;
      this.notify();
    };

    this.currentUtterance = utterance;
    this.synth.speak(utterance);
  }

  public pause(): void {
    if (this.synth && this.state.isPlaying && !this.state.isPaused) {
      this.synth.pause();
      this.state.isPaused = true;
      this.notify();
    }
  }

  public resume(): void {
    if (this.synth && this.state.isPaused) {
      this.synth.resume();
      this.state.isPaused = false;
      this.notify();
    }
  }

  public stop(): void {
    if (this.synth) {
      this.synth.cancel();
      this.state.isPlaying = false;
      this.state.isPaused = false;
      this.currentUtterance = null;
      this.notify();
    }
  }

  public getState(): TTSState {
    return { ...this.state };
  }

  private notify(): void {
    if (this.stateChangeCb) {
      this.stateChangeCb({ ...this.state });
    }
  }
}
