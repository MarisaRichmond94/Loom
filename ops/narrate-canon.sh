#!/usr/bin/env bash
# Backfill canon narration for every published chapter (LOOM-136).
#
#   ./ops/narrate-canon.sh            # report what is missing, generate nothing
#   ./ops/narrate-canon.sh --run      # generate them, one at a time
#
# Requires Loom to be running (it does the synthesis). Safe to stop at any
# point with ctrl-c: each chapter is finished and on disk before the next
# begins, and re-running picks up where it left off.
#
# WHY CANON, NOT "the default variant": publish matches a recording against the
# canon path's state and answered choices. A chapter reached through a choice
# has a different variant hash, so warming the pre-choice variant would look
# like it worked and leave the chapter publishing silent exactly as before.
#
# Afterwards, REPUBLISH — recordings live in dev.db, and readers only get what
# a publish copies into the snapshot.

set -uo pipefail

LOOM="${LOOM:-http://127.0.0.1:3000}"
SERIES="${SERIES:-cmp8wtcr50000zufxy70xic4e}"
API="$LOOM/api/narration/backfill?seriesId=$SERIES"

report=$(curl -s -m 30 "$API")
remaining=$(printf '%s' "$report" | python3 -c "import json,sys; print(json.load(sys.stdin).get('remaining','?'))" 2>/dev/null)

if [[ "$remaining" == "?" || -z "$remaining" ]]; then
  echo "Could not reach Loom at $LOOM — is it running?"
  exit 1
fi

if [[ "$remaining" == "0" ]]; then
  echo "Every published canon chapter already has narration."
  exit 0
fi

echo "$remaining chapter(s) without canon narration:"
printf '%s' "$report" | python3 -c "
import json,sys
for c in json.load(sys.stdin)['chapters']:
    print(f\"  {c['book']} — {c['label']}\")
"

if [[ "${1:-}" != "--run" ]]; then
  echo
  echo "Run again with --run to generate them. Each takes a few minutes."
  exit 0
fi

echo
echo "Generating. Ctrl-C is safe — finished chapters stay done."
done_count=0
while :; do
  # No -m: synthesis of a long chapter legitimately takes minutes, and the
  # route already caps itself at 15 of them.
  out=$(curl -s -X POST "$API")
  finished=$(printf '%s' "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('done', False))" 2>/dev/null)
  if [[ "$finished" == "True" ]]; then
    echo "Done — $done_count chapter(s) generated."
    echo "Now REPUBLISH so readers get them."
    exit 0
  fi

  label=$(printf '%s' "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('chapter','?'))" 2>/dev/null)
  left=$(printf '%s' "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('remaining','?'))" 2>/dev/null)

  if printf '%s' "$out" | grep -q '"failed":true'; then
    echo "  ✗ $label failed — stopping. Nothing already generated is lost."
    exit 1
  fi
  if printf '%s' "$out" | grep -q '"timedOut":true'; then
    echo "  ✗ $label exceeded 15 minutes — stopping."
    exit 1
  fi

  done_count=$((done_count + 1))
  echo "  ✓ $label   ($left left)"
done
