#!/usr/bin/env bash
set -euo pipefail

# Make launchd behave more like your shell environment (safe even if unused)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

###############################################################################
# CONFIG (START)
###############################################################################

LOCAL_ROOT="$HOME/Writing"
BOOK_FILES=(
  "$LOCAL_ROOT/1. Nobody's Hero/Nobody's Hero.pages"
  "$LOCAL_ROOT/2. Faded/Faded.pages"
  "$LOCAL_ROOT/3. The Secrets We Keep/The Secrets We Keep.pages"
  "$LOCAL_ROOT/4. The Secrets We Bury/The Secrets We Bury.pages"
  "$LOCAL_ROOT/5. Split/Split.pages"
)

# iCloud Drive destination for your Mac mini RAG to index:
# iCloud Drive/Books/<book>.pages  (overwritten each run)
ICLOUD_BOOKS_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Books"

# Local dated backups (kept as a safety net)
LOCAL_BACKUP_ROOT="$HOME/Backups"
GDRIVE_ROOT="gdrive:Backups"
KEEP_LOCAL_DAYS=30

# Loom app data: the SQLite source of truth (canon + choose-your-own-adventure)
# and the nightly per-book JSON snapshots Loom writes at 22:00.
LOOM_DB="$HOME/Documents/GitHub/Loom/dev.db"
LOOM_SNAPSHOT_DIR="$HOME/Backups/Loom"

# WriteAI's writer-authored state (LOOM-27). Small and IRREPLACEABLE: timeline
# events, character-name decisions, writer characters, and every review and
# explore conversation. Its sibling data/ is ~11GB but derived — a corrupted
# index is a re-ingest, never a loss — so only this directory is backed up.
# It is gitignored, so before this nothing covered it at all.
WRITER_DATA_DIR="$HOME/Documents/GitHub/WriteAi/writer_data"

# Book cover images (LOOM-26). Gitignored, and the .loom.json export stores only
# coverPath — the string, never the bytes. So before this they existed in
# exactly one place on one disk. Small (~1.6MB) and irreplaceable.
COVERS_DIR="$HOME/Documents/GitHub/Loom/public/covers"

# WriteAI index essentials (LOOM-28). data/ is 13GB and mostly derived, but
# "derived" is not the same as "cheap to lose": rebuilding it re-runs LLM
# extraction, and sync has cost $50 all-time with one full re-ingest at $35.
# Roughly 8MB carries essentially all of that spend.
WRITEAI_DATA_DIR="$HOME/Documents/GitHub/WriteAi/data"
# Floor for "valid SQLite but suspiciously empty" — the index held 1431 chunks
# on 2026-07-31. Same reasoning as MIN_CHAPTERS: wide margin, so ordinary
# re-chunking never trips it.
MIN_CHUNKS=500

# Output validation (LOOM-14). Exit codes only prove a step ran; these prove
# what it produced is usable.
VERIFY_LIB="$HOME/Scripts/lib/backup_verify.sh"
LOOM_JSON_CHECKER="$HOME/Scripts/check_loom_json.py"
# Floor for "valid SQLite but suspiciously empty". Production held 341 chapters
# on 2026-07-30 and the count only grows, so 200 catches a catastrophically
# empty snapshot with wide margin. Deliberately NOT set just under the true
# count: a threshold that trips on ordinary reorganisation becomes noise, which
# is the exact failure LOOM-13 is about.
MIN_CHAPTERS=200

NOW_DATE="$(date +%Y-%m-%d)"
NOW_TIME="$(date +%H%M%S)"
RUN_DIR_LOCAL="${LOCAL_BACKUP_ROOT}/${NOW_DATE}"

LOG_DIR="${LOCAL_BACKUP_ROOT}/_logs"
LOG_FILE="${LOG_DIR}/backup_${NOW_DATE}_${NOW_TIME}.log"

###############################################################################
# CONFIG (END)
###############################################################################

