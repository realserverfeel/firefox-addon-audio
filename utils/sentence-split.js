/**
 * Sentence splitting utility.
 * Splits text into sentences, handling abbreviations, decimals, and ellipses.
 */
const SentenceSplitter = (() => {
  // Common abbreviations that should not trigger sentence breaks
  const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd',
    'dept', 'est', 'fig', 'govt', 'inc', 'ltd', 'corp', 'vol', 'vs',
    'etc', 'approx', 'appt', 'apt', 'dept', 'dpt', 'mgr', 'no',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
    'u.s', 'u.k', 'e.g', 'i.e', 'a.m', 'p.m'
  ]);

  /**
   * Split text into sentences.
   * @param {string} text - The input text to split.
   * @returns {string[]} Array of sentence strings.
   */
  function split(text) {
    if (!text || !text.trim()) return [];

    const sentences = [];
    let current = '';
    const chars = text.trim();
    let i = 0;

    while (i < chars.length) {
      const ch = chars[i];
      current += ch;

      if (ch === '.' || ch === '!' || ch === '?') {
        // Check for ellipsis
        if (ch === '.' && i + 2 < chars.length && chars[i + 1] === '.' && chars[i + 2] === '.') {
          current += '..';
          i += 3;
          continue;
        }

        // Check for decimal number (e.g., 72.5)
        if (ch === '.' && i + 1 < chars.length && /\d/.test(chars[i + 1]) && i > 0 && /\d/.test(chars[i - 1])) {
          i++;
          continue;
        }

        // Check for abbreviation
        if (ch === '.') {
          const wordBefore = getWordBefore(current.slice(0, -1));
          if (wordBefore && ABBREVIATIONS.has(wordBefore.toLowerCase())) {
            i++;
            continue;
          }
          // Check for initials like "U.S.A."
          if (wordBefore && wordBefore.length === 1 && /[A-Z]/.test(wordBefore)) {
            i++;
            continue;
          }
        }

        // Check if followed by whitespace (or footnote markers then whitespace) and then uppercase or end of text
        const remaining = chars.slice(i + 1);
        // Detect footnote markers like [45], [45][46], etc.
        const footnoteMatch = remaining.match(/^(\[\d+\])+/);
        const afterFootnotes = footnoteMatch ? remaining.slice(footnoteMatch[0].length) : remaining;
        if (!remaining || /^\s/.test(remaining) || (footnoteMatch && (!afterFootnotes || /^\s/.test(afterFootnotes)))) {
          // Include footnote markers in current sentence if present
          if (footnoteMatch) {
            current += footnoteMatch[0];
            i += footnoteMatch[0].length;
          }
          const trimmed = current.trim();
          if (trimmed) {
            sentences.push(trimmed);
          }
          current = '';
          // Skip whitespace
          i++;
          while (i < chars.length && /\s/.test(chars[i])) i++;
          continue;
        }
      }

      i++;
    }

    // Add remaining text as last sentence
    const trimmed = current.trim();
    if (trimmed) {
      sentences.push(trimmed);
    }

    return sentences;
  }

  /**
   * Get the last word before the current position.
   */
  function getWordBefore(text) {
    const match = text.match(/(\S+)$/);
    return match ? match[1] : '';
  }

  return { split };
})();

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.SentenceSplitter = SentenceSplitter;
}
