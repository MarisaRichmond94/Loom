// Case-insensitive substring replace inside a TipTap doc JSON. Walks
// every text node and rewrites its `text` property in place. Marks are
// preserved because we only touch the leaf text — node structure stays
// intact. Matches that span across two adjacent text nodes with
// different marks won't be found (same limitation the search
// highlighter has), but that's a niche case for prose.
//
// Returns the updated JSON string + the count of replacements made.
// When count is 0 the original input is returned untouched (avoids a
// noisy serialize/parse round-trip when nothing changed).

type TipTapNode = {
  type?: string
  text?: string
  content?: TipTapNode[]
  marks?: unknown
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function walk(node: TipTapNode, pattern: RegExp, replacement: string, counter: { n: number }): void {
  if (typeof node.text === 'string') {
    let count = 0
    const replaced = node.text.replace(pattern, () => {
      count++
      return replacement
    })
    if (count > 0) {
      node.text = replaced
      counter.n += count
    }
    return
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, pattern, replacement, counter)
  }
}

export function replaceInTipTapJson(
  json: string | null | undefined,
  find: string,
  replacement: string,
): { json: string | null; count: number } {
  if (!json || !find) return { json: json ?? null, count: 0 }
  // Legacy plain-text rows (pre-TipTap migration) — still searchable as
  // raw strings so we don't miss them. The substring replace runs the
  // same regex pattern.
  const pattern = new RegExp(escapeRegex(find), 'gi')
  if (!json.trimStart().startsWith('{')) {
    let count = 0
    const replaced = json.replace(pattern, () => { count++; return replacement })
    return { json: count > 0 ? replaced : json, count }
  }
  try {
    const parsed = JSON.parse(json) as TipTapNode
    const counter = { n: 0 }
    walk(parsed, pattern, replacement, counter)
    return counter.n > 0
      ? { json: JSON.stringify(parsed), count: counter.n }
      : { json, count: 0 }
  } catch {
    return { json, count: 0 }
  }
}

// For plain string columns (prompt, label). Same case-insensitive
// substring replace; returns the new value + count. Null/undefined
// input passes through unchanged.
export function replaceInString(
  raw: string | null | undefined,
  find: string,
  replacement: string,
): { value: string | null; count: number } {
  if (!raw || !find) return { value: raw ?? null, count: 0 }
  const pattern = new RegExp(escapeRegex(find), 'gi')
  let count = 0
  const replaced = raw.replace(pattern, () => { count++; return replacement })
  return count > 0 ? { value: replaced, count } : { value: raw, count: 0 }
}
