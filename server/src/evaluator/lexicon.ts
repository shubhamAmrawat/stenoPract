/**
 * Word lists the evaluator consults. The defaults below are only a starting point:
 * in production these come from the `alternateForms` and `abbreviations` collections
 * so an admin can edit them without a deploy.
 */
export interface LexiconInput {
  /** Groups of words that are all accepted for one another, e.g. ["honourable", "hon'ble", "hon"]. */
  alternates?: string[][];
  /** abbreviation -> possible expansions, used only to label a mistake as "abbreviation". */
  abbreviations?: Record<string, string[]>;
  /** Words whose trailing full stop belongs to the word (Mr., Dr., No.), not to the sentence. */
  dotAbbreviations?: string[];
}

export interface Lexicon {
  altMap: Map<string, string>;
  abbrevMap: Map<string, Set<string>>;
  dotAbbreviations: Set<string>;
}

export const DEFAULT_LEXICON_INPUT: Required<LexiconInput> = {
  alternates: [
    ["honourable", "hon'ble", 'honble', 'hon'],
    ['judgement', 'judgment'],
    ['percent', 'pc'],
  ],
  abbreviations: {
    govt: ['government'],
    dept: ['department'],
    min: ['ministry', 'minister'],
    rs: ['rupees'],
    no: ['number'],
    sh: ['shri'],
    ors: ['others'],
    anr: ['another'],
    vs: ['versus'],
    esp: ['especially'],
    approx: ['approximately'],
    tel: ['telephone'],
  },
  dotAbbreviations: [
    'mr', 'mrs', 'ms', 'dr', 'hon', 'no', 'sh', 'smt', 'govt', 'dept', 'rs', 'vs',
    'etc', 'viz', 'i.e', 'e.g', 'a.m', 'p.m', 'st', 'ltd', 'co', 'esp', 'approx', 'ors', 'anr',
  ],
};

export function buildLexicon(input: LexiconInput = {}): Lexicon {
  const alternates = input.alternates ?? DEFAULT_LEXICON_INPUT.alternates;
  const abbreviations = input.abbreviations ?? DEFAULT_LEXICON_INPUT.abbreviations;
  const dots = input.dotAbbreviations ?? DEFAULT_LEXICON_INPUT.dotAbbreviations;

  const altMap = new Map<string, string>();
  for (const group of alternates) {
    const canonical = group[0]?.toLowerCase();
    if (!canonical) continue;
    for (const word of group) altMap.set(word.toLowerCase(), canonical);
  }

  const abbrevMap = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!abbrevMap.has(a)) abbrevMap.set(a, new Set());
    abbrevMap.get(a)!.add(b);
  };
  for (const [abbr, expansions] of Object.entries(abbreviations)) {
    for (const full of expansions) {
      link(abbr.toLowerCase(), full.toLowerCase());
      link(full.toLowerCase(), abbr.toLowerCase());
    }
  }

  return { altMap, abbrevMap, dotAbbreviations: new Set(dots.map((d) => d.toLowerCase())) };
}
