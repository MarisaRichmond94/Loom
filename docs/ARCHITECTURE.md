# Loom — Architecture & Design Notes

A reference for anyone picking up the codebase. Covers the data model, routing structure, key design decisions, and non-obvious patterns.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | SQLite via `better-sqlite3` |
| ORM | Prisma 7 (driver adapters mode) |
| Editor | TipTap 3 (ProseMirror-based) |
| Drag & drop | @dnd-kit |
| Styling | Tailwind CSS v4 (`@theme` variables, no config file) |
| Runtime extras | `yt-dlp` (external CLI, via Homebrew) |

---

## Data model

```
Series
├── StoryVariable[]       (scoped to the series, shared across all books)
├── Character[]           (series-level cast)
├── ReaderSession[]       (one per playthrough)
└── Book[]
    └── Chapter[]
        └── ContentBlock[]
            ├── Choice[]              (only on choice_point blocks)
            └── ConditionalOverride[] (only on conditional_fragment blocks)
```

### ContentBlock types

All content lives in `ContentBlock` rows with a `type` discriminator:

| `type` | Purpose | Fields used |
|---|---|---|
| `text` | Rich-text prose | `content` (TipTap HTML) |
| `choice_point` | Branch decision | `prompt`, `displayType`, `choices[]` |
| `conditional_fragment` | Conditionally rendered text | `overrides[]` |
| `soundtrack` | Background music | `prompt` (title), `content` (file path) |

Blocks have an `order` integer. All ordering is explicit — **never rely on insertion order**.

### Choices

Each `Choice` row belongs to a `choice_point` block and stores:
- `label` — display text
- `setsVariables` — JSON string (`Record<string, boolean|number|string>`) applied to story state when chosen
- `targetChapterId` — nullable; if set, navigates the reader to that chapter

### ConditionalOverride

Each override belongs to a `conditional_fragment` block and stores:
- `condition` — JSON string (`Record<string, value>`) — all keys must match story state
- `content` — TipTap HTML rendered if condition passes
- `order` — overrides are evaluated in ascending order; first match wins

### StoryVariable

Series-level variables. `type` is a hint (`boolean`, `number`, `string`) — the actual value stored in `ReaderSession.storyState` is whatever the choice sets. `defaultValue` is a JSON-encoded string (e.g. `"false"`, `"0"`, `"\"open\""`) parsed at session creation.

### ReaderSession

One row per playthrough. Stores:
- `storyState` — JSON string of the current variable map
- `choiceHistory` — JSON string of `HistoryEntry[]` (choice point ID, choice ID, state snapshot at that point)
- `currentBlockId` — tracks reader position (used to resume and for rewind navigation)

---

## Routing

### Author-facing pages

| Route | Purpose |
|---|---|
| `/` | Series list (home) |
| `/author/[seriesId]` | Series overview — books, characters, variables |
| `/author/[seriesId]/book/[bookId]` | Book overview — chapter list |
| `/author/[seriesId]/chapter/[chapterId]` | Chapter editor (blocks, metadata) |
| `/settings` | Backup configuration |

### Reader-facing pages

| Route | Purpose |
|---|---|
| `/read/[sessionId]` | Reader view — renders blocks, handles choices, tracks state |

### API routes

The API follows two structural patterns:

**Nested under the content hierarchy** — for operations that need context:
```
/api/series/[seriesId]/...
/api/series/[seriesId]/books/[bookId]/...
/api/series/[seriesId]/books/[bookId]/chapters/[chapterId]/...
/api/chapters/[chapterId]/blocks/...
```

**Block-centric** — for operations on a known block ID:
```
/api/blocks/[blockId]/choices/[choiceId]
/api/blocks/[blockId]/overrides/[overrideId]
/api/blocks/[blockId]/audio
/api/blocks/[blockId]/audio/youtube
```

---

## Story engine (`src/lib/storyEngine.ts`)

Pure functions — no database access, no side effects. Testable in isolation.

**`resolveConditional(block, storyState)`** — evaluates a `conditional_fragment`'s overrides in order and returns the first matching override's content, or `null` if none match.

**`applyChoice(currentState, currentHistory, choicePointId, choice)`** — merges `choice.setsVariables` into story state and appends a history entry with a snapshot of state *before* the choice (needed for rewind).

**`rewindTo(history, choicePointId)`** — finds the history entry for a given choice point, restores the state snapshot from just before that choice was made, and truncates history to that point.

The session API routes (`/advance`, `/rewind`) call these functions and persist results to `ReaderSession`.

---

## TipTap editor

`TextBlock` uses a custom TipTap setup. A few non-obvious decisions:

