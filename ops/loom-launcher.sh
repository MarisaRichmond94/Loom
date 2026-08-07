#!/bin/bash
# Launcher for Loom. The server (Next.js production, :3000) runs permanently
# under launchd (com.marisarichmond.loom) — this app ensures it's running,
# rebuilds + restarts it if the code has changed since the last build, and
# opens it. Quitting this app stops nothing: Loom keeps running (auto-save
# exports, the 22:00 backup, and WriteAI sync depend on it).
#
# Server controls, when needed:
#   restart : launchctl kickstart -k gui/$(id -u)/com.marisarichmond.loom
#     (restarts the PROCESS but reuses the loaded plist — if you edit the
#      plist itself, you need bootout then bootstrap, below)
#   stop    : launchctl bootout gui/$(id -u)/com.marisarichmond.loom
#   start   : launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.marisarichmond.loom.plist
# (For development with hot reload: stop the agent, then npm run dev.)

export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH"
cd "/Users/marisarichmond/Documents/GitHub/Loom" || { echo "Could not find /Users/marisarichmond/Documents/GitHub/Loom"; exit 1; }

# Rebuild only when source files are newer than the last production build —
# on a normal writing day this is instant and skips straight to opening.
# `shared` is in this list because Loom imports from it (@shared/readerDb,
# @shared/commentGate, the theme CSS, and more — 11 files as of LOOM-135).
# Without it, editing shared/ left Loom believing it was up to date and it
# quietly kept serving the previous build.
if [ ! -f .next/BUILD_ID ] || [ -n "$(find src shared prisma package.json next.config.ts -type f -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  echo "Code changed since last build — rebuilding Loom (about a minute)..."
  npm install && npm run build || { echo "Build failed — leaving the running server as it was."; open "http://localhost:3000"; exit 1; }
  echo "Restarting the Loom service..."
  launchctl kickstart -k "gui/$(id -u)/com.marisarichmond.loom" 2>/dev/null
fi

if ! launchctl list com.marisarichmond.loom >/dev/null 2>&1; then
  echo "Loom agent not loaded — loading it..."
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.marisarichmond.loom.plist"
fi

echo "Waiting for Loom..."
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://localhost:3000" && break
  sleep 1
done

echo "Opening Loom at http://localhost:3000"
open "http://localhost:3000"
