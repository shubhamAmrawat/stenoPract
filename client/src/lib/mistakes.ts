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
