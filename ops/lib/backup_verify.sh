#!/usr/bin/env bash
# Output validation for book_backup.sh (KAN-14).
#
# The backup chain's failures have all been the same shape: a command exits 0,
# the log says success, and the artifact is wrong. Exit codes tell you a step
# RAN; these functions tell you what it PRODUCED is usable.
#
# Sourcing this file must have no side effects — it defines functions only, so
# it can be sourced by a test harness and exercised against deliberately
# corrupted fixtures. A check that has never been seen to fail is not known to
# work (same reasoning as the KAN-11 restore drill).
#
# Each function echoes human-readable diagnostics on stdout and returns 0 (ok)
# or 1 (problem). Callers are expected to log the output and treat a non-zero
# return as a loud warning, NOT as fatal — see book_backup.sh's non-fatal
# design notes.

# verify_db_snapshot <path/to/snapshot.db.gz> [min_chapters]
#
# Proves the gzip stream is intact, the database inside decompresses, passes
# SQLite's own integrity_check, and carries real content. The content floor
# exists because an empty-but-perfectly-valid database passes integrity_check
# and would otherwise be reported as a healthy backup.
verify_db_snapshot() {
  local gz="$1"
  local min_chapters="${2:-1}"
  local tmp result count

  [[ -f "$gz" ]] || { echo "snapshot file missing: $gz"; return 1; }

  # Cheap and catches truncation — the most likely corruption from a disk-full
  # or interrupted write.
  if ! gunzip -t "$gz" 2>/dev/null; then
    echo "gzip stream is corrupt or truncated: $(basename "$gz")"
    return 1
  fi

  tmp="$(mktemp -t loomverify 2>/dev/null)" || { echo "could not create temp file for verification"; return 1; }

  if ! gunzip -c "$gz" > "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    echo "snapshot failed to decompress: $(basename "$gz")"
    return 1
  fi

  # Assigned separately from `local` on purpose: `local x="$(cmd)"` returns the
  # status of `local`, not of the command, which would swallow a failure here.
  result="$(sqlite3 "$tmp" 'PRAGMA integrity_check;' 2>/dev/null | head -1)" || result="check failed to run"
  if [[ "$result" != "ok" ]]; then
    rm -f "$tmp"
    echo "integrity_check did not return ok: ${result:-<no output>}"
    return 1
  fi

  count="$(sqlite3 "$tmp" 'SELECT COUNT(*) FROM Chapter;' 2>/dev/null)" || count=""
  rm -f "$tmp"

  if ! [[ "$count" =~ ^[0-9]+$ ]]; then
    echo "could not read chapter count from snapshot (schema missing?)"
    return 1
  fi
  if (( count < min_chapters )); then
    echo "snapshot holds only $count chapters, below the floor of $min_chapters — valid SQLite but suspiciously empty"
    return 1
  fi

  echo "integrity_check ok, $count chapters"
  return 0
}

# verify_loom_json <loom-json-dir> <path/to/check_loom_json.py>
#
# The .loom.json snapshots are the ONLY backup carrying CYOA branch structure —
# the .pages/.txt/.docx exports are linear and drop choices entirely. The script
# previously copied and counted them without ever parsing one.
#
# check_loom_json.py handles the double-encoding trap: blocks[].content is a
# JSON *string*, not a nested object, so a naive walker reports zero words with
# no error — indistinguishable from total data loss at a glance.
verify_loom_json() {
  local dir="$1"
  local checker="$2"
  local py out rc

  [[ -d "$dir" ]] || { echo "no loom-json directory at $dir"; return 1; }
  [[ -f "$checker" ]] || { echo "validator script not found: $checker"; return 1; }

  py="$(command -v python3 2>/dev/null || true)"
  [[ -n "$py" ]] || { echo "python3 not found — cannot validate .loom.json snapshots"; return 1; }

  out="$("$py" "$checker" "$dir" 2>&1)"
  rc=$?
  [[ -n "$out" ]] && echo "$out"
  return $rc
}
