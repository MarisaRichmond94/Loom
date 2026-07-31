#!/bin/zsh
# ============================================================================
# generate_ebook.sh
#   Interactive: pick a book (or books) and build a clean .epub for Apple Books.
#
#   Per book:  Pages -> text -> chapters (shared split, Prologue/Part aware)
#              -> XHTML (Chapter N (POV) headings) -> pandoc -> .epub
#              with a proper chapter TOC, dust-jacket cover, and title/author.
#
#   Reuses the SAME chapter split as the audiobooks (under
#   ~/Writing/Audiobooks/<book>/chapters_txt) so the ebook TOC matches the
#   audiobook chapters exactly. 100% local; no LLM, no network, no cost.
#
#   Requirements (one-time):  brew install pandoc ffmpeg
#   Usage:
#     ./generate_ebook.sh            # interactive menu
#     ./generate_ebook.sh 2 5        # build books 2 and 5
#     ./generate_ebook.sh --update   # incremental: rebuild only changed books
# ============================================================================

AUDIO_ROOT="/Users/marisarichmond/Writing/Audiobooks"   # holds chapters_txt + text/
EBOOK_OUT="/Users/marisarichmond/Writing/Ebooks"
AUTHOR="B.C. Stryker"

typeset -a TITLES PAGES TRACKS
add_book(){ TITLES+=("$1"); PAGES+=("$2"); TRACKS+=("$3"); }
add_book "Nobody's Hero"       "/Users/marisarichmond/Writing/1. Nobody's Hero/Nobody's Hero.pages"             1
add_book "Faded"               "/Users/marisarichmond/Writing/2. Faded/Faded.pages"                            2
add_book "The Secrets We Keep" "/Users/marisarichmond/Writing/3. The Secrets We Keep/The Secrets We Keep.pages" 3
add_book "The Secrets We Bury" "/Users/marisarichmond/Writing/4. The Secrets We Bury/The Secrets We Bury.pages" 4
add_book "Split"               "/Users/marisarichmond/Writing/5. Split/Split.pages"                            5

for tool in pandoc ffmpeg osascript awk; do
  command -v "$tool" >/dev/null || { echo "ERROR: '$tool' not found. Run: brew install pandoc ffmpeg"; exit 1; }
done
mkdir -p "$EBOOK_OUT"

# --- Pages -> text (only used when the shared split is stale) ----------------
export_text(){  # $1=pages  $2=out.txt
  local scpt; scpt=$(mktemp /tmp/pg_export.XXXX.scpt)
  cat > "$scpt" <<'APPLESCRIPT'
on run argv
  tell application "Pages"
    set d to open (POSIX file (item 1 of argv) as alias)
    delay 1
    export d to (POSIX file (item 2 of argv)) as unformatted text
    close d saving no
  end tell
end run
APPLESCRIPT
  osascript "$scpt" "$1" "$2"; local rc=$?; rm -f "$scpt"; return $rc
}

# --- text -> per-chapter segment files (identical logic to the audiobook one) -
split_text(){  # $1=txt  $2=title  $3=outdir
  awk -v outdir="$3" -v title="$2" '
    function pad(n){ return sprintf("%03d", n) }
    function newseg(f){ if (curfile != "") close(curfile); curfile = outdir "/" f }
    /^Prologue$/ { started=1; newseg(sprintf("000 - %s - Prologue.txt", title)); print "Prologue." > curfile; next }
    /^Part (One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)$/ {
      if (started) { p=$0; if ((getline subt)>0){ newseg(sprintf("%sa - %s - %s.txt", pad(lastch), title, p)); print p "." > curfile; print subt > curfile; close(curfile); curfile=""} next } }
    /^[0-9][0-9]?[0-9]?$/ { started=1; ch=$0+0; lastch=ch; newseg(sprintf("%s - %s - Ch %d.txt", pad(ch), title, ch)); printf "Chapter %d.\n", ch > curfile; next }
    started && curfile != "" { print > curfile }
  ' "$1"
}

ensure_chapters(){  # $1=pages  $2=title  $3=track  $4=txtdir ; refresh split only if stale
  local pages="$1" title="$2" track="$3" txtdir="$4"
  if [ -d "$txtdir" ] && find "$txtdir" -name '*.txt' -newer "$pages" 2>/dev/null | grep -q .; then
    return 0   # shared split already newer than the manuscript — reuse it
  fi
  local raw="$AUDIO_ROOT/text/$(printf '%02d' $track) - $title.txt"
  mkdir -p "$AUDIO_ROOT/text" "$txtdir"
  export_text "$pages" "$raw" || return 1
  find "$txtdir" -maxdepth 1 -name '*.txt' -delete 2>/dev/null
  split_text "$raw" "$title" "$txtdir"
}

