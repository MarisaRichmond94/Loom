// Server-safe extractor for TipTap doc JSON → plain text. The browser
// path (htmlToPlainText in clipboardFormatting) relies on the DOM and
// won't run inside a Next.js route handler, so this walker traverses
// the TipTap node tree directly. Used by search to scan prose without
// needing to render HTML first.

type TipTapNode = {
  type?: string
  text?: string
  content?: TipTapNode[]
}

const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'listItem',
  'bulletList', 'orderedList', 'codeBlock',
])

function walk(node: TipTapNode, out: string[]): void {
  if (typeof node.text === 'string') {
    out.push(node.text)
    return
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, out)
  }
  if (node.type === 'hardBreak') {
    out.push('\n')
    return
  }
  if (node.type && BLOCK_TYPES.has(node.type)) {
    out.push('\n\n')
  }
}

export function extractTextFromTipTap(json: string | null | undefined): string {
  if (!json) return ''
  // Legacy plain-text rows (pre-TipTap migration) — return as-is.
  if (!json.trimStart().startsWith('{')) return json
  try {
    const parsed = JSON.parse(json) as TipTapNode
    const parts: string[] = []
    walk(parsed, parts)
    return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
  } catch {
    return ''
  }
}
