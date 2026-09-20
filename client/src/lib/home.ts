/** Small pure helpers for the student home page. Kept separate so they can be checked without a browser. */

/** A greeting that matches the student's own clock. 00:00-04:59 is deliberately not "morning". */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 24) return 'Good evening'
  return 'Burning the midnight oil'
}

/**
 * First name, tidied for display. Google accounts often hand us "SHUBHAM AMRAWAT" or "shubham";
 * mixed-case names ("McDonald", "Anne-Marie") are left exactly as the student wrote them.
 */
export function displayFirstName(full: string | undefined | null): string {
  const first = (full ?? '').trim().split(/\s+/)[0] ?? ''
  if (!first) return ''
  const shouted = first === first.toUpperCase() && first !== first.toLowerCase()
  const flat = first === first.toLowerCase()
  if (!shouted && !flat) return first
  return first.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

/** Calendar date (YYYY-MM-DD) of an instant in a given IANA time zone. */
export function dateKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

const dayMs = 86_400_000
const utcDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

export interface WeekDay {
  key: string
  /** Single-letter weekday, e.g. "M". */
  letter: string
  /** Full weekday name, for screen readers and tooltips. */
  name: string
  done: boolean
  today: boolean
}

/**
 * The last seven calendar days ending today, in the student's time zone. Plain calendar arithmetic on the
 * date key, so daylight-saving changes cannot skip or repeat a day.
 */
export function lastSevenDays(now: Date, timeZone: string, practised: ReadonlySet<string>): WeekDay[] {
  const todayKey = dateKey(now, timeZone)
  const base = utcDay(todayKey)
  const out: WeekDay[] = []
  for (let i = 6; i >= 0; i--) {
    const day = new Date(base - i * dayMs)
    const key = day.toISOString().slice(0, 10)
    const name = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' }).format(day)
    out.push({ key, letter: name[0]!, name, done: practised.has(key), today: i === 0 })
  }
  return out
}

/** Short, practical notes. The scoring ones mirror how this platform marks a transcript. */
export const STENO_TIPS: readonly string[] = [
  'Spelling slips, singular for plural, and a missed full stop are only half mistakes. An omitted, added or substituted word costs a full one.',
  'Repeating a word counts as a full mistake. When you are catching up with the speaker, write it once and move on.',
  'An incomplete word is a full mistake. If you cannot finish an outline in time, write your best full form when you transcribe.',
  'Write what you heard: an abbreviation in place of the full form, or the reverse, counts as a full mistake.',
  'Figures are accepted as numerals or in words. Use whichever you can write faster and stay with it.',
  'Both “Hon’ble” and “Honourable” are accepted. Do not spend a second deciding.',
  'A transcript typed in all capitals is a full mistake against normal-case text. Check Caps Lock before you begin.',
  'A proper noun needs its capital letter, and so does the first word of a sentence. Both are half mistakes, and easy to avoid.',
  'Listen one phrase ahead. Your hand writes the phrase you have just heard while your ear takes the next one.',
  'Do not stop for a word you missed. Leave a gap, keep the rhythm, and fill it in from context while transcribing.',
  'Leave a wide margin in your notebook. Corrections and late additions go there, never squeezed between lines.',
  'Read your transcript once against your outlines before you submit. Most slips are caught on the second look.',
  'Five minutes on your weak words after an attempt is worth more than another fresh dictation.',
  'Short daily sessions build the hand better than one long weekend push.',
  'Practise an outline until you no longer have to think about it. Speed comes from shapes that write themselves.',
  'Sit with your back supported and the notebook on a steady surface. A relaxed hand is a fast hand.',
  'Choose a pen or pencil you never have to press with. Light pressure keeps you moving for the full dictation.',
  'When you slip, let it go. Dwelling on one word costs you the next three.',
  'Take the first dictation of the day slowly. Accuracy first; speed follows once the hand is warm.',
  'Once in a while, practise slightly above your target speed. Your exam pace will feel comfortable afterwards.',
  'Punctuation is part of the dictation. Listen for the pauses and mark them as you write.',
  'Listen for the final \u201cs\u201d. Dropping it turns a plural into a singular, and that is a half mistake.',
  'A rested hand and ear are worth more than one more late-night session before the exam.',
  'After transcribing, glance at the start and end of every sentence. Capitals and full stops hide there.',
]

/** One tip per calendar day, the same for everyone that day and never random on re-render. */
export function tipForDay(now: Date, timeZone: string): string {
  const n = Math.floor(utcDay(dateKey(now, timeZone)) / dayMs)
  return STENO_TIPS[((n % STENO_TIPS.length) + STENO_TIPS.length) % STENO_TIPS.length]!
}
