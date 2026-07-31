# ops/ — scheduled automation

Backup, snapshot, audiobook and ebook automation. These run unattended under
`launchd`; they are **not** part of Loom's build.

> `scripts/` is Loom's build tooling — `ensure-native.mjs` and
> `ensure-narrate.mjs` run on every `predev` / `prebuild` / `prestart` /
> `postinstall`. Keep the two apart. Nothing here is invoked by `npm`.

## `~/Scripts` is a symlink to this directory

```
~/Scripts -> ~/Documents/GitHub/Loom/ops
```

Both launchd jobs invoke `$HOME/Scripts/<name>.sh` by absolute path, and the
scripts reference each other the same way. The symlink means those paths keep
resolving **unchanged**, so version control cost zero plist edits.

`MONOREPO-MIGRATION.md` §8 lists launchd absolute paths as a repeat offender —
a directory move means editing both plists and re-`bootstrap`ing, with prior
PATH and dev-port breakage as precedent. The symlink sidesteps that entirely.

**If you ever move this directory, the symlink must move with it**, or both
scheduled jobs fail silently at their next run.

## Scheduled jobs

| Job | Script | When |
|---|---|---|
| `com.marisarichmond.bookbackup` | `book_backup.sh` | 22:30 daily |
| `com.marisarichmond.loomsnapshot` | `loom_db_snapshot.sh` | 08:30 and 18:00 |

Logs land in `~/Backups/_logs/`.

## Contents

| File | Purpose |
|---|---|
| `book_backup.sh` | Nightly manuscripts + Loom DB + `.loom.json` → local, iCloud, Google Drive. Validates its outputs (KAN-14). |
| `loom_db_snapshot.sh` | Intraday `dev.db` snapshot, matched to writing sessions (KAN-15). |
| `lib/backup_verify.sh` | Output validators, sourced by the above. Side-effect free so a harness can exercise them against corrupted fixtures. |
| `check_loom_json.py` | Parses `.loom.json` snapshots and asserts real content. |
| `generate_audiobook.sh` / `build_audiobooks.sh` / `build_m4b.sh` | TTS audiobook build. |
| `generate_ebook.sh` | EPUB build for Apple Books. |
| `finish_split.sh` / `finish_remaining.sh` | One-off helpers for the audiobook chapter split. |

## Editing these

They run unattended against irreplaceable data, so:

* **Validate outputs, not exit codes.** Every failure this chain has had was a
  command exiting 0 while producing something wrong. See `lib/backup_verify.sh`
  and KAN-14.
* **Never run `book_backup.sh` directly to test it** — it drives Pages,
  regenerates audiobooks and ebooks, and uploads to Drive. Copy it and `sed` the
  config vars (`LOCAL_BACKUP_ROOT`, `ICLOUD_BOOKS_DIR`, `GDRIVE_ROOT`,
  `AUDIOBOOK_SCRIPT`, `EBOOK_SCRIPT`) to sandbox paths, and stub the `rclone`
  call.
* **Syntax checking is not enough.** These use `set -euo pipefail`; the real
  risk is aborting midway at 22:30. Only an end-to-end run against sandbox
  paths catches that.
* `loom_db_snapshot.sh` takes `LOOM_DB` / `BACKUP_ROOT` / `GDRIVE_ROOT` from the
  environment, so it can be tested against scratch paths without a copy.

## Recovery

`RESTORE.md` in the repo root documents the verified restore path.
