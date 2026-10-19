import { InMemorySessionStore, SessionState } from '../../shared/session-store';
import { ExtensionMessage } from './messages';

/**
 * Manifest V3 Background Service Worker
 *
 * Maintains the current session transcript strictly in volatile memory (RAM).
 * Preserves the transcript if the extension popup closes while dictation remains active,
 * and clears all temporary transcript data when the session is explicitly closed.
 */
const sessionStore = new InMemorySessionStore('Ctrl+Shift+Space', 'en-US');
let activeTabId: number | null = null;

function broadcastState(state: SessionState): void {
  const msg: ExtensionMessage = { type: 'STATE_BROADCAST', state };

  // Broadcast to popup if open
  chrome.runtime.sendMessage(msg).catch(() => {
    // Popup is currently closed; safe to ignore
  });

  // Broadcast to active tab content script if known
  if (activeTabId !== null) {
    chrome.tabs.sendMessage(activeTabId, msg).catch(() => {
      // Tab may have navigated or closed
    });
  }
}

sessionStore.subscribe((state) => {
  broadcastState(state);
});

async function resolveTargetTabId(senderTabId?: number): Promise<number | null> {
  if (typeof senderTabId === 'number') {
    activeTabId = senderTabId;
    return senderTabId;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (tab && typeof tab.id === 'number') {
      activeTabId = tab.id;
      return tab.id;
    }
  } catch {
    // Ignore query errors
  }

  return activeTabId;
}

async function ensureContentScriptAndSend(
  tabId: number,
  message: ExtensionMessage
): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    // Content script might not be injected yet if tab was opened prior to extension load
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      return false;
    }
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-dictation') {
    const tabId = await resolveTargetTabId();
    if (tabId !== null) {
      await ensureContentScriptAndSend(tabId, { type: 'TOGGLE_DICTATION' });
    }
  }
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse): boolean => {
    const senderTabId = sender.tab?.id;

    switch (message.type) {
      case 'GET_STATE': {
        sendResponse(sessionStore.getState());
        return false;
      }

      case 'START_DICTATION': {
        resolveTargetTabId(senderTabId).then(async (tabId) => {
          let contentScriptSent = false;
          if (tabId !== null) {
            contentScriptSent = await ensureContentScriptAndSend(tabId, { type: 'START_DICTATION' });
          }
          sendResponse({ ...sessionStore.getState(), contentScriptSent });
        });
        return true;
      }

      case 'STOP_DICTATION': {
        resolveTargetTabId(senderTabId).then(async (tabId) => {
          if (tabId !== null) {
            await ensureContentScriptAndSend(tabId, { type: 'STOP_DICTATION' });
          }
          sessionStore.setStatus('stopped');
          sendResponse(sessionStore.getState());
        });
        return true;
      }

      case 'TOGGLE_DICTATION': {
        resolveTargetTabId(senderTabId).then(async (tabId) => {
          const current = sessionStore.getState().status;
          const nextAction: ExtensionMessage =
            current === 'listening' || current === 'starting'
              ? { type: 'STOP_DICTATION' }
              : { type: 'START_DICTATION' };
          if (tabId !== null) {
            await ensureContentScriptAndSend(tabId, nextAction);
          }
          sendResponse(sessionStore.getState());
        });
        return true;
      }

      case 'TOGGLE_FLOATING_WIDGET': {
        resolveTargetTabId(senderTabId).then(async (tabId) => {
          if (tabId !== null) {
            await ensureContentScriptAndSend(tabId, { type: 'TOGGLE_FLOATING_WIDGET' });
          }
          sendResponse({ ok: true });
        });
        return true;
      }

      case 'CLOSE_SESSION': {
        resolveTargetTabId(senderTabId).then(async (tabId) => {
          if (tabId !== null) {
            await ensureContentScriptAndSend(tabId, { type: 'CLOSE_SESSION' });
          }
          const clearedState = sessionStore.clearSession();
          sendResponse(clearedState);
        });
        return true;
      }

      case 'SET_LANGUAGE': {
        const state = sessionStore.setLanguage(message.language);
        resolveTargetTabId(senderTabId).then(async (tabId) => {
          if (tabId !== null) {
            await ensureContentScriptAndSend(tabId, {
              type: 'SET_LANGUAGE',
              language: message.language,
            });
          }
        });
        sendResponse(state);
        return false;
      }

      case 'SET_SHORTCUT': {
        const state = sessionStore.setShortcut(message.shortcut);
        resolveTargetTabId(senderTabId).then(async (tabId) => {
          if (tabId !== null) {
            await ensureContentScriptAndSend(tabId, {
              type: 'SET_SHORTCUT',
              shortcut: message.shortcut,
            });
          }
        });
        sendResponse(state);
        return false;
      }

      case 'SET_REPLACEMENTS': {
        resolveTargetTabId(senderTabId).then(async (tabId) => {
          if (tabId !== null) {
            await ensureContentScriptAndSend(tabId, {
              type: 'SET_REPLACEMENTS',
              replacements: message.replacements,
            });
          }
        });
        sendResponse({ ok: true });
        return false;
      }

      case 'CONTENT_STATUS_UPDATE': {
        if (typeof senderTabId === 'number') {
          activeTabId = senderTabId;
        }
        const state = sessionStore.setStatus(message.status, message.errorMessage ?? null);
        sendResponse(state);
        return false;
      }

      case 'CONTENT_INTERIM_RESULT': {
        const state = sessionStore.setInterimText(message.interimText);
        sendResponse(state);
        return false;
      }

      case 'CONTENT_FINAL_RESULT': {
        const { insertedSegment, state } = sessionStore.appendFinalSegment(message.finalText);
        // If finalized text came from the popup fallback recognizer, forward insertion to active tab
        if (!senderTabId && insertedSegment && activeTabId !== null) {
          ensureContentScriptAndSend(activeTabId, {
            type: 'INSERT_TEXT_AT_CURSOR',
            text: insertedSegment,
          });
        }
        sendResponse(state);
        return false;
      }

      default:
        return false;
    }
  }
);
