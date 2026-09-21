import type { MistakeKind } from './types.js';

/** The six families the analysis and "My mistakes" screens sort mistakes into. Keep in step with client/src/lib/mistakes.ts. */
export const MISTAKE_GROUPS = ['additions', 'omissions', 'spelling', 'capitalisation', 'punctuation', 'replacements'] as const;
export type MistakeGroup = (typeof MISTAKE_GROUPS)[number];

/** Typed as a full Record so adding a MistakeKind without placing it in a group fails to compile. */
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
};

export function kindsInGroup(group: MistakeGroup): MistakeKind[] {
  return (Object.keys(GROUP_OF_KIND) as MistakeKind[]).filter((k) => GROUP_OF_KIND[k] === group);
}
