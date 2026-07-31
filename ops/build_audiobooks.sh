#!/bin/zsh
# Build chapter-split M4A audiobooks from exported plain-text novels using the
# "Tom (Enhanced)" system voice. Front matter (before chapter 1) is skipped.
#
# Usage:
#   build_audiobooks.sh split           # split all books into per-chapter text
#   build_audiobooks.sh audio           # narrate all chapter text -> m4a
#   build_audiobooks.sh audio <file>    # narrate just one book's text file
set -e

ROOT="/Users/marisarichmond/Writing/Audiobooks"
TEXT="$ROOT/text"
VOICE="Tom (Enhanced)"

split_book() {
  local txt="$1"
  local base="${txt:t:r}"          # e.g. "02 - Faded"
  local title="${base#* - }"       # e.g. "Faded"
  local outdir="$ROOT/$title/chapters_txt"
  mkdir -p "$outdir"
  find "$outdir" -maxdepth 1 -name '*.txt' -delete 2>/dev/null || true
  # awk: emit one file per chapter; ignore everything before the first lone-number line.
  awk -v outdir="$outdir" -v title="$title" '
    function pad(n){ return sprintf("%03d", n) }
    /^[0-9]{1,3}$/ {
      ch = $0 + 0
      file = sprintf("%s/%s - %s - Ch %d.txt", outdir, pad(ch), title, ch)
      # natural spoken chapter heading instead of a bare number
      printf("Chapter %d.\n", ch) > file
      started = 1
      next
    }
    started { print > file }
  ' "$txt"
  echo "  $title: $(ls "$outdir"/*.txt 2>/dev/null | wc -l | tr -d ' ') chapters"
}

audio_book() {
  local txt="$1"
  local base="${txt:t:r}"
  local title="${base#* - }"
  local txtdir="$ROOT/$title/chapters_txt"
  local outdir="$ROOT/$title"
  mkdir -p "$outdir"
  for ct in "$txtdir"/*.txt; do
    local name="${ct:t:r}"               # "001 - Faded - Ch 1"
    local out="$outdir/$name.m4a"
    [ -f "$out" ] && continue            # resume: skip already-done chapters
    say -v "$VOICE" -f "$ct" -o "$out" --data-format=aac@22050
    echo "  done: $name"
  done
}

case "$1" in
  split)
    for txt in "$TEXT"/*.txt; do split_book "$txt"; done ;;
  audio)
    if [ -n "$2" ]; then audio_book "$2"; else
      for txt in "$TEXT"/*.txt; do echo "== ${txt:t} =="; audio_book "$txt"; done
    fi ;;
  *) echo "usage: $0 {split|audio [textfile]}"; exit 1 ;;
esac
