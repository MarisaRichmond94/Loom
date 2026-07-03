// The text-editor color palette: the swatches offered by the TipTap
// toolbar. Client-safe module (types + defaults only) — persistence lives
// in /api/settings/editor-colors, consumption in useEditorColors.

export type EditorColor = { label: string; value: string }

export const DEFAULT_EDITOR_COLORS: EditorColor[] = [
  { label: 'Red',    value: '#ef4444' },
  { label: 'Rose',   value: '#f43f5e' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Amber',  value: '#f59e0b' },
  { label: 'Emerald', value: '#10b981' },
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Gray',   value: '#9ca3af' },
]

export function sanitizeEditorColors(raw: unknown): EditorColor[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 24) return null
  const out: EditorColor[] = []
  for (const item of raw) {
    const label = typeof item?.label === 'string' ? item.label.trim() : ''
    const value = typeof item?.value === 'string' ? item.value.trim().toLowerCase() : ''
    if (!label || !/^#[0-9a-f]{6}$/.test(value)) return null
    out.push({ label, value })
  }
  return out
}
