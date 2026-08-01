#!/usr/bin/env bash
#
# Intraday snapshots of Loom's database (LOOM-15).
#
# Loom's dev.db IS production. book_backup.sh runs once nightly at 22:30, so up
# to ~24h of writing can sit unbacked. This runs at 08:30 and 18:00 — chosen
# around the writer's actual sessions — cutting the worst window to ~10h
# overnight and ~4.5h in the evening.
#
# Database only. The .pages/.loom.json exports come from Loom's own 22:00 cron
# and don't change intraday, and the audiobook/ebook stages must never run here.
#
# Unlike the nightly script, this one VALIDATES its output before claiming
# success: gunzip -t, a real restore, PRAGMA integrity_check, and a content
# floor. That is deliberate — see LOOM-14. Every backup bug found so far was a
# step that checked its exit code and never looked at what it produced.
#
# Safe to run while Loom is live: `sqlite3 .backup` is designed for it, and
# dev.db is journal_mode=delete with no WAL sidecars.
#
# Install:
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.marisarichmond.loomsnapshot.plist
# Run by hand:
#   /bin/bash ~/Scripts/loom_db_snapshot.sh

set -uo pipefail

# launchd hands services a bare PATH; Homebrew binaries would be invisible.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Overridable so the whole thing can be exercised against scratch paths
# without touching production or Drive:
#   LOOM_DB=/tmp/copy.db BACKUP_ROOT=/tmp/bk GDRIVE_ROOT=/tmp/bk-remote \
#     bash ~/Scripts/loom_db_snapshot.sh
# (rclone treats a plain path as a local remote, so the upload path is real.)
LOOM_DB="${LOOM_DB:-$HOME/Documents/GitHub/Loom/dev.db}"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/Backups}"
GDRIVE_ROOT="${GDRIVE_ROOT:-gdrive:Backups}"
STATE_FILE="$BACKUP_ROOT/.loom_snapshot_state"
LOG_DIR="$BACKUP_ROOT/_logs"

# Catastrophe floor. Not a tight bound — it exists to catch a structurally
# valid but empty database, which integrity_check happily calls "ok".
MIN_CHAPTERS=100

NOW_DATE="$(date +%Y-%m-%d)"
# Scheduled runs are minute-unique by construction (08:30, 18:00), so HHMM is
# enough for them. A FORCED run is not: two clicks in the same minute, or a
# manual backup landing in the same minute as a scheduled one, would resolve to
# the same filename and the second would OVERWRITE the first. Overwriting a
# good scheduled snapshot with a manual one is a quiet loss, so forced runs get
# seconds and a marker that says where they came from.
if [[ "${FORCE:-0}" == "1" ]]; then
  NOW_HHMM="$(date +%H%M%S)-manual"
else
  NOW_HHMM="$(date +%H%M)"
fi
RUN_DIR="$BACKUP_ROOT/$NOW_DATE"
# Stamped with the run time so multiple intraday snapshots coexist instead of
# overwriting each other. More restore points is the point: an accidental
# deletion at 17:00 shouldn't be preserved by the 18:00 run with no earlier
# copy to fall back to. Never collides with the nightly's loom-dev.db.gz.
DEST="$RUN_DIR/loom-dev-${NOW_HHMM}.db.gz"
LOG_FILE="$LOG_DIR/snapshot_${NOW_DATE}.log"

mkdir -p "$RUN_DIR" "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log "=== intraday Loom DB snapshot ==="

[[ -f "$LOOM_DB" ]] || { log "ERROR: $LOOM_DB not found — nothing to snapshot."; exit 1; }
command -v sqlite3 >/dev/null || { log "ERROR: sqlite3 not on PATH."; exit 1; }

# --- skip if nothing changed -------------------------------------------------
# A snapshot of already-snapshotted bytes is 25 MB of nothing. Compare against
# the newest EXISTING artifact of any kind — including book_backup.sh's nightly
# loom-dev.db.gz — not just this script's own last run. Otherwise the 08:30 run
# would duplicate the 22:30 nightly every morning the writer didn't work
# overnight. Newest-wins by mtime, matching book_backup.sh's approach: immune to
# timezone, DST, and schedule changes.
db_mtime="$(stat -f %m "$LOOM_DB")"

last_chapters=""
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE" 2>/dev/null || true
  last_chapters="${LAST_CHAPTERS:-}"
fi

newest_snap=""
while IFS= read -r f; do
  [[ -z "$newest_snap" || "$f" -nt "$newest_snap" ]] && newest_snap="$f"
done < <(find "$BACKUP_ROOT" -maxdepth 2 -type f -name 'loom-dev*.db.gz' 2>/dev/null)

if [[ -n "$newest_snap" && ! "$LOOM_DB" -nt "$newest_snap" && "${FORCE:-0}" != "1" ]]; then
  log "dev.db (modified $(date -r "$db_mtime" '+%m-%d %H:%M')) is not newer than $(basename "$newest_snap") — nothing new to capture, skipping."
  exit 0
fi

