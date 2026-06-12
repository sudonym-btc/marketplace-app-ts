import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const themeStorageKey = 'marketplace.theme'

const darkMediaQuery = '(prefers-color-scheme: dark)'

type ThemeContextValue = {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference(preference: ThemePreference): void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = window.localStorage.getItem(themeStorageKey)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia(darkMediaQuery).matches ? 'dark' : 'light'
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? readSystemTheme() : preference
}

function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readStoredPreference()))

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference)
    try {
      if (nextPreference === 'system') {
        window.localStorage.removeItem(themeStorageKey)
      } else {
        window.localStorage.setItem(themeStorageKey, nextPreference)
      }
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }, [])

  useEffect(() => {
    function updateResolvedTheme() {
      const nextTheme = resolveTheme(preference)
      setResolvedTheme(nextTheme)
      applyTheme(nextTheme)
    }

    updateResolvedTheme()
    if (preference !== 'system') return undefined

    const media = window.matchMedia(darkMediaQuery)
    media.addEventListener('change', updateResolvedTheme)
    return () => media.removeEventListener('change', updateResolvedTheme)
  }, [preference])

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== themeStorageKey) return
      setPreferenceState(isThemePreference(event.newValue) ? event.newValue : 'system')
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
