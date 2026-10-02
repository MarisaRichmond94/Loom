'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LuAudioLines,
  LuBookOpen,
  LuDatabaseBackup,
  LuDownload,
  LuLoaderCircle,
  LuMenu,
  LuSend,
  LuSettings,
  LuTrash2,
  LuTriangleAlert,
} from 'react-icons/lu'
import { useClickOutside } from '@/components/editor/AnchoredPopover'
import { showToast } from '@/lib/notifications'
import type { BookPublishStatus } from '@/components/series/usePublishStatus'

// The book card's ☰ (LOOM-157).
//
// The card had four text buttons in a row under the stats — Publish/Republish,
// Backup, Settings, Delete — and three more actions wanted in: regenerate the
// audiobook, regenerate the EPUB, export the story bible. Seven text buttons is
// not a row, so they collapse into the same ☰ the book page and the series
// header already use, parked beside the title where it reads as "things I can
// do to this book" rather than competing with the card's own content.
//
// The menu does NOT close on the two generate items. They start work that runs
// for minutes and report back in place; closing the menu would hide the only
// thing that just happened, and re-opening it to check is worse than leaving
// it open. Everything else closes, because everything else is instantaneous or
// opens its own surface.

type ArtifactKind = 'audiobook' | 'epub'

type Run = {
  kind: ArtifactKind
  startedAt: number
  finishedAt: number | null
  ok: boolean | null
  error: string | null
  tail: string[]
  logPath: string
}

type ArtifactState = {
  runs: Partial<Record<ArtifactKind, Run>>
  available: Partial<Record<ArtifactKind, boolean>>
  manuscript: { current: boolean; reason: string; detail?: string } | null
}

const KIND_LABEL: Record<ArtifactKind, string> = {
  audiobook: 'audiobook',
  epub: 'EPUB',
}

/** Poll only while something is running — this is not a dashboard. */
const POLL_MS = 4000

/**
 * The line of the script's output worth repeating back.
 *
 * Not simply the last one: both scripts end with a divider and a "Done in Nm
 * Ns" line, which says nothing about what they did. The line before that is
 * the verdict — "unchanged since last build — skipped", "text identical —
 * nothing to re-narrate", "12 segment(s) changed — rebuilding .m4b" — and
 * telling them apart is the whole reason to press the button twice.
 */
function verdict(tail: string[]): string | undefined {
  const noise = /^=+$|^-+$|^Done in /
  return [...tail].reverse().find(l => !noise.test(l.trim())) ?? tail.at(-1)
}

const itemClass =
  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted'

