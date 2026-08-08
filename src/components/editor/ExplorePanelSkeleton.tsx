// Body skeleton for the Explore tab (LOOM-118).
//
// The panel is loaded on tab open rather than with the page, so there is a real
// gap between the click and the panel appearing. `OutlineBoardSkeleton` is the
// precedent — a section-level skeleton for a lazily-loaded tab.
//
// ⚠️ Sized against the REAL panel, per element — the lesson SeriesPageSkeleton
// has already learned twice. The frame is `h-[560px]` with the same rail width
// (w-11), the same filter-bar height, and the same composer block, so switching
// to this tab does not resize the page underneath the writer.
//
// The staleness banner is deliberately NOT drawn here. Whether it appears
// depends on a network read, so drawing it speculatively would flash a warning
// that then vanishes — worse than a slightly taller settle.
export default function ExplorePanelSkeleton({
  /** Matches ExplorePanel's own `fillHeight` — the series page's tab strip is
   *  fillHeight, so its Explore skeleton should claim the same flex-1 space
   *  the real panel will, rather than settling at the book page's fixed
   *  560px and then resizing once the real panel mounts. */
  fillHeight = false,
}: { fillHeight?: boolean } = {}) {
  return (
    <div
      className={`mt-3 flex overflow-hidden rounded-lg border border-accent/15 bg-surface-raised animate-pulse ${
        fillHeight ? 'min-h-0 flex-1' : 'h-[560px]'
      }`}
    >
      {/* History rail — 44px, matching ExploreHistory's w-11. */}
      <div className="flex w-11 shrink-0 flex-col items-center border-r border-accent/10 bg-surface-base py-2.5">
        <div className="h-8 w-8 rounded-md bg-surface-overlay" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Filter bar: two dropdowns left, the what-if switch right. Widths
            follow the real labels ("All books", "All POVs", "What-if" + toggle). */}
        <div className="flex items-center gap-2 border-b border-accent/10 px-4 py-2.5">
          <div className="h-[30px] w-[104px] rounded-md bg-surface-overlay" />
          <div className="h-[30px] w-[96px] rounded-md bg-surface-overlay" />
          <div className="ml-auto h-5 w-[86px] rounded-full bg-surface-overlay" />
        </div>

        {/* Message area. Alternating user/assistant blocks so the settle does
            not jump from "one shape" to "two shapes". */}
        <div className="flex flex-1 flex-col gap-4 px-4 py-4">
          <div className="self-end h-9 w-[42%] rounded-xl rounded-br-sm bg-surface-overlay" />
          <div className="flex flex-col gap-2 self-start w-[88%]">
            <div className="h-3 w-full rounded bg-surface-muted" />
            <div className="h-3 w-[94%] rounded bg-surface-muted" />
            <div className="h-3 w-[76%] rounded bg-surface-muted" />
            {/* The collapsed "Sources (n)" row — one line, since that is what
                the real panel shows until it is expanded. */}
            <div className="mt-1.5 h-3 w-[84px] rounded bg-surface-muted" />
          </div>
          <div className="self-end h-9 w-[34%] rounded-xl rounded-br-sm bg-surface-overlay" />
          <div className="flex flex-col gap-2 self-start w-[80%]">
            <div className="h-3 w-full rounded bg-surface-muted" />
            <div className="h-3 w-[62%] rounded bg-surface-muted" />
          </div>
        </div>

        {/* Composer: input row plus the footer strip that carries the model
            picker and the Fast/Thorough toggle. */}
        <div className="border-t border-accent/10 px-4 pb-3 pt-2.5">
          <div className="h-[42px] rounded-lg border border-accent/20 bg-surface-base" />
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-3 w-[188px] rounded bg-surface-muted" />
            <div className="ml-auto h-3 w-9 rounded bg-surface-muted" />
            <div className="h-3 w-14 rounded bg-surface-muted" />
            <div className="h-3 w-[88px] rounded bg-surface-muted" />
          </div>
        </div>
      </div>
    </div>
  )
}
