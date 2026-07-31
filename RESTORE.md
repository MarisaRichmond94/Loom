# Restoring Loom from backup

Written for the version of you who is having a bad day. Every command below
was executed and verified on 2026-07-29. Copy-paste them.

**Nothing here writes to `dev.db`.** You restore to a scratch file first and
only swap it in deliberately, at the end, if you decide to.

---

## 0. What you have

| What | Where | Contains |
|------|-------|----------|
| `loom-dev.db.gz` | `~/Backups/<date>/` **and** `gdrive:Backups/<date>/` | The whole database, gzipped (~24 MB) |
| `*.loom.json` | `~/Backups/<date>/loom-json/<book>/` | Per-book prose **plus CYOA choices** |
| `*.pages` / `.txt` / `.docx` | `~/Writing/`, iCloud Books | Linear manuscript only, no branches |
| `writeai-writer_data/*.json` | `~/Backups/<date>/` **and** `gdrive:Backups/<date>/` | WriteAI's **writer-authored** state (KAN-27) |
| `writeai-series_metadata.db.gz` | same | WriteAI's index — the parts that cost money (KAN-28) |
| `writeai-chunk_hashes.json` | same | Ingest change-detection state |

Backups run nightly at **22:30** (`~/Scripts/book_backup.sh` →
`ops/book_backup.sh`, `com.marisarichmond.bookbackup.plist`). Worst case you
lose the writing done since the last run.

`dev.db` is `journal_mode=delete` with no `-wal`/`-shm` sidecars, so the
gzipped `sqlite3 .backup` is a complete, consistent database. There is no
torn-copy hazard and no sidecar you need to restore alongside it.

---

## 1. Restore the database to a scratch file

```sh
mkdir -p /tmp/restore && cd /tmp/restore
gunzip -c ~/Backups/2026-07-28/loom-dev.db.gz > restored.db   # EDIT the date
sqlite3 restored.db "PRAGMA integrity_check;"                 # must print: ok
```

Takes about a second. If `integrity_check` prints anything other than `ok`,
stop and try a different date, or the Google Drive copy (§2).

## 2. If the machine or the local backups are gone

```sh
cd /tmp/restore
rclone lsd gdrive:Backups                                     # list what exists
rclone copy gdrive:Backups/2026-07-28/loom-dev.db.gz ./
gunzip -c loom-dev.db.gz > restored.db
sqlite3 restored.db "PRAGMA integrity_check;"
```

`rclone` lives at **`/usr/local/bin/rclone`**. (`book_backup.sh` probes
`/opt/homebrew/bin` first and falls back correctly, but if you are typing by
hand, use the `/usr/local` path.)

Verified 2026-07-29: the Drive copy is **byte-identical** to the local one —
same SHA-256. Either source is equally good.

## 3. Check what you actually got

```sh
sqlite3 restored.db "SELECT 'series=' || (SELECT COUNT(*) FROM Series)
  || ' books='    || (SELECT COUNT(*) FROM Book)
  || ' chapters=' || (SELECT COUNT(*) FROM Chapter)
  || ' blocks='   || (SELECT COUNT(*) FROM ContentBlock)
  || ' words='    || (SELECT SUM(wordCount) FROM ContentBlock);"
```

Baseline from the 2026-07-28 snapshot, for comparison:

```
series=1 books=5 chapters=339 blocks=662 words=775038
```

Read some actual prose before trusting it — counts can look right while
content is empty:

```sh
sqlite3 restored.db 'SELECT cb.content FROM ContentBlock cb
  JOIN Chapter c ON c.id = cb.chapterId
  JOIN Book b ON b.id = c.bookId
  WHERE b.title = "The Secrets We Bury" AND c."order" = 33 LIMIT 1;' \
  | python3 -c "import json,sys; d=json.loads(sys.stdin.read());
t=lambda n: n.get('text','') if n.get('type')=='text' else ''.join(t(c) for c in n.get('content',[]));
print('\n\n'.join(filter(None,[t(p) for p in d['content'][:3]])))"
```

> `order` is a SQL keyword — it must be quoted as `c."order"`.
> Prose lives in `ContentBlock.content` as TipTap JSON. `Chapter` has no
> body column, and neither `Book` nor `Chapter` has an `updatedAt`.

## 4. Put it back

Stop Loom first so nothing is mid-write, keep the current file rather than
overwriting it, then swap:

```sh
launchctl bootout gui/$(id -u)/com.marisarichmond.loom
cd ~/Documents/GitHub/Loom
cp dev.db "dev.db.before-restore-$(date +%Y%m%d-%H%M%S)"   # keep the bad one
cp /tmp/restore/restored.db dev.db
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.marisarichmond.loom.plist
```

Open <http://localhost:3000> and confirm your books are there.

**Keep the `dev.db.before-restore-*` file.** If the restore turns out to be
older than you thought, that file is the only copy of whatever was in the
broken database. `dev.db.pre-*` is gitignored; `dev.db.before-restore-*` is
not — do not commit it.

