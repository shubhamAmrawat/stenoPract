/** The colour themes a student can choose from. The colours themselves live in theme.css (one block per id). */
export const THEMES = [
  { id: 'teal', name: 'Teal', note: 'Calm and focused' },
  { id: 'forest', name: 'Forest', note: 'Steno-pad green' },
  { id: 'sky', name: 'Sky', note: 'Bright and clear' },
  { id: 'slate', name: 'Slate', note: 'Quiet and modern' },
  { id: 'plum', name: 'Plum', note: 'Warm and bold' },
  { id: 'indigo', name: 'Indigo', note: 'The classic' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** What a student sees until they choose one. */
export const DEFAULT_THEME: ThemeId = 'teal'

export function resolveTheme(value: string | null | undefined): ThemeId {
  return THEMES.find((t) => t.id === value)?.id ?? DEFAULT_THEME
}
