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

export interface ScanChecks {
  exerciseFound: boolean
  complete: boolean
  markers: { found: number; expected: number | null; ok: boolean }
  wordCount: { words: number; printed: number | null; ok: boolean }
  spelling: { unknown: string[]; ok: boolean }
  reads: { passes: number; agree: boolean }
  green: boolean
}

export interface ScanRow {
  id: string
  setId: string
  fileName: string
  pageNo: number
  /** Every page that makes up this exercise (two when it is printed over two pages). */
  pageNos: number[]
  part: 'whole' | 'start' | 'continuation' | null
  joinedInto: string | null
  status: 'queued' | 'running' | 'waiting' | 'done' | 'failed'
  error: string | null
  exerciseNo: number | null
  dictationId: string | null
  textId: string | null
  outcome: 'draft' | 'identical' | 'none' | null
  review: 'pending' | 'approved'
  green: boolean
  checks: ScanChecks | null
  uncertainCount: number
  differenceCount: number | null
  usage: { inputTokens: number; outputTokens: number; passes: number } | null
}

export interface ScanUncertain {
  text: string
  kind: 'illegible' | 'printing_error' | 'punctuation' | 'reads_differ' | 'other'
  note: string
  suggestion?: string
}

export interface ScanDetail {
  scan: ScanRow
  hasImage: boolean
  /** The scan's own page first, then any page joined to it. */
  parts: { id: string; pageNo: number; hasImage: boolean }[]
  reading: { text: string; printedWordCount: number | null; complete: boolean; uncertain: ScanUncertain[] } | null
  compare: { liveVersion: number; liveWords: number; differenceCount: number; differences: { index: number; live: string; scan: string }[] } | null
  draft: { id: string; version: number; masterText: string; checkpoints: number[]; reviewStatus: string; wordCount: number } | null
  dictation: { id: string; title: string; videoCount: number; published: boolean; activeTextVersion: number | null } | null
}