---

## 4b. Restoring WriteAI's writer_data

Separate from Loom, and separately irreplaceable. `writer_data/` holds the
writer's timeline events, character-name decisions, writer characters, and
every review and explore conversation. It is gitignored, so the nightly backup
is the **only** copy.

```sh
# stop WriteAI first — it writes this directory
launchctl bootout gui/$(id -u)/com.marisarichmond.writeai

# inspect before overwriting anything
python3 - ~/Backups/<date>/writeai-writer_data <<'EOF'
import glob, json, os, sys
for p in sorted(glob.glob(os.path.join(sys.argv[1], "*.json"))):
    d = json.load(open(p))
    n = len(d) if isinstance(d, (list, dict)) else "?"
    print(f"{os.path.basename(p):32} {os.path.getsize(p):>9,} bytes  {n} entries")
EOF

# then copy back
cp ~/Backups/<date>/writeai-writer_data/*.json \
   ~/Documents/GitHub/WriteAi/writer_data/

launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.marisarichmond.writeai.plist
```

## 4c. Restoring WriteAI's index

`data/` is 13 GB and mostly derived, so only the parts that cost **money** are
backed up (KAN-28) — about 8 MB carrying ~$75 of accumulated API spend.

```sh
launchctl bootout gui/$(id -u)/com.marisarichmond.writeai

gunzip -c ~/Backups/<date>/writeai-series_metadata.db.gz \
  > ~/Documents/GitHub/WriteAi/data/series_metadata.sqlite
cp ~/Backups/<date>/writeai-chunk_hashes.json \
   ~/Documents/GitHub/WriteAi/data/chunk_hashes.json

launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.marisarichmond.writeai.plist
```

Restore `chunk_hashes.json` **together with** the database. It is the ingest's
change-detection state; a mismatched pair can make the next ingest re-extract
everything, which is exactly the spend this backup exists to avoid.

Then rebuild the free parts by re-ingesting from Settings → Sync: `chroma_db`
(local embeddings), `extracted_text` and `rich_text` are regenerated at no API
cost, just time.

**Do not look for a backup of `chroma_db`, `extracted_text` or `backups/`** —
they are deliberately excluded. The first two are free to rebuild; `backups/`
is WriteAI's own 12 GB of pre-ingest snapshots, and backing up backups is not a
strategy.

`plan_outline.json` is machine-generated (verified 2026-07-30) and rebuilds
from the index, so it is the one file here you can afford to lose.

---

## 5. Recovering prose without the database

If the DB is unusable, `.loom.json` is the better fallback: it is the **only
backup carrying CYOA choices**. The `.pages`/`.txt`/`.docx` exports are linear
and drop branching entirely.

```sh
python3 - <<'PY'
import json
p = "~/Backups/2026-07-28/loom-json/Split/Split_2026-07-29.loom.json"
import os; d = json.load(open(os.path.expanduser(p)))
for book in d["series"]["books"]:
    for ch in book["chapters"]:
        for blk in ch["blocks"]:
            doc = json.loads(blk["content"])          # NOTE: a JSON *string*
            t = lambda n: n.get("text","") if n.get("type")=="text" else "".join(t(c) for c in n.get("content",[]))
            print(f'--- {book["title"]} / {ch["title"]} ---')
            print("\n\n".join(filter(None, (t(x) for x in doc.get("content", [])))))
PY
```

**The trap:** `blocks[].content` is a JSON **string**, not a nested object.
Forget the inner `json.loads` and you silently get zero words out with no
error. This cost time during the 2026-07-29 drill.

Structure: `series → books[] → chapters[] → blocks[] → content`.

Verified 2026-07-29 across all five books: 339 chapters, 70 choices, ~789k
words. (That word count is a naive `split()`; the DB's own `wordCount` sums to
775,038. The methods differ — the ~14k gap is expected, not missing prose.)

**Known omission:** `buildBookPayload()` does not export `ChapterNote`,
`ChapterNarration`, `NarrationSegment`, or `ReaderSession`. Notes exist only
in the database snapshot — a restore from JSON alone drops them. Accepted
2026-07-27.

---

## 6. Drill results — 2026-07-29

Everything above was executed against the 2026-07-28 backup.

| Check | Result |
|-------|--------|
| Local `gunzip` + `integrity_check` | **ok** (0.13s) |
| Google Drive restore, independent | **ok** — byte-identical SHA-256 to local |
| Row counts vs production | reconcile; all deltas in the expected direction |
| Prose readable | yes — formatting, smart quotes, em dashes intact |
| `.loom.json` × 5 | all parse; 339 chapters, 70 choices |
| Time to a verified restored DB | **under 30 seconds** |

Delta between that snapshot and production at drill time — i.e. what a
restore would actually have cost:

- **250 words**, 2 chapters, 25 chapter notes

That is the real exposure of a nightly-only schedule on a normal writing day.

**Re-run this drill periodically.** A backup chain that worked in July is not
evidence about November.
