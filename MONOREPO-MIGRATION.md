# Loom + WriteAI monorepo migration — plan & runbook

> Status: **not started** — planning doc only. Written 2026-07-29.
> Goal: combine Loom and WriteAI into a single repo, moving toward a more
> thoughtfully integrated experience, **without losing data or regressing
> either app.**

Read `INTEGRATION.md` first — it is the contract of every seam between the two
apps and is the safety rail this whole plan is built around.

---

## 1. The core insight (why this is safer than it feels)

**The irreplaceable data is not in git, in either repo.** Combining the repos
is a pure *code* operation and cannot touch your writing.

| Repo | Irreplaceable, on-disk only (gitignored) | Notes |
|------|------------------------------------------|-------|
| Loom | `dev.db` (~122 MB, Prisma SQLite) | **This file IS production.** `*.db` and `/data` are gitignored. |
| WriteAI | `data/` (~11 GB), `writer_data/` (~12 MB) | `data/` is gitignored; `writer_data/` is deliberately untracked writer-authored state. |
| Shared source of truth | `~/Writing` (manuscripts) | Read-only canon; Loom exports into it, WriteAI ingests from it. |

The **git move** and the **data** are on separate tracks. Only the data track
is dangerous, and this plan keeps them decoupled. Keep that separation and the
data-loss fear is contained to a handful of explicit, backed-up steps.

## 2. Decisions locked in

1. **Monorepo of two still-separate apps** — NOT a rewrite. The two runtimes
   stay as two processes.
   - Loom: Next.js 16 / Node ≥24 / Prisma + better-sqlite3 / TipTap.
   - WriteAI: Python / FastAPI + uvicorn / ChromaDB / Vite SPA (React 18).
2. **Do NOT merge the datastores.** Loom's SQLite is the source of truth for
   prose. WriteAI's 11 GB is overwhelmingly *derived* (Chroma embeddings,
   extracted text) and regenerable from `~/Writing`. Keep the mental model:
   **Loom = truth, WriteAI = index.** A corrupted WriteAI index is a re-ingest,
   never a loss.
3. **Preserve both git histories** (subtree / read-tree merge, not a fresh
   copy).
4. **Keep every `INTEGRATION.md` seam byte-for-byte identical** through Phases
   0–2. Only collapse seams deliberately in Phase 3.

## 3. Target repo layout (end of Phase 1)

```
Loom/                      # monorepo root (keeps the "Loom" name / remote)
  apps/
    loom/                  # current Loom app moves here
    writeai/               # WriteAI subtree lands here
  INTEGRATION.md           # single canonical copy (Phase 2)
  MONOREPO-MIGRATION.md    # this file
```

> Alternative for Phase 1 only: leave Loom at root and add `apps/writeai/`
> first, to minimize churn; move Loom under `apps/loom/` in a later commit.
> Pick whichever keeps the diff smallest to review.

---

## 4. Phase 0 — Snapshot & baseline (DO THIS BEFORE TOUCHING ANYTHING)

Nothing here modifies either app. It creates the backups and the regression
oracle everything else is checked against.

### 4a. Back up the three irreplaceable things OFF the working disk

> Your notes already flag a single-disk durability gap and a UTC date-stamp
> backup trap. This is the step that matters most. Put copies on a *different*
> physical disk / external / cloud, not just another folder on the same drive.

```sh
# pick a real second location
BK="/Volumes/<external>/loom-writeai-premerge-20260729"   # EDIT THIS
mkdir -p "$BK"

# Loom source-of-truth DB (stop Loom first so the file is quiescent — see 4c)
cp -c "/Users/marisarichmond/Documents/GitHub/Loom/dev.db" "$BK/loom-dev.db"

# WriteAI writer-authored state (small, irreplaceable)
cp -Rc "/Users/marisarichmond/Documents/GitHub/WriteAi/writer_data" "$BK/writeai-writer_data"

# Manuscripts (source canon)
cp -Rc "$HOME/Writing" "$BK/Writing"

# Verify sizes look right, then record a checksum for the DB
ls -la "$BK"
shasum -a 256 "$BK/loom-dev.db" | tee "$BK/loom-dev.db.sha256"
```

WriteAI's 11 GB `data/` is **derived** — you do NOT need to back it up to be
safe (it rebuilds from `~/Writing`). Optionally copy it only to save
re-ingest time/cost.

### 4b. Capture the regression baseline (the oracle)

Record current behavior so "no regression" is checkable, not vibes:

- [ ] WriteAI eval: run the eval harness, record hit@k (compare later with
      `eval/compare.py`).
- [ ] Loom launches under launchd; a chapter opens and renders.
- [ ] WriteAI launches; Explore returns citations.
- [ ] Jump link WriteAI → Loom author works
      (`/author/by-title/<series>`).
- [ ] Jump link WriteAI → Loom reader works
      (`/read/by-title/<series>/<book>/<chapter>`).
- [ ] Loom → WriteAI review deep link opens the review pane on the right
      chapter.
- [ ] Event outbox: Loom `GET /api/events?since=<seq>` responds; WriteAI
      polls it (`server/loom_events.py`).

### 4c. Freeze services during the move

```sh
launchctl bootout gui/$(id -u)/com.marisarichmond.loom
launchctl bootout gui/$(id -u)/com.marisarichmond.writeai
# (older syntax: launchctl unload ~/Library/LaunchAgents/<plist>)
```

Do the DB backup in 4a *after* Loom is stopped so `dev.db` isn't mid-write.

### 4d. Rollback point

Confirm both repos are committed and clean (`git status`), and note the current
HEAD of each:

```sh
git -C /Users/marisarichmond/Documents/GitHub/Loom  rev-parse HEAD
git -C /Users/marisarichmond/Documents/GitHub/WriteAi rev-parse HEAD
```

