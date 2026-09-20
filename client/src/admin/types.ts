export interface AdminSet {
  id: string
  slug: string
  title: string
  description: string | null
  source: string | null
  youtubePlaylistId: string | null
  order: number
  published: boolean
}

export interface AdminVideo {
  youtubeVideoId: string
  baseWpm: number
  title: string | null
}

export interface AdminDictation {
  id: string
  setId: string
  exerciseNo: number
  title: string
  videos: AdminVideo[]
  tags: string[]
  masterWordCount: number
  activeTextVersion: number | null
  published: boolean
  openReports?: number
}

export interface AdminText {
  id: string
  dictationId: string
  version: number
  masterText?: string
  wordCount: number
  source: 'book' | 'asr' | 'manual'
  reviewStatus: 'draft' | 'in_review' | 'verified'
  checkpoints: number[]
  notes: string | null
  attemptCount: number
  createdAt: string | null
}

export interface ImportResultRow {
  exerciseNo: number
  dictationId: string
  action: 'created' | 'updated'
  transcript: 'none' | 'unchanged' | 'new_version'
  version: number | null
  published: boolean
  warnings: string[]
}

export interface ImportResponse {
  results: ImportResultRow[]
  skipped?: { line: string; reason: string }[]
}

export interface SuspectWord {
  wordIndex: number
  word: string
  misses: number
  ratio: number
  kinds: Record<string, number>
}

export interface AdminReport {
  id: string
  type: 'transcript_error' | 'video_issue' | string
  message: string
  word: string | null
  wordIndex: number | null
  textVersion: number | null
  status: 'open' | 'resolved' | 'rejected'
  resolutionNote: string | null
  createdAt: string
  user: { id: string; name: string | null; email: string | null } | null
  dictation: { id: string; title: string | null; exerciseNo: number | null } | null
}

export interface AdminProfile {
  code: string
  name: string
  wpm: number
  durationMin: number
  words: number
  limits: { general: number; reserved: number }
  rules: { commas: 'ignore' | 'half' }
  rulesVersion: number
  active: boolean
  verifiedAgainstNotice: boolean
}

export interface AlternateForm {
  canonical: string
  variants: string[]
  note: string | null
}

export interface Abbreviation {
  abbr: string
  expansions: string[]
  dotted: boolean
}

/** Pull the 11-character id out of a YouTube link (or accept a bare id). */
export function parseVideoId(input: string): string | null {
  const s = input.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/)
  return m ? m[1]! : null
}

export function dictationStatus(d: AdminDictation): { label: string; tone: 'ok' | 'info' | 'half' | 'muted' } {
  if (d.activeTextVersion == null) return { label: 'No verified transcript', tone: 'half' }
  if (d.videos.length === 0) return { label: 'No video', tone: 'half' }
  return d.published ? { label: 'Published', tone: 'ok' } : { label: 'Ready, not published', tone: 'info' }
}
