'use client'

import { useState } from 'react'
import { LuX } from 'react-icons/lu'
import { GENRES } from '@/lib/genres'

type Props = {
  genres: string[]
  keywords: string[]
  onChange: (next: { genres?: string[]; keywords?: string[] }) => void
}

// Genre is multi-select against the fixed list in @/lib/genres. Keywords are
// free-form, entered one at a time (Enter or comma). Both render as toggle
// chips. PATCHes are pushed by the parent via onChange — this component is
// purely presentational state.
export default function SeriesTagsEditor({ genres, keywords, onChange }: Props) {
  const [keywordDraft, setKeywordDraft] = useState('')

  function toggleGenre(genre: string) {
    const next = genres.includes(genre)
      ? genres.filter(g => g !== genre)
      : [...genres, genre]
    onChange({ genres: next })
  }

  function commitKeyword() {
    const cleaned = keywordDraft.trim().replace(/,+$/, '').trim()
    if (!cleaned) return
    // Deduplicate case-insensitively so the writer doesn't accumulate
    // "fantasy" / "Fantasy" / "FANTASY" as separate chips.
    if (keywords.some(k => k.toLowerCase() === cleaned.toLowerCase())) {
      setKeywordDraft('')
      return
    }
    onChange({ keywords: [...keywords, cleaned] })
    setKeywordDraft('')
  }

  function removeKeyword(keyword: string) {
    onChange({ keywords: keywords.filter(k => k !== keyword) })
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <label className="text-xs uppercase tracking-widest text-ink-faint">Genre(s)</label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {GENRES.map(genre => {
            const on = genres.includes(genre)
            return (
              <button
                type="button"
                key={genre}
                onClick={() => toggleGenre(genre)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  on
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-overlay text-ink-muted border-accent/15 hover:border-accent/40 hover:text-ink'
                }`}
              >
                {genre}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className="text-xs uppercase tracking-widest text-ink-faint">Keyword(s)</label>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {keywords.map(keyword => (
            <span
              key={keyword}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-accent/15 text-ink border border-accent/20"
            >
              {keyword}
              <button
                type="button"
                onClick={() => removeKeyword(keyword)}
                className="text-ink-faint hover:text-choice-kill transition"
                title="Remove keyword"
              >
                <LuX size={10} />
              </button>
            </span>
          ))}
          <input
            value={keywordDraft}
            onChange={e => {
              const v = e.target.value
              // Comma also commits — typical tag UX.
              if (v.endsWith(',')) {
                setKeywordDraft(v.slice(0, -1))
                requestAnimationFrame(commitKeyword)
              } else {
                setKeywordDraft(v)
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitKeyword() }
              if (e.key === 'Backspace' && keywordDraft === '' && keywords.length > 0) {
                onChange({ keywords: keywords.slice(0, -1) })
              }
            }}
            onBlur={commitKeyword}
            placeholder={keywords.length === 0 ? 'Add a keyword (Enter or comma)…' : 'Add another…'}
            className="text-xs px-2 py-1 bg-transparent border border-dashed border-accent/20 rounded-full text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 min-w-[140px] flex-1"
          />
        </div>
      </div>
    </div>
  )
}