**Custom `textStyle` mark** (`TextStyleColor` in `TextBlock.tsx`) — TipTap's built-in `TextStyle` + `Color` combo uses `addGlobalAttributes()`, which has a broken `getRenderedAttributes` path in TipTap 3. We define a `Mark.create()` with `addAttributes()` directly instead. This is why color renders correctly in the live editor. Changing back to the official extension will break live color display.

**`localEditRef` pattern** — TipTap content is set via `editor.commands.setContent()`. Without guarding, incoming `content` prop changes (from parent re-renders) would overwrite text the user is mid-typing. `localEditRef` is set on focus and cleared on blur; while set, the sync `useEffect` skips `setContent`.

**Custom marks** (in `src/lib/extensions/`):
- `CharacterMark` — wraps character name mentions in `<span data-character-id>`. Stored in TipTap HTML, visible in editor with dotted underline.
- `Footnote` — wraps text in `<span data-footnote="...">`. CSS in `globals.css` renders the footnote content as a hover tooltip.

---

## Drag and drop

Block reordering uses `@dnd-kit` (already a dependency). The same library is used in `OutlineTree` for chapter reordering.

**`DragOverlay`** — when dragging a block, the original fades to 30% opacity (ghost placeholder) and a clean skeleton card floats under the cursor. This avoids the distortion that happens when @dnd-kit applies CSS transforms to rich editor content. The overlay is a pure visual — it doesn't run any block sub-components.

**Keyboard reorder** — `Ctrl+Shift+↑/↓` moves the active block (not `Cmd+Shift` — that's used by macOS for text selection).

---

## Ordering conventions

Blocks, chapters, and books all have an explicit `order: Int` column. Rules:

- On create (append): `order = count + 1`
- On insert at position N: `UPDATE ... SET order = order + 1 WHERE order >= N`, then insert at N
- On delete: `UPDATE ... SET order = order - 1 WHERE order > deleted.order`
- On reorder (drag): bulk `PATCH` to the `/reorder` endpoint, which updates all rows in a Prisma transaction

Chapter auto-rename on insert/delete: if a chapter title matches `^\d+$` or `^Chapter \d+$`, the number is incremented/decremented along with the order. Drag-to-reorder does **not** rename.

---

## Active block tracking

The chapter editor page maintains `activeBlockId` state. `BlockEditor` calls `onActiveBlockChange` whenever the active block changes. This is used to:

1. Insert new blocks *after* the active block (not always at the end)
2. Target the `⌥⇧D` delete hotkey at the correct block

The delete handler uses a ref (`activeBlockIdRef`) written during render rather than a closure dep, to avoid stale values across async operations.

---

## File uploads

Uploaded assets are written to `public/` and served statically by Next.js:

| Asset type | Path pattern |
|---|---|
| Book covers | `public/covers/[bookId].[ext]` |
| Audio files | `public/music/[blockId].[ext]` |
| Author avatar | `public/avatar.jpg` |
| Character avatars | `public/characters/[characterId].[ext]` |

These paths are **not committed** (gitignored). On a fresh clone, the directories are created at first upload.

**YouTube audio** — the `/api/blocks/[blockId]/audio/youtube` route shells out to `yt-dlp -f bestaudio --no-playlist`. The `-f bestaudio` flag downloads a native audio-only stream (webm/opus or m4a/aac) without requiring ffmpeg. Any existing audio for the block is deleted before downloading.

---

## Backup system

Configured via `/settings`. Settings are stored in `data/backup-settings.json` (not the database).

At server startup (`src/instrumentation.ts`), `scheduleBackup()` reads the settings and registers a `node-cron` job. The job exports each book to a `.loom.json` file (same format as the manual export) into a user-chosen folder, organized as `<series>/<book>/<book>_<date>.loom.json`. Old backups beyond the retention window are deleted automatically.

The backup format (`loom.json`) is the same as the manual per-book export available from the book page.

---

## Theme system

Tailwind v4 — **no `tailwind.config.js`**. All custom tokens are declared in `globals.css` under `@theme`:

```css
@theme {
  --color-surface-base: #0d0d18;
  --color-accent: #8888ff;
  /* etc. */
}
```

These become Tailwind utilities (`bg-surface-base`, `text-accent`, etc.) automatically.

**Light mode** — scoped to the reader via the `.light-body` class applied to the `<main>` element, not the whole page. The sidebar and chrome stay dark; only the reading area flips. Implemented by overriding the same `--color-*` variables inside `.light-body { }`.

---

## Prisma setup

The project uses Prisma's **driver adapters** mode with `@prisma/adapter-better-sqlite3`. This is why the Prisma client is instantiated manually in `src/lib/prisma.ts` rather than using the default singleton pattern. The `DATABASE_URL` env var is optional — it defaults to `file:./dev.db` (resolves to `data/dev.db`).

The generated client is output to `src/generated/prisma/` (configured in `schema.prisma`). This directory is gitignored — run `npx prisma generate` after cloning.
