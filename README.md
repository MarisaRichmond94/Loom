# Loom

A local-first interactive fiction authoring tool. Write branching narratives with choice points, conditional text, per-character POV, and an in-app reader to preview the experience.

---

## Prerequisites

### Node.js

Install via [nvm](https://github.com/nvm-sh/nvm) or download from [nodejs.org](https://nodejs.org). Node 20+ recommended.

### Homebrew packages

```bash
brew install yt-dlp
```

`yt-dlp` is required for the **Download from YouTube** feature in Soundtrack blocks. Without it, file upload still works — only the YouTube option will fail.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database

The app uses a local SQLite database managed by Prisma. Run migrations to create it:

```bash
npx prisma migrate dev
```

This creates `data/dev.db`. You only need to run this once (and again any time the schema changes).

### 3. Generate the Prisma client

```bash
npx prisma generate
```

This is also run automatically during `migrate dev`, but run it manually if you ever see Prisma import errors.

---

## Running the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Project structure

| Path | Purpose |
|---|---|
| `src/app/` | Next.js App Router pages and API routes |
| `src/components/` | React components (editor, reader, sidebar) |
| `src/lib/` | Shared utilities, Prisma client, story engine |
| `prisma/` | Database schema and migrations |
| `public/` | Static assets (covers, music, avatars — not committed) |
| `data/` | SQLite database file (not committed) |

---

## Notes

- All data is stored locally — there is no backend server or cloud sync.
- `public/covers/`, `public/music/`, and `public/characters/` are created at runtime when you upload assets. They are gitignored, so a fresh clone starts with no uploaded files.
- The database is also gitignored. Each environment gets its own `data/dev.db` after running migrations.