mkdir -p "$RUN_DIR_LOCAL" "$LOG_DIR" "$ICLOUD_BOOKS_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

fail() {
  log "ERROR: $*"
  exit 1
}

# Locate rclone
RCLONE=""
if [[ -x "/opt/homebrew/bin/rclone" ]]; then
  RCLONE="/opt/homebrew/bin/rclone"
elif [[ -x "/usr/local/bin/rclone" ]]; then
  RCLONE="/usr/local/bin/rclone"
elif command -v rclone >/dev/null 2>&1; then
  RCLONE="$(command -v rclone)"
fi

[[ -n "$RCLONE" ]] || fail "rclone not found. Install it (brew install rclone) and run rclone config."

# Load the output validators. Missing lib is a warning, never fatal: an
# unverified backup still beats no backup, which is the same reasoning that
# keeps the iCloud and Drive steps non-fatal.
VERIFY_AVAILABLE=0
if [[ -f "$VERIFY_LIB" ]]; then
  # shellcheck source=/dev/null
  source "$VERIFY_LIB" && VERIFY_AVAILABLE=1
fi

# Set to 0 by any failed output check. Gates the prune and the closing message.
VALIDATION_OK=1

log "Starting book backup"
log "Local destination: $RUN_DIR_LOCAL"
log "iCloud Books destination: $ICLOUD_BOOKS_DIR"
log "Google Drive destination: $GDRIVE_ROOT/$NOW_DATE"

# Verify files exist before copying
for f in "${BOOK_FILES[@]}"; do
  [[ -e "$f" ]] || fail "File not found: $f"
done

# Is each book's manuscript on disk current with Loom's database? (LOOM-13)
#
# This used to compare each .pages mtime against dev.db's, and warn when they
# were more than a day apart. That could not work. dev.db is touched by an edit
# to ANY book, so its mtime is "now" every night; every book the writer wasn't
# actively working on tripped the threshold. The warning fired most nights, for
# books that were completely fine, and a warning that fires most nights is the
# same as no warning at all.
#
# mtime is not evidence in the other direction either — a .pages file can be
# touched by something that is not an export, and has been (Split's mtime moved
# 17 days after its last real export).
#
# So ask Loom instead. GET /api/export-status re-walks canon for each book and
# compares a content hash per chapter against the manifest sidecar written by
# the last export. That is an exact answer to "does the manuscript on disk
# reflect the book as it is now?", not a guess from timestamps. It writes
# nothing — no export, no Pages round-trip — so it is safe to call here.
#
# THE DISTINCTION THIS PRESERVES, which the mtime check could not make:
#   "you haven't touched this book in weeks"  -> fine, INFO, not a problem
#   "the export no longer matches the book"   -> WARNING, act on it
# Do not "simplify" this back into a timestamp comparison.
LOOM_URL="${LOOM_URL:-http://localhost:3000}"
export_status="$(curl -sf --max-time 60 "$LOOM_URL/api/export-status" 2>/dev/null || true)"

if [[ -z "$export_status" ]]; then
  # Loom being unreachable IS a real finding: it runs under launchd with
  # KeepAlive, and if it is down then canon auto-export is not running either.
  log "WARNING: could not reach Loom at $LOOM_URL to verify canon exports — is the app running?"
