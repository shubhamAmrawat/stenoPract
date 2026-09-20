import type { Token } from './types.js';

type Kind = 'ones' | 'teen' | 'tens' | 'hundred' | 'scale';

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = {
  thousand: 1_000, lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000,
  crore: 10_000_000, crores: 10_000_000, million: 1_000_000, billion: 1_000_000_000,
};

function wordKind(core: string): { kind: Kind; value: number } | null {
  if (core in ONES) return { kind: 'ones', value: ONES[core]! };
  if (core in TEENS) return { kind: 'teen', value: TEENS[core]! };
  if (core in TENS) return { kind: 'tens', value: TENS[core]! };
  if (core === 'hundred') return { kind: 'hundred', value: 100 };
  if (core in SCALES) return { kind: 'scale', value: SCALES[core]! };
  return null;
}

type Last = 'start' | Kind | 'and';

function canFollow(kind: Kind, last: Last): boolean {
  switch (kind) {
    case 'ones': return last === 'start' || last === 'tens' || last === 'hundred' || last === 'scale' || last === 'and';
    case 'teen':
    case 'tens': return last === 'start' || last === 'hundred' || last === 'scale' || last === 'and';
    case 'hundred': return last === 'start' || last === 'ones' || last === 'teen' || last === 'tens';
    case 'scale': return last === 'start' || last === 'ones' || last === 'teen' || last === 'tens' || last === 'hundred';
  }
}

/**
 * Folds runs of spoken numbers ("twenty five", "one hundred and five", "two lakh")
 * into a single numeric token so they compare equal to the digits ("25", "105", "200000").
 * Runs like "nineteen ninety four" (spoken years) are not folded correctly - by design we
 * only guarantee ordinary quantities.
 */
export function collapseNumberWords(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const first = wordKind(tokens[i]!.core);
    if (!first) {
      out.push(tokens[i]!);
      i++;
      continue;
    }

    let total = 0;
    let current = 0;
    let last: Last = 'start';
    let j = i;
    const used: Token[] = [];

    while (j < tokens.length) {
      const t = tokens[j]!;
      // A sentence end or comma inside the run ends it (after including this token).
      const wk = wordKind(t.core);
      if (wk && canFollow(wk.kind, last)) {
        if (wk.kind === 'ones' || wk.kind === 'teen' || wk.kind === 'tens') current += wk.value;
        else if (wk.kind === 'hundred') current = (current || 1) * 100;
        else { total += (current || 1) * wk.value; current = 0; }
        last = wk.kind;
        used.push(t);
        j++;
        if (t.sentenceEnd || t.comma) break;
        continue;
      }
      if (t.core === 'and' && (last === 'hundred' || last === 'scale') && !used[used.length - 1]!.sentenceEnd) {
        const next = tokens[j + 1] ? wordKind(tokens[j + 1]!.core) : null;
        if (next && (next.kind === 'ones' || next.kind === 'teen' || next.kind === 'tens')) {
          last = 'and';
          used.push(t);
          j++;
          continue;
        }
      }
      break;
    }

    if (used.length === 0) {
      out.push(tokens[i]!);
      i++;
      continue;
    }

    const value = String(total + current);
    const lastTok = used[used.length - 1]!;
    out.push({
      raw: used.map((u) => u.raw).join(' '),
      core: value,
      key: value,
      sentenceEnd: lastTok.sentenceEnd,
      comma: lastTok.comma,
      capitalised: false,
      upper: false,
      numeric: true,
    });
    i = j;
  }
  return out;
}
