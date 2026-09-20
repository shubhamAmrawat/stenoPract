import type { Lexicon } from './lexicon.js';
import { collapseNumberWords } from './numbers.js';
import type { Token } from './types.js';

const NUMERIC = /^\d[\d,]*(\.\d+)?$/;

function normaliseText(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—…]/g, ' ')
    .replace(/\bper\s+cent\b/gi, 'percent')
    .replace(/%/g, ' percent ');
}

/** Number of words the way a human counts them: whitespace-separated chunks. */
export function countWords(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

export function tokenize(text: string, lexicon: Lexicon): Token[] {
  const tokens: Token[] = [];

  for (const chunk of normaliseText(text).split(/\s+/)) {
    if (!chunk) continue;
    // "well-known" -> "well-", "known": both "well-known" and "well known" tokenise the same.
    const pieces = chunk.match(/[^-]+-?/g) ?? [];
    for (const piece of pieces) {
      const stripped = piece.replace(/^[("'[{]+/, '');
      const tailMatch = stripped.match(/[.,;:!?)"'\]}-]+$/);
      const tail = tailMatch ? tailMatch[0] : '';
      const body = tail ? stripped.slice(0, -tail.length) : stripped;

      const hasStop = /[.?!]/.test(tail);
      const hasComma = /[,;:]/.test(tail);

      if (body === '') {
        // A stray punctuation mark that was typed as its own word: attach it to the previous word.
        const prev = tokens[tokens.length - 1];
        if (prev) {
          if (hasStop && !lexicon.dotAbbreviations.has(prev.core)) prev.sentenceEnd = true;
          if (hasComma) prev.comma = true;
        }
        continue;
      }

      let core = body.toLowerCase();
      const numeric = NUMERIC.test(core);
      if (numeric) core = core.replace(/,/g, '');

      tokens.push({
        raw: piece,
        core,
        key: lexicon.altMap.get(core) ?? core,
        sentenceEnd: hasStop && !lexicon.dotAbbreviations.has(core),
        comma: hasComma,
        capitalised: /^\p{Lu}/u.test(body),
        upper: body.length >= 2 && /\p{L}/u.test(body) && body === body.toUpperCase(),
        numeric,
      });
    }
  }

  return collapseNumberWords(tokens).map((t) => ({ ...t, key: lexicon.altMap.get(t.core) ?? t.core }));
}
