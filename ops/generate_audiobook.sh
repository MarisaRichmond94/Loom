#!/bin/zsh
# ============================================================================
# generate_audiobook.sh
#   Interactive: pick a book (or books) and build its .m4b audiobook FROM
#   SCRATCH using the "Tom (Enhanced)" macOS system voice.
#
#   Per book the pipeline is:
#     1. Pages  -> plain text            (AppleScript export)
#     2. text   -> per-chapter segments  (awk; Prologue + Part aware)
#     3. segments -> .m4a                (say, with a per-chapter hang watchdog)
#     4. .m4a   -> .m4b                  (ffmpeg: concat + chapters + cover)
#     5. tag as Audiobook                (AtomicParsley, so iOS routes to Books)
#
#   100% local / offline. No LLM, no network, no API keys, no per-run cost.
#   The only "AI" is Apple's on-device text-to-speech voice.
#
#   Requirements (one-time):  brew install ffmpeg atomicparsley
#   Usage:
#     ./generate_audiobook.sh            # interactive menu
#     ./generate_audiobook.sh 2 5        # build books 2 and 5 directly
#     ./generate_audiobook.sh all        # build everything
# ============================================================================

ROOT="/Users/marisarichmond/Writing/Audiobooks"
AUTHOR="B.C. Stryker"
VOICE="Tom (Enhanced)"
TIMEOUT=90          # seconds before a stuck `say` is killed and retried

# --- book registry (reading order) : title | .pages path | series track ------
typeset -a TITLES PAGES TRACKS
add_book(){ TITLES+=("$1"); PAGES+=("$2"); TRACKS+=("$3"); }
add_book "Nobody's Hero"       "/Users/marisarichmond/Writing/1. Nobody's Hero/Nobody's Hero.pages"             1
add_book "Faded"               "/Users/marisarichmond/Writing/2. Faded/Faded.pages"                            2
add_book "The Secrets We Keep" "/Users/marisarichmond/Writing/3. The Secrets We Keep/The Secrets We Keep.pages" 3
add_book "The Secrets We Bury" "/Users/marisarichmond/Writing/4. The Secrets We Bury/The Secrets We Bury.pages" 4
add_book "Split"               "/Users/marisarichmond/Writing/5. Split/Split.pages"                            5

# --- dependency check --------------------------------------------------------
for tool in ffmpeg ffprobe AtomicParsley say osascript awk; do
  command -v "$tool" >/dev/null || { echo "ERROR: '$tool' not found. Run: brew install ffmpeg atomicparsley"; exit 1; }
done

# --- 1. export Pages -> plain text -------------------------------------------
export_text(){  # $1=pages  $2=out.txt
  local scpt; scpt=$(mktemp /tmp/pg_export.XXXX.scpt)
  cat > "$scpt" <<'APPLESCRIPT'
on run argv
  set inPath  to item 1 of argv
  set outPath to item 2 of argv
  tell application "Pages"
    set d to open (POSIX file inPath as alias)
    delay 1
    export d to (POSIX file outPath) as unformatted text
    close d saving no
  end tell
end run
APPLESCRIPT
  osascript "$scpt" "$1" "$2"
  local rc=$?
  rm -f "$scpt"
  return $rc
}

# --- 2. split text -> per-chapter segment files ------------------------------
#   Front matter (before Prologue / chapter 1) is skipped. A "Prologue" becomes
#   segment 000; each "Part X" + its subtitle line becomes a marker that sorts
#   just before the chapter it precedes; chapters become "Chapter N.".
split_text(){  # $1=txt  $2=title  $3=outdir
  awk -v outdir="$3" -v title="$2" '
    function pad(n){ return sprintf("%03d", n) }
    function newseg(f){ if (curfile != "") close(curfile); curfile = outdir "/" f }
    /^Prologue$/ {
      started=1
      newseg(sprintf("000 - %s - Prologue.txt", title))
      print "Prologue." > curfile
      next
    }
    /^Part (One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)$/ {
      if (started) {
        p = $0
        if ((getline subt) > 0) {
          newseg(sprintf("%sa - %s - %s.txt", pad(lastch), title, p))
          print p "." > curfile
          print subt  > curfile
          close(curfile); curfile = ""     # marker is complete; no body follows
        }
        next
      }
    }
    /^[0-9][0-9]?[0-9]?$/ {
      started=1; ch = $0 + 0; lastch = ch
      newseg(sprintf("%s - %s - Ch %d.txt", pad(ch), title, ch))
      printf "Chapter %d.\n", ch > curfile
      next
    }
    started && curfile != "" { print > curfile }
  ' "$1"
}

