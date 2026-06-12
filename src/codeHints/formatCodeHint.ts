const indentText = '    '

type Container = 'array' | 'object' | 'paren'

function appendNewline(output: string[], indentLevel: number): void {
  while (output.length > 0 && output[output.length - 1] === ' ') output.pop()
  if (output[output.length - 1] !== '\n') output.push('\n')
  output.push(indentText.repeat(Math.max(0, indentLevel)))
}

function readStringLiteral(code: string, startIndex: number): { nextIndex: number; value: string } {
  const quote = code[startIndex]
  let index = startIndex + 1
  let value = quote

  while (index < code.length) {
    const char = code[index]
    value += char
    index += 1

    if (char === '\\') {
      if (index < code.length) {
        value += code[index]
        index += 1
      }
      continue
    }

    if (char === quote) break
  }

  return { nextIndex: index, value }
}

function skipHorizontalWhitespace(code: string, startIndex: number): number {
  let index = startIndex
  while (code[index] === ' ' || code[index] === '\t') index += 1
  return index
}

export function formatCodeHint(code: string): string {
  const trimmedCode = code.trim()

  const output: string[] = []
  const containers: Container[] = []
  let indentLevel = 0
  let index = 0

  while (index < trimmedCode.length) {
    const char = trimmedCode[index]

    if (char === '"' || char === "'" || char === '`') {
      const literal = readStringLiteral(trimmedCode, index)
      output.push(literal.value)
      index = literal.nextIndex
      continue
    }

    if (char === '(') {
      const nextIndex = skipHorizontalWhitespace(trimmedCode, index + 1)
      if (trimmedCode[nextIndex] === ')') {
        output.push('()')
        index = nextIndex + 1
        continue
      }
      containers.push('paren')
      output.push(char)
      indentLevel += 1
      appendNewline(output, indentLevel)
      index = skipHorizontalWhitespace(trimmedCode, index + 1)
      continue
    }

    if (char === ')') {
      if (containers[containers.length - 1] === 'paren') containers.pop()
      indentLevel -= 1
      appendNewline(output, indentLevel)
      output.push(char)
      index = skipHorizontalWhitespace(trimmedCode, index + 1)
      continue
    }

    if (char === '[') {
      containers.push('array')
      output.push(char)
      index += 1
      continue
    }

    if (char === ']') {
      if (containers[containers.length - 1] === 'array') containers.pop()
      output.push(char)
      index += 1
      continue
    }

    if (char === '{') {
      containers.push('object')
      output.push(char)
      indentLevel += 1
      appendNewline(output, indentLevel)
      index = skipHorizontalWhitespace(trimmedCode, index + 1)
      continue
    }

    if (char === '}') {
      if (containers[containers.length - 1] === 'object') containers.pop()
      indentLevel -= 1
      appendNewline(output, indentLevel)
      output.push(char)
      index = skipHorizontalWhitespace(trimmedCode, index + 1)
      continue
    }

    if (char === ',' && (containers[containers.length - 1] === 'object' || containers[containers.length - 1] === 'paren')) {
      output.push(char)
      appendNewline(output, indentLevel)
      index = skipHorizontalWhitespace(trimmedCode, index + 1)
      continue
    }

    output.push(char)
    index += 1
  }

  return output.join('').trim()
}
