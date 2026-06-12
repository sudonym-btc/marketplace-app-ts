import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from 'lucide-react'

import { Button, cn } from '../components/ui'
import { formatCodeHint } from './formatCodeHint'

export const showCodeStorageKey = 'show_code'
const hideDelayMs = 220
const restoreDelayMs = 5_000

type CodeHighlightModule = typeof import('./highlightCode')

let codeHighlightModulePromise: Promise<CodeHighlightModule> | undefined

function loadCodeHighlightModule(): Promise<CodeHighlightModule> {
  codeHighlightModulePromise ??= import('./highlightCode')
  return codeHighlightModulePromise
}

type CodeHintsContextValue = {
  showCode: boolean
  setShowCode(showCode: boolean): void
}

const CodeHintsContext = createContext<CodeHintsContextValue | undefined>(undefined)

function readStoredShowCode(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const stored = window.localStorage.getItem(showCodeStorageKey)
    if (stored === null) return true
    return stored !== 'false'
  } catch {
    return true
  }
}

export function CodeHintsProvider({ children }: { children: ReactNode }) {
  const [showCode, setShowCodeState] = useState(readStoredShowCode)

  const setShowCode = useCallback((nextShowCode: boolean) => {
    setShowCodeState(nextShowCode)
    try {
      window.localStorage.setItem(showCodeStorageKey, String(nextShowCode))
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }, [])

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== showCodeStorageKey) return
      setShowCodeState(event.newValue !== 'false')
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const value = useMemo<CodeHintsContextValue>(
    () => ({ showCode, setShowCode }),
    [setShowCode, showCode],
  )

  return <CodeHintsContext.Provider value={value}>{children}</CodeHintsContext.Provider>
}

export function useCodeHints(): CodeHintsContextValue {
  const context = useContext(CodeHintsContext)
  if (!context) throw new Error('useCodeHints must be used within CodeHintsProvider')
  return context
}

type CodeHintProps = {
  code: string | string[]
  children: ReactNode
  className?: string
  language?: string
}

type HighlightedCodeProps = {
  code: string
  className?: string
  language: string
}

function HighlightedCode({ className, code, language }: HighlightedCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | undefined>()

  useEffect(() => {
    let isCurrent = true
    setHighlightedHtml(undefined)

    loadCodeHighlightModule()
      .then(({ highlightCodeBlock }) => highlightCodeBlock(code, language))
      .then(html => {
        if (isCurrent) setHighlightedHtml(html)
      })
      .catch(() => {
        if (isCurrent) setHighlightedHtml(undefined)
      })

    return () => {
      isCurrent = false
    }
  }, [code, language])

  if (highlightedHtml) {
    return (
      <div
        className={cn('code-hint-highlighted', className)}
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
    )
  }

  return (
    <code className={cn('max-w-full rounded-md border border-border/60 bg-background/80 px-2.5 py-1.5 font-mono text-[11px] leading-5 text-foreground shadow-sm [overflow-wrap:anywhere]', className)}>
      {code.split('\n').map((line, index) => (
        <span key={`${line}:${index}`} className="block">
          {line}
        </span>
      ))}
    </code>
  )
}

type FullscreenRect = {
  height: number
  left: number
  top: number
  width: number
}

function targetFullscreenRect(): FullscreenRect {
  const margin = window.matchMedia('(max-width: 720px)').matches ? 10 : 24
  return {
    height: Math.max(240, window.innerHeight - margin * 2),
    left: margin,
    top: margin,
    width: Math.max(280, window.innerWidth - margin * 2),
  }
}

