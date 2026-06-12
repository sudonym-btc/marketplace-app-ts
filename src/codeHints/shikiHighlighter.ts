import javascript from '@shikijs/langs/javascript'
import jsx from '@shikijs/langs/jsx'
import tsx from '@shikijs/langs/tsx'
import typescript from '@shikijs/langs/typescript'
import githubDarkDimmed from '@shikijs/themes/github-dark-dimmed'
import githubLight from '@shikijs/themes/github-light'
import type { Highlighter } from 'shiki'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const codeHintHighlighter = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [javascript, jsx, typescript, tsx],
  themes: [githubDarkDimmed, githubLight],
}) as Promise<Highlighter>

export function getCodeHintHighlighter(): Promise<Highlighter> {
  return codeHintHighlighter
}
