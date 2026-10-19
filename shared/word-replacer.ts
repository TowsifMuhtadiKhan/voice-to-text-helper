export interface WordReplacement {
  id?: string;
  from: string;
  to: string;
  enabled?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export const DEFAULT_REPLACEMENTS: WordReplacement[] = [
  { id: '1', from: 'comma', to: ',', enabled: true },
  { id: '2', from: 'period', to: '.', enabled: true },
  { id: '3', from: 'question mark', to: '?', enabled: true },
  { id: '4', from: 'exclamation mark', to: '!', enabled: true },
  { id: '5', from: 'new line', to: '\n', enabled: true },
  { id: '6', from: 'new paragraph', to: '\n\n', enabled: true },
];

/**
 * Performs exact whole-word or punctuation substitutions without generative AI.
 * Prevents recursive replacement loops by applying each replacement once per pass.
 */
export function applyWordReplacements(text: string, replacements: WordReplacement[]): string {
  if (!text || !replacements || replacements.length === 0) return text;

  let result = text;
  for (const rep of replacements) {
    if (rep.enabled === false) continue;
    const rawFrom = rep.from.trim();
    if (!rawFrom) continue;

    // Prevent infinite loop if target is the same as replacement
    if (rep.from === rep.to) continue;

    // Escape regex characters, and convert any whitespace sequence into \s+
    const escaped = rawFrom
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');

    const isWholeWord = rep.wholeWord !== false;
    const startBoundary = isWholeWord && /^\w/.test(rawFrom) ? '\\b' : '';
    const endBoundary = isWholeWord && /\w$/.test(rawFrom) ? '\\b' : '';

    const flags = rep.caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(`${startBoundary}${escaped}${endBoundary}`, flags);
    result = result.replace(regex, rep.to);
  }

  // Clean up punctuation spacing: "word , word" -> "word, word", "word . " -> "word. "
  result = result
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\n\s+/g, '\n');

  return result;
}