else
  # Python rather than jq: jq is not guaranteed installed, python3 ships with
  # macOS, and the rest of this script already depends on it.
  while IFS='|' read -r level book reason detail; do
    [[ -z "$level" ]] && continue
    if [[ "$level" == "WARN" ]]; then
      log "WARNING: $book — $reason. $detail"
    else
      log "$book: $detail"
    fi
  done < <(printf '%s' "$export_status" | python3 -c '
import json, sys, datetime

try:
    d = json.load(sys.stdin)
except Exception as e:
    print("WARN|export-status|unreadable response|%s" % e)
    sys.exit(0)

REASONS = {
    "content-drift": "the manuscript on disk no longer matches the book",
    "no-manifest":   "no manifest sidecar, so export currency cannot be verified",
    "no-manuscript": "the manuscript file is missing",
    "no-folder":     "no canon export folder for this book",
    "error":         "could not be checked",
}

for b in d.get("books", []):
    title = b.get("title", "?")
    if b.get("current"):
        # Age is reported, never warned about. A book untouched for a month is
        # a book that was finished a month ago.
        exported = b.get("exportedAt")
        try:
            when = datetime.datetime.fromisoformat(exported.replace("Z", "+00:00"))
            days = (datetime.datetime.now(datetime.timezone.utc) - when).days
            age = "today" if days == 0 else ("1 day ago" if days == 1 else "%d days ago" % days)
        except Exception:
            age = "at an unknown time"
        print("INFO|%s||canon export is current (last exported %s)" % (title, age))
    else:
        reason = REASONS.get(b.get("reason"), b.get("reason", "unknown"))
        detail = b.get("drift")
        if detail:
            detail = "%d chapter(s) changed, %d added, %d removed since the export." % (
                detail.get("changed", 0), detail.get("added", 0), detail.get("removed", 0))
        else:
            detail = (b.get("detail") or "").replace("|", "/")
        print("WARN|%s|%s|%s" % (title, reason, detail))
')

  # BOOK_FILES is hardcoded at the top of this script, but Loom now tells us
  # which books actually exist. A book Loom knows about that BOOK_FILES does
  # not list is a book this script is silently not backing up — which is worth
  # far more than a stale-export warning. Matching is by filename stem, so a
  # title containing a character the export sanitizes (/ \ :) could warn
  # spuriously; erring toward a false warning is the right side here.
  while IFS= read -r title; do
    [[ -z "$title" ]] && continue
    found=0
    for f in "${BOOK_FILES[@]}"; do
      [[ "$(basename "$f" .pages)" == "$title" ]] && { found=1; break; }
    done
    (( found )) || log "WARNING: Loom has a book \"$title\" that this script does not back up — add it to BOOK_FILES."
  done < <(printf '%s' "$export_status" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for b in d.get("books", []):
    print(b.get("title", ""))
')
fi

###############################################################################
# 1) Local dated copy (safety net)                                            #
###############################################################################
log "Copying to local dated backup via ditto..."
for f in "${BOOK_FILES[@]}"; do
  base="$(basename "$f")"
  log "Local backup: $base"
  /usr/bin/ditto --rsrc --extattr "$f" "$RUN_DIR_LOCAL/$base"
done
log "Local dated backup complete."

###############################################################################
# 1b) Loom app data (canon + choose-your-own-adventure)                       #
#     - Compressed snapshot of Loom's SQLite DB (sqlite3 .backup is safe on   #
#       a live database).                                                     #
#     - Today's .loom.json per-book snapshots (Loom writes them at 22:00;     #
#       they include CYOA branches the .pages exports don't carry).          #
#     Both land in RUN_DIR_LOCAL so they ride the Google Drive upload.        #
#     Non-fatal: canon .pages backups above always take precedence.           #
###############################################################################
if [[ -f "$LOOM_DB" ]] && command -v sqlite3 >/dev/null 2>&1; then
  SNAP_GZ="$RUN_DIR_LOCAL/loom-dev.db.gz"
  snap_ok=0
  for attempt in 1 2; do
    log "Snapshotting Loom database (attempt ${attempt})..."
    rm -f "$RUN_DIR_LOCAL/loom-dev.db" "$SNAP_GZ"
    if sqlite3 "$LOOM_DB" ".backup '$RUN_DIR_LOCAL/loom-dev.db'" 2>>"$LOG_FILE" \
       && gzip -f "$RUN_DIR_LOCAL/loom-dev.db"; then
      if [[ "$VERIFY_AVAILABLE" == 1 ]]; then
        # Test-restore what we just wrote: gzip integrity, SQLite
        # integrity_check, and a content floor. A backup you have never
        # decompressed is a hypothesis, not a backup.
        if verify_out="$(verify_db_snapshot "$SNAP_GZ" "$MIN_CHAPTERS")"; then
          snap_ok=1
        else
          snap_ok=0
        fi
        while IFS= read -r vline; do
          if [[ -n "$vline" ]]; then log "  db snapshot: $vline"; fi
        done <<< "$verify_out"
      else
        snap_ok=1
        log "  db snapshot: NOT VERIFIED — validator library missing at $VERIFY_LIB"
      fi
    else
      snap_ok=0
      log "  db snapshot: sqlite3 .backup or gzip failed"
    fi

    if [[ "$snap_ok" == 1 ]]; then
      break
    fi
    # The likeliest cause of a bad snapshot is a transient read while Loom was
    # mid-write, so one retry is worth ~2s before crying wolf.
    if [[ "$attempt" == 1 ]]; then
      log "  db snapshot: verification failed — retrying once..."
    fi
  done

  if [[ "$snap_ok" == 1 ]]; then
    log "Loom database snapshot complete and verified (loom-dev.db.gz)."
  else
    VALIDATION_OK=0
    # Deliberately NOT rm -f'd. The old code deleted the artifact on failure,
    # leaving nothing to diagnose. A suspect file you can inspect beats an
    # absence you can only guess about.
    log "WARNING: Loom database snapshot FAILED VERIFICATION after 2 attempts — keeping the suspect file at $SNAP_GZ for inspection."
  fi
fi

# Pick the NEWEST snapshot in each book folder rather than matching a date in
# the filename. Loom stamps those names with a UTC date (toISOString) but writes
# them at 22:00 local, so the file created tonight already carries tomorrow's
# date — matching on "$NOW_DATE" here silently copied the PREVIOUS night's file
# every single run, while still logging success. Newest-wins is correct
# regardless of timezone, DST, or a change to Loom's backup time; the staleness
# check below is what actually catches a Loom backup that stopped running.
if [[ -d "$LOOM_SNAPSHOT_DIR" ]]; then
  log "Copying latest Loom .loom.json snapshots..."
  loom_json_count=0
  loom_stale_count=0
  now_epoch="$(date +%s)"
  while IFS= read -r -d '' dir; do
    newest=""
    while IFS= read -r -d '' f; do
      [[ -z "$newest" || "$f" -nt "$newest" ]] && newest="$f"
    done < <(find "$dir" -maxdepth 1 -type f -name "*.loom.json" -print0 2>/dev/null)
    [[ -n "$newest" ]] || continue

    book="$(basename "$dir")"
    # Default to now_epoch (age 0, no warning) if stat fails — the script runs
    # under `set -e`, and an empty command substitution here would be an
    # arithmetic syntax error that aborts the whole backup before the iCloud
    # and Google Drive steps. A missing mtime must never cost us the upload.
    snap_mtime="$(stat -f %m "$newest" 2>/dev/null || echo "$now_epoch")"
    age_h=$(( (now_epoch - snap_mtime) / 3600 ))
    # Loom runs at 22:00 and this script at 22:30, but RunAtLoad means it can
    # also fire before 22:00, when the newest snapshot is legitimately ~23h old.
    # 25h flags a genuinely missed nightly run without crying wolf on those.
    if (( age_h > 25 )); then
      log "WARNING: newest snapshot for ${book} is ${age_h}h old ($(basename "$newest")) — Loom's 22:00 backup may have stopped."
      loom_stale_count=$((loom_stale_count + 1))
    fi

    if /usr/bin/ditto "$newest" "$RUN_DIR_LOCAL/loom-json/${book}/$(basename "$newest")" 2>>"$LOG_FILE"; then
      loom_json_count=$((loom_json_count + 1))
    else
      log "WARNING: failed to copy $(basename "$newest")"
    fi
  done < <(find "$LOOM_SNAPSHOT_DIR" -type d -print0 2>/dev/null)

  if [[ "$loom_json_count" -gt 0 ]]; then
    log "Copied $loom_json_count Loom snapshot(s) (${loom_stale_count} stale)."
    # Actually parse what was copied. Counting files proves ditto ran; it says
    # nothing about whether Loom wrote real content. If the export started
    # emitting empty or malformed JSON, the old code copied it, counted it, and
    # logged success.
    if [[ "$VERIFY_AVAILABLE" == 1 ]]; then
      if lj_out="$(verify_loom_json "$RUN_DIR_LOCAL/loom-json" "$LOOM_JSON_CHECKER")"; then
        lj_ok=1
      else
        lj_ok=0
      fi
      while IFS= read -r vline; do
        if [[ -n "$vline" ]]; then log "  loom.json: $vline"; fi
      done <<< "$lj_out"
      if [[ "$lj_ok" == 1 ]]; then
        log "Loom .loom.json snapshots verified."
      else
        VALIDATION_OK=0
        log "WARNING: one or more .loom.json snapshots FAILED VALIDATION — these are the only backup carrying CYOA branch structure."
      fi
    else
      log "  loom.json: NOT VERIFIED — validator library missing at $VERIFY_LIB"
    fi
  else
    VALIDATION_OK=0
    log "WARNING: no Loom .loom.json snapshots found under ${LOOM_SNAPSHOT_DIR} (Loom's 22:00 backup may not have run)."
  fi
fi

###############################################################################
# 1b-ii) Book cover images (LOOM-26)                                           #
#                                                                             #
#     Gitignored, and .loom.json carries only coverPath — never the bytes.    #
#     Nothing backed these up, so they lived on one disk in one place. A       #
#     restore without them leaves every book with a broken cover.             #
#                                                                             #
#     No JSON to validate here; the check is that the count and total size    #
#     are non-zero, logged so a silent emptying is visible.                   #
###############################################################################
if [[ -d "$COVERS_DIR" ]]; then
  cover_count=$(find "$COVERS_DIR" -type f ! -name '.*' | wc -l | tr -d ' ')
  if [[ "$cover_count" -gt 0 ]]; then
    if /usr/bin/ditto "$COVERS_DIR" "$RUN_DIR_LOCAL/loom-covers" 2>>"$LOG_FILE"; then
      copied=$(find "$RUN_DIR_LOCAL/loom-covers" -type f ! -name '.*' | wc -l | tr -d ' ')
      bytes=$(du -sk "$RUN_DIR_LOCAL/loom-covers" | cut -f1)
      if [[ "$copied" -eq "$cover_count" && "$bytes" -gt 0 ]]; then
        log "Copied $copied cover image(s) (${bytes}KB)."
      else
        VALIDATION_OK=0
        log "WARNING: cover copy incomplete — $copied of $cover_count file(s), ${bytes}KB."
      fi
    else
      VALIDATION_OK=0
      log "WARNING: failed to copy cover images from ${COVERS_DIR}."
    fi
  else
    log "No cover images in ${COVERS_DIR} — nothing to copy."
  fi
fi

###############################################################################
# 1c) WriteAI writer-authored state (LOOM-27)                                  #
#                                                                             #
#     Nothing covered this before: writer_data/ is gitignored, so it was in   #
#     neither the repo nor any backup. It holds the writer's timeline events, #
#     character-name decisions, writer characters, and every review and       #
#     explore conversation — ~12MB, none of it regenerable.                   #
#                                                                             #
#     Its sibling data/ (~11GB: Chroma, extracted text) is deliberately NOT   #
#     backed up. That store is derived; a corrupted index is a re-ingest.     #
#                                                                             #
#     Lands in RUN_DIR_LOCAL so it rides the Google Drive upload. Non-fatal,  #
#     like every other step here.                                             #
###############################################################################
if [[ -d "$WRITER_DATA_DIR" ]]; then
  log "Copying WriteAI writer_data..."
  WD_DEST="$RUN_DIR_LOCAL/writeai-writer_data"
  mkdir -p "$WD_DEST"
  wd_count=0
  for f in "$WRITER_DATA_DIR"/*.json; do
    [[ -e "$f" ]] || continue
    if /usr/bin/ditto "$f" "$WD_DEST/$(basename "$f")" 2>>"$LOG_FILE"; then
      wd_count=$((wd_count + 1))
    else
      log "WARNING: failed to copy $(basename "$f")"
    fi
  done

  if [[ "$wd_count" -gt 0 ]]; then
    log "Copied $wd_count writer_data file(s)."
    # Parse what was copied. Counting files proves ditto ran; it says nothing
    # about whether the JSON survived. Structural damage fails; entry counts
    # are reported but never asserted — writer_events.json can legitimately be
    # empty, and a floor that trips on a legitimate state becomes the nightly
    # noise LOOM-13 exists to remove.
    if [[ "$VERIFY_AVAILABLE" == 1 ]]; then
      if wd_out="$(verify_writer_data "$WD_DEST")"; then
        wd_ok=1
      else
        wd_ok=0
      fi
      while IFS= read -r vline; do
        if [[ -n "$vline" ]]; then log "  writer_data: $vline"; fi
      done <<< "$wd_out"
      if [[ "$wd_ok" == 1 ]]; then
        log "WriteAI writer_data verified."
      else
        VALIDATION_OK=0
        log "WARNING: writer_data FAILED VALIDATION — this is the only backup of the writer's events, character decisions and review history."
      fi
    else
      log "  writer_data: NOT VERIFIED — validator library missing at $VERIFY_LIB"
    fi
  else
    VALIDATION_OK=0
    log "WARNING: no writer_data files found under ${WRITER_DATA_DIR}."
  fi
else
  log "WriteAI writer_data not found at ${WRITER_DATA_DIR} — skipping."
fi

###############################################################################
# 1d) WriteAI index essentials (LOOM-28)                                       #
#                                                                             #
#     data/ is 13GB and was excluded as "derived". True, but derived is not    #
#     the same as cheap: rebuilding it re-runs LLM extraction. Sync has cost   #
#     $50 all-time, one full re-ingest $35, enrichment another $25.            #
#                                                                             #
#     ~8MB carries essentially all of that:                                    #
#       series_metadata.sqlite  chunks, characters, events, summaries,         #
#                               foreshadowing, timeline — every extraction     #
#                               and enrichment result. 19MB, ~8MB gzipped.     #
#       chunk_hashes.json       the ingest's change-detection state. Lose it   #
#                               and the next ingest may re-extract everything. #
#                                                                             #
#     DELIBERATELY NOT BACKED UP, do not "fix" this:                          #
#       chroma_db (110MB)      local nomic embeddings — free, just slow        #
#       extracted_text (143MB) re-parsed from ~/Writing — free                 #
#       rich_text (5.4MB)      same                                            #
#       backups/ (12GB)        WriteAI's own pre-ingest snapshots, 112 of them #
#                              and never pruned. Backing up backups is not a   #
#                              backup strategy. See LOOM-28 for retention.      #
#                                                                             #
#     sqlite3 .backup, NOT cp: this database carries a multi-MB WAL, so a raw  #
#     file copy of the main file alone is silently incomplete.                 #
###############################################################################
WRITEAI_DB="$WRITEAI_DATA_DIR/series_metadata.sqlite"
if [[ -f "$WRITEAI_DB" ]] && command -v sqlite3 >/dev/null 2>&1; then
  log "Snapshotting WriteAI index (series_metadata.sqlite)..."
  WAI_GZ="$RUN_DIR_LOCAL/writeai-series_metadata.db.gz"
  rm -f "$RUN_DIR_LOCAL/writeai-series_metadata.db" "$WAI_GZ"
  wai_ok=0
  if sqlite3 "$WRITEAI_DB" ".backup '$RUN_DIR_LOCAL/writeai-series_metadata.db'" 2>>"$LOG_FILE" \
     && gzip -f "$RUN_DIR_LOCAL/writeai-series_metadata.db"; then
    if [[ "$VERIFY_AVAILABLE" == 1 ]]; then
      if wai_out="$(verify_db_snapshot "$WAI_GZ" "$MIN_CHUNKS" chunks)"; then
        wai_ok=1
      else
        wai_ok=0
      fi
      while IFS= read -r vline; do
        if [[ -n "$vline" ]]; then log "  writeai index: $vline"; fi
      done <<< "$wai_out"
    else
      wai_ok=1
      log "  writeai index: NOT VERIFIED — validator library missing at $VERIFY_LIB"
    fi
  else
    log "  writeai index: sqlite3 .backup or gzip failed"
  fi

  # The ingest's change-detection state. Tiny, and losing it is expensive.
  if [[ -f "$WRITEAI_DATA_DIR/chunk_hashes.json" ]]; then
    /usr/bin/ditto "$WRITEAI_DATA_DIR/chunk_hashes.json" \
      "$RUN_DIR_LOCAL/writeai-chunk_hashes.json" 2>>"$LOG_FILE" \
      && log "  writeai index: chunk_hashes.json copied" \
      || log "  WARNING: failed to copy chunk_hashes.json"
  fi

  if [[ "$wai_ok" == 1 ]]; then
    log "WriteAI index snapshot complete and verified."
  else
    VALIDATION_OK=0
    log "WARNING: WriteAI index snapshot FAILED VERIFICATION — keeping the suspect file at $WAI_GZ. Rebuilding this costs real API spend."
  fi
else
  log "WriteAI index not found at ${WRITEAI_DB} — skipping."
fi

#############################################################################################
# 2) iCloud Books folder (overwrite-in-place safely)                                        #
#    Copy to a temp bundle then swap, so the Mac mini never indexes a half-copied bundle.   #
#############################################################################################
log "Copying to iCloud Books folder (overwrite)..."
ICLOUD_OK=1
for f in "${BOOK_FILES[@]}"; do
  base="$(basename "$f")"
  dest="$ICLOUD_BOOKS_DIR/$base"
  tmp="$ICLOUD_BOOKS_DIR/.${base}.tmp"

  log "iCloud copy: $base"
  rm -rf "$tmp" 2>/dev/null || true

  # Non-fatal: a failure here (e.g. the scheduled job lacking Full Disk Access
  # for iCloud Drive) must NOT abort the backup or the audiobook/ebook updates.
  ok=1
  /usr/bin/ditto --rsrc --extattr "$f" "$tmp" 2>/dev/null || ok=0
  if [[ "$ok" == 1 ]]; then
    rm -rf "$dest" 2>/dev/null || true
    mv "$tmp" "$dest" 2>/dev/null || ok=0
  fi
  if [[ "$ok" == 0 ]]; then
    ICLOUD_OK=0
    rm -rf "$tmp" 2>/dev/null || true
    log "WARNING: iCloud copy failed for $base (often Full Disk Access for the scheduled job). Continuing."
  fi
done
if [[ "$ICLOUD_OK" == 1 ]]; then log "iCloud Books copy complete."
else log "iCloud Books copy had failures (see warnings) — continuing with backup + audiobook/ebook updates."; fi

#############################################################################################
# 3) Google Drive (dated folder)                                                            #
#############################################################################################
log "Uploading local dated backup to Google Drive via rclone..."
# Non-fatal: a network/auth failure must not abort the audiobook/ebook updates.
if "$RCLONE" copy "$RUN_DIR_LOCAL" "${GDRIVE_ROOT}/${NOW_DATE}" \
  --create-empty-src-dirs \
  --retries 3 \
  --low-level-retries 10 \
  --log-level INFO \
  --log-file "$LOG_FILE"; then
  log "Google Drive upload complete."
else
  log "WARNING: Google Drive upload failed — continuing with audiobook/ebook updates."
fi

# Optional cleanup of old local backups.
#
# Gated on validation (LOOM-14). This prune assumes recent backups are good and
# deletes older ones on that basis. If tonight's outputs did not verify, that
# assumption is exactly what is in doubt — and had snapshots been silently
# invalid for a month, pruning would delete the last VALID copy. When in doubt,
# keep more, not less: disk is cheaper than a manuscript.
if [[ "$KEEP_LOCAL_DAYS" -gt 0 ]]; then
  if [[ "$VALIDATION_OK" == 1 ]]; then
    log "Cleaning up local backups older than ${KEEP_LOCAL_DAYS} days..."
    find "$LOCAL_BACKUP_ROOT" -maxdepth 1 -type d -name "20??-??-??" -mtime +"$KEEP_LOCAL_DAYS" -print -exec rm -rf {} \; \
      | tee -a "$LOG_FILE" || true
  else
    log "SKIPPING the ${KEEP_LOCAL_DAYS}-day cleanup: tonight's outputs failed verification, so old backups are being kept."
  fi
fi

#############################################################################################
# 4) Update audiobooks (incremental: only re-narrates chapters that changed)                #
#    Runs AFTER all backup work. Non-fatal by design — an audiobook problem must never       #
#    fail the backup. Needs you logged in (Pages export uses the GUI session).               #
#############################################################################################
AUDIOBOOK_SCRIPT="$HOME/Scripts/generate_audiobook.sh"
AUDIOBOOK_LOG="${LOG_DIR}/audiobooks_${NOW_DATE}_${NOW_TIME}.log"
if [[ -x "$AUDIOBOOK_SCRIPT" ]]; then
  log "Updating audiobooks (incremental) -> $AUDIOBOOK_LOG"
  if /bin/zsh "$AUDIOBOOK_SCRIPT" --update >"$AUDIOBOOK_LOG" 2>&1; then
    log "Audiobook update complete."
  else
    log "WARNING: audiobook update hit an error (see $AUDIOBOOK_LOG). Backup itself is fine."
  fi
else
  log "Audiobook script not executable at $AUDIOBOOK_SCRIPT — skipping audiobook update."
fi

#############################################################################################
# 5) Update ebooks (clean EPUBs for Apple Books). Reuses the chapter split the audiobook    #
#    step just refreshed, so it does not re-open Pages. Non-fatal, like the audiobook step.  #
#############################################################################################
EBOOK_SCRIPT="$HOME/Scripts/generate_ebook.sh"
EBOOK_LOG="${LOG_DIR}/ebooks_${NOW_DATE}_${NOW_TIME}.log"
if [[ -x "$EBOOK_SCRIPT" ]]; then
  log "Updating ebooks (incremental) -> $EBOOK_LOG"
  if /bin/zsh "$EBOOK_SCRIPT" --update >"$EBOOK_LOG" 2>&1; then
    log "Ebook update complete."
  else
    log "WARNING: ebook update hit an error (see $EBOOK_LOG). Backup itself is fine."
  fi
else
  log "Ebook script not executable at $EBOOK_SCRIPT — skipping ebook update."
fi

# "Successfully" now means the outputs were checked, not merely that the
# commands exited 0. Every failure this chain has had logged success while
# producing a bad artifact — that is the whole point of LOOM-14.
if [[ "$VALIDATION_OK" == 1 ]]; then
  if [[ "$VERIFY_AVAILABLE" == 1 ]]; then
    log "Backup finished successfully — all outputs verified."
  else
    log "Backup finished, but outputs were NOT verified (validator library missing at $VERIFY_LIB)."
  fi
else
  log "Backup finished WITH VERIFICATION FAILURES — see the warnings above. Files were uploaded and old backups were kept; inspect before trusting this run."
fi
exit 0