# --- 3. narrate one segment with a watchdog (retries on hang) -----------------
gen_one(){  # $1=txt  $2=out.m4a  -> 0 on success
  local try
  for try in 1 2 3; do
    rm -f "$2"
    say -v "$VOICE" -f "$1" -o "$2" --data-format=aac@22050 &
    local pid=$! waited=0 killed=0
    while kill -0 $pid 2>/dev/null; do
      sleep 2; waited=$((waited+2))
      [ $waited -ge $TIMEOUT ] && { kill -9 $pid 2>/dev/null; killed=1; break; }
    done
    wait $pid 2>/dev/null
    # Success = say finished on its own (not watchdog-killed) AND wrote real audio.
    # The size floor (2KB) only rejects empty/failed output; short Part markers
    # are ~40KB, so they pass. A watchdog kill is never accepted (truncated audio).
    [ $killed -eq 0 ] && [ -f "$2" ] && [ "$(stat -f%z "$2")" -gt 2000 ] && return 0
    echo "      retry $try ($([ $killed -eq 1 ] && echo 'stalled — watchdog killed' || echo 'short/failed output')): ${2:t}"
  done
  return 1
}

# --- title shown in the chapter list, derived from a segment's first lines ---
chapter_title(){  # $1=segment.txt  -> echoes title
  local h1 pov
  h1=$(sed -n '1p' "$1" | tr -d '\r')
  pov=$(sed -n '2p' "$1" | tr -d '\r')
  if [[ "$h1" == Prologue* ]]; then echo "Prologue"
  elif [[ "$h1" == "Part "* ]]; then
    [ -n "$pov" ] && echo "${h1%.} — $pov" || echo "${h1%.}"
  elif [[ "$h1" =~ '^Chapter ([0-9]+)' ]]; then
    [ -n "$pov" ] && echo "Chapter ${match[1]} ($pov)" || echo "Chapter ${match[1]}"
  else echo "${h1%.}"; fi
}

