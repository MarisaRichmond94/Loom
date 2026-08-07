import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'

import { openReaderDb } from '@shared/readerDb'
import type Database from 'better-sqlite3'

/**
 * The author's side of reader identity (LOOM-132).
 *
 * Two things live here: where `reader.db` is from Loom's point of view, and the
 * base URL that invite links are built against.
 *
 * THE BASE URL IS A SETTING, not an env var and not the request's own host.
 * The link is only useful if it points at the tailnet address the reader can
 * actually reach — and Loom is served on a different port from the reader, so
 * deriving it from wherever settings happened to be opened would quietly
 * produce a link that works for the author and nobody else. Making it visible
 * and editable means the wrong value is a thing you can SEE.
 */

export type ReaderInviteSettings = { baseUrl: string }

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'reader-invite-settings.json')

export function readerInviteDefaults(): ReaderInviteSettings {
  // Correct for the only place the reader currently runs. It becomes wrong the
  // day the tailnet host exists, which is exactly why it is editable.
  return { baseUrl: 'http://localhost:3200' }
}

export async function readReaderInviteSettings(): Promise<ReaderInviteSettings> {
  const defaults = readerInviteDefaults()
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_PATH, 'utf-8')) as Partial<ReaderInviteSettings>
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
        ? parsed.baseUrl.trim()
        : defaults.baseUrl,
    }
  } catch {
    return defaults
  }
}

export async function writeReaderInviteSettings(s: ReaderInviteSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8')
}

/** The invite link for a token. Trailing slashes on the base are tolerated. */
export function inviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/r/${token}`
}

/**
 * `reader.db`, from Loom. Loom's cwd is the repo root; the reader app's is
 * `reader/`, so the two resolve the same file by different routes rather than
 * sharing a constant neither could compute.
 *
 * READER_DB_PATH overrides it, which is how a sandbox Loom points at a
 * throwaway reader database instead of the real one.
 */
export const READER_DB_PATH =
  process.env.READER_DB_PATH ?? path.join(process.cwd(), 'reader', 'reader.db')

let handle: Database.Database | null = null

export function readerDb(): Database.Database {
  if (!handle) handle = openReaderDb(READER_DB_PATH)
  return handle
}
