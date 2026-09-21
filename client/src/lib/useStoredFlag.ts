import { useCallback, useState } from 'react'

/** Remembers a yes/no choice in this browser. Storage can be blocked, so every access is guarded. */
export function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? initial : v === '1'
    } catch {
      return initial
    }
  })
  const set = useCallback((v: boolean) => {
    setValue(v)
    try { localStorage.setItem(key, v ? '1' : '0') } catch { /* ignore */ }
  }, [key])
  return [value, set]
}

/** Exam mode is a practice preference kept in this browser (see DictationPage and WritePage). */
export const EXAM_MODE_KEY = 'steno.examMode'
export const HALL_SOUND_KEY = 'steno.hallSound'
