import { buildLexicon, type Lexicon } from '../evaluator/index.js';
import { Abbreviation, AlternateForm } from '../models/index.js';

const TTL_MS = 60_000;
let cached: { lexicon: Lexicon; at: number } | null = null;

/** Word lists from the database (admin-editable), cached for a minute. */
export async function getLexicon(): Promise<Lexicon> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.lexicon;

  const [alternates, abbreviations] = await Promise.all([
    AlternateForm.find().lean(),
    Abbreviation.find().lean(),
  ]);

  const abbr: Record<string, string[]> = {};
  const dotted: string[] = [];
  for (const a of abbreviations) {
    if (a.expansions.length) abbr[a.abbr] = a.expansions;
    if (a.dotted) dotted.push(a.abbr);
  }

  const lexicon = buildLexicon({
    alternates: alternates.map((a) => [a.canonical, ...a.variants.filter((v) => v !== a.canonical)]),
    abbreviations: abbr,
    dotAbbreviations: dotted,
  });
  cached = { lexicon, at: Date.now() };
  return lexicon;
}

/** Call after an admin edits alternate forms / abbreviations. */
export function invalidateLexicon(): void {
  cached = null;
}
