import { contextBridge, ipcRenderer } from 'electron';
import { SessionState } from '../../../shared/session-store';

export interface VoiceDesktopAPI {
  getState: () => Promise<SessionState>;
  start: () => Promise<SessionState>;
  stop: () => Promise<SessionState>;
  toggle: () => Promise<SessionState>;
  setShortcut: (shortcut: string) => Promise<SessionState>;
  setReplacements: (replacements: any[]) => Promise<boolean>;
  simulateSpeech: (text: string, noInsert?: boolean) => Promise<SessionState>;
  minimizeApp: () => Promise<void>;
  closeApp: () => Promise<void>;
  hideWindow: () => Promise<void>;
  quitApp: () => Promise<void>;
  onStateChanged: (callback: (state: SessionState) => void) => () => void;
}

const api: VoiceDesktopAPI = {
  getState: () => ipcRenderer.invoke('voice:get-state'),
  start: () => ipcRenderer.invoke('voice:start'),
  stop: () => ipcRenderer.invoke('voice:stop'),
  toggle: () => ipcRenderer.invoke('voice:toggle'),
  setShortcut: (shortcut: string) => ipcRenderer.invoke('voice:set-shortcut', shortcut),
  setReplacements: (replacements: any[]) =>
    ipcRenderer.invoke('voice:set-replacements', replacements),
  simulateSpeech: (text: string, noInsert?: boolean) =>
    ipcRenderer.invoke('voice:simulate-speech', text, noInsert),
  minimizeApp: () => ipcRenderer.invoke('voice:minimize-app'),
  closeApp: () => ipcRenderer.invoke('voice:close-app'),
  hideWindow: () => ipcRenderer.invoke('voice:hide-window'),
  quitApp: () => ipcRenderer.invoke('voice:quit-app'),
  onStateChanged: (callback: (state: SessionState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SessionState) => {
      callback(state);
    };
    ipcRenderer.on('voice:state-changed', handler);
    return () => {
      ipcRenderer.removeListener('voice:state-changed', handler);
    };
  },
};

contextBridge.exposeInMainWorld('voiceHelper', api);
