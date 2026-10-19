/**
 * DOM Editable Field Detector & Ctrl+Z-Safe Text Inserter
 *
 * Responsibilities:
 * 1. Detect the currently focused (or last focused) editable element (<input>, <textarea>, contenteditable).
 * 2. Insert finalized recognized text at the exact cursor position.
 * 3. Preserve the target editor's native Undo stack (Ctrl+Z) by using Blink's native
 *    `document.execCommand('insertText', false, text)` command rather than overwriting `.value`.
 * 4. Never intercept Ctrl+Z globally.
 */

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  '',
]);

interface SavedSelection {
  element: HTMLElement;
  /** For <input> / <textarea> */
  selectionStart?: number | null;
  selectionEnd?: number | null;
  /** For contenteditable elements */
  range?: Range | null;
}

export class DomTextInserter {
  private lastSavedSelection: SavedSelection | null = null;
  private isWidgetElement: (el: Element | null) => boolean;

  constructor(isWidgetElement: (el: Element | null) => boolean = () => false) {
    this.isWidgetElement = isWidgetElement;
    this.installFocusTrackers();
  }

  /**
   * Checks whether an element is an editable text field (<input>, <textarea>, or contenteditable).
   */
  public isEditableElement(el: Element | null): el is HTMLElement {
    if (!el || !(el instanceof HTMLElement)) {
      return false;
    }
    if (this.isWidgetElement(el)) {
      return false;
    }

    if (el instanceof HTMLTextAreaElement) {
      return !el.disabled && !el.readOnly;
    }

    if (el instanceof HTMLInputElement) {
      const type = (el.type || 'text').toLowerCase();
      return TEXT_INPUT_TYPES.has(type) && !el.disabled && !el.readOnly;
    }

    if (el.isContentEditable) {
      return true;
    }

    return false;
  }

  /**
   * Returns a human-readable description of the active target element, if any.
   */
  public getTargetDescription(): string | null {
    const target = this.resolveTargetElement();
    if (!target) {
      return null;
    }
    if (target instanceof HTMLInputElement) {
      return target.placeholder
        ? `Input (${target.placeholder.slice(0, 24)})`
        : 'Input field';
    }
    if (target instanceof HTMLTextAreaElement) {
      return target.placeholder
        ? `Textarea (${target.placeholder.slice(0, 24)})`
        : 'Textarea';
    }
    if (target.isContentEditable) {
      return 'Rich-text editor';
    }
    return 'Editable field';
  }