export default function BookActionsMenu({
  seriesId,
  bookId,
  bookTitle,
  publishStatus,
  publishBusy,
  publishingThis,
  onPublish,
  onSettings,
  onDelete,
}: {
  seriesId: string
  bookId: string
  bookTitle: string
  /** null until the snapshot read lands, which is a third state: the item
   *  disables with the draft reason rather than claiming the book is ready. */
  publishStatus: BookPublishStatus | null
  /** True while ANY book on the page is publishing — the queue is global, so
   *  every card's item disables, not just the one being sent. */
  publishBusy: boolean
  /** ...and true only for THIS book, which is what the label reads from. */
  publishingThis: boolean
  onPublish: () => void
  onSettings: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside([ref], () => setOpen(false), open)

  const [artifacts, setArtifacts] = useState<ArtifactState | null>(null)
  const [starting, setStarting] = useState<ArtifactKind | null>(null)
  const [bibleBusy, setBibleBusy] = useState(false)

  const url = `/api/series/${seriesId}/books/${bookId}/artifacts`

  // Loaded on open, not on mount. The currency check hashes the book's canon
  // chapters, and a series page shows five cards — doing that for every card
  // on every visit, to populate a menu most visits never open, is the kind of
  // eager read LOOM-118 was about.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) setArtifacts(await res.json() as ArtifactState)
    } catch {
      // A menu that cannot read its own state renders without the extras,
      // which is what `artifacts === null` already means.
    }
  }, [url])

  useEffect(() => { if (open) void refresh() }, [open, refresh])

  const running = (Object.keys(KIND_LABEL) as ArtifactKind[])
    .some(k => artifacts?.runs?.[k]?.ok === null)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(id)
  }, [running, refresh])

  // Polling continues while the menu is shut, so a run that finishes out of
  // sight still announces itself. The ref holds which runs have already been
  // reported, so a re-render cannot toast the same finish twice.
  const announced = useRef(new Set<string>())
  useEffect(() => {
    for (const kind of Object.keys(KIND_LABEL) as ArtifactKind[]) {
      const run = artifacts?.runs?.[kind]
      if (!run || run.ok === null) continue
      const id = `${kind}:${run.startedAt}`
      if (announced.current.has(id)) continue
      announced.current.add(id)
      showToast({
        kind: run.ok ? 'ok' : 'error',
        message: run.ok
          ? `${bookTitle} — ${KIND_LABEL[kind]} rebuilt.`
          : `${bookTitle} — ${KIND_LABEL[kind]} rebuild failed.`,
        detail: run.ok ? verdict(run.tail) : run.error ?? undefined,
        durationMs: run.ok ? 6000 : 14000,
      })
    }
  }, [artifacts, bookTitle])

  async function generate(kind: ArtifactKind) {
    setStarting(kind)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
      const data = await res.json() as { run?: Run; error?: string }
      if (!res.ok) {
        showToast({ kind: 'error', message: data.error ?? 'Could not start the rebuild.', durationMs: 12000 })
        return
      }
      // The POST hands back the run it started, so the row flips to
      // "Generating…" now rather than one poll interval from now.
      if (data.run) {
        // `prev` is null only if the on-open read failed; re-read rather than
        // drop the run on the floor, because the poll loop keys off this state
        // and a run nobody is watching finishes invisibly.
        setArtifacts(prev =>
          prev ? { ...prev, runs: { ...prev.runs, [kind]: data.run! } } : prev)
        void refresh()
      }
      // A finish that lands while this run is in flight is news.
      announced.current.delete(`${kind}:${data.run?.startedAt}`)
    } catch {
      showToast({ kind: 'error', message: 'Could not reach Loom to start the rebuild.' })
    } finally {
      setStarting(null)
    }
  }

  /**
   * The bible is a download, but it is NOT a plain `<a download>`.
   *
   * It comes from WriteAI through a proxy, and WriteAI is frequently not
   * running. An anchor would "succeed" by saving the proxy's JSON error as a
   * file called story-bible.md — a broken artifact that looks like a working
   * one, which is exactly the failure this whole seam is careful about. So the
   * response is inspected before anything is handed to the browser.
   */
  async function exportBible() {
    setBibleBusy(true)
    try {
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/bible`, { cache: 'no-store' })
      if (!res.ok) {
        const detail = await res.json().then(
          (d: { error?: string }) => d.error,
          () => undefined,
        )
        showToast({
          kind: 'error',
          message: res.status === 503
            ? 'WriteAI is not running, so it cannot build a story bible.'
            : 'Could not export the story bible.',
          detail,
          durationMs: 12000,
        })
        return
      }
      const name = /filename="?([^";]+)"?/
        .exec(res.headers.get('Content-Disposition') ?? '')?.[1]
        ?? `story-bible-${bookTitle}.md`
      const href = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = href
      a.download = name
      a.click()
      URL.revokeObjectURL(href)
      setOpen(false)
    } catch {
      showToast({ kind: 'error', message: 'Could not export the story bible.' })
    } finally {
      setBibleBusy(false)
    }
  }

  const eligible = publishStatus?.eligible ?? false
  const needs = !!publishStatus && (publishStatus.changed || !publishStatus.inSnapshot)

  return (
    <div ref={ref} className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Book actions"
        aria-label="Book actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center h-[26px] px-2 rounded text-xs font-medium border transition ${
          open
            ? 'border-accent/40 text-ink bg-surface-raised'
            : 'border-accent/20 text-ink-muted hover:text-ink hover:border-accent/40 bg-surface-overlay'
        }`}
      >
        <LuMenu size={13} />
        {/* A spinner on the closed button, so a rebuild running behind a shut
            menu is visible from the card. Without it the only evidence a
            45-minute job is in flight disappears the moment the menu closes. */}
        {running && <LuLoaderCircle size={11} className="ml-1.5 animate-spin text-accent" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-50 min-w-[250px] overflow-hidden rounded-lg border border-accent/20 bg-surface-raised shadow-xl"
        >
          {/* Publishing leads: it is the one action here with a deadline
              attached, and the only one a reader notices. */}
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onPublish() }}
            disabled={!publishStatus || !eligible || publishBusy}
            title={!eligible
              ? 'This book is a draft. Mark it as Published first — until then readers only see “Coming Soon”.'
              : needs
                ? 'Send this book to readers. Every other book keeps exactly what it has.'
                : 'Readers already have this version — republishing would change nothing.'}
            className={`${itemClass} ${needs && eligible && !publishBusy ? 'font-medium text-ink' : ''}`}
          >
            <span className="flex w-5 items-center justify-center text-accent"><LuSend size={14} /></span>
            <span className="flex-1">
              {publishingThis ? 'Publishing…' : needs ? 'Publish to readers' : 'Republish'}
            </span>
          </button>

          <div className="h-px bg-accent/15" />

          {/* The two nightly artifacts, on demand. Grouped and labelled,
              because "generate" here means something specific: the same
              incremental pass the 22:30 chain runs, not a from-scratch
              rebuild — a book whose prose has not moved finishes in seconds
              saying so. */}
          <div className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-faint">
            Rebuild now
          </div>

          {/* The manuscript warning sits ABOVE both items rather than inside
              their tooltips: it changes what pressing them means. Both
              builders read the .pages file, so a stale one quietly produces a
              correct artifact of the wrong draft. */}
          {artifacts?.manuscript && !artifacts.manuscript.current && (
            <div
              title={artifacts.manuscript.detail ?? artifacts.manuscript.reason}
              className="mx-3 mb-1.5 flex items-start gap-2 rounded border border-choice-kill-border bg-choice-kill-bg px-2.5 py-2 text-[11px] leading-snug text-choice-kill"
            >
              <LuTriangleAlert size={13} className="mt-px shrink-0" />
              <span>
                {artifacts.manuscript.reason === 'no-manuscript'
                  ? 'No manuscript on disk yet — save this book to Pages first.'
                  : 'The Pages manuscript is behind Loom. Both builds read that file, so they would rebuild the older draft.'}
              </span>
            </div>
          )}

          {(['audiobook', 'epub'] as ArtifactKind[]).map(kind => {
            const run = artifacts?.runs?.[kind]
            const busy = run?.ok === null || starting === kind
            // `undefined` means the menu has not loaded its state yet, which
            // is not the same as "this book has no entry" — don't disable on
            // ignorance, the POST refuses properly either way.
            const unavailable = artifacts?.available?.[kind] === false
            return (
              <div key={kind}>
                <button
                  role="menuitem"
                  onClick={() => void generate(kind)}
                  disabled={busy || unavailable}
                  title={unavailable
                    ? `The ${kind === 'epub' ? 'EPUB' : 'audiobook'} script has no entry for this book — it only knows the canon books.`
                    : kind === 'audiobook'
                      ? 'Re-export from Pages and re-narrate only the chapters whose text changed. Minutes, usually.'
                      : 'Rebuild the .epub for Apple Books from the current manuscript.'}
                  className={itemClass}
                >
                  <span className="flex w-5 items-center justify-center text-accent">
                    {busy
                      ? <LuLoaderCircle size={14} className="animate-spin" />
                      : kind === 'audiobook' ? <LuAudioLines size={14} /> : <LuBookOpen size={14} />}
                  </span>
                  <span className="flex-1">
                    {busy
                      ? `Generating ${KIND_LABEL[kind]}…`
                      : `Generate ${KIND_LABEL[kind]}`}
                  </span>
                </button>
                {/* The script's own last line while it works, and its
                    explanation when it fails. Both are the script talking —
                    paraphrasing either into "working…" / "something went
                    wrong" is how a failed build gets mistaken for a slow one. */}
                {run && (run.ok === null || run.ok === false) && (
                  <div className={`px-4 pb-2 text-[11px] leading-snug ${run.ok === false ? 'text-choice-kill' : 'text-ink-faint'}`}>
                    {run.ok === false ? run.error : verdict(run.tail) ?? 'starting…'}
                  </div>
                )}
              </div>
            )
          })}

          {/* The last thing WriteAI was still needed for. Deterministic and
              free upstream — no LLM call — so there is no reason to make her
              open another app for it. */}
          <button
            role="menuitem"
            onClick={() => void exportBible()}
            disabled={bibleBusy}
            title="WriteAI's story bible for this book, as markdown — characters, places, timeline and facts, assembled from what it extracted."
            className={itemClass}
          >
            <span className="flex w-5 items-center justify-center text-accent">
              {bibleBusy ? <LuLoaderCircle size={14} className="animate-spin" /> : <LuDownload size={14} />}
            </span>
            <span className="flex-1">{bibleBusy ? 'Exporting…' : 'Export story bible'}</span>
          </button>

          <div className="h-px bg-accent/15" />

          <a
            role="menuitem"
            href={`/api/series/${seriesId}/books/${bookId}/export`}
            download
            onClick={() => setOpen(false)}
            title="Back up this book as a .loom.json you can re-import. Covers prose, choices and characters — not chapter notes, narration or cover images. For a readable manuscript, open the book and use Save."
            className={itemClass}
          >
            <span className="flex w-5 items-center justify-center text-accent"><LuDatabaseBackup size={14} /></span>
            <span className="flex-1">Backup</span>
          </a>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onSettings() }}
            title="Title, description, status, canon vs alt, and who reaches this book."
            className={itemClass}
          >
            <span className="flex w-5 items-center justify-center text-accent"><LuSettings size={14} /></span>
            <span className="flex-1">Settings</span>
          </button>

          <div className="h-px bg-accent/15" />

          {/* Red, and alone below the rule — the only item here that destroys
              something. */}
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onDelete() }}
            title="Delete this book"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-choice-kill transition hover:bg-surface-overlay"
          >
            <span className="flex w-5 items-center justify-center"><LuTrash2 size={14} /></span>
            <span className="flex-1">Delete</span>
          </button>
        </div>
      )}
    </div>
  )
}
