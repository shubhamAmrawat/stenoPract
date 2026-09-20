import { useCallback, useLayoutEffect, useRef } from 'react'
import { useAuth } from '../auth/AuthContext'
import { api } from './api'
import { resolveTheme, type ThemeId } from './themes'
import type { User } from './types'

const FALLBACK_BAR_COLOUR = '#4F46E5'

/**
 * Puts the theme on <html data-theme="...">. Runs before the browser paints, so there is no flash of the wrong
 * colours. Leaving the student area removes it again (the admin console keeps its own colours).
 */
export function useApplyTheme(theme: string | null | undefined): void {
  const id = resolveTheme(theme)
  useLayoutEffect(() => {
    const root = document.documentElement
    const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    root.dataset.theme = id
    const primary = getComputedStyle(root).getPropertyValue('--primary').trim()
    if (bar && primary) bar.content = primary
    return () => {
      delete root.dataset.theme
      if (bar) bar.content = FALLBACK_BAR_COLOUR
    }
  }, [id])
}

/** The signed-in student's theme, and a function that changes it right away and saves it to their account. */
export function useThemeChoice(): { theme: ThemeId; choose: (id: ThemeId) => Promise<void> } {
  const { user, setUser } = useAuth()
  const latest = useRef(0)
  const theme = resolveTheme(user?.theme)

  const choose = useCallback(
    async (id: ThemeId) => {
      if (!user || id === theme) return
      const before = user
      const ticket = ++latest.current
      setUser({ ...user, theme: id }) // the page changes colour immediately
      try {
        const r = await api<{ user: User }>('/me/profile', { method: 'PATCH', body: { theme: id } })
        if (ticket === latest.current) setUser(r.user)
      } catch (err) {
        if (ticket === latest.current) setUser(before) // saving failed: go back to what they had
        throw err
      }
    },
    [user, theme, setUser],
  )
  return { theme, choose }
}
