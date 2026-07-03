'use client'

import { useEffect, useState } from 'react'
import { LuFolderOpen, LuX } from 'react-icons/lu'

// Settings section for the manuscript style template. Loom lifts style
// definitions out of the chosen .pages file (via a cached Pages→docx
// conversion) and builds every export on them; the chips below show which
// styles were actually found so the writer can tell whether the template's
// sample page covers everything. Pages only exports styles used in the
// document body — styles missing here just fall back to the Export-tab
// formatting numbers.

type Summary = {
  path: string
  styles: { paragraph: string[]; color: Array<{ name: string; type: string; color: string }> } | null
  error: string | null
}

// Style names the exporter actually references; anything else in the
// template is ignored, so showing it would only confuse.
const STRUCTURAL = ['Chapter', 'POV', 'Date', 'Body', 'Section Breaks', 'Footnotes', 'Header & Footer']

export default function ManuscriptTemplateSection() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/settings/manuscript-template').then(r => r.json()).then(setSummary)
  }, [])

  async function patch(path: string) {
    setBusy(true)
    const res = await fetch('/api/settings/manuscript-template', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (res.ok) setSummary(await res.json())
    setBusy(false)
  }

  async function pickFile() {
    setBusy(true)
    const res = await fetch('/api/settings/manuscript-template/pick-file', { method: 'POST' })
    const { file } = await res.json() as { file: string | null }
    if (file) await patch(file)
    else setBusy(false)
  }

  if (!summary) return null

  const found = new Set(summary.styles?.paragraph ?? [])
  const missing = summary.path && summary.styles
    ? STRUCTURAL.filter(name => !found.has(name))
    : []

  return (
    <section className="mb-8">
      <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-4">Manuscript Template</h2>
      <div className="bg-surface-raised border border-accent/10 rounded-xl p-6 flex flex-col gap-4">
        <p className="text-xs text-ink-faint leading-relaxed -mb-1">
          A .pages file whose text styles every export copies exactly. Pages
          only exposes styles that are used somewhere in the template's body,
          so include a sample page exercising each one. Colored editor text
          maps onto the template's <span className="font-mono">&lt;color&gt; Text</span> styles.
        </p>

        <div className="flex gap-2">
          <input
            value={summary.path}
            onChange={e => setSummary(s => s ? { ...s, path: e.target.value } : s)}
            onBlur={e => patch(e.target.value)}
            placeholder="/Users/you/Writing/Assets/Novel Template.pages"
            className="flex-1 bg-surface-base border border-accent/20 rounded-lg px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent font-mono"
          />
          <button
            onClick={pickFile}
            disabled={busy}
            title="Choose template"
            className="px-3 py-2 rounded-lg bg-surface-base border border-accent/20 text-ink-muted hover:text-ink transition disabled:opacity-50 shrink-0"
          >
            <LuFolderOpen size={16} />
          </button>
          {summary.path && (
            <button
              onClick={() => patch('')}
              disabled={busy}
              title="Stop using a template"
              className="px-3 py-2 rounded-lg bg-surface-base border border-accent/20 text-ink-muted hover:text-ink transition disabled:opacity-50 shrink-0"
            >
              <LuX size={16} />
            </button>
          )}
        </div>

        {busy && <p className="text-xs text-ink-faint italic">Reading template through Pages…</p>}
        {summary.error && <p className="text-xs text-choice-kill">{summary.error}</p>}

        {!busy && summary.path && summary.styles && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {STRUCTURAL.filter(name => found.has(name)).map(name => (
                <span key={name} className="px-2 py-0.5 rounded-full text-[10px] bg-accent/10 text-accent border border-accent/20">
                  {name}
                </span>
              ))}
              {summary.styles.color.map(s => (
                <span
                  key={s.name}
                  className="px-2 py-0.5 rounded-full text-[10px] bg-surface-base text-ink-muted border border-accent/20 inline-flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="text-xs text-ink-faint">
                Not in the template (using Export-tab formatting instead):{' '}
                {missing.join(', ')}. Add a line using each to the template's
                sample page to carry them over.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
