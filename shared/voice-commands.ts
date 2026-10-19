/**
 * Deterministic voice commands parser for VoiceText v2.0.
 * Operates purely on speech transcript strings without generative AI.
 */

export interface VoiceCommandAction {
  type:
    | 'new-line'
    | 'new-paragraph'
    | 'insert-comma'
    | 'insert-period'
    | 'insert-question'
    | 'insert-exclamation'
    | 'copy-text'
    | 'select-all'
    | 'clear-text';
  label: string;
}

export interface VoiceCommandResult {
  isCommand: boolean;
  action?: VoiceCommandAction;
  processedText?: string;
}

/**
 * Checks if a standalone spoken phrase is an explicit editor command.
 */
export function checkVoiceCommand(spokenPhrase: string): VoiceCommandAction | null {
  const norm = spokenPhrase.trim().toLowerCase().replace(/[.,!?;:]/g, '');

  switch (norm) {
    case 'new line':
    case 'newline':
    case 'line break':
      return { type: 'new-line', label: 'New Line' };

    case 'new paragraph':
    case 'paragraph break':
    case 'next paragraph':
      return { type: 'new-paragraph', label: 'New Paragraph' };

    case 'copy text':
    case 'copy all':
    case 'copy to clipboard':
      return { type: 'copy-text', label: 'Copy Text' };

    case 'select all':
    case 'select text':
      return { type: 'select-all', label: 'Select All' };

    case 'clear text':
    case 'clear all':
    case 'erase text':
      return { type: 'clear-text', label: 'Clear Text' };

    default:
      return null;
  }
}

/**
 * Replaces punctuation voice command tokens inside longer continuous sentences.
 */
export function processInlineVoicePunctuation(text: string): string {
  if (!text) return text;

  return text
    .replace(/\b(comma)\b/gi, ',')
    .replace(/\b(period|full stop)\b/gi, '.')
    .replace(/\b(question mark)\b/gi, '?')
    .replace(/\b(exclamation mark|exclamation point)\b/gi, '!')
    .replace(/\b(new line|newline)\b/gi, '\n')
    .replace(/\b(new paragraph)\b/gi, '\n\n')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\n\s+/g, '\n');
}
