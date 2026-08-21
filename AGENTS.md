<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## How this app actually runs — read before building or starting a server

Marisa runs Loom as a packaged desktop app (`~/Applications/Loom.app`), **not**
`npm run dev`. That app is a thin launcher (`Contents/Resources/script`)
around a **permanent production Next.js server managed by launchd**
(`com.marisarichmond.loom`, `next start` on `127.0.0.1:3000`). It keeps
running after the launcher window closes — auto-save exports, the 22:00
backup, and WriteAI sync all depend on it staying up.

**Node version is load-bearing.** The launchd service — and its
`node_modules` native bindings (`better-sqlite3`, and anything else with a
compiled addon) — run on Homebrew's `node@24`
(`/opt/homebrew/opt/node@24/bin`), *not* whatever `nvm`/your shell defaults
to. Building or running with a mismatched Node version doesn't always fail
loudly: it can silently produce a broken/empty CSS bundle or throw
`NODE_MODULE_VERSION` errors from native modules at request time. Before
running `npm run build`, `npm run start`, or any script that touches
`node_modules`' native addons, check what's actually on `PATH`:
```bash
which node   # must resolve to /opt/homebrew/opt/node@24/bin/node (or .../Cellar/node@24/<version>/bin/node)
```
If it doesn't, prefix the command with
`export PATH="/opt/homebrew/opt/node@24/bin:$PATH"` first.

**Never `npm run build` into this checkout while the service is live** —
`.next/` here is the exact directory the running server reads from on every
request. Overwriting it out from under a live process leaves it serving a
half-consistent build (this has already caused a broken-CSS incident).
If you need to build in this checkout for any reason (verifying a change,
checking bundle output), immediately restart the service afterward so it
picks up a clean, consistent build:
```bash
launchctl kickstart -k "gui/$(id -u)/com.marisarichmond.loom"
```
Prefer building in an isolated worktree/copy instead when possible, so the
live service's `.next/` is never touched mid-request.

**Other service controls**, straight from the launcher script:
```bash
# restart the process, keep the loaded launchd config
launchctl kickstart -k "gui/$(id -u)/com.marisarichmond.loom"
# stop it
launchctl bootout "gui/$(id -u)/com.marisarichmond.loom"
# (re)load it after a bootout, or after editing the plist itself
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.marisarichmond.loom.plist"
```
For hot-reload development against real data: `bootout` the agent first (so
its `next start` isn't fighting `next dev` for port 3000/the `.next` dir),
then `npm run dev`.

