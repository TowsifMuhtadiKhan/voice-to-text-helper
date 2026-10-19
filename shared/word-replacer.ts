export interface WordReplacement {
  from: string;
  to: string;
}

export const DEFAULT_REPLACEMENTS: WordReplacement[] = [
  { from: 'comma', to: ',' },
  { from: 'period', to: '.' },
  { from: 'question mark', to: '?' },
  { from: 'exclamation mark', to: '!' },
  { from: 'new line', to: '\n' },
];

/**
 * Performs exact whole-word or punctuation substitutions without generative AI.
 */
export function applyWordReplacements(text: string, replacements: WordReplacement[]): string {
  if (!text || !replacements || replacements.length === 0) return text;

  let result = text;
  for (const rep of replacements) {
    const rawFrom = rep.from.trim();
    if (!rawFrom) continue;

    // Escape regex characters, and convert any whitespace sequence into \s+
    const escaped = rawFrom
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');

    // Only apply \b word boundary if the start/end char is a word character (\w)
    const startBoundary = /^\w/.test(rawFrom) ? '\\b' : '';
    const endBoundary = /\w$/.test(rawFrom) ? '\\b' : '';

    const regex = new RegExp(`${startBoundary}${escaped}${endBoundary}`, 'gi');
    result = result.replace(regex, rep.to);
  }

  // Clean up punctuation spacing: "word , word" -> "word, word", "word . " -> "word. "
  result = result
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\n\s+/g, '\n');

  return result;
}
