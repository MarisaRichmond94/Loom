// Push Loom's canonical character portraits into WriteAI — LOOM-87, under
// LOOM-5.
//
//   node scripts/push-portraits-to-writeai.mjs           # dry run
//   node scripts/push-portraits-to-writeai.mjs --apply   # upload
//
// WHY, and why this direction. Loom holds 36 canonical portraits; WriteAI
// holds its own for the same people, extracted from canon at 32-46 KB against
// Loom's 100-240 KB. Every one of the 36 pairs differs. After the unification
// WriteAI's Characters tab is the one place a DEFAULT portrait is set, so the
// better image has to end up there — otherwise changing a photo in that tab
// would appear to do nothing, because a higher-priority Loom file was
// shadowing it.
//
// Lossless: WriteAI's upload handler writes the uploaded bytes verbatim
// (`dest.write_bytes(await file.read())`, plan.py:764) — no re-encode, no
// downscale. Verified per file by comparing hashes afterwards, not assumed.
//
// Loom's own files are NOT deleted here. They stay untouched until LOOM-90's
// cleanup commit, so this is reversible by doing nothing.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readMap, readWriterCharacters } from './character-id-map.mjs'

const apply = process.argv.includes('--apply')
const WRITEAI = process.env.WRITEAI_URL ?? 'http://localhost:8000'
const LOOM_PUBLIC = process.env.LOOM_PUBLIC ??
  path.join(os.homedir(), 'Documents/GitHub/Loom/public/characters')
const PHOTOS_DIR = process.env.WRITEAI_PHOTOS ??
  path.join(os.homedir(), 'Documents/GitHub/WriteAi/writer_data/photos')

const md5 = file => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

const map = readMap()
if (!map) {
  console.error('✗ no character-id-map.json — run build-character-id-map.mjs first')
  process.exit(1)
}

const writerById = new Map(readWriterCharacters().map(c => [c.id, c]))

// Canonical Loom portraits only. Per-book files (<cuid>-<bookId>.jpg) stay in
// Loom — they are the whole point of the feature and WriteAI has nowhere to
// put them.
const jobs = []
for (const [loomId, wcId] of Object.entries(map)) {
  const source = path.join(LOOM_PUBLIC, `${loomId}.jpg`)
  if (!fs.existsSync(source)) continue
  const writer = writerById.get(wcId)
  if (!writer) {
    console.error(`✗ ${wcId} is not in WriteAI's pool — run check-character-id-map.mjs`)
    process.exit(1)
  }
  jobs.push({ loomId, wcId, name: writer.name, source, size: fs.statSync(source).size })
}

console.log(`\n${jobs.length} canonical portraits to push`)
console.log(`From: ${LOOM_PUBLIC}`)
console.log(`To:   ${WRITEAI}/api/plan/characters/<wc-id>/photo`)
console.log(apply ? 'Mode: APPLY\n' : 'Mode: dry run (pass --apply to upload)\n')

if (!apply) {
  for (const j of jobs.slice(0, 5)) {
    console.log(`  ${j.name.padEnd(22)} ${(j.size / 1024).toFixed(0).padStart(4)} KB -> ${j.wcId}.jpg`)
  }
  if (jobs.length > 5) console.log(`  … and ${jobs.length - 5} more`)
  console.log('\nNothing uploaded.')
  process.exit(0)
}

let uploaded = 0
const failures = []

for (const job of jobs) {
  const bytes = fs.readFileSync(job.source)
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), `${job.wcId}.jpg`)

  let res
  try {
    res = await fetch(`${WRITEAI}/api/plan/characters/${encodeURIComponent(job.wcId)}/photo`, {
      method: 'POST',
      body: form,
    })
  } catch (err) {
    failures.push(`${job.name}: ${err.message}`)
    continue
  }
  if (!res.ok) {
    failures.push(`${job.name}: WriteAI responded ${res.status}`)
    continue
  }

  // Verify the stored bytes rather than trusting a 200. The upload replaces a
  // file in place under a stable name, so a silent truncation or re-encode
  // would look exactly like success.
  const { photo_url: photoUrl } = await res.json()
  const stored = path.join(PHOTOS_DIR, path.basename(photoUrl.split('?')[0]))
  if (!fs.existsSync(stored)) {
    failures.push(`${job.name}: WriteAI reported ${photoUrl} but no file is there`)
    continue
  }
  if (md5(stored) !== md5(job.source)) {
    failures.push(`${job.name}: stored bytes differ from the source (re-encoded or truncated)`)
    continue
  }

  uploaded++
  console.log(`  ✓ ${job.name.padEnd(22)} ${photoUrl}`)
}

console.log(`\n${uploaded}/${jobs.length} uploaded and byte-verified`)
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed:`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('Loom\'s own copies were not touched — this is reversible by doing nothing.')
