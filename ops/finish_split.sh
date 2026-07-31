#!/bin/zsh
# Finish generating Split's chapters with a per-chapter watchdog so a hung
# enhanced-voice process (as happened on Ch 12) can't freeze the whole queue.
cd "/Users/marisarichmond/Writing/Audiobooks"
VOICE="Tom (Enhanced)"
TXTDIR="Split/chapters_txt"
TIMEOUT=90   # seconds; normal chapter generates in <30s, so >90s == hung

gen_one() {  # $1=txt  $2=out ; returns 0 on success
  local txt="$1" out="$2" try
  for try in 1 2 3; do
    rm -f "$out"
    say -v "$VOICE" -f "$txt" -o "$out" --data-format=aac@22050 &
    local pid=$! waited=0
    while kill -0 $pid 2>/dev/null; do
      sleep 2; waited=$((waited+2))
      if [ $waited -ge $TIMEOUT ]; then kill -9 $pid 2>/dev/null; break; fi
    done
    wait $pid 2>/dev/null
    if [ -f "$out" ] && [ "$(stat -f%z "$out")" -gt 50000 ]; then return 0; fi
    echo "  retry $try (hung/failed): ${out:t}"
  done
  return 1
}

for ct in "$TXTDIR"/*.txt; do
  name="${ct:t:r}"
  out="Split/$name.m4a"
  [ -f "$out" ] && [ "$(stat -f%z "$out")" -gt 50000 ] && continue
  if gen_one "$ct" "$out"; then
    echo "[$(printf '%(%H:%M:%S)T')] done: $name ($(find Split -maxdepth 1 -name '*.m4a'|wc -l|tr -d ' ')/76)"
  else
    echo "!! GAVE UP on $name after 3 tries"
  fi
done

count=$(find Split -maxdepth 1 -name '*.m4a' | wc -l | tr -d ' ')
echo "[$(printf '%(%H:%M:%S)T')] Split chapters: $count/76"
if [ "$count" -eq 76 ]; then
  echo "building Split.m4b ..."
  "$HOME/Scripts/build_m4b.sh" "Split"
  echo "ALL DONE"
else
  echo "Split incomplete ($count/76) - not building m4b"
fi
