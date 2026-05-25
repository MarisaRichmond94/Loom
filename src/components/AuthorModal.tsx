'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { LuX, LuUser, LuBookOpen } from 'react-icons/lu'
import {
  getFollowedAuthors,
  toggleFollowedAuthor,
} from '@/lib/readerProgress'

// Author profile modal. Opened from any byline ("by <name>") across the
// reader-side: Explore cards, series landing, book landing. Pulls the
// global profile once, shows photo + name + bio, exposes a Follow toggle
// (localStorage; Loom is single-author-per-instance for now), and lists
// other series by the same author below.

type Profile = {
  authorName: string
  bio: string
  pseudonymEnabled: boolean
  pseudonym: string
  hasAvatar: boolean
  hasPseudonymAvatar: boolean
}

type OtherSeries = {
  id: string
  title: string
  heroCoverPath: string | null
  publishedBookCount: number
  totalBookCount: number
  authorName: string
}

type Props = {
  // The name displayed in the byline that opened the modal — required so
  // we can detect when it's NOT the real author (demo / future
  // multi-author rows) and render a minimal stub instead of the full
  // profile.
  authorName: string
  // Series to exclude from "More from <name>" so the modal opened from a
  // series landing doesn't list the very series you're already on.
  excludeSeriesId?: string
  onClose: () => void
}

export default function AuthorModal({ authorName, excludeSeriesId, onClose }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [otherSeries, setOtherSeries] = useState<OtherSeries[]>([])
  const [following, setFollowing] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/settings/profile')
      .then(r => r.ok ? r.json() : null)
      .then(setProfile)
      .catch(() => setProfile(null))
    fetch('/api/explore')
      .then(r => r.ok ? r.json() : [])
      .then(setOtherSeries)
      .catch(() => setOtherSeries([]))
    setFollowing(getFollowedAuthors())
  }, [])

  // Escape closes the modal — matches the rest of the app's dismissal pattern.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!profile) {
    return (
      <div
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8"
        onClick={onClose}
      >
        <p className="text-ink-faint text-sm">Loading…</p>
      </div>
    )
  }

  // The "real author" is the one matching the global profile's display
  // name. Anything else (demo seed's fake authors, future multi-author
  // rows) gets a minimal stub: name + Follow + a "More from" list of
  // other series attributed to the same name.
  const realDisplayName =
    profile.pseudonymEnabled && profile.pseudonym.trim()
      ? profile.pseudonym.trim()
      : profile.authorName.trim()
  const isRealAuthor = authorName === realDisplayName && !!realDisplayName
  const followed = following.includes(authorName)

  // Avatar resolution mirrors the Settings preview, but only for the real
  // author. Demo authors fall back to a placeholder icon.
  let avatarSrc: string | null = null
  let avatarBlurred = false
  if (isRealAuthor) {
    if (profile.pseudonymEnabled) {
      if (profile.hasPseudonymAvatar) avatarSrc = '/pseudonym-avatar.jpg'
      else if (profile.hasAvatar) { avatarSrc = '/avatar.jpg'; avatarBlurred = true }
    } else if (profile.hasAvatar) {
      avatarSrc = '/avatar.jpg'
    }
  }

  function onFollow() {
    setFollowing(toggleFollowedAuthor(authorName))
  }

  // "More from <name>" matches by author. Real author = anything not
  // overridden (so the Explore endpoint resolved to the same name).
  // Demo author = exact match on the override name. Either way,
  // exclude the series the reader came from.
  const visibleOthers = otherSeries
    .filter(s => s.id !== excludeSeriesId)
    .filter(s => s.authorName === authorName)

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface-raised border border-accent/20 rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col"
      >
        {/* Header: avatar + name + Follow + close X */}
        <div className="flex items-start gap-4 p-6 border-b border-accent/10">
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-accent/30 bg-surface-base shrink-0 flex items-center justify-center">
            {avatarSrc
              ? <img
                  src={avatarSrc}
                  alt={authorName}
                  className={`w-full h-full object-cover ${avatarBlurred ? 'blur-md scale-110' : ''}`}
                />
              : <LuUser size={32} className="text-ink-faint" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-semibold text-ink truncate">{authorName || 'Unnamed author'}</p>
            <button
              type="button"
              onClick={onFollow}
              disabled={!authorName || isRealAuthor}
              title={isRealAuthor ? "You can't follow yourself" : undefined}
              className={`mt-2 px-3 py-1.5 rounded text-xs font-medium border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                followed
                  ? 'bg-accent/10 border-accent/40 text-ink hover:bg-accent/15'
                  : 'bg-accent text-white border-accent hover:opacity-90'
              }`}
            >
              {followed ? 'Following' : 'Follow'}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="text-ink-faint hover:text-ink transition shrink-0"
          >
            <LuX size={18} />
          </button>
        </div>

        {/* Scroll area: bio + other series */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
          {isRealAuthor && profile.bio ? (
            <p className="text-sm text-ink-muted leading-relaxed whitespace-pre-wrap">{profile.bio}</p>
          ) : (
            <p className="text-sm text-ink-faint italic">No bio yet.</p>
          )}

          {visibleOthers.length > 0 && (
            <section>
              <h3 className="text-xs uppercase tracking-widest text-ink-faint mb-3">
                More from {authorName || 'this author'}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleOthers.map(s => (
                  <Link
                    key={s.id}
                    href={`/preview/series/${s.id}`}
                    onClick={onClose}
                    className="group flex items-stretch gap-3 p-3 rounded-lg bg-surface-overlay border border-accent/10 hover:border-accent/40 transition"
                  >
                    <div className="relative w-12 shrink-0 rounded overflow-hidden bg-surface-base border border-accent/10 aspect-[2/3] flex items-center justify-center">
                      {s.heroCoverPath
                        ? <Image src={s.heroCoverPath} alt="" fill sizes="48px" className="object-cover" />
                        : <LuBookOpen size={14} className="text-ink-faint" />}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <p className="text-sm font-medium text-ink truncate group-hover:text-accent transition">{s.title}</p>
                      <p className="text-[10px] uppercase tracking-widest text-ink-faint mt-0.5">
                        {s.totalBookCount} book(s)
                        {s.publishedBookCount < s.totalBookCount && (
                          <> ({s.publishedBookCount} published)</>
                        )}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
