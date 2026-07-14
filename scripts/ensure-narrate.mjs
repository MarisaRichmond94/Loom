#!/usr/bin/env node
// Compiles the chapter-narration Swift helper (scripts/native/narrate.swift)
// to scripts/native/bin/narrate when the binary is missing or older than the
// source. Runs before `npm run dev` / `build` / `start`, mirroring
// ensure-native.mjs, so an edit to the helper self-rebuilds.
//
// Degrades gracefully: if the Swift toolchain isn't installed, it warns and
// exits 0 rather than failing the whole dev/build — narration generation will
// simply no-op until `swiftc` is available (see src/lib/narration/generate.ts).

import { spawnSync } from 'node:child_process'
import { existsSync, statSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, 'native', 'narrate.swift')
const binDir = join(here, 'native', 'bin')
const bin = join(binDir, 'narrate')

function log(msg) { console.log(`[ensure-narrate] ${msg}`) }

// Up to date? (binary exists and is newer than the source)
if (existsSync(bin) && statSync(bin).mtimeMs >= statSync(src).mtimeMs) process.exit(0)

// Is the Swift compiler available?
const probe = spawnSync('swiftc', ['--version'], { stdio: 'ignore' })
if (probe.status !== 0) {
  log('swiftc not found — skipping. Chapter narration will be unavailable')
  log('until the Swift toolchain (Xcode command line tools) is installed.')
  process.exit(0)
}

mkdirSync(binDir, { recursive: true })
log('compiling narrate.swift…')
const build = spawnSync('swiftc', ['-O', src, '-o', bin], { stdio: 'inherit' })
if (build.status !== 0) {
  log('compile failed — narration will be unavailable until this is fixed.')
  // Don't hard-fail dev/build over an optional helper.
  process.exit(0)
}
log('built scripts/native/bin/narrate')
