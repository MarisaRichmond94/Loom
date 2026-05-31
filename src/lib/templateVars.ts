// Inline variable templates in prose. Two forms:
//
//   {{var}}                            substitute the storyState value
//   {{var ? a : b}}                    truthy/falsy on storyState[var]
//   {{var OP literal ? a : b}}         comparison (>, <, >=, <=, ==, !=)
//
// Branches are unquoted text by default (trimmed). Wrap in '...' or "..."
// to preserve whitespace, include a colon, or emit an empty string.
//
// Unknown variables and malformed templates render as the literal {{...}}
// text — the writer sees their typo and the prose stays readable.

export type ComparisonOp = '>' | '<' | '>=' | '<=' | '==' | '!='

export type ParsedCondition =
  | { kind: 'truthy';  name: string }
  | { kind: 'compare'; name: string; op: ComparisonOp; literal: number | string }

export type ParsedTemplate =
  | { kind: 'var';     name: string }
  | { kind: 'ternary'; cond: ParsedCondition; a: string; b: string }

export type TemplateMatch = {
  start: number
  end: number
  raw: string
  parsed: ParsedTemplate | null
}

const IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/

// Given `s` and the index of a `{{` opener, walk forward and return the
// index of the matching `}}` accounting for nested templates and quoted
// strings. Returns -1 if no balanced closer is found.
function findMatchingClose(s: string, openIdx: number): number {
  let i = openIdx + 2
  let depth = 1
  while (i < s.length) {
    const c = s[i]
    if (c === "'" || c === '"') {
      const end = s.indexOf(c, i + 1)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if (s.startsWith('{{', i)) { depth++; i += 2; continue }
    if (s.startsWith('}}', i)) {
      depth--
      if (depth === 0) return i
      i += 2
      continue
    }
    i++
  }
  return -1
}

// Returns the index of the first top-level (outside quotes AND outside any
// nested {{...}} span) occurrence of `needle` in `s`, starting at `from`.
// Lets a quoted branch contain a literal `:`, and a nested ternary contain
// its own `?` / `:` without confusing the outer split.
function findTopLevel(s: string, needle: string, from = 0): number {
  let i = from
  while (i < s.length) {
    const c = s[i]
    if (c === "'" || c === '"') {
      const end = s.indexOf(c, i + 1)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if (s.startsWith('{{', i)) {
      const close = findMatchingClose(s, i)
      if (close === -1) return -1
      i = close + 2
      continue
    }
    if (s.startsWith(needle, i)) return i
    i++
  }
  return -1
}

function parseBranch(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function parseLiteral(raw: string): number | string | null {
  const t = raw.trim()
  if (t.length >= 2) {
    const first = t[0]
    const last = t[t.length - 1]
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return t.slice(1, -1)
    }
  }
  if (NUMBER_RE.test(t)) return Number(t)
  return null
}

function parseCondition(raw: string): ParsedCondition | null {
  const trimmed = raw.trim()
  if (IDENT_RE.test(trimmed)) return { kind: 'truthy', name: trimmed }

  // Try longer operators first so `>=` doesn't match as `>`.
  const ops: ComparisonOp[] = ['>=', '<=', '==', '!=', '>', '<']
  for (const op of ops) {
    const idx = findTopLevel(trimmed, op)
    if (idx === -1) continue
    const lhs = trimmed.slice(0, idx).trim()
    const rhs = trimmed.slice(idx + op.length).trim()
    if (!IDENT_RE.test(lhs)) return null
    const literal = parseLiteral(rhs)
    if (literal === null) return null
    return { kind: 'compare', name: lhs, op, literal }
  }
  return null
}

function parseInner(inner: string): ParsedTemplate | null {
  const qIdx = findTopLevel(inner, '?')
  if (qIdx === -1) {
    const trimmed = inner.trim()
    if (IDENT_RE.test(trimmed)) return { kind: 'var', name: trimmed }
    return null
  }
  const condRaw = inner.slice(0, qIdx)
  const afterQ = inner.slice(qIdx + 1)
  const cIdx = findTopLevel(afterQ, ':')
  if (cIdx === -1) return null
  const aRaw = afterQ.slice(0, cIdx)
  const bRaw = afterQ.slice(cIdx + 1)
  const cond = parseCondition(condRaw)
  if (!cond) return null
  return { kind: 'ternary', cond, a: parseBranch(aRaw), b: parseBranch(bRaw) }
}

export function findVarTemplates(text: string): TemplateMatch[] {
  const out: TemplateMatch[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{{', i)
    if (open === -1) break
    // findMatchingClose accounts for nested {{...}} so the outer template
    // doesn't stop at the inner's closer.
    const close = findMatchingClose(text, open)
    if (close === -1) break
    const inner = text.slice(open + 2, close)
    out.push({
      start: open,
      end: close + 2,
      raw: text.slice(open, close + 2),
      parsed: parseInner(inner),
    })
    i = close + 2
  }
  return out
}

// Flat list of every template span — outer and nested — with the variable
// name each one references (or null for malformed). Used by the editor
// highlighter so each `{{...}}` lights up independently, even when one is
// embedded inside another's branch.
export type TemplateRange = { start: number; end: number; name: string | null }

export function findAllTemplateRanges(text: string, base = 0): TemplateRange[] {
  const out: TemplateRange[] = []
  for (const m of findVarTemplates(text)) {
    let name: string | null = null
    if (m.parsed?.kind === 'var') name = m.parsed.name
    else if (m.parsed?.kind === 'ternary') name = m.parsed.cond.name
    out.push({ start: base + m.start, end: base + m.end, name })
    // Recurse into the raw inner content. The offset is `open + 2` from
    // the outer's start, so absolute positions stay correct.
    const innerBase = base + m.start + 2
    const inner = text.slice(m.start + 2, m.end - 2)
    out.push(...findAllTemplateRanges(inner, innerBase))
  }
  return out
}

export function evalCondition(
  cond: ParsedCondition,
  storyState: Record<string, unknown>,
): boolean | null {
  if (!(cond.name in storyState)) return null
  const val = storyState[cond.name]
  if (cond.kind === 'truthy') return Boolean(val)

  if (cond.op === '>' || cond.op === '<' || cond.op === '>=' || cond.op === '<=') {
    const lhs = Number(val)
    const rhs = Number(cond.literal)
    if (Number.isNaN(lhs) || Number.isNaN(rhs)) return false
    switch (cond.op) {
      case '>':  return lhs > rhs
      case '<':  return lhs < rhs
      case '>=': return lhs >= rhs
      case '<=': return lhs <= rhs
    }
  }
  // == / != coerce both sides to the literal's type so the writer's
  // intent ("povName == 'Jared'" is a string compare) is preserved.
  const litIsNum = typeof cond.literal === 'number'
  const coercedLhs = litIsNum ? Number(val) : String(val)
  const coercedRhs = cond.literal
  if (litIsNum && Number.isNaN(coercedLhs as number)) return cond.op === '!='
  return cond.op === '==' ? coercedLhs === coercedRhs : coercedLhs !== coercedRhs
}

export function substituteVarTemplates(
  text: string,
  storyState: Record<string, unknown>,
  escape: (s: string) => string,
): string {
  const matches = findVarTemplates(text)
  if (matches.length === 0) return text
  let out = ''
  let cursor = 0
  for (const m of matches) {
    out += text.slice(cursor, m.start)
    const replacement = resolveMatch(m, storyState, escape)
    out += replacement ?? m.raw
    cursor = m.end
  }
  out += text.slice(cursor)
  return out
}

function resolveMatch(
  m: TemplateMatch,
  storyState: Record<string, unknown>,
  escape: (s: string) => string,
): string | null {
  if (!m.parsed) return null
  if (m.parsed.kind === 'var') {
    if (!(m.parsed.name in storyState)) return null
    // storyState values are raw text — escape on the way to HTML.
    return escape(String(storyState[m.parsed.name]))
  }
  const result = evalCondition(m.parsed.cond, storyState)
  if (result === null) return null
  // Branch text comes from the editor and has already been rendered to
  // valid HTML by TipTap (the writer can't inject raw markup; TipTap
  // escapes unsafe input). If the writer toggled a mark mid-template the
  // branch may legitimately contain things like `<em> </em>` — those
  // need to reach the DOM as real tags, not as escaped text.
  // Recurse so nested {{...}} inside a branch gets evaluated too —
  // {{outer ? {{inner ? x : y}} text : z}} works naturally.
  const branch = result ? m.parsed.a : m.parsed.b
  return substituteVarTemplates(branch, storyState, escape)
}
