// Recompute ContentBlock.wordCount from scratch for every block:
// words in content + baseContent + every override's content. Mirrors
// blockWordCount() in src/lib/wordCounts.ts (and extractText/countWords in
// src/lib/seriesStats.ts). Safe to re-run any time the cached counts are
// suspected of drifting — it only writes the wordCount column.
//
// Usage: node scripts/backfill-word-counts.mjs
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = new Database(path.join(root, 'dev.db'))

function extractText(json) {
  if (!json) return ''
  try {
    const walk = node => {
      if (node.type === 'text') return node.text ?? ''
      return (node.content ?? []).map(walk).join(' ')
    }
    return walk(JSON.parse(json))
  } catch { return '' }
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

const blocks = db.prepare('SELECT id, content, baseContent FROM ContentBlock').all()
const overridesByBlock = new Map()
for (const o of db.prepare('SELECT conditionalFragmentId, content FROM ConditionalOverride').all()) {
  const list = overridesByBlock.get(o.conditionalFragmentId) ?? []
  list.push(o.content)
  overridesByBlock.set(o.conditionalFragmentId, list)
}

const update = db.prepare('UPDATE ContentBlock SET wordCount = ? WHERE id = ?')
let total = 0
db.transaction(() => {
  for (const b of blocks) {
    const texts = [b.content, b.baseContent, ...(overridesByBlock.get(b.id) ?? [])]
    const words = texts.reduce((sum, t) => sum + countWords(extractText(t)), 0)
    update.run(words, b.id)
    total += words
  }
})()

console.log(`Backfilled ${blocks.length} blocks, ${total} total words.`)
