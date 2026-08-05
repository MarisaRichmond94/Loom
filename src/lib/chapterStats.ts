import { countWords } from './seriesStats'

// Prose-texture stats for the chapter stats panel (LOOM-109). Word count and
// reading time are exact; dialogue % and filter-word count are heuristics —
// there's no dialogue markup or POS tagger in the document model to lean on,
// so they work off regex passes over the resolved plain text instead.

const WORDS_PER_MINUTE = 200

// Words writers commonly want to spot and trim: filter words (was, felt,
// seemed...) and hedges/intensifiers (just, really, very...).
const FILTER_WORDS = new Set([
  'was', 'were', 'felt', 'feel', 'seemed', 'looked', 'heard', 'saw',
  'thought', 'realized', 'wondered', 'knew', 'noticed', 'watched',
  'just', 'really', 'very', 'quite', 'rather', 'somewhat', 'basically',
  'actually', 'literally', 'totally', 'completely', 'definitely',
  'certainly', 'suddenly', 'almost', 'nearly',
])

// Common "-ly" words that read as adjectives/nouns rather than adverbs —
// excluded so the -ly sweep below doesn't flag them.
const LY_EXCLUSIONS = new Set([
  'family', 'only', 'ally', 'rally', 'belly', 'jelly', 'holy', 'ugly',
  'silly', 'folly', 'bully', 'supply', 'apply', 'comply', 'reply',
  'imply', 'multiply', 'assembly', 'chilly', 'hilly', 'curly', 'early',
  'elderly', 'friendly', 'lovely', 'lonely', 'deadly', 'costly',
  'timely', 'ghastly', 'unruly',
])

export type ChapterStats = {
  words: number
  readingMinutes: number
  dialoguePercent: number | null
  filterWordCount: number
}

export function countReadingMinutes(words: number): number {
  if (words === 0) return 0
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

// Sums the words inside quote-paired spans (straight or curly double
// quotes) as a stand-in for dialogue. A heuristic, not a parse — nested or
// unclosed quotes, and non-dialogue quoted text (a character quoting a
// letter), can throw it off.
export function estimateDialoguePercent(text: string, totalWords: number): number | null {
  if (totalWords === 0) return null
  const spans = text.match(/["“][^"”]*["”]/g) ?? []
  const dialogueWords = spans.reduce((sum, span) => sum + countWords(span), 0)
  return Math.round((Math.min(dialogueWords, totalWords) / totalWords) * 100)
}

export function countFilterWords(text: string): number {
  const words = text.match(/[A-Za-z']+/g) ?? []
  let count = 0
  for (const raw of words) {
    const w = raw.toLowerCase()
    if (FILTER_WORDS.has(w)) { count++; continue }
    if (w.length > 4 && w.endsWith('ly') && !LY_EXCLUSIONS.has(w)) count++
  }
  return count
}

export function computeChapterStats(text: string): ChapterStats {
  const words = countWords(text)
  return {
    words,
    readingMinutes: countReadingMinutes(words),
    dialoguePercent: estimateDialoguePercent(text, words),
    filterWordCount: countFilterWords(text),
  }
}