# FORCE=1 defeats the skip above. Correct for the scheduled runs — there is no
# point storing a second identical snapshot — but WRONG for an on-demand
# backup: the writer asks for one because they are about to do something
# risky, and exiting 0 having produced nothing would report success for work
# that never happened. That is the exact failure class LOOM-14 exists to stop.
# Loom's "Back up now" (LOOM-26) sets it.
if [[ "${FORCE:-0}" == "1" && -n "$newest_snap" && ! "$LOOM_DB" -nt "$newest_snap" ]]; then
  log "FORCE=1 — snapshotting even though dev.db is not newer than $(basename "$newest_snap")."
fi

# --- snapshot ---------------------------------------------------------------
log "Snapshotting $(du -h "$LOOM_DB" | cut -f1) database..."
if ! sqlite3 "$LOOM_DB" ".backup '$TMP/loom-dev.db'" 2>>"$LOG_FILE"; then
  log "ERROR: sqlite3 .backup failed — no snapshot written."
  exit 1
fi

# --- validate BEFORE gzipping and BEFORE claiming success -------------------
integrity="$(sqlite3 "$TMP/loom-dev.db" "PRAGMA integrity_check;" 2>&1)"
if [[ "$integrity" != "ok" ]]; then
  # A badly damaged DB reports one line per bad page — thousands of them. Log a
  # summary plus a capped excerpt, and park the full report next to the log so
  # it's available without bloating the log itself.
  report="$LOG_DIR/integrity_${NOW_DATE}_$(date +%H%M%S).txt"
  printf '%s\n' "$integrity" > "$report"
  log "ERROR: integrity_check FAILED on the fresh snapshot ($(printf '%s\n' "$integrity" | wc -l | tr -d ' ') line(s)). Full report: $report"
  printf '%s\n' "$integrity" | head -5 | while IFS= read -r line; do log "  | $line"; done
  log "Keeping nothing. Investigate dev.db before trusting tonight's nightly."
  exit 1
fi

chapters="$(sqlite3 "$TMP/loom-dev.db" "SELECT COUNT(*) FROM Chapter;" 2>/dev/null || echo 0)"
words="$(sqlite3 "$TMP/loom-dev.db" "SELECT COALESCE(SUM(wordCount),0) FROM ContentBlock;" 2>/dev/null || echo 0)"

if (( chapters < MIN_CHAPTERS )); then
  log "ERROR: snapshot has only $chapters chapters (floor $MIN_CHAPTERS) — refusing to treat this as a good backup."
  exit 1
fi

# A drop in chapter count is legal (deletions happen) but worth surfacing.
if [[ -n "$last_chapters" ]] && (( chapters < last_chapters )); then
  log "WARNING: chapter count fell from $last_chapters to $chapters since the last snapshot. Intentional?"
fi

gzip -c "$TMP/loom-dev.db" > "$TMP/out.gz" || { log "ERROR: gzip failed."; exit 1; }

# Verify the compressed artifact itself, not just that gzip exited 0.
gunzip -t "$TMP/out.gz" 2>>"$LOG_FILE" || { log "ERROR: gzip output failed gunzip -t."; exit 1; }

mv "$TMP/out.gz" "$DEST"

# Stamp the artifact with dev.db's mtime AS READ, not with "now". This makes the
# skip check above exact rather than approximate: an artifact's mtime then means
# "the content version this holds", so `dev.db -nt artifact` answers precisely
# "has the writer changed anything since we captured this?". Without it, a write
# landing during the ~2s snapshot would make the artifact look newer than data it
# doesn't contain, and the next run would skip that write.
touch -t "$(date -r "$db_mtime" +%Y%m%d%H%M.%S)" "$DEST" 2>/dev/null \
  || log "WARNING: could not backdate $DEST to dev.db's mtime; skip checks fall back to approximate."

log "Snapshot OK: $(du -h "$DEST" | cut -f1)  chapters=$chapters  words=$words  -> $DEST"

# Record state only after a verified-good snapshot.
printf 'LAST_DB_MTIME=%s\nLAST_CHAPTERS=%s\n' "$db_mtime" "$chapters" > "$STATE_FILE"

# --- off-machine copy -------------------------------------------------------
# Non-fatal, matching book_backup.sh: a local verified snapshot is already
# worth having, and a network failure must not make this run "fail".
RCLONE=""
for candidate in /opt/homebrew/bin/rclone /usr/local/bin/rclone; do
  [[ -x "$candidate" ]] && { RCLONE="$candidate"; break; }
done
[[ -n "$RCLONE" ]] || RCLONE="$(command -v rclone || true)"

if [[ -n "$RCLONE" ]]; then
  log "Uploading to $GDRIVE_ROOT/$NOW_DATE ..."
  if "$RCLONE" copy "$DEST" "${GDRIVE_ROOT}/${NOW_DATE}" \
      --retries 3 --low-level-retries 10 \
      --log-level INFO --log-file "$LOG_FILE"; then
    log "Upload complete."
  else
    log "WARNING: Drive upload failed — the verified local snapshot is still in place."
  fi
else
  log "WARNING: rclone not found — local snapshot only, no off-machine copy."
fi

log "Done."
exit 0