  /**
   * Inserts finalized speech text at the cursor in the currently focused (or last focused)
   * editable element while preserving the browser's native Ctrl+Z undo history.
   */
  public insertTextAtCursor(rawText: string): boolean {
    const trimmed = rawText.trim();
    if (!trimmed) {
      return false;
    }

    const target = this.resolveTargetElement();
    if (!target) {
      return false;
    }

    // Ensure the target element has focus before invoking execCommand('insertText')
    // (For example, if the user clicked the extension popup icon in the toolbar)
    const activeEl = this.getDeepActiveElement();
    if (activeEl !== target) {
      target.focus({ preventScroll: true });
      this.restoreSelectionIfNeeded(target);
    }

    const textToInsert = this.applySmartSpacing(target, trimmed);

    // Primary path: `document.execCommand('insertText', false, textToInsert)`
    // In Chromium (Chrome & Edge), this pushes an atomic TypingCommand onto the element's
    // native undo stack so Ctrl+Z undoes the inserted phrase naturally without clearing prior history.
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, textToInsert);
    } catch {
      inserted = false;
    }

    // Fallback path only if execCommand failed on a custom control
    if (!inserted) {
      inserted = this.fallbackInsert(target, textToInsert);
    }

    if (inserted) {
      this.captureSelection(target);
    }

    return inserted;
  }

  private installFocusTrackers(): void {
    const recordCurrentFocus = () => {
      const active = this.getDeepActiveElement();
      if (this.isEditableElement(active)) {
        this.captureSelection(active);
      }
    };

    document.addEventListener('focusin', recordCurrentFocus, true);
    document.addEventListener('mouseup', recordCurrentFocus, true);
    document.addEventListener('keyup', recordCurrentFocus, true);
    document.addEventListener('selectionchange', recordCurrentFocus, true);

    // Capture initial active element if already focused when content script loads
    recordCurrentFocus();
  }

  private getDeepActiveElement(): Element | null {
    let active: Element | null = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      if (this.isWidgetElement(active)) {
        break;
      }
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  private resolveTargetElement(): HTMLElement | null {
    const currentActive = this.getDeepActiveElement();
    if (this.isEditableElement(currentActive)) {
      return currentActive;
    }

    if (
      this.lastSavedSelection &&
      document.contains(this.lastSavedSelection.element) &&
      this.isEditableElement(this.lastSavedSelection.element)
    ) {
      return this.lastSavedSelection.element;
    }

    return null;
  }

  private captureSelection(el: HTMLElement): void {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        this.lastSavedSelection = {
          element: el,
          selectionStart: el.selectionStart,
          selectionEnd: el.selectionEnd,
        };
      } catch {
        this.lastSavedSelection = { element: el };
      }
      return;
    }

    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (el.contains(range.commonAncestorContainer)) {
          this.lastSavedSelection = {
            element: el,
            range: range.cloneRange(),
          };
          return;
        }
      }
      this.lastSavedSelection = { element: el };
    }
  }

  private restoreSelectionIfNeeded(el: HTMLElement): void {
    if (!this.lastSavedSelection || this.lastSavedSelection.element !== el) {
      return;
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const { selectionStart, selectionEnd } = this.lastSavedSelection;
      if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
        try {
          el.setSelectionRange(selectionStart, selectionEnd);
        } catch {
          // Some input types (e.g. email) do not support setSelectionRange
        }
      }
      return;
    }

    if (el.isContentEditable && this.lastSavedSelection.range) {
      try {
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(this.lastSavedSelection.range);
        }
      } catch {
        // Ignore selection restoration errors
      }
    }
  }

  /**
   * Prepends or appends a single space if adjacent characters at the cursor are non-whitespace
   * so words inserted at the cursor never run into surrounding words.
   */
  private applySmartSpacing(el: HTMLElement, text: string): string {
    let result = text;
    const startsWithPunctuation = /^[.,!?;:)\]}]/.test(text);
    if (!startsWithPunctuation) {
      const charBefore = this.getCharBeforeCursor(el);
      if (charBefore && !/\s/.test(charBefore)) {
        result = ' ' + result;
      }
    }

    const charAfter = this.getCharAfterCursor(el);
    if (charAfter && !/\s/.test(charAfter) && !/^[.,!?;:)\]}]/.test(charAfter)) {
      result = result + ' ';
    }

    return result;
  }

  private getCharBeforeCursor(el: HTMLElement): string | null {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        const pos = el.selectionStart ?? el.value.length;
        return pos > 0 ? el.value.charAt(pos - 1) : null;
      } catch {
        return el.value.length > 0 ? el.value.charAt(el.value.length - 1) : null;
      }
    }

    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        const offset = range.startOffset;
        if (node.nodeType === Node.TEXT_NODE && offset > 0) {
          return (node.textContent || '').charAt(offset - 1) || null;
        }
      }
    }

    return null;
  }

  private getCharAfterCursor(el: HTMLElement): string | null {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        const end = el.selectionEnd ?? el.value.length;
        return end < el.value.length ? el.value.charAt(end) : null;
      } catch {
        return null;
      }
    }

    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const node = range.endContainer;
        const offset = range.endOffset;
        if (node.nodeType === Node.TEXT_NODE) {
          const content = node.textContent || '';
          return offset < content.length ? content.charAt(offset) : null;
        }
      }
    }

    return null;
  }

  private fallbackInsert(el: HTMLElement, text: string): boolean {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        el.setRangeText(text, start, end, 'end');
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: false,
            inputType: 'insertText',
            data: text,
          })
        );
        return true;
      } catch {
        return false;
      }
    }

    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: false,
            inputType: 'insertText',
            data: text,
          })
        );
        return true;
      }
    }

    return false;
  }
}
