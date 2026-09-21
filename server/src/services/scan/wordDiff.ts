/**
 * Small word-level diff (longest common subsequence). Used to compare two readings of the same page
 * and to compare a fresh scan with the transcript that is already live. Texts here are ~1,000 words,
 * so the O(n*m) table is a few hundred KB at most.
 */

export interface DiffSpan {
  /** Words from the first text in this span (empty for a pure insertion). */
  a: string[];
  /** Words from the second text in this span (empty for a pure deletion). */
  b: string[];
  /** Index of the first word of the span in the first text. */
  aIndex: number;
}

const keyOf = (w: string) => w;

/** Splits on whitespace. */
export const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Returns only the places where the two word lists differ, merged into spans. */
export function diffWords(first: string[], second: string[]): DiffSpan[] {
  const n = first.length;
  const m = second.length;
  // Trim the common head and tail first: two readings of one page are almost identical.
  let head = 0;
  while (head < n && head < m && keyOf(first[head]!) === keyOf(second[head]!)) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && keyOf(first[n - 1 - tail]!) === keyOf(second[m - 1 - tail]!)) tail++;

  const A = first.slice(head, n - tail);
  const B = second.slice(head, m - tail);
  const rows = A.length + 1;
  const cols = B.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        keyOf(A[i]!) === keyOf(B[j]!) ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }

  const spans: DiffSpan[] = [];
  let i = 0;
  let j = 0;
  let cur: DiffSpan | null = null;
  const flush = () => {
    if (cur) spans.push(cur);
    cur = null;
  };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && keyOf(A[i]!) === keyOf(B[j]!)) {
      flush();
      i++;
      j++;
    } else if (j < B.length && (i === A.length || table[i * cols + j + 1]! >= table[(i + 1) * cols + j]!)) {
      cur ??= { a: [], b: [], aIndex: head + i };
      cur.b.push(B[j]!);
      j++;
    } else {
      cur ??= { a: [], b: [], aIndex: head + i };
      cur.a.push(A[i]!);
      i++;
    }
  }
  flush();
  return spans;
}