html_escape(){ sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }

emit_segment(){  # $1=segment.txt -> XHTML to stdout
  local f="$1" h1 pov title type
  h1=$(sed -n '1p' "$f" | tr -d '\r'); pov=$(sed -n '2p' "$f" | tr -d '\r')
  if [[ "$h1" == Prologue* ]]; then title="Prologue"; type="prologue"
  elif [[ "$h1" == "Part "* ]]; then type="part"; [ -n "$pov" ] && title="${h1%.} — $pov" || title="${h1%.}"
  elif [[ "$h1" =~ '^Chapter ([0-9]+)' ]]; then type="chapter"; [ -n "$pov" ] && title="Chapter ${match[1]} ($pov)" || title="Chapter ${match[1]}"
  else type="other"; title="${h1%.}"; fi
  printf '<h1>%s</h1>\n' "$(printf '%s' "$title" | html_escape)"
  case "$type" in
    part) ;;                                   # divider page: heading only
    chapter) awk 'NR>=3 && NF' "$f" | html_escape | sed 's/.*/<p>&<\/p>/' ;;  # skip POV line (in heading)
    *)       awk 'NR>=2 && NF' "$f" | html_escape | sed 's/.*/<p>&<\/p>/' ;;  # keep POV (prologue)
  esac
}

build_epub(){  # $1=title $2=pages $3=track $4=txtdir
  local title="$1" pages="$2" track="$3" txtdir="$4"
  local segs=("$txtdir"/*.txt(N)); [ ${#segs} -eq 0 ] && { echo "   no chapters for $title"; return 1; }
  local work; work=$(mktemp -d)
  local html="$work/book.xhtml" cover="$work/cover.jpg"
  { echo '<?xml version="1.0" encoding="utf-8"?>'
    echo '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>'"$title"'</title></head><body>'
    local s; for s in "${(@)segs}"; do emit_segment "$s"; done
    echo '</body></html>'; } > "$html"
  local front="${pages:h}/Dust Jacket/Front Cover.png" coveropt=()
  [ -f "$front" ] && ffmpeg -y -i "$front" -vf "scale=-2:1600" -q:v 3 -f mjpeg "$cover" >/dev/null 2>&1 && coveropt=(--epub-cover-image "$cover")
  local out="$EBOOK_OUT/$title.epub"; rm -f "$out"
  pandoc "$html" -f html -t epub3 -o "$out" --toc --toc-depth=1 "${coveropt[@]}" \
    --metadata title="$title" --metadata author="$AUTHOR" --metadata lang=en-US >/dev/null 2>&1
  rm -rf "$work"
  if [ -f "$out" ]; then echo "   ✓ $title.epub — ${#segs} sections, $(du -h "$out" | cut -f1)"
  else echo "   !! pandoc failed for $title"; return 1; fi
}

process_book(){  # from scratch ; $1=index
  local idx="$1" title="${TITLES[$idx]}" pages="${PAGES[$idx]}" track="${TRACKS[$idx]}"
  local txtdir="$AUDIO_ROOT/$title/chapters_txt"
  echo "=============================================================="; echo " $title"
  [ -f "$pages" ] || { echo "   !! source not found: $pages"; return 1; }
  echo "   exporting + splitting…"; ensure_chapters "$pages" "$title" "$track" "$txtdir" || { echo "   !! prep failed"; return 1; }
  echo "   building EPUB…"; build_epub "$title" "$pages" "$track" "$txtdir"
}

incremental_book(){  # $1=index
  local idx="$1" title="${TITLES[$idx]}" pages="${PAGES[$idx]}" track="${TRACKS[$idx]}"
  local txtdir="$AUDIO_ROOT/$title/chapters_txt" epub="$EBOOK_OUT/$title.epub"
  echo "--------------------------------------------------------------"; echo " $title"
  [ -f "$pages" ] || { echo "   !! source not found: $pages"; return 1; }
  if [ -f "$epub" ] && [ "$(stat -f%m "$pages")" -le "$(stat -f%m "$epub")" ]; then
    echo "   unchanged since last build — skipped"; return 0
  fi
  echo "   source changed — rebuilding EPUB"
  ensure_chapters "$pages" "$title" "$track" "$txtdir" || { echo "   !! prep failed"; return 1; }
  build_epub "$title" "$pages" "$track" "$txtdir"
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
for idx in "${(@)sel}"; do
  (( INCREMENTAL )) && incremental_book "$idx" || process_book "$idx"
done
echo "=============================================================="
echo "Done in $((SECONDS/60))m $((SECONDS%60))s. EPUBs in: $EBOOK_OUT/"
