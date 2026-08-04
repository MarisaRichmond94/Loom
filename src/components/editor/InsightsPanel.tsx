'use client'

import { LuLightbulb } from 'react-icons/lu'
import { PanelEmpty, PanelEmptyState } from './PanelEmptyState'
import type { ChapterInsights, InsightsReason } from './useChapterInsights'

// The Insights tab (LOOM-92): what WriteAI extracted for this chapter.
//
// Read-only, and deliberately so — this is WriteAI's reading of the prose, not
// a second place to author it. Three sections: the summary, the facts, and the
// locations.
//
// Presentation is Loom's, not a copy of WriteAI's book drawer. The drawer wraps
// facts in a sortable table with a type chip; both are chrome around a field
// that is hardcoded "revealed" upstream, so a chip that always says the same
// word and a sort with one value would be furniture. A plain list says as much.
//
// The characters WriteAI extracts are not shown here at all — the Characters
// tab, one along, shows the writer's own tags for the same people. The proxy
// drops them before they reach this component.

/** Section heading, matching the dock's existing small-caps labels. */
function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="border-b border-accent/10 px-4 py-3 last:border-b-0">
      <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-ink-faint">
        {title}
        {count != null && <span className="ml-1 tabular-nums text-ink-faint/70">{count}</span>}
      </p>
      {children}
    </div>
  )
}

export default function InsightsPanel({
  insights,
  reason,
  loading,
  onRetry,
}: {
  insights: ChapterInsights | null
  reason: InsightsReason | null
  loading: boolean
  onRetry: () => void
}) {
  function body() {
    if (loading && !insights) {
      return <PanelEmptyState icon={<LuLightbulb size={26} />} title="Loading insights…" />
    }

    if (!insights) {
      // Three states, three sentences. Collapsing them would turn the ordinary
      // case — a chapter written since the last enrichment pass — into
      // something that reads like a fault.
      if (reason === 'writeai-unavailable') {
        return (
          <PanelEmptyState icon={<LuLightbulb size={26} />} title="WriteAI isn’t running">
            Insights come from WriteAI’s reading of your prose, so they can’t be shown until it’s
            up. Nothing here is stored in Loom.{' '}
            <button onClick={onRetry} className="text-accent underline underline-offset-2">
              Try again
            </button>
          </PanelEmptyState>
        )
      }
      if (reason === 'chapter-not-addressable') {
        return (
          <PanelEmptyState icon={<LuLightbulb size={26} />} title="No insights for this chapter">
            Insights are only available for numbered chapters and the prologue — WriteAI addresses
            chapters by number, and this one doesn’t have one.
          </PanelEmptyState>
        )
      }
      return (
        <PanelEmptyState icon={<LuLightbulb size={26} />} title="Not analysed yet">
          WriteAI hasn’t read this chapter. It will appear here after the next sync and enrichment
          pass — expected for anything written recently.
        </PanelEmptyState>
      )
    }

    return (
      <div className="flex flex-col">
        <Section title="Summary">
          {insights.summaryText ? (
            <p className="text-[11px] leading-relaxed text-ink-muted">{insights.summaryText}</p>
          ) : (
            // No enriched summary for this chapter. The key events are the same
            // reading at lower resolution, which beats an empty section — and
            // is what WriteAI's own drawer falls back to.
            <ul className="flex flex-col gap-1.5">
              {insights.summary.map((line, i) => (
                <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-ink-muted">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent/40" />
                  {line}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Both are shown when the prose summary exists: the paragraph is the
            shape of the chapter, the bullets are what happened in it. */}
        {insights.summaryText && insights.summary.length > 0 && (
          <Section title="Key events" count={insights.summary.length}>
            <ul className="flex flex-col gap-1.5">
              {insights.summary.map((line, i) => (
                <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-ink-muted">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent/40" />
                  {line}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {insights.facts.length > 0 && (
          <Section title="Facts" count={insights.facts.length}>
            <ul className="flex flex-col gap-1.5">
              {insights.facts.map((f, i) => (
                <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-ink-muted">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent/40" />
                  {f.statement}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {insights.locations.length > 0 && (
          <Section title="Locations" count={insights.locations.length}>
            <div className="flex flex-wrap gap-1">
              {insights.locations.map((name, i) => (
                <span
                  key={i}
                  className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] text-ink-faint"
                >
                  {name}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Extraction reflects the last ingested draft, not the words on
            screen. A quiet footer rather than a warning: staleness here is
            expected and permanent, and a banner that is always true is one
            nobody reads.

            Deliberately undated. The payload carries the chapter's date line,
            but that is the date INSIDE the story ("Monday, May 23rd") — putting
            it here would read as when the reading was taken, which it is not.
            An honest timestamp would need WriteAI's `last_synced`, and that is
            a second call for a footnote. */}
        <p className="px-4 py-3 text-[10px] italic leading-relaxed text-ink-faint/70">
          From WriteAI’s last reading of this chapter. Recent edits won’t appear until the next
          sync.
        </p>
      </div>
    )
  }

  return <PanelEmpty>{body()}</PanelEmpty>
}
