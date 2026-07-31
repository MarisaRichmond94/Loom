#!/bin/zsh
cd "/Users/marisarichmond/Writing/Audiobooks"
# wait for chapter generation to finish
while pgrep -f build_audiobooks.sh >/dev/null; do sleep 30; done
echo "[$(printf '%(%H:%M:%S)T')] audio generation finished; building final m4b files"
"$HOME/Scripts/build_m4b.sh" "The Secrets We Bury"
"$HOME/Scripts/build_m4b.sh" "Split"
echo "[$(printf '%(%H:%M:%S)T')] ALL DONE"
ls -la m4b/*.m4b
