#!/bin/zsh
# Stitch per-chapter M4A files into ONE .m4b audiobook per book, with embedded
# chapter markers, title/author metadata, and cover art pulled from the .pages file.
# Result: 5 audiobooks in Apple Books instead of 322 loose tracks.
#
# Requires: ffmpeg, ffprobe (brew install ffmpeg)
ROOT="/Users/marisarichmond/Writing/Audiobooks"
AUTHOR="B.C. Stryker"
OUT="$ROOT/m4b"
mkdir -p "$OUT"

# title | source .pages (for cover art) | series track number
books=(
  "Nobody's Hero|/Users/marisarichmond/Writing/1. Nobody's Hero/Nobody's Hero.pages|1"
  "Faded|/Users/marisarichmond/Writing/2. Faded/Faded.pages|2"
  "The Secrets We Keep|/Users/marisarichmond/Writing/3. The Secrets We Keep/The Secrets We Keep.pages|3"
  "The Secrets We Bury|/Users/marisarichmond/Writing/4. The Secrets We Bury/The Secrets We Bury.pages|4"
  "Split|/Users/marisarichmond/Writing/5. Split/Split.pages|5"
)

extract_cover() {  # $1=pages file (locates the book folder)  $2=dest jpg
  local pages="$1" dest="$2" tmp img
  # Preferred: the designed dust-jacket front cover, downscaled for embedding.
  local front="${pages:h}/Dust Jacket/Front Cover.png"
  if [ -f "$front" ]; then
    ffmpeg -y -i "$front" -vf "scale=-2:1600" -q:v 3 -f mjpeg "$dest" >/dev/null 2>&1
    [ -f "$dest" ] && return 0
  fi
  # Fallback: rendered first page inside the .pages package.
  tmp=$(mktemp -d)
  img=$(unzip -Z1 "$pages" 2>/dev/null | grep -i '^preview.jpg$' | head -1)
  if [ -n "$img" ]; then
    unzip -o -j "$pages" "$img" -d "$tmp" >/dev/null 2>&1
    [ -f "$tmp/${img:t}" ] && cp "$tmp/${img:t}" "$dest"
  fi
  rm -rf "$tmp"
}

build_one() {
  local title="$1" pages="$2" track="$3"
  local chdir="$ROOT/$title"
  local chapters=("$chdir"/*.m4a(N))
  if [ ${#chapters} -eq 0 ]; then echo "  !! no chapters for $title, skipping"; return 1; fi

  local work; work=$(mktemp -d)
  local list="$work/list.txt"  meta="$work/meta.txt"  cover="$work/cover.img"
  : > "$list"
  {
    echo ";FFMETADATA1"
    echo "title=$title"
    echo "artist=$AUTHOR"
    echo "album=$title"
    echo "album_artist=$AUTHOR"
    echo "genre=Audiobook"
    echo "track=$track"
    echo "comment=Narrated by the Tom (Enhanced) system voice"
  } > "$meta"

  local start=0 ch=0 f
  for f in "${(@)chapters}"; do
    ch=$((ch+1))
    # sanitized symlink so the concat list has no special characters
    local seg=""; seg=$(printf 'seg_%03d.m4a' "$ch")
    ln -s "$f" "$work/$seg"
    echo "file '$seg'" >> "$list"
    local dur_s="" dur_ms=""
    dur_s=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$f")
    dur_ms=$(awk -v d="$dur_s" 'BEGIN{printf "%.0f", d*1000}')
    local end=$((start + dur_ms))
    # chapter title derived from the text heading (line 1), so numbering stays correct
    # even with a Prologue first, and a Prologue is labelled properly.
    local ctxt="$chdir/chapters_txt/${f:t:r}.txt" h1="" pov="" ctitle="Chapter $ch"
    if [ -f "$ctxt" ]; then
      h1=$(sed -n '1p' "$ctxt" | tr -d '\r')
      pov=$(sed -n '2p' "$ctxt" | tr -d '\r')
    fi
    if [[ "$h1" == Prologue* ]]; then
      ctitle="Prologue"
    elif [[ "$h1" == "Part "* ]]; then
      ctitle="${h1%.}"                              # "Part Two." -> "Part Two"
      [ -n "$pov" ] && ctitle="${h1%.} — $pov"      # -> "Part Two — First Blood"
    elif [[ "$h1" =~ '^Chapter ([0-9]+)' ]]; then
      ctitle="Chapter ${match[1]}"
      [ -n "$pov" ] && ctitle="Chapter ${match[1]} ($pov)"
    fi
    printf '[CHAPTER]\nTIMEBASE=1/1000\nSTART=%s\nEND=%s\ntitle=%s\n' "$start" "$end" "$ctitle" >> "$meta"
    start=$end
  done

  extract_cover "$pages" "$cover"

  local outfile="$OUT/$title.m4b"
  rm -f "$outfile"
  if [ -f "$cover" ]; then
    ( cd "$work" && ffmpeg -y -f concat -safe 0 -i list.txt -i meta.txt -i cover.img \
        -map 0:a -map 2:v -map_metadata 1 \
        -c:a copy -c:v copy -disposition:v attached_pic \
        -f mp4 "$outfile" ) >"$work/ffmpeg.log" 2>&1
  else
    ( cd "$work" && ffmpeg -y -f concat -safe 0 -i list.txt -i meta.txt \
        -map 0:a -map_metadata 1 -c:a copy -f mp4 "$outfile" ) >"$work/ffmpeg.log" 2>&1
  fi

  # Tag as an Audiobook (iTunes 'stik' atom) so iOS routes it to Books, not Music.
  if [ -f "$outfile" ] && command -v AtomicParsley >/dev/null; then
    AtomicParsley "$outfile" --stik "Audiobook" --overWrite >/dev/null 2>&1
  fi

  if [ -f "$outfile" ]; then
    local mins; mins=$(awk -v s="$start" 'BEGIN{printf "%.0f", s/60000}')
    echo "  ✓ $title.m4b — ${ch} chapters, ~${mins} min, $(du -h "$outfile" | cut -f1)$( [ -f "$cover" ] && echo ', cover ✓' || echo ', no cover' )"
    rm -rf "$work"
  else
    echo "  !! ffmpeg failed for $title — log kept at $work/ffmpeg.log"; tail -6 "$work/ffmpeg.log"
    return 1
  fi
}

if [ -n "$1" ]; then
  for b in "${books[@]}"; do
    [ "${b%%|*}" = "$1" ] && build_one "${b%%|*}" "$(echo $b | cut -d'|' -f2)" "${b##*|}"
  done
else
  for b in "${books[@]}"; do
    build_one "${b%%|*}" "$(echo $b | cut -d'|' -f2)" "${b##*|}"
  done
fi
