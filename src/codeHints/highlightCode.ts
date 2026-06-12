import rehypePrettyCode from 'rehype-pretty-code'
import rehypeStringify from 'rehype-stringify'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

import { getCodeHintHighlighter } from './shikiHighlighter'

const defaultLanguage = 'tsx'

const processor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypePrettyCode, {
    defaultLang: {
      block: defaultLanguage,
      inline: defaultLanguage,
    },
    getHighlighter: getCodeHintHighlighter,
    keepBackground: false,
    theme: {
      dark: 'github-dark-dimmed',
      light: 'github-light',
    },
  })
  .use(rehypeStringify)

const highlightedCodeCache = new Map<string, Promise<string>>()

function normalizeLanguage(language: string): string {
  return language.trim().replace(/[^\w#+.-]/g, '') || defaultLanguage
}

function createFence(code: string): string {
  const longestBacktickRun = Math.max(0, ...Array.from(code.matchAll(/`+/g), match => match[0].length))
  return '`'.repeat(Math.max(3, longestBacktickRun + 1))
}

async function highlightCode(code: string, language: string): Promise<string> {
  const fence = createFence(code)
  const file = await processor.process(`${fence}${language}\n${code}\n${fence}`)
  return String(file)
}

export function highlightCodeBlock(code: string, language = defaultLanguage): Promise<string> {
  const normalizedLanguage = normalizeLanguage(language)
  const cacheKey = `${normalizedLanguage}\0${code}`
  const cached = highlightedCodeCache.get(cacheKey)
  if (cached) return cached

  const highlighted = highlightCode(code, normalizedLanguage).catch(error => {
    highlightedCodeCache.delete(cacheKey)
    throw error
  })
  highlightedCodeCache.set(cacheKey, highlighted)
  return highlighted
}
