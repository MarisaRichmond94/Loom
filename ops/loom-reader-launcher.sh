#!/bin/bash
# Launcher for the Loom Reader — the app your family reads in (LOOM-136).
#
# The server (Next.js production, 127.0.0.1:3200) runs permanently under
# launchd (com.marisarichmond.loomreader) and is published to your tailnet at
# https://gatlin-global.tail834fb9.ts.net/loom by `tailscale serve`. This app
# ensures it is running, rebuilds and restarts it if the code changed, and
# opens it. Quitting this app stops nothing — your readers keep reading.
#
# LOCALHOST ONLY, deliberately. The reader binds 127.0.0.1 and Tailscale
# proxies into it, so the only way in is through the tailnet. It is never on
# your home Wi-Fi.
#
# Server controls, when needed:
#   restart : launchctl kickstart -k gui/$(id -u)/com.marisarichmond.loomreader
#     (restarts the PROCESS but reuses the loaded plist — if you edit the
#      plist itself, you need bootout then bootstrap, below)
#   stop    : launchctl bootout gui/$(id -u)/com.marisarichmond.loomreader
#   start   : launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.marisarichmond.loomreader.plist
#
# Publishing does NOT need a restart: the reader notices content.db has been
# replaced and reopens it by itself. A restart is only for CODE changes.

export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH"
REPO="/Users/marisarichmond/Documents/GitHub/Loom"
cd "$REPO/reader" || { echo "Could not find $REPO/reader"; exit 1; }

# MUST match the plist's NEXT_PUBLIC_BASE_PATH. Next inlines basePath into the
# client bundle at build time, so building without this produces a bundle whose
# asset URLs have no /loom prefix — they would leave this app entirely and land
# on whatever answers `/` on the tailnet, which is a different application.
export NEXT_PUBLIC_BASE_PATH=/loom

# Rebuild only when source is newer than the last production build. `shared` is
# included because the reader imports from it (the word-wrapper, the comment
# gate, the resume ladder, the theme) — leaving it out would let an edit there
# ship nothing while looking like it had.
if [ ! -f .next/BUILD_ID ] || [ -n "$(find src ../shared package.json next.config.ts -type f -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  echo "Code changed since last build — rebuilding the reader (about a minute)..."
  npm install && npm run build || {
    echo "Build failed — leaving the running server as it was."
    exit 1
  }
  echo "Restarting the reader service..."
  launchctl kickstart -k "gui/$(id -u)/com.marisarichmond.loomreader" 2>/dev/null
fi

if ! launchctl list com.marisarichmond.loomreader >/dev/null 2>&1; then
  echo "Reader agent not loaded — loading it..."
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.marisarichmond.loomreader.plist"
fi

echo "Waiting for the reader..."
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:3200/loom/invite" && break
  sleep 1
done

# Opened at the TAILNET address, not localhost: that is the URL your readers
# use, so this is also a check that the path they take actually works.
URL="https://gatlin-global.tail834fb9.ts.net/loom"
echo "Opening the reader at $URL"
open "$URL"