Phase 1 happens on a branch, so rollback = delete the branch. Data rollback =
restore from `$BK`.

---

## 5. Phase 1 — Monorepo, ZERO behavior change

Bring both codebases under one repo, preserving both histories. Neither app's
runtime, ports, data locations, or seams change.

### 5a. Merge WriteAI's history into Loom via subtree

Work on a branch off Loom:

```sh
cd /Users/marisarichmond/Documents/GitHub/Loom
git switch -c monorepo-consolidation

# add WriteAI as a remote and pull its whole history under apps/writeai/
git remote add writeai /Users/marisarichmond/Documents/GitHub/WriteAi
git fetch writeai
git subtree add --prefix=apps/writeai writeai main   # EDIT branch name if not 'main'
```

`git subtree add` preserves WriteAI's commits under the new prefix. (If you
prefer a cleaner single-commit import, `git read-tree --prefix=apps/writeai/`
is the alternative — but subtree keeps history, which is the stated goal.)

### 5b. Move Loom under apps/loom/ (optional in this phase)

If doing it now, `git mv` Loom's tracked files into `apps/loom/`. Keep this a
separate commit from 5a so the diff is reviewable. Update relative paths in
config that assume repo-root (Next config, tsconfig, jest, scripts,
`prisma.config.ts`).

### 5c. Reconcile .gitignore (CRITICAL — do before any `git add`)

The two ignore files must not shadow each other, and the 11 GB must never be
staged.

- Loom ignores `/data` (its events dir) and `*.db`.
- WriteAI ignores `data/`, `writer_data/`, `logs/`, `eval/results/`,
  `frontend/dist/`, `.venv/`, `__pycache__/`.

Scope every rule to its app subpath in the merged repo, e.g.
`apps/writeai/data/`, `apps/writeai/writer_data/`, `apps/loom/data/`,
`apps/loom/dev.db*`. **Before the first commit, verify:**

```sh
git status --ignored | grep -i "apps/writeai/data"   # must show as IGNORED
git check-ignore apps/writeai/data                    # must print the path
```

### 5d. Keep data & services pointing where they already are

- Do NOT move `dev.db`, `data/`, or `writer_data/` on disk in this phase.
  If the app directories moved (5b), update the app config/env to point back at
  the existing on-disk data locations, OR move the data too and update — but
  only one variable at a time.
- Update the two launchd plists' `WorkingDirectory` / program paths to the new
  app subdirs. (You've been bitten by launchd PATH + dev-port issues before —
  change these deliberately, re-`bootstrap`, and re-check.)

### 5e. Re-launch and check against the Phase 0 baseline

Restart both services and walk the entire 4b checklist. If anything fails,
this phase is fully reversible (branch delete; data never moved).

---

## 6. Phase 2 — Unified tooling, still two processes

Payoff: one front door. No runtime or datastore changes.

- One top-level launcher (Makefile / justfile / npm workspace scripts) that
  fans out to Node (Loom) and Python (WriteAI): install, dev, build, start.
- Consolidate management of the two launchd plists (one script to
  bootstrap/bootout both).
- Fold the two mirrored `INTEGRATION.md` files into one canonical copy at repo
  root; delete the duplicate.
- Keep per-app `.env` files (WriteAI's holds the Anthropic key + machine
  paths; Loom has its own). Do NOT centralize secrets into one committed file.

## 7. Phase 3 — Tighten integration deliberately, one seam at a time

Each item is a normal feature change with its own test — not a big-bang. Order
cheapest/safest first:

1. **Shared seam types.** Extract TypeScript types for the seam payloads
   (manifest, events, review deep-link params). Both frontends already use
   TipTap + react-icons, so some sharing is natural.
2. **Replace title-based identity with stable IDs.** Today series/book identity
   across apps is title-based and punctuation-loose; renaming a book in Loom
   breaks jump links and folder matching (see INTEGRATION.md "Identity
   caveat"). This is the most fragile seam — hardening it is the highest-value
   integration win.
3. **Unified UI shell (optional).** Make Explore/Review feel native inside
   Loom while the Python RAG stays a service behind it. Frontend convergence
   only — the Python backend and its datastores stay put.

---

## 8. Gotchas specific to this setup

- **launchd absolute paths.** Both services run from absolute paths under
  launchd. Any directory move means editing both plists deliberately, then
  `launchctl bootstrap` + re-verify. History: prior PATH / dev-port breakage.
- **Gitignore collision & the 11 GB.** Loom's `/data` vs WriteAI's 11 GB
  `data/` must be scoped per-app and confirmed ignored before the first
  `git add` (§5c).
- **`.env` / secrets stay per-app.** Never centralize into a committed file.
- **Regeneration is the net.** If WriteAI's Chroma index is mangled during the
  move, recovery is a re-ingest from `~/Writing`, not a restore. Another reason
  the datastores stay separate.
- **Backups on a second disk.** Single-disk durability gap + UTC date-stamp
  backup trap are known issues — §4a must land on different physical media.
- **Two React majors** (Loom 19, WriteAI 18). Fine while frontends stay
  separate; a concern only if/when you converge UI in Phase 3.

## 9. Rollback summary

| Failure point | Rollback |
|---------------|----------|
| Phase 1 code merge | Delete `monorepo-consolidation` branch; data untouched. |
| Services won't start | Restore old launchd plists; both repos still exist independently until you delete the old WriteAi dir. |
| Loom DB suspect | Restore `dev.db` from `$BK` (verify with the recorded sha256). |
| WriteAI data suspect | Restore `writer_data/` from `$BK`; re-ingest `data/` from `~/Writing`. |

Do not delete the standalone `WriteAi/` directory or the `$BK` backups until
the monorepo has run cleanly for a while.