export function CodeHint({ children, className, code, language = 'tsx' }: CodeHintProps) {
  const { showCode } = useCodeHints()
  const [temporarilyHidden, setTemporarilyHidden] = useState(false)
  const [fullscreenRect, setFullscreenRect] = useState<FullscreenRect | null>(null)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const restoreTimerRef = useRef<number | undefined>(undefined)
  const lines = Array.isArray(code) ? code : [code]
  const codeText = lines.map(formatCodeHint).join('\n')
  const fullscreenTarget = fullscreenRect && typeof window !== 'undefined'
    ? targetFullscreenRect()
    : null
  const fullscreenStyle = fullscreenRect && fullscreenTarget
    ? {
        height: `${fullscreenTarget.height}px`,
        left: `${fullscreenTarget.left}px`,
        top: `${fullscreenTarget.top}px`,
        width: `${fullscreenTarget.width}px`,
        '--code-hint-start-x': `${fullscreenRect.left - fullscreenTarget.left}px`,
        '--code-hint-start-y': `${fullscreenRect.top - fullscreenTarget.top}px`,
        '--code-hint-start-scale-x': String(fullscreenRect.width / fullscreenTarget.width),
        '--code-hint-start-scale-y': String(fullscreenRect.height / fullscreenTarget.height),
      } as CSSProperties
    : undefined

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === undefined) return
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = undefined
  }, [])

  const clearRestoreTimer = useCallback(() => {
    if (restoreTimerRef.current === undefined) return
    window.clearTimeout(restoreTimerRef.current)
    restoreTimerRef.current = undefined
  }, [])

  const hideHint = useCallback(() => {
    clearHideTimer()
    clearRestoreTimer()
    setTemporarilyHidden(true)
  }, [clearHideTimer, clearRestoreTimer])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      hideHint()
      hideTimerRef.current = undefined
    }, hideDelayMs)
  }, [clearHideTimer, hideHint])

  const keepHintVisible = useCallback(() => {
    clearHideTimer()
    clearRestoreTimer()
    setTemporarilyHidden(false)
  }, [clearHideTimer, clearRestoreTimer])

  const scheduleRestore = useCallback(() => {
    clearHideTimer()
    clearRestoreTimer()
    restoreTimerRef.current = window.setTimeout(() => {
      setTemporarilyHidden(false)
      restoreTimerRef.current = undefined
    }, restoreDelayMs)
  }, [clearHideTimer, clearRestoreTimer])

  const closeFullscreen = useCallback(() => {
    setFullscreenRect(null)
  }, [])

  const openFullscreen = useCallback(() => {
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    clearHideTimer()
    clearRestoreTimer()
    setFullscreenRect({
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    })
  }, [clearHideTimer, clearRestoreTimer])

  const handlePanelClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    openFullscreen()
  }, [openFullscreen])

  const handlePanelKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openFullscreen()
  }, [openFullscreen])

  useEffect(() => () => {
    clearHideTimer()
    clearRestoreTimer()
  }, [clearHideTimer, clearRestoreTimer])

  useEffect(() => {
    if (!fullscreenRect) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') closeFullscreen()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeFullscreen, fullscreenRect])

  if (!showCode) return <>{children}</>

  return (
    <div
      className={cn('relative min-w-0', className)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleRestore()
      }}
      onFocusCapture={event => {
        const target = event.target as HTMLElement | null
        if (target?.closest('[data-code-hint-panel="true"]')) keepHintVisible()
        else hideHint()
      }}
      onPointerEnter={scheduleHide}
      onPointerLeave={scheduleRestore}
    >
      {children}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-20 flex items-start justify-center overflow-visible rounded-[inherit] border border-primary/20 bg-background/55 p-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_40px_rgba(0,0,0,0.18)] backdrop-blur-md transition-opacity duration-500',
          temporarilyHidden ? 'opacity-0' : 'opacity-100',
        )}
      >
        <div
          className={cn(
            'sticky top-4 mt-4 max-h-[calc(100dvh-2rem)] max-w-full cursor-zoom-in overflow-auto rounded-md',
            temporarilyHidden ? 'pointer-events-none' : 'pointer-events-auto',
          )}
          data-code-hint-panel="true"
          onClick={handlePanelClick}
          onFocus={keepHintVisible}
          onKeyDown={handlePanelKeyDown}
          onPointerEnter={keepHintVisible}
          onPointerLeave={scheduleHide}
          ref={panelRef}
          role="button"
          tabIndex={temporarilyHidden ? -1 : 0}
        >
          <HighlightedCode code={codeText} language={language} />
        </div>
      </div>
      {fullscreenRect && fullscreenStyle && createPortal(
        <div
          aria-modal="true"
          className="fixed inset-0 z-[90] bg-background/70 p-0 backdrop-blur-md"
          onClick={closeFullscreen}
          role="dialog"
        >
          <section
            className="code-hint-fullscreen fixed grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
            onClick={event => event.stopPropagation()}
            style={fullscreenStyle}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-3 py-2">
              <p className="truncate font-mono text-xs text-muted-foreground">Marketplace SDK call</p>
              <Button
                aria-label="Close code hint"
                onClick={closeFullscreen}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <XIcon aria-hidden="true" className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 overflow-auto p-3">
              <HighlightedCode className="code-hint-highlighted-fullscreen" code={codeText} language={language} />
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}
