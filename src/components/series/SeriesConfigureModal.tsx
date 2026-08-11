'use client'

import { LuX, LuSettings } from 'react-icons/lu'
import SeriesTagsEditor from '@/components/editor/SeriesTagsEditor'

type Props = {
  genres: string[]
  keywords: string[]
  onChange: (next: { genres?: string[]; keywords?: string[] }) => void
  onClose: () => void
}

// Genre(s) and Keyword(s), pulled off the series page body and into a modal
// (LOOM-142) so the description above gets the vertical space they used to
// take. Same shape as PathConfigModal — the closest "Configure X" precedent
// in this codebase.
export default function SeriesConfigureModal({ genres, keywords, onChange, onClose }: Props) {
  return (
    <div
      // Centred over the CONTENT — excluding the site header and the
      // author sidebar — not the whole window. `--author-sidebar` comes from
      // the author layout and follows the sidebar's own width, collapsed or
      // not (same convention as CharacterModal); 60px is AppHeader's own
      // height (matches this page's delete-book dialog).
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6"
      style={{ paddingLeft: 'calc(var(--author-sidebar, 0px) + 1.5rem)', paddingTop: 'calc(60px + 1.5rem)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-2xl w-full mx-8 shadow-2xl relative max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none">
          <LuX size={18} />
        </button>
        <h2 className="text-base font-bold text-ink mb-4 pr-6 uppercase tracking-widest flex items-center gap-2">
          <LuSettings size={16} className="text-accent" /> Configure
        </h2>
        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          <SeriesTagsEditor genres={genres} keywords={keywords} onChange={onChange} />
        </div>
      </div>
    </div>
  )
}
