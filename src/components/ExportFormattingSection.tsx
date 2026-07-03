'use client'

import { useEffect, useState } from 'react'
import { LuRotateCcw } from 'react-icons/lu'

// Settings section for manuscript-export formatting. Mirrors the shape of
// src/lib/exportFormatting.ts; every field PATCHes on change/blur so there's
// no explicit save. Defaults were measured from the author's real Pages
// manuscript, so "Reset to defaults" restores the canonical book look.

type Align = 'left' | 'center' | 'right' | 'justify'
type Style = {
  font: string; sizePt: number; color: string; align: Align
  spaceAfterPt: number; lineSpacing: number
  firstLineIndentIn?: number; letterSpacingPt?: number
}
type StyleKey = 'chapter' | 'pov' | 'date' | 'body' | 'sectionBreak' | 'footnote' | 'header'
type Formatting = {
  page: { widthIn: number; heightIn: number; marginTopIn: number; marginBottomIn: number; marginLeftIn: number; marginRightIn: number }
  styles: Record<StyleKey, Style>
  sectionBreakText: string
  runningHeaders: boolean
  pageNumbers: boolean
}

const STYLE_LABELS: Array<{ key: StyleKey; label: string; hint?: string }> = [
  { key: 'chapter', label: 'Chapter Number' },
  { key: 'pov', label: 'POV' },
  { key: 'date', label: 'Date' },
  { key: 'body', label: 'Body' },
  { key: 'sectionBreak', label: 'Section Break' },
  { key: 'footnote', label: 'Footnotes' },
  { key: 'header', label: 'Header & Footer' },
]

const PAGE_FIELDS: Array<{ key: keyof Formatting['page']; label: string }> = [
  { key: 'widthIn', label: 'Width' },
  { key: 'heightIn', label: 'Height' },
  { key: 'marginTopIn', label: 'Top' },
  { key: 'marginBottomIn', label: 'Bottom' },
  { key: 'marginLeftIn', label: 'Left' },
  { key: 'marginRightIn', label: 'Right' },
]

const inputCls = 'bg-surface-base border border-accent/20 rounded px-2 py-1.5 text-xs text-ink outline-none focus:border-accent'

