// Recovers the line breaks of a text for the side-by-side view.
// The marker works on words (so its result has no paragraphs), so we walk the original text the same way the marker split it
// (see server/src/evaluator/tokenize.ts) and note how many line breaks came before each word.

interface Piece {
  raw: string
  /** Line breaks before this piece in the original text (0, 1 or 2 for a blank line). */
  br: number
}

/** Splits text into the same word pieces the marker uses (see server evaluator/tokenize.ts), remembering line breaks. */
export function pieces(text: string): Piece[] {
  const norm = text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—…]/g, ' ')
    .replace(/\bper\s+cent\b/gi, 'percent')
    .replace(/%/g, ' percent ')
  const out: Piece[] = []
  let pending = 0
  for (const m of norm.matchAll(/(\s*)(\S+)/g)) {
    const newlines = (m[1]!.match(/\n/g) ?? []).length
    pending = Math.max(pending, Math.min(newlines, 2))
    for (const piece of m[2]!.match(/[^-]+-?/g) ?? []) {
      const stripped = piece.replace(/^[("'[{]+/, '')
      const tail = stripped.match(/[.,;:!?)"'\]}-]+$/)?.[0] ?? ''
      if ((tail ? stripped.slice(0, -tail.length) : stripped) === '') continue // stray punctuation: not a word
      out.push({ raw: piece, br: pending })
      pending = 0
    }
  }
  return out
}

/** For each word (in order), how many line breaks came before it. Falls back to 0 if the text cannot be matched. */
export function breaksFor(words: (string | undefined)[], text: string): number[] {
  const ps = pieces(text)
  const out = new Array<number>(words.length).fill(0)
  let p = 0
  let carry = 0
  words.forEach((word, j) => {
    if (word === undefined) return
    const parts = word.split(' ') // several numbers-in-words are joined into one word
    const limit = Math.min(ps.length, p + 8)
    let q = p
    while (q < limit && ps[q]!.raw !== parts[0]) q++
    if (q >= limit) return // could not match: keep our place
    for (let k = p; k < q; k++) carry = Math.max(carry, ps[k]!.br) // skipped pieces hand their breaks on
    out[j] = Math.max(carry, ps[q]!.br)
    carry = 0
    p = q + parts.length
  })
  return out
}
