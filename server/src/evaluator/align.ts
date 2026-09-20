import { comparePair, type CompareContext, type PairResult } from './compare.js';
import type { Token } from './types.js';

export type AlignOp =
  | { op: 'pair'; mi: number; ai: number; result: PairResult }
  | { op: 'del'; mi: number } // master word missing from the attempt
  | { op: 'ins'; ai: number }; // extra word in the attempt

const DIAG = 0;
const UP = 1; // consume a master word only (omission)
const LEFT = 2; // consume an attempt word only (addition)
const GAP = 2; // an omission or an addition costs one full mistake (= 2 half units)

/**
 * Word-level dynamic-programming alignment (edit distance with weighted costs).
 * Costs are in half-mistake units so everything stays an integer.
 * Ties prefer pairing words (diagonal), then omissions, then additions.
 */
export function align(master: Token[], attempt: Token[], ctx: CompareContext): AlignOp[] {
  const n = master.length;
  const m = attempt.length;
  const width = m + 1;
  const cost = new Int32Array((n + 1) * width);
  const back = new Uint8Array((n + 1) * width);

  for (let i = 1; i <= n; i++) {
    cost[i * width] = i * GAP;
    back[i * width] = UP;
  }
  for (let j = 1; j <= m; j++) {
    cost[j] = j * GAP;
    back[j] = LEFT;
  }

  for (let i = 1; i <= n; i++) {
    const mt = master[i - 1]!;
    for (let j = 1; j <= m; j++) {
      const at = attempt[j - 1]!;
      const diag = cost[(i - 1) * width + (j - 1)]! + comparePair(mt, at, ctx).cost;
      const up = cost[(i - 1) * width + j]! + GAP;
      const left = cost[i * width + (j - 1)]! + GAP;

      let best = diag;
      let dir = DIAG;
      if (up < best) { best = up; dir = UP; }
      if (left < best) { best = left; dir = LEFT; }
      cost[i * width + j] = best;
      back[i * width + j] = dir;
    }
  }

  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = back[i * width + j]!;
    if (i > 0 && j > 0 && dir === DIAG) {
      ops.push({ op: 'pair', mi: i - 1, ai: j - 1, result: comparePair(master[i - 1]!, attempt[j - 1]!, ctx) });
      i--; j--;
    } else if (i > 0 && (j === 0 || dir === UP)) {
      ops.push({ op: 'del', mi: i - 1 });
      i--;
    } else {
      ops.push({ op: 'ins', ai: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}
