import type { MistakeKind } from './types'

export interface KindInfo {
  label: string
  weight: 1 | 0.5
  hint: string
  /** A few words for the compact banner on the side-by-side view. */
  short: string
}

export const KINDS: Record<MistakeKind, KindInfo> = {
  omission: { label: 'Missed word', weight: 1, short: 'Word left out', hint: 'A word from the dictation is missing in your text.' },
  addition: { label: 'Extra word', weight: 1, short: 'Extra word', hint: 'You typed a word that was not dictated.' },
  repetition: { label: 'Repeated word', weight: 1, short: 'Typed twice', hint: 'A word was typed twice.' },
  substitution: { label: 'Wrong word', weight: 1, short: 'Different word', hint: 'You typed a different valid word.' },
  incomplete_word: { label: 'Incomplete word', weight: 1, short: 'Word cut short', hint: 'The word is cut short.' },
  abbreviation: { label: 'Abbreviation', weight: 1, short: 'Abbreviation mismatch', hint: 'An abbreviation was typed in place of the full word (or the reverse).' },
  all_caps: { label: 'ALL CAPS', weight: 1, short: 'Typed in capitals', hint: 'A word was typed in capital letters.' },
  spelling: { label: 'Spelling', weight: 0.5, short: 'Misspelt', hint: 'The word is misspelt.' },
  plural: { label: 'Singular / plural', weight: 0.5, short: 'Singular / plural', hint: 'Singular typed for plural, or the reverse.' },
  full_stop: { label: 'Full stop', weight: 0.5, short: 'Full stop issue', hint: 'A full stop is missing or in the wrong place.' },
  capitalisation: { label: 'Capital letter', weight: 0.5, short: 'Needs a capital', hint: 'A capital letter was needed (sentence start or a name).' },
  comma: { label: 'Comma', weight: 0.5, short: 'Comma issue', hint: 'A comma is missing or extra.' },
}

export const KIND_ORDER = Object.keys(KINDS) as MistakeKind[]

/** The six families mistakes are sorted into on the result and "My mistakes" screens. Keep in step with server/src/evaluator/groups.ts. */
export type MistakeGroup = 'additions' | 'omissions' | 'spelling' | 'capitalisation' | 'punctuation' | 'replacements'

export interface GroupInfo {
  label: string
  /** Short singular form for headings and file names. */
  short: string
  hint: string
  /** Dot colour on the filter chips. */
  color: string
}

export const GROUPS: Record<MistakeGroup, GroupInfo> = {
  additions: { label: 'Additions', short: 'additions', color: '#3b82f6', hint: 'Extra words you typed, including words typed twice.' },
  omissions: { label: 'Omissions', short: 'omissions', color: '#f43f5e', hint: 'Words from the dictation that are missing in your text.' },
  spelling: { label: 'Spelling', short: 'spelling', color: '#f59e0b', hint: 'Misspelt words and singular / plural slips.' },
  capitalisation: { label: 'Capitalisation', short: 'capitalisation', color: '#8b5cf6', hint: 'A capital letter was needed, or a word was typed in capitals.' },
  punctuation: { label: 'Punctuation', short: 'punctuation', color: '#14b8a6', hint: 'Full stops and commas.' },
  replacements: { label: 'Replacements', short: 'replacements', color: '#ec4899', hint: 'A different word, a cut-short word or an abbreviation typed in place of the dictated word.' },
}

export const GROUP_ORDER = Object.keys(GROUPS) as MistakeGroup[]

/** A full Record, so adding a MistakeKind without placing it in a group fails to compile. */
export const GROUP_OF_KIND: Record<MistakeKind, MistakeGroup> = {
  addition: 'additions',
  repetition: 'additions',
  omission: 'omissions',
  spelling: 'spelling',
  plural: 'spelling',
  capitalisation: 'capitalisation',
  all_caps: 'capitalisation',
  full_stop: 'punctuation',
  comma: 'punctuation',
  substitution: 'replacements',
  incomplete_word: 'replacements',
  abbreviation: 'replacements',
}

export function isGroup(v: string | null | undefined): v is MistakeGroup {
  return !!v && Object.prototype.hasOwnProperty.call(GROUPS, v)
}

/** How many mistakes fall in each group, from a per-kind breakdown. */
export function countByGroup(breakdown: Partial<Record<MistakeKind, number>>): Record<MistakeGroup, number> {
  const out = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as Record<MistakeGroup, number>
  for (const [k, n] of Object.entries(breakdown)) {
    const g = GROUP_OF_KIND[k as MistakeKind]
    if (g) out[g] += n ?? 0
  }
  return out
}
