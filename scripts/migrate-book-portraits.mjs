// Rename Loom's per-book portraits from cuid to `wc-` names — LOOM-87, under
// LOOM-5.
//
//   node scripts/migrate-book-portraits.mjs           # dry run
//   node scripts/migrate-book-portraits.mjs --apply   # copy
//
// public/characters/<cuid>-<bookId>.jpg -> <wc-id>-<bookId>.jpg
//
// COPY, never move. The originals stay exactly where they are until LOOM-90's
// cleanup commit, so at every moment during this migration both names resolve
// and there is no window in which a portrait is missing. Each copy is verified
// by hash before the run is called a success — `cp` exiting 0 is not evidence
// the file is right, which is the class of mistake behind three separate
// backup bugs in this project.
//
// Canonical portraits are deliberately NOT handled here: they were pushed into
// WriteAI instead (push-portraits-to-writeai.mjs), so the default portrait has
// exactly one home.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readMap } from './character-id-map.mjs'

const apply = process.argv.includes('--apply')
const DIR = process.env.LOOM_PUBLIC ??
  path.join(os.homedir(), 'Documents/GitHub/Loom/public/characters')

const md5 = file => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

const map = readMap()
if (!map) {
  console.error('✗ no character-id-map.json — run build-character-id-map.mjs first')
  process.exit(1)
}

// Filenames are `<id>-<bookId>.jpg`, and both halves are cuids containing no
// hyphen, so splitting on the single hyphen is unambiguous.
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jpg') && f.includes('-'))

const jobs = []
const skipped = []
for (const file of files) {
  const [loomId, rest] = file.replace(/\.jpg$/, '').split('-', 2)
  const bookId = rest
  if (loomId.startsWith('wc')) { skipped.push(`${file} (already migrated)`); continue }
  const wcId = map[loomId]
  if (!wcId) { skipped.push(`${file} (character not in the id map)`); continue }
  jobs.push({ file, from: path.join(DIR, file), to: path.join(DIR, `${wcId}-${bookId}.jpg`), wcId, bookId })
}

console.log(`\n${jobs.length} per-book portraits to copy in ${DIR}`)
console.log(apply ? 'Mode: APPLY\n' : 'Mode: dry run (pass --apply to copy)\n')
for (const j of jobs) console.log(`  ${j.file}  ->  ${path.basename(j.to)}`)
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length}:`)
  for (const s of skipped) console.log(`  - ${s}`)
}

if (!apply) {
  console.log('\nNothing copied. Originals are never moved or deleted by this script.')
  process.exit(0)
}

let copied = 0
const failures = []
for (const job of jobs) {
  try {
    fs.copyFileSync(job.from, job.to)
    if (md5(job.from) !== md5(job.to)) {
      failures.push(`${job.file}: copy does not match the original`)
      continue
    }
    copied++
  } catch (err) {
    failures.push(`${job.file}: ${err.message}`)
  }
}

console.log(`\n${copied}/${jobs.length} copied and hash-verified`)
console.log(`Originals still present: ${jobs.filter(j => fs.existsSync(j.from)).length}/${jobs.length}`)
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed:`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
