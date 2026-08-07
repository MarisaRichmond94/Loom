/**
 * The schema of `content.db` — what the reader tier is allowed to know.
 *
 * Defined as an explicit whitelist rather than derived from Loom's schema.
 * `dev.db` has ~25 models and most are author-only (ChapterNote,
 * ChapterSummary, WriterCharacterSnapshot, the WriteAI surface). A blacklist
 * would fail open every time a model is added; this cannot.
 *
 * Note what is ABSENT, and deliberately so:
 *   - no Choice, ConditionalOverride or StoryVariable. Canon is flattened at
 *     publish time, so the reader has no branches to evaluate and no engine to
 *     evaluate them with. A bug cannot leak a branch that is not here.
 *   - no first/death/last-appearance book references on Character. Those are
 *     inputs to the per-book projection, never outputs — publishing them would
 *     put "this character dies in book 3" in a book-1 response.
 *
 * `content.db` is disposable: rebuilt wholesale on every publish, never backed
 * up, and safe to delete. That is what lets this schema change freely.
 */
export const CONTENT_SCHEMA = `
CREATE TABLE Series (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  genres      TEXT NOT NULL DEFAULT '[]',
  keywords    TEXT NOT NULL DEFAULT '[]',
  authorName  TEXT NOT NULL DEFAULT ''
);

-- published=0 rows are STUBS: title and order only, so the series landing can
-- still show "Coming Soon" without the draft's synopsis, cover or chapters
-- existing anywhere on the reader tier.
CREATE TABLE Book (
  id        TEXT PRIMARY KEY,
  seriesId  TEXT NOT NULL,
  title     TEXT NOT NULL,
  synopsis  TEXT NOT NULL DEFAULT '',
  coverPath TEXT,
  "order"   INTEGER NOT NULL,
  published INTEGER NOT NULL DEFAULT 0
);

-- "order" is the position on the CANON PATH (1..n), which is not Loom's
-- Chapter.order: the walk skips gated chapters. "label" is what the reader
-- displays, and is the same number the canon export wrote and WriteAI ingested.
CREATE TABLE Chapter (
  id       TEXT PRIMARY KEY,
  bookId   TEXT NOT NULL,
  title    TEXT NOT NULL,
  label    TEXT NOT NULL,
  numbered INTEGER NOT NULL,
  "order"  INTEGER NOT NULL,
  pov      TEXT,
  date     TEXT
);
CREATE INDEX idx_chapter_book ON Chapter(bookId, "order");

-- ids are copied verbatim from Loom, or are deterministic composites of ids
-- that are. Reader positions and comment anchors depend on them not moving.
CREATE TABLE ContentBlock (
  id            TEXT PRIMARY KEY,
  chapterId     TEXT NOT NULL,
  "order"       INTEGER NOT NULL,
  type          TEXT NOT NULL,
  content       TEXT NOT NULL,
  displayType   TEXT,
  sourceBlockId TEXT NOT NULL,
  -- soundtrack only: the track's name, and the chapter range it is pinned to.
  -- Stored on ContentBlock.prompt/pinStart/pinEnd in Loom; renamed here because
  -- "prompt" means nothing to a reader looking at a track listing.
  title         TEXT,
  pinStart      INTEGER,
  pinEnd        INTEGER
);
CREATE INDEX idx_block_chapter ON ContentBlock(chapterId, "order");

-- One row per (character, book): the projection of what a reader may know by
-- the end of that book. A character absent from a book's rows is one the
-- reader should not know about yet — absence, not a hidden flag.
CREATE TABLE Character (
  id        TEXT NOT NULL,
  bookId    TEXT NOT NULL,
  name      TEXT NOT NULL,
  age       INTEGER,
  photoPath TEXT,
  deceased  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, bookId)
);

-- At most one row per chapter: the narration of the CANON path.
--
-- ChapterNarration in Loom is keyed [chapterId, contentHash] — a hash of the
-- segment texts, which depend on which choices were answered. A chapter can
-- therefore have many recordings, one per narrated branch (47 chapters do; one
-- has 22). Publishing the wrong row would ship branch prose to the reader as
-- AUDIO, past every guarantee the text side makes. Selection is by recomputed
-- canon hash, and a chapter with no canon recording publishes silent.
--
-- timing is the RECONCILED map, not the synthesizer's raw output. Loom's own
-- read view reconciles at serve time; a snapshot has no serve time, so publish
-- does it once, here. Shipping the raw ranges instead looks fine — it is a
-- valid JSON array of the right rough length — and drifts the word highlight a
-- word at a time until it is a paragraph behind the voice.
--
-- blockIds is the ordered list of blocks the recording actually speaks, which
-- is NOT "every non-soundtrack block": a block whose prose resolves to nothing
-- is skipped, and the highlight's whole contract is that DOM word N is timing
-- word N. Deriving that list in the browser is a guess about publish's rules;
-- storing it makes it the same fact both sides read.
CREATE TABLE Narration (
  chapterId  TEXT PRIMARY KEY,
  audioPath  TEXT NOT NULL,
  timing     TEXT NOT NULL,
  blockIds   TEXT NOT NULL,
  durationMs INTEGER NOT NULL
);

CREATE TABLE PublishMeta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