# --- 4+5. concat segments -> tagged .m4b with chapters + cover ---------------
build_m4b(){  # $1=title  $2=pages  $3=track  $4=bookdir(.m4a live here)  $5=txtdir
  local title="$1" pages="$2" track="$3" bookdir="$4" txtdir="$5"
  local segs=("$bookdir"/*.m4a(N)); [ ${#segs} -eq 0 ] && { echo "  no audio for $title"; return 1; }
  local work; work=$(mktemp -d)
  local list="$work/list.txt" meta="$work/meta.txt" cover="$work/cover.jpg"
  : > "$list"
  { echo ";FFMETADATA1"; echo "title=$title"; echo "artist=$AUTHOR"
    echo "album=$title"; echo "album_artist=$AUTHOR"; echo "genre=Audiobook"
    echo "track=$track"; echo "comment=Narrated by the Tom (Enhanced) system voice"; } > "$meta"

  local start=0 i=0 f
  for f in "${(@)segs}"; do
    i=$((i+1))
    local seg=""; seg=$(printf 'seg_%03d.m4a' "$i")
    ln -s "$f" "$work/$seg"
    echo "file '$seg'" >> "$list"
    local dur_s="" dur_ms=""
    dur_s=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$f")
    dur_ms=$(awk -v d="$dur_s" 'BEGIN{printf "%.0f", d*1000}')
    local end=$((start + dur_ms))
    local ct="$txtdir/${f:t:r}.txt" title_str="Chapter $i"
    [ -f "$ct" ] && title_str=$(chapter_title "$ct")
    printf '[CHAPTER]\nTIMEBASE=1/1000\nSTART=%s\nEND=%s\ntitle=%s\n' "$start" "$end" "$title_str" >> "$meta"
    start=$end
  done

  # cover: dust-jacket front, downscaled for embedding
  local front="${pages:h}/Dust Jacket/Front Cover.png"
  [ -f "$front" ] && ffmpeg -y -i "$front" -vf "scale=-2:1600" -q:v 3 -f mjpeg "$cover" >/dev/null 2>&1

  local out="$ROOT/m4b/$title.m4b"; mkdir -p "$ROOT/m4b"; rm -f "$out"
  if [ -f "$cover" ]; then
    ( cd "$work" && ffmpeg -y -f concat -safe 0 -i list.txt -i meta.txt -i cover.jpg \
        -map 0:a -map 2:v -map_metadata 1 -c:a copy -c:v copy -disposition:v attached_pic -f mp4 "$out" ) >/dev/null 2>&1
  else
    ( cd "$work" && ffmpeg -y -f concat -safe 0 -i list.txt -i meta.txt \
        -map 0:a -map_metadata 1 -c:a copy -f mp4 "$out" ) >/dev/null 2>&1
  fi
  [ -f "$out" ] && AtomicParsley "$out" --stik "Audiobook" --overWrite >/dev/null 2>&1
  rm -rf "$work"
  if [ -f "$out" ]; then
    local mins; mins=$(awk -v s="$start" 'BEGIN{printf "%.0f", s/60000}')
    echo "  ✓ $title.m4b — ${i} segments, ~${mins} min, $(du -h "$out" | cut -f1)"
  else echo "  !! build failed for $title"; return 1; fi
}

# --- orchestrate one book end-to-end -----------------------------------------
process_book(){  # $1=index
  local idx="$1" title="${TITLES[$idx]}" pages="${PAGES[$idx]}" track="${TRACKS[$idx]}"
  local bookdir="$ROOT/$title" txtdir="$ROOT/$title/chapters_txt" raw="$ROOT/text/$(printf '%02d' $track) - $title.txt"
  echo "=============================================================="
  echo " $title"
  echo "=============================================================="
  [ -f "$pages" ] || { echo "  !! source not found: $pages"; return 1; }

  echo "  [1/4] exporting text from Pages…"
  mkdir -p "$ROOT/text"
  export_text "$pages" "$raw" || { echo "  !! Pages export failed"; return 1; }

  echo "  [2/4] splitting into chapters (prologue/parts aware)…"
  mkdir -p "$txtdir"; find "$txtdir" -maxdepth 1 -name '*.txt' -delete 2>/dev/null
  split_text "$raw" "$title" "$txtdir"
  local n=$(find "$txtdir" -maxdepth 1 -name '*.txt' | wc -l | tr -d ' ')
  echo "        $n segments"

  echo "  [3/4] narrating with $VOICE (fresh)…"
  mkdir -p "$bookdir"; find "$bookdir" -maxdepth 1 -name '*.m4a' -delete 2>/dev/null
  local ct done=0
  for ct in "$txtdir"/*.txt(N); do
    gen_one "$ct" "$bookdir/${ct:t:r}.m4a" && done=$((done+1)) || echo "      !! gave up: ${ct:t}"
    printf "\r        %d/%d chapters" "$done" "$n"
  done
  echo ""

  echo "  [4/4] building tagged .m4b…"
  build_m4b "$title" "$pages" "$track" "$bookdir" "$txtdir"
}

# --- incremental: re-narrate only chapters whose text changed ----------------
incremental_book(){  # $1=index
  local idx="$1" title="${TITLES[$idx]}" pages="${PAGES[$idx]}" track="${TRACKS[$idx]}"
  local bookdir="$ROOT/$title" txtdir="$ROOT/$title/chapters_txt"
  local raw="$ROOT/text/$(printf '%02d' $track) - $title.txt" mb="$ROOT/m4b/$title.m4b"
  echo "--------------------------------------------------------------"
  echo " $title"
  [ -f "$pages" ] || { echo "   !! source not found: $pages"; return 1; }

  # level 1 — skip the whole book if .pages is no newer than the built .m4b
  if [ -f "$mb" ] && [ "$(stat -f%m "$pages")" -le "$(stat -f%m "$mb")" ]; then
    echo "   unchanged since last build — skipped"; return 0
  fi

  echo "   source changed — checking which chapters differ…"
  mkdir -p "$ROOT/text" "$txtdir" "$bookdir"
  export_text "$pages" "$raw" || { echo "   !! Pages export failed"; return 1; }
  local newdir; newdir=$(mktemp -d)
  split_text "$raw" "$title" "$newdir"

  local changed=0 nt name live out
  # additions + modifications (also regenerates if the .m4a is missing)
  for nt in "$newdir"/*.txt(N); do
    name="${nt:t}"; live="$txtdir/$name"; out="$bookdir/${nt:t:r}.m4a"
    if [ ! -f "$live" ] || ! cmp -s "$nt" "$live" || [ ! -f "$out" ]; then
      cp "$nt" "$live"
      if gen_one "$live" "$out"; then echo "     ↻ ${nt:t:r}"; changed=$((changed+1))
      else echo "     !! failed: ${nt:t:r}"; fi
    fi
  done
  # deletions — segments that no longer exist in the new split
  for live in "$txtdir"/*.txt(N); do
    name="${live:t}"
    [ -f "$newdir/$name" ] || { rm -f "$live" "$bookdir/${live:t:r}.m4a"; echo "     ✗ removed ${live:t:r}"; changed=$((changed+1)); }
  done
  rm -rf "$newdir"

  if (( changed > 0 )) || [ ! -f "$mb" ]; then
    echo "   $changed segment(s) changed — rebuilding .m4b"
    build_m4b "$title" "$pages" "$track" "$bookdir" "$txtdir"
  else
    echo "   text identical — nothing to re-narrate"
    touch "$mb"   # bump mtime so this book is skipped at level 1 next run
  fi
}

# --- mode + selection --------------------------------------------------------
#   --update / --nightly : non-interactive incremental mode (for nightly cron)
INCREMENTAL=0
if [[ "$1" == (--update|--nightly|-u) ]]; then INCREMENTAL=1; shift; fi

typeset -a sel
if (( INCREMENTAL )); then
  [ $# -gt 0 ] && args="$*" || args="all"      # default to ALL books, no prompt
elif [ $# -gt 0 ]; then
  args="$*"
else
  echo "Which audiobook(s) do you want to generate?"
  for i in {1..${#TITLES}}; do echo "  $i) ${TITLES[$i]}"; done
  echo "  a) ALL"
  printf "Enter number(s) (e.g. 2  or  2 5  or  a): "
  read -r args
fi

if [[ "$args" == (a|A|all|ALL) ]]; then
  sel=({1..${#TITLES}})
else
  for tok in ${(s: :)args//,/ }; do
    if [[ "$tok" == <-> ]] && (( tok >= 1 && tok <= ${#TITLES} )); then sel+=("$tok")
    else echo "  (ignoring invalid choice: '$tok')"; fi
  done
fi
[ ${#sel} -eq 0 ] && { echo "Nothing selected. Exiting."; exit 0; }

typeset -a selnames; for idx in "${(@)sel}"; do selnames+=("${TITLES[$idx]}"); done
SECONDS=0
if (( INCREMENTAL )); then
  echo "[$(date '+%Y-%m-%d %H:%M')] incremental update: ${(j:, :)selnames}"
else
  echo "Will generate (from scratch): ${(j:, :)selnames}"
fi
for idx in "${(@)sel}"; do
  (( INCREMENTAL )) && incremental_book "$idx" || process_book "$idx"
done
echo "=============================================================="
echo "Done in $((SECONDS/60))m $((SECONDS%60))s. Audiobooks in: $ROOT/m4b/"
