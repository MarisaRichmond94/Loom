'use client'

import { useEffect, useState } from 'react'
import { LuCheck, LuCopy, LuLink, LuPlus, LuUserX, LuUserCheck } from 'react-icons/lu'
import { showToast } from '@/lib/notifications'

/**
 * The readers list (LOOM-132) — the only part of reader identity the author
 * touches.
 *
 * Tokens are never held here. The list arrives without them and Copy fetches
 * one link at the moment it is clicked, so this component never has more than
 * a single invite in memory and only while it is being copied.
 */

type Reader = {
  id: string
  displayName: string
  disabled: boolean
  createdAt: string
  lastSeenAt: string | null
}

/** "2 hours ago" beats a timestamp for the one question this answers: are they reading? */
function ago(iso: string | null): string {
  if (!iso) return 'never opened'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString()
}

export default function ReadersSection() {
  const [readers, setReaders] = useState<Reader[]>([])
  const [baseUrl, setBaseUrl] = useState('')
  const [savedBase, setSavedBase] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  useEffect(() => { void load() }, [])

  async function load() {
    const res = await fetch('/api/settings/readers')
    if (!res.ok) return
    const data = await res.json() as { readers: Reader[]; settings: { baseUrl: string } }
    setReaders(data.readers)
    setBaseUrl(data.settings.baseUrl)
    setSavedBase(data.settings.baseUrl)
  }

  async function saveBase() {
    const next = baseUrl.trim()
    if (!next || next === savedBase) return
    const res = await fetch('/api/settings/readers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: next }),
    })
    if (res.ok) { setSavedBase(next); showToast({ kind: 'ok', message: 'Invite link address saved.' }) }
  }

  async function add() {
    const displayName = name.trim()
    if (!displayName || busy) return
    setBusy(true)
    const res = await fetch('/api/settings/readers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    })
    setBusy(false)
    if (!res.ok) { showToast({ kind: 'error', message: 'Could not add that reader.' }); return }
    setName('')
    await load()
  }

  async function patch(id: string, body: Partial<{ displayName: string; disabled: boolean }>) {
    const res = await fetch(`/api/settings/readers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) await load()
  }

  /** Asks for the token only now, and only this one. */
  async function copyLink(id: string) {
    const res = await fetch(`/api/settings/readers/${id}/link`, { method: 'POST' })
    if (!res.ok) { showToast({ kind: 'error', message: 'Could not build that link.' }); return }
    const { url, disabled } = await res.json() as { url: string; disabled: boolean }
    await navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(c => (c === id ? null : c)), 2000)
    showToast(disabled
      ? { kind: 'warn', message: 'Invite link copied.', detail: 'This reader is revoked, so the link will not work until you re-enable them.' }
      : { kind: 'ok', message: 'Invite link copied.' })
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Readers</h2>
        <p className="mt-1 text-sm text-ink-muted">
          People you’ve shared the books with. There are no accounts and no passwords —
          each person gets a private link, and opening it once is all they ever do.
        </p>
      </div>

      {/* The base URL. Visible because a link built against the wrong host is
          the failure everyone hits once, and it is invisible in an env file. */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-ink-faint">Invite link address</span>
        <div className="flex items-center gap-2">
          <LuLink size={14} className="text-ink-faint shrink-0" />
          <input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            onBlur={saveBase}
            placeholder="http://localhost:3200"
            className="flex-1 px-3 py-2 rounded bg-surface-overlay border border-accent/20 text-sm text-ink focus:outline-none focus:border-accent/50"
          />
        </div>
        <span className="text-xs text-ink-faint">
          Where your readers reach the books. Links are built from this, so it needs to be an
          address <em>they</em> can open — not localhost.
        </span>
      </label>

      {/* Add */}
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void add() }}
          placeholder="Add a reader…"
          className="flex-1 px-3 py-2 rounded bg-surface-overlay border border-accent/20 text-sm text-ink focus:outline-none focus:border-accent/50"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!name.trim() || busy}
          className="flex items-center gap-1.5 px-4 py-2 rounded bg-accent/15 border border-accent/30 text-accent text-sm font-medium transition hover:bg-accent/25 disabled:opacity-40 disabled:pointer-events-none"
        >
          <LuPlus size={14} /> Add
        </button>
      </div>

      {/* List */}
      <div className="flex flex-col gap-2">
        {readers.length === 0 && (
          <p className="text-sm text-ink-faint italic">No readers yet.</p>
        )}

        {readers.map(r => (
          <div
            key={r.id}
            className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface-raised border border-accent/10"
          >
            <div className="flex-1 min-w-0">
              {editing === r.id ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  onBlur={() => { void patch(r.id, { displayName: draftName }); setEditing(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { void patch(r.id, { displayName: draftName }); setEditing(null) }
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  className="w-full px-2 py-1 rounded bg-surface-overlay border border-accent/30 text-sm text-ink focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => { setEditing(r.id); setDraftName(r.displayName) }}
                  className="text-sm text-ink hover:text-accent transition text-left truncate"
                  title="Rename"
                >
                  {r.displayName}
                </button>
              )}
              <p className="text-xs text-ink-faint">{ago(r.lastSeenAt)}</p>
            </div>

            <span
              className={`shrink-0 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                r.disabled
                  ? 'text-ink-faint border-ink-faint/30'
                  : 'text-accent border-accent/30 bg-accent/10'
              }`}
            >
              {r.disabled ? 'Revoked' : 'Active'}
            </span>

            <button
              type="button"
              onClick={() => void copyLink(r.id)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-ink-muted hover:text-accent hover:bg-accent/10 transition"
              title="Copy this reader’s invite link"
            >
              {copiedId === r.id ? <LuCheck size={13} /> : <LuCopy size={13} />}
              {copiedId === r.id ? 'Copied' : 'Copy link'}
            </button>

            <button
              type="button"
              onClick={() => void patch(r.id, { disabled: !r.disabled })}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-ink-muted hover:text-accent hover:bg-accent/10 transition"
              title={r.disabled ? 'Let this reader back in' : 'Revoke access on their next page load'}
            >
              {r.disabled ? <LuUserCheck size={13} /> : <LuUserX size={13} />}
              {r.disabled ? 'Enable' : 'Disable'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
