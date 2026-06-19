#!/usr/bin/env node
// Verifies that better-sqlite3's native binding can load against the
// current Node version, and rebuilds it if the module-version stamp
// has drifted (the classic "compiled against NODE_MODULE_VERSION 127,
// this Node requires 137" failure after a Node upgrade). Runs before
// `npm run dev` / `build` / `start` so a fresh Node bump self-heals
// without the writer having to know what `npm rebuild` does.
//
// Idempotent and quiet on the happy path — only logs when it has to
// take action.

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function loads() {
  try {
    require('better-sqlite3')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e }
  }
}

const first = loads()
if (first.ok) process.exit(0)

const msg = String(first.error?.message ?? '')
const isBindingMismatch = first.error?.code === 'ERR_DLOPEN_FAILED'
  || /NODE_MODULE_VERSION/.test(msg)
  || /was compiled against a different Node\.js/.test(msg)

if (!isBindingMismatch) {
  // Something else is wrong (missing module entirely, corrupted install).
  // Don't paper over it — surface the real error.
  console.error('[ensure-native] better-sqlite3 failed to load, but the')
  console.error('[ensure-native] failure does not look like a Node version')
  console.error('[ensure-native] mismatch. Original error:')
  console.error(first.error)
  process.exit(1)
}

console.log('[ensure-native] better-sqlite3 was compiled against a different')
console.log('[ensure-native] Node version — rebuilding now…')

const rebuild = spawnSync('npm', ['rebuild', 'better-sqlite3'], { stdio: 'inherit' })
if (rebuild.status !== 0) {
  console.error('[ensure-native] npm rebuild better-sqlite3 failed.')
  process.exit(rebuild.status ?? 1)
}

const second = loads()
if (!second.ok) {
  console.error('[ensure-native] Native binding still fails to load after rebuild.')
  console.error(second.error)
  process.exit(1)
}

console.log('[ensure-native] Rebuild succeeded.')
