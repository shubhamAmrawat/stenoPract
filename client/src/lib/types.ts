export type Role = 'user' | 'admin'
export type Category = 'general' | 'reserved'

export interface User {
  id: string
  email: string
  name: string
  picture: string | null
  role: Role
  settings: { examProfile: string; category: Category }
  phone: string | null
  gender: 'female' | 'male' | 'other' | 'prefer-not-to-say' | null
  bio: string | null
  signInMethod: 'google' | 'password'
  memberSince: string | null
  /** The student has uploaded a photo of their own. */
  hasCustomPhoto: boolean
  /** The server has photo storage set up. */
  canUploadPhoto: boolean
}

export interface ExamProfile {
  code: string
  name: string
  wpm: number
  durationMin: number
  words: number
  limits: { general: number; reserved: number }
  verifiedAgainstNotice: boolean
}

export interface DictationState {
  seen: boolean
  favourite: boolean
  folderIds: string[]
  attemptsCount: number
  bestErrorPct: number | null
  lastErrorPct: number | null
  lastAttemptAt: string | null
}

export interface Video {
  youtubeVideoId: string
  baseWpm: number
  title: string | null
}

export interface Dictation {
  id: string
  setId: string
  exerciseNo: number
  title: string
  videos: Video[]
  masterWordCount: number
  tags: string[]
  ready: boolean
  state: DictationState
}

export interface DictationSet {
  id: string
  slug: string
  title: string
  description: string | null
  source: string | null
  coverVideoId: string | null
  dictationCount: number
  readyCount: number
  seenCount: number
  attemptedCount: number
}

export interface Folder {
  id: string
  name: string
  color: string
  count: number
}

export type MistakeKind =
  | 'omission'
  | 'addition'
  | 'repetition'
  | 'substitution'
  | 'incomplete_word'
  | 'abbreviation'
  | 'all_caps'
  | 'spelling'
  | 'plural'
  | 'full_stop'
  | 'capitalisation'
  | 'comma'

export interface DiffOp {
  t: 'm' | 's' | 'd' | 'i'
  m?: string
  a?: string
  k?: MistakeKind[]
}

export interface Mistake {
  kind: MistakeKind
  weight: 1 | 0.5
  pos: number
  masterIndex?: number
  master?: string
  attempt?: string
}

export interface AttemptResult {
  full: number
  half: number
  masterWords: number
  attemptWords: number
  errorPct: number
  limitPct: number | null
  passed: boolean | null
  accuracyPct: number | null
  breakdown: Partial<Record<MistakeKind, number>>
  diff: DiffOp[]
}

export interface Attempt {
  id: string
  dictationId: string
  textVersion: number
  examProfile: string
  category: Category
  status: 'draft' | 'submitted'
  typedText: string
  listenedWpm: number | null
  startedAt: string
  deadlineAt: string
  durationSec: number
  submittedAt: string | null
  timeTakenSec: number | null
  overtimeSec: number | null
  autoSubmitted: boolean
  serverNow: string
  result?: AttemptResult
  mistakes?: Mistake[]
  masterText?: string | null
}

export interface AttemptSummary {
  id: string
  dictationId: string
  dictationTitle: string | null
  exerciseNo: number | null
  examProfile: string
  category: Category
  status: 'draft' | 'submitted'
  startedAt: string
  submittedAt: string | null
  timeTakenSec: number | null
  full: number | null
  half: number | null
  errorPct: number | null
  limitPct: number | null
  passed: boolean | null
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

/** A shelf on the Resources area. `group` is its address (/resources/<group>). */
export interface ResourceGroup {
  id: string
  group: string
  title: string
  blurb: string
  order: number
  published: boolean
  /** How many files it holds (files students can see, on the student side). */
  count?: number
}

export interface ResourceItem {
  id: string
  group: string
  title: string
  url: string
  /** Uploaded to our own storage (as opposed to a link to somewhere else). */
  uploaded: boolean
  /** File size in bytes, for uploaded files. */
  size: number | null
  order: number
  published: boolean
}

export interface TranscriptResponse {
  exerciseNo: number
  version: number
  wordCount: number
  paragraphs: string[]
}
