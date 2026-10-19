/**
 * Text formatting, cleaning, and analysis utilities for VoiceText v2.0.
 * Pure JavaScript/TypeScript without external dependencies or generative AI.
 */

export interface TextStatistics {
  wordCount: number;
  charCount: number;
  charCountNoSpaces: number;
  sentenceCount: number;
  paragraphCount: number;
  readingTimeMinutes: number;
  speakingTimeMinutes: number;
}

export function computeTextStatistics(text: string): TextStatistics {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      wordCount: 0,
      charCount: 0,
      charCountNoSpaces: 0,
      sentenceCount: 0,
      paragraphCount: 0,
      readingTimeMinutes: 0,
      speakingTimeMinutes: 0,
    };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const charCount = text.length;
  const charCountNoSpaces = text.replace(/\s/g, '').length;

  // Sentences ending in ., !, or ?
  const sentences = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = sentences.length;

  // Paragraphs separated by one or more blank lines
  const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const paragraphCount = paragraphs.length;

  // Average reading speed: 200 words per minute
  const readingTimeMinutes = Math.max(1, Math.round((wordCount / 200) * 10) / 10);
  // Average speaking speed: 130 words per minute
  const speakingTimeMinutes = Math.max(1, Math.round((wordCount / 130) * 10) / 10);

  return {
    wordCount,
    charCount,
    charCountNoSpaces,
    sentenceCount,
    paragraphCount,
    readingTimeMinutes,
    speakingTimeMinutes,
  };
}

export type TextCaseType = 'upper' | 'lower' | 'title' | 'sentence' | 'capitalize';

export function convertTextCase(text: string, type: TextCaseType): string {
  if (!text) return text;

  switch (type) {
    case 'upper':
      return text.toUpperCase();

    case 'lower':
      return text.toLowerCase();

    case 'title':
      return text.replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
      });

    case 'sentence': {
      // Capitalize first letter of each sentence
      return text.toLowerCase().replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, prefix, letter) => {
        return prefix + letter.toUpperCase();
      });
    }

    case 'capitalize':
      return text.replace(/\b\w/g, (char) => char.toUpperCase());

    default:
      return text;
  }
}

export type TextCleaningAction =
  | 'remove-extra-spaces'
  | 'remove-blank-lines'
  | 'trim'
  | 'remove-duplicate-words'
  | 'normalize-line-breaks'
  | 'remove-repeated-punct'
  | 'tabs-to-spaces'
  | 'paragraphs-to-single';

export function cleanText(text: string, action: TextCleaningAction): string {
  if (!text) return text;

  switch (action) {
    case 'remove-extra-spaces':
      // Collapse multiple spaces into one space while keeping line breaks
      return text
        .split('\n')
        .map((line) => line.replace(/[^\S\r\n]+/g, ' ').trim())
        .join('\n');

    case 'remove-blank-lines':
      return text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .join('\n');

    case 'trim':
      return text.trim();

    case 'remove-duplicate-words':
      // Remove adjacent duplicate words (e.g. "the the" -> "the")
      return text.replace(/\b(\w+)\s+\1\b/gi, '$1');

    case 'normalize-line-breaks':
      return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    case 'remove-repeated-punct':
      // Replace repeated punctuation like "!!" -> "!", "???" -> "?" but keep ellipsis "..."
      return text
        .replace(/([!?,;])\1+/g, '$1')
        .replace(/\.{4,}/g, '...');

    case 'tabs-to-spaces':
      return text.replace(/\t/g, '  ');

    case 'paragraphs-to-single':
      // Collapse multiple paragraphs into single clean text separated by a space
      return text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ');

    default:
      return text;
  }
}

export function formatList(text: string, type: 'bullet' | 'numbered' | 'remove'): string {
  if (!text) return text;
  const lines = text.split(/\r?\n/);

  if (type === 'remove') {
    return lines
      .map((line) => line.replace(/^(\s*[-*•]|\s*\d+\.)\s*/, ''))
      .join('\n');
  }

  if (type === 'bullet') {
    return lines
      .map((line) => {
        const trimmed = line.replace(/^(\s*[-*•]|\s*\d+\.)\s*/, '').trim();
        return trimmed ? `• ${trimmed}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (type === 'numbered') {
    let index = 1;
    return lines
      .map((line) => {
        const trimmed = line.replace(/^(\s*[-*•]|\s*\d+\.)\s*/, '').trim();
        if (!trimmed) return '';
        const formatted = `${index}. ${trimmed}`;
        index++;
        return formatted;
      })
      .filter(Boolean)
      .join('\n');
  }

  return text;
}

export interface VolatileClip {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  wordCount: number;
}

export function getFormattedTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export type MarkdownFormatType = 'h1' | 'h2' | 'h3' | 'bold' | 'italic' | 'code' | 'quote' | 'timestamp';

export function applyMarkdownFormat(
  text: string,
  start: number,
  end: number,
  format: MarkdownFormatType
): { newText: string; newStart: number; newEnd: number } {
  const before = text.substring(0, start);
  const selected = text.substring(start, end);
  const after = text.substring(end);

  switch (format) {
    case 'h1': {
      const heading = `# ${selected || 'Heading 1'}\n`;
      return {
        newText: before + heading + after,
        newStart: start,
        newEnd: start + heading.length,
      };
    }
    case 'h2': {
      const heading = `## ${selected || 'Heading 2'}\n`;
      return {
        newText: before + heading + after,
        newStart: start,
        newEnd: start + heading.length,
      };
    }
    case 'h3': {
      const heading = `### ${selected || 'Heading 3'}\n`;
      return {
        newText: before + heading + after,
        newStart: start,
        newEnd: start + heading.length,
      };
    }
    case 'bold': {
      const wrapped = `**${selected || 'bold text'}**`;
      return {
        newText: before + wrapped + after,
        newStart: start + 2,
        newEnd: start + wrapped.length - 2,
      };
    }
    case 'italic': {
      const wrapped = `*${selected || 'italic text'}*`;
      return {
        newText: before + wrapped + after,
        newStart: start + 1,
        newEnd: start + wrapped.length - 1,
      };
    }
    case 'code': {
      const wrapped = `\`${selected || 'code'}\``;
      return {
        newText: before + wrapped + after,
        newStart: start + 1,
        newEnd: start + wrapped.length - 1,
      };
    }
    case 'quote': {
      const wrapped = `> ${selected || 'Quote'}\n`;
      return {
        newText: before + wrapped + after,
        newStart: start,
        newEnd: start + wrapped.length,
      };
    }
    case 'timestamp': {
      const stamp = `[${getFormattedTimestamp()}] `;
      return {
        newText: before + stamp + after,
        newStart: start + stamp.length,
        newEnd: start + stamp.length,
      };
    }
    default:
      return { newText: text, newStart: start, newEnd: end };
  }
}