export default function ExportFormattingSection() {
  const [formatting, setFormatting] = useState<Formatting | null>(null)

  useEffect(() => {
    fetch('/api/settings/export-formatting').then(r => r.json()).then(setFormatting)
  }, [])

  async function patch(body: object) {
    const res = await fetch('/api/settings/export-formatting', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) setFormatting(await res.json())
  }

  async function reset() {
    const res = await fetch('/api/settings/export-formatting', { method: 'DELETE' })
    if (res.ok) setFormatting(await res.json())
  }

  if (!formatting) return null

  function setPage(key: keyof Formatting['page'], value: number) {
    if (!Number.isFinite(value) || value <= 0) return
    setFormatting(f => f ? { ...f, page: { ...f.page, [key]: value } } : f)
    patch({ page: { [key]: value } })
  }

  function setStyle(key: StyleKey, field: keyof Style, value: string | number) {
    setFormatting(f => f ? { ...f, styles: { ...f.styles, [key]: { ...f.styles[key], [field]: value } } } : f)
    patch({ styles: { [key]: { [field]: value } } })
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs uppercase tracking-widest text-ink-faint">Manuscript Export</h2>
        <button
          onClick={reset}
          className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink transition"
          title="Restore the formatting measured from your Pages manuscripts"
        >
          <LuRotateCcw size={11} /> Reset to defaults
        </button>
      </div>
      <div className="bg-surface-raised border border-accent/10 rounded-xl p-6 flex flex-col gap-6">
        <p className="text-xs text-ink-faint leading-relaxed -mb-1">
          Layout used when exporting a book to Pages/Word. Defaults match your
          existing manuscripts.
        </p>

        {/* Page setup */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-ink-faint mb-2">Page & Margins (inches)</h3>
          <div className="grid grid-cols-6 gap-2">
            {PAGE_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="block text-[10px] uppercase tracking-widest text-ink-faint mb-1">{label}</label>
                <input
                  type="number" step={0.05} min={0}
                  value={formatting.page[key]}
                  onChange={e => setPage(key, Number(e.target.value))}
                  className={`w-full ${inputCls}`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Styles */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-ink-faint mb-2">Text Styles</h3>
          <div className="flex flex-col gap-1.5">
            {/* Column headings */}
            <div className="grid grid-cols-[7.5rem_1fr_3.5rem_3rem_4.5rem_4rem_4rem] gap-2 items-center px-1">
              <span />
              <span className="text-[10px] uppercase tracking-widest text-ink-faint">Font</span>
              <span className="text-[10px] uppercase tracking-widest text-ink-faint">Size</span>
              <span className="text-[10px] uppercase tracking-widest text-ink-faint">Color</span>
              <span className="text-[10px] uppercase tracking-widest text-ink-faint">Align</span>
              <span className="text-[10px] uppercase tracking-widest text-ink-faint" title="Space after paragraph, points">After</span>
              <span className="text-[10px] uppercase tracking-widest text-ink-faint" title="Line spacing multiple">Line</span>
            </div>
            {STYLE_LABELS.map(({ key, label }) => {
              const s = formatting.styles[key]
              return (
                <div key={key} className="grid grid-cols-[7.5rem_1fr_3.5rem_3rem_4.5rem_4rem_4rem] gap-2 items-center px-1">
                  <span className="text-xs text-ink">{label}</span>
                  <input
                    value={s.font}
                    onChange={e => setFormatting(f => f ? { ...f, styles: { ...f.styles, [key]: { ...s, font: e.target.value } } } : f)}
                    onBlur={e => patch({ styles: { [key]: { font: e.target.value } } })}
                    className={`w-full ${inputCls}`}
                  />
                  <input
                    type="number" step={0.5} min={1}
                    value={s.sizePt}
                    onChange={e => { const v = Number(e.target.value); if (v > 0) setStyle(key, 'sizePt', v) }}
                    className={`w-full ${inputCls}`}
                  />
                  <input
                    type="color"
                    value={s.color}
                    onChange={e => setStyle(key, 'color', e.target.value)}
                    className="w-full h-7 bg-surface-base border border-accent/20 rounded cursor-pointer"
                  />
                  <select
                    value={s.align}
                    onChange={e => setStyle(key, 'align', e.target.value)}
                    className={`w-full ${inputCls}`}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                    <option value="justify">Justify</option>
                  </select>
                  <input
                    type="number" step={1} min={0}
                    value={s.spaceAfterPt}
                    onChange={e => { const v = Number(e.target.value); if (v >= 0) setStyle(key, 'spaceAfterPt', v) }}
                    className={`w-full ${inputCls}`}
                  />
                  <input
                    type="number" step={0.05} min={0.5}
                    value={s.lineSpacing}
                    onChange={e => { const v = Number(e.target.value); if (v >= 0.5) setStyle(key, 'lineSpacing', v) }}
                    className={`w-full ${inputCls}`}
                  />
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-faint mb-1">
                Body first-line indent (in)
              </label>
              <input
                type="number" step={0.05} min={0}
                value={formatting.styles.body.firstLineIndentIn ?? 0}
                onChange={e => { const v = Number(e.target.value); if (v >= 0) setStyle('body', 'firstLineIndentIn', v) }}
                className={`w-full ${inputCls}`}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-faint mb-1">
                Chapter letter spacing (pt)
              </label>
              <input
                type="number" step={0.05} min={0}
                value={formatting.styles.chapter.letterSpacingPt ?? 0}
                onChange={e => { const v = Number(e.target.value); if (v >= 0) setStyle('chapter', 'letterSpacingPt', v) }}
                className={`w-full ${inputCls}`}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-faint mb-1">
                Section break text
              </label>
              <input
                value={formatting.sectionBreakText}
                placeholder="(blank gap)"
                onChange={e => setFormatting(f => f ? { ...f, sectionBreakText: e.target.value } : f)}
                onBlur={e => patch({ sectionBreakText: e.target.value })}
                className={`w-full ${inputCls}`}
              />
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-6 border-t border-accent/10 pt-4">
          <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
            <input
              type="checkbox"
              checked={formatting.runningHeaders}
              onChange={e => { setFormatting(f => f ? { ...f, runningHeaders: e.target.checked } : f); patch({ runningHeaders: e.target.checked }) }}
              className="accent-accent"
            />
            <span>Running headers (title / author)</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
            <input
              type="checkbox"
              checked={formatting.pageNumbers}
              onChange={e => { setFormatting(f => f ? { ...f, pageNumbers: e.target.checked } : f); patch({ pageNumbers: e.target.checked }) }}
              className="accent-accent"
            />
            <span>Page numbers</span>
          </label>
        </div>
      </div>
    </section>
  )
}
