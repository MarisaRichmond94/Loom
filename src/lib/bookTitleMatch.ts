// The one rule for deciding whether two book titles name the same book.
//
// Loom, WriteAI and the ops generate scripts each hold these titles
// independently, and every cross-boundary lookup joins on them. A curly
// apostrophe on one side is a silent miss on the other — `Nobody's Hero` is
// the live example, and it found the bug the first time by failing on exactly
// one book while the other four worked.
//
// Its own module, with no imports, because the callers have nothing else in
// common: writeaiBooks.ts needs Prisma, writingArtifacts.ts spawns shell
// scripts, and the Explore scope resolver needs neither. Sharing the rule
// through whichever file happened to define it first is how writingArtifacts
// ended up pulling the Prisma client in behind a six-line string function.
export const normBookTitle = (s: string) =>
  s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()
