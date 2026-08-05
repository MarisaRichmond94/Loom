// Body skeleton for the /author/[seriesId] route. Used by the author layout
// when series hasn't returned and the page hasn't mounted yet.
//
// Rewritten for the tabbed, full-width layout (LOOM-106, with LOOM-105).
//
// ⚠️ This file has drifted twice before, and both times it was invisible until
// someone watched the page load: the genre row drew 12 uniform stubs against a
// real row of ALL 16 genres, so the cloud re-wrapped; and the book-card control
// row drew ~152px against a real row nearer 300px, so every card's controls
// jumped rightward. The lesson both times was the same — size against the REAL
// markup, per element, not by eye.
export default function SeriesPageSkeleton() {
  return (
    // Matches the page's max-w-[1600px] (LOOM-105). At the old 3xl the whole
    // identity block would settle a container-width narrower than where it
    // lands, which is the largest jump this file could possibly cause.
    <div className="max-w-[1600px] mx-auto px-8 py-8 animate-pulse">
      {/* Action row — Backup then Preview (KAN-19; renamed from Export in
          KAN-20). Widths still hold: same two controls, and "Backup" is the
          same length as "Export". Re-check if a third one lands here. */}
      <div className="flex justify-end items-center gap-2 mb-2">
        <div className="h-7 w-20 bg-surface-overlay rounded" />
        <div className="h-7 w-24 bg-accent/30 rounded" />
      </div>

      {/* Title + by-author */}
      <div className="flex flex-col items-center mb-8">
        <div className="h-9 w-72 bg-surface-muted rounded mb-2" />
        <div className="h-3 w-24 bg-surface-muted rounded" />
      </div>

      {/* Description / Genres / Keywords block */}
      <div className="mb-8 flex flex-col gap-6">
        <div>
          <div className="h-3 w-20 bg-surface-muted rounded mb-2" />
          <div className="h-20 bg-surface-overlay rounded-lg" />
        </div>
        <div>
          <div className="h-3 w-16 bg-surface-muted rounded mb-2" />
          {/* Genre chips. Genre is a MULTI-SELECT against the fixed list in
              @/lib/genres, so the real row always renders ALL of them —
              currently 16 — not just the ones selected. Widths below are
              PER-LABEL (text-xs, px-2.5), longest "Contemporary" and "Young
              Adult", shortest "CYOA".

              Deliberately unchanged by the widening, and that is the point:
              because each width matches its own label, the row wraps exactly as
              the real one does at ANY container width. The earlier drift came
              from uniform stubs, which only lined up at one width by accident.
              Re-derive if genres.ts changes. */}
          <div className="flex flex-wrap gap-1.5">
            {[76, 57, 94, 51, 45, 51, 76, 63, 82, 57, 63, 82, 63, 57, 70, 88].map((w, i) => (
              <div key={i} className="h-6 bg-surface-muted rounded-full" style={{ width: w }} />
            ))}
          </div>
        </div>
        <div>
          <div className="h-3 w-20 bg-surface-muted rounded mb-2" />
          {/* Keyword chips + the trailing input. Free-form, so the count is
              per-series; sized for the primary user's two ("Psychological
              Thriller", "Dark"). Each carries a remove "×", hence the extra
              ~14px over a plain chip. The input is flex-1 min-w-[140px] in the
              real editor — it GROWS to fill the row, so a fixed stub would
              leave a gap that closes on load. */}
          <div className="flex flex-wrap gap-1.5">
            <div className="h-6 w-44 bg-surface-muted rounded-full" />
            <div className="h-6 w-16 bg-surface-muted rounded-full" />
            <div className="h-6 flex-1 min-w-[140px] bg-surface-overlay border border-dashed border-accent/20 rounded-full" />
          </div>
        </div>
      </div>

      {/* Tab strip — Book(s) / Character(s) / Timeline / Explore (LOOM-105,
          Explore added by LOOM-118).
          Sized per label at text-sm uppercase tracking-widest with px-1, the
          same per-element discipline as the genre row: ~11px per character
          including tracking, plus 8px of padding. Height comes from pb-2 over a
          20px line box, and the bottom border is the strip's own — both
          matching SectionTabs, so the content below starts at the right y.

          "Explore" is 7 characters, the same as "Book(s)", hence the repeated
          86. Adding a tab and not adding a stub here is the exact drift this
          file has already suffered twice — the strip would settle one tab
          narrower and everything after it would shift sideways on hydration. */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2 border-b border-accent/10">
          <div className="flex items-center gap-6">
            {[86, 142, 98, 86].map((w, i) => (
              <div key={i} className="pb-2">
                <div className="h-5 bg-surface-muted rounded" style={{ width: w }} />
              </div>
            ))}
          </div>
          {/* No action stub. Books is the default tab and carries no header
              control; Character(s) has none either; and Timeline's "Add Event"
              only exists once that tab is chosen, which is never on first
              paint. Drawing one here would be a button that vanishes on load. */}
        </div>

        {/* Books-tab content only — the skeleton renders what the DEFAULT tab
            renders. Drawing a timeline or a character grid under a strip that
            will resolve to Books would be a worse jump than drawing nothing.
            Five stubs, matching the primary user's series. */}
        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="flex gap-5 p-5 rounded-lg bg-accent/25 border border-accent/20">
              <div className="w-28 shrink-0 rounded bg-surface-muted" style={{ minHeight: '9rem' }} />
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <div className="flex items-baseline gap-3 mb-4">
                    <div className="h-3 w-12 bg-surface-muted rounded" />
                    <div className="h-5 w-48 bg-surface-muted rounded" />
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {[0, 1, 2, 3].map(j => (
                      <div key={j} className="bg-surface-overlay border border-accent/10 rounded-lg px-3 py-4 flex flex-col items-center gap-1">
                        <div className="h-6 w-8 bg-surface-muted rounded" />
                        <div className="h-3 w-14 bg-surface-muted rounded" />
                      </div>
                    ))}
                  </div>
                </div>
                {/* THREE controls, not two: "Mark as in progress" (or the
                    shorter "In progress" once set), Backup, and Delete. Sized
                    for the longer label, which is the state most books are in. */}
                <div className="flex justify-end gap-2 mt-3">
                  <div className="h-7 w-40 bg-surface-overlay rounded" />
                  <div className="h-7 w-20 bg-surface-overlay rounded" />
                  <div className="h-7 w-16 bg-surface-overlay rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
