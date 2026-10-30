import * as React from "react"

export type Theme = "light" | "dark" | "system"
type ResolvedTheme = "light" | "dark"

const STORAGE_KEY = "evido.theme"
const QUERY = "(prefers-color-scheme: dark)"

// index.html of each app sets the initial class before first paint (no white
// flash in dark mode); keep its inline script in sync with STORAGE_KEY/QUERY.

function readTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === "light" || stored === "dark" ? stored : "system"
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(QUERY).matches ? "dark" : "light"
}

function apply(resolved: ResolvedTheme) {
  const root = document.documentElement
  // Avoid every element animating its colours during the switch.
  const style = document.createElement("style")
  style.textContent = "*,*::before,*::after{transition:none!important}"
  document.head.appendChild(style)
  root.classList.remove("light", "dark")
  root.classList.add(resolved)
  root.style.colorScheme = resolved
  window.getComputedStyle(document.body)
  requestAnimationFrame(() => style.remove())
}

type ThemeState = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeState | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(readTheme)
  const [system, setSystem] = React.useState<ResolvedTheme>(systemTheme)
  const resolvedTheme = theme === "system" ? system : theme

  React.useEffect(() => apply(resolvedTheme), [resolvedTheme])

  React.useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = () => setSystem(systemTheme())
    // Other tabs changing the theme.
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setThemeState(readTheme())
    }
    media.addEventListener("change", onChange)
    window.addEventListener("storage", onStorage)
    return () => {
      media.removeEventListener("change", onChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const setTheme = React.useCallback((next: Theme) => {
    if (next === "system") localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used within a ThemeProvider")
  return context
}
