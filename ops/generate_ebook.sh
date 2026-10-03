#!/bin/zsh
# ============================================================================
# generate_ebook.sh
#   Interactive: pick a book (or books) and build a clean .epub for Apple Books.
#
#   Per book:  Loom's manuscript (dev.db, READ-ONLY) -> canon walk -> HTML
#              -> pandoc -> .epub, via scripts/build-ebook.mjs.
#
#   Built from Loom rather than from a Pages text export so the formatting
#   survives: italics, text colors, section breaks, footnotes. Headings are
#   the chapter number ("1.") with the POV centered beneath it; the TOC reads
#   "1 - Jared Gatlin". 100% local; no LLM, no network, no cost.
#
#   Safety: the database is opened read-only (writes are impossible at the
#   SQLite layer) for one short read per book. A failed build never replaces
#   the existing .epub.
#
#   Requirements (one-time):  brew install pandoc ffmpeg node@24
#   Usage:
#     ./generate_ebook.sh            # interactive menu
#     ./generate_ebook.sh 2 5        # build books 2 and 5
#     ./generate_ebook.sh --update   # incremental: rebuild only changed books
# ============================================================================

# This file lives in the Loom repo (~/Scripts is a symlink to its ops/ folder).
LOOM_ROOT="${0:A:h:h}"
EBOOK_OUT="${EBOOK_OUT:-/Users/marisarichmond/Writing/Ebooks}"   # override for test builds
STATE_DIR="$EBOOK_OUT/.loom-ebook-state"   # content hashes + converted covers
AUTHOR="B.C. Stryker"

# better-sqlite3's native binding is built for Homebrew's node@24; any other
# Node fails at load time with NODE_MODULE_VERSION.
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH"

# Title (must match the book's title in Loom), the book's folder in ~/Writing
# (for the dust-jacket cover), and its series track.
typeset -a TITLES PAGES TRACKS
add_book(){ TITLES+=("$1"); PAGES+=("$2"); TRACKS+=("$3"); }
add_book "Nobody's Hero"       "/Users/marisarichmond/Writing/1. Nobody's Hero/Nobody's Hero.pages"             1
add_book "Faded"               "/Users/marisarichmond/Writing/2. Faded/Faded.pages"                            2
add_book "The Secrets We Keep" "/Users/marisarichmond/Writing/3. The Secrets We Keep/The Secrets We Keep.pages" 3
add_book "The Secrets We Bury" "/Users/marisarichmond/Writing/4. The Secrets We Bury/The Secrets We Bury.pages" 4
add_book "Split"               "/Users/marisarichmond/Writing/5. Split/Split.pages"                            5

for tool in pandoc ffmpeg node; do
  command -v "$tool" >/dev/null || { echo "ERROR: '$tool' not found. Run: brew install pandoc ffmpeg node@24"; exit 1; }
done
mkdir -p "$EBOOK_OUT" "$STATE_DIR"

# Dust jacket -> 1600px JPEG, cached so an unchanged cover converts once (and
# its bytes, which feed the change check, stay stable between runs).
cover_for(){  # $1=title $2=pages ; prints the cover path, or nothing
  local front="${2:h}/Dust Jacket/Front Cover.png"
  local cover="$STATE_DIR/${1//\//_}.cover.jpg"
  [ -f "$front" ] || return 0
  if [ ! -f "$cover" ] || [ "$front" -nt "$cover" ]; then
    ffmpeg -y -i "$front" -vf "scale=-2:1600" -q:v 3 -f mjpeg "$cover" >/dev/null 2>&1 || { rm -f "$cover"; return 0; }
  fi
  echo "$cover"
}

build_book(){  # $1=index  $2=1 to skip when unchanged
  local idx="$1" title="${TITLES[$1]}" pages="${PAGES[$1]}"
  local cover; cover=$(cover_for "$title" "$pages")
  local args=(--title "$title" --out "$EBOOK_OUT/$title.epub" --author "$AUTHOR" --state-dir "$STATE_DIR")
  [ -n "$cover" ] && args+=(--cover "$cover")
  [ "$2" = 1 ] && args+=(--if-changed)
  local out
  if out=$(node "$LOOM_ROOT/scripts/build-ebook.mjs" "${args[@]}" 2>&1); then
    echo "$out" | sed 's/^ *//; s/^/   /'
  else
    echo "$out" | sed 's/^/   !! /'; return 1
  fi
}

# --- mode + selection --------------------------------------------------------
INCREMENTAL=0
if [[ "$1" == (--update|--nightly|-u) ]]; then INCREMENTAL=1; shift; fi
typeset -a sel
if (( INCREMENTAL )); then
  [ $# -gt 0 ] && args="$*" || args="all"
elif [ $# -gt 0 ]; then args="$*"
else
  echo "Which book(s) do you want as EPUBs for Apple Books?"
  for i in {1..${#TITLES}}; do echo "  $i) ${TITLES[$i]}"; done
  echo "  a) ALL"; printf "Enter number(s) (e.g. 2  or  2 5  or  a): "; read -r args
fi
if [[ "$args" == (a|A|all|ALL) ]]; then sel=({1..${#TITLES}})
else for tok in ${(s: :)args//,/ }; do
    if [[ "$tok" == <-> ]] && (( tok >= 1 && tok <= ${#TITLES} )); then sel+=("$tok")
    else echo "  (ignoring invalid choice: '$tok')"; fi
  done
fi
[ ${#sel} -eq 0 ] && { echo "Nothing selected. Exiting."; exit 0; }
typeset -a selnames; for idx in "${(@)sel}"; do selnames+=("${TITLES[$idx]}"); done
SECONDS=0
(( INCREMENTAL )) && echo "[$(date '+%Y-%m-%d %H:%M')] EPUB update: ${(j:, :)selnames}" \
                  || echo "Building EPUBs: ${(j:, :)selnames}"
FAILED=0
for idx in "${(@)sel}"; do
  echo "--------------------------------------------------------------"; echo " ${TITLES[$idx]}"
  build_book "$idx" "$INCREMENTAL" || FAILED=1
done
echo "=============================================================="
echo "Done in $((SECONDS/60))m $((SECONDS%60))s. EPUBs in: $EBOOK_OUT/"
exit $FAILED
