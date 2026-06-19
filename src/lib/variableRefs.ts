// Variable-reference extractors for the on-disk shapes used by conditions,
// templates, and choice setsVariables payloads. Lifted out of the
// variable-usage route so both that endpoint AND the per-chapter
// read-variables endpoint can share one implementation — divergence
// between the two walks would silently misclassify which choices a
// chapter depends on.

// {{varName}} or {{ varName ? ... : ... }} — we only need the var name
// at the head of the inner expression. The regex is intentionally cheap
// (single pass, no backtracking) and matches the same identifier shape
// that templateVars.ts accepts.
export const TEMPLATE_VAR_RE = /\{\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g

// Conditions ship as either the legacy `{a: 1, b: 2}` object (implicit
// AND of equalities) or the compound `{op, clauses: [{var, value}]}`
// shape. Both yield the same set of referenced variable names.
export function namesInCondition(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const c = JSON.parse(raw)
    if (c && typeof c === 'object') {
      if ('op' in c && Array.isArray((c as { clauses?: unknown }).clauses)) {
        const clauses = (c as { clauses: Array<{ var?: string }> }).clauses
        return clauses.map(cl => cl.var ?? '').filter(Boolean)
      }
      return Object.keys(c as Record<string, unknown>)
    }
  } catch { /* malformed — count as no references */ }
  return []
}

// Scans HTML-or-text for {{varName}} template heads. Reset lastIndex so
// the shared regex doesn't leak state across calls.
export function namesInTemplates(raw: string | null | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  TEMPLATE_VAR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TEMPLATE_VAR_RE.exec(raw)) !== null) out.push(m[1])
  return out
}

// Keys of the choice's setsVariables JSON — the variables a choice writes
// when picked. Always an object on disk; defensive parse for legacy or
// half-saved rows.
export function namesInSetsVariables(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object') return Object.keys(v as Record<string, unknown>)
  } catch { /* malformed */ }
  return []
}
