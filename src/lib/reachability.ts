// Reachability analysis for the CYOA structure (LOOM-122).
//
// Answers one question exactly: which gated things — conditional overrides,
// gated blocks, chapter conditions, gated choice options — can no reader ever
// see? Not a heuristic. Three properties of the data make it decidable:
//
//   1. Conditions are conjunctions/disjunctions of equality and numeric
//      comparison (storyEngine's matchesCondition), never arbitrary code.
//   2. A session seeds every variable from its declared defaultValue
//      (sessionService), so the starting state is fully known.
//   3. No choice sets targetChapterId — the chapter spine is linear and all
//      branching lives in variable state. So walking the spine once, forking
//      at each choice point, enumerates every reachable state.
//
// Condition evaluation and variable writes are DELEGATED to storyEngine
// (matchesCondition, applyChoice) rather than reimplemented. A second
// evaluator that drifted from the engine would report confident nonsense —
// the whole value of this module is that a green result can be trusted.
//
// Read-only: it takes plain rows and returns findings. It never writes.
import {
  matchesCondition,
  applyChoice,
  type Condition,
  type StoryState,
  type ChoiceSetValue,
} from './storyEngine'

// ── Input rows ───────────────────────────────────────────────────────────────
// Deliberately structural, not Prisma types: this is a pure function so it can
// be unit-tested against fixtures without a database.
export type ReachBook = { id: string; title: string; order: number }
export type ReachChapter = {
  id: string; bookId: string; title: string; order: number; condition: string | null
}
export type ReachBlock = {
  id: string; chapterId: string; order: number; type: string; condition: string | null
}
export type ReachChoice = {
  id: string; choicePointId: string; order: number; label: string
  setsVariables: string; condition: string | null
  isBadEnding: boolean; endsChapter: boolean
}
export type ReachOverride = {
  id: string; conditionalFragmentId: string; order: number
  condition: string; endsChapter: boolean
}
export type ReachVariable = { name: string; type: string; defaultValue: string }

export type ReachabilityInput = {
  books: ReachBook[]
  chapters: ReachChapter[]
  blocks: ReachBlock[]
  choices: ReachChoice[]
  overrides: ReachOverride[]
  variables: ReachVariable[]
}

// ── Findings ─────────────────────────────────────────────────────────────────
export type FindingKind =
  /** Condition names a variable that is not a declared StoryVariable, so it can
   *  never match — session state only ever holds declared variables. */
  | 'undeclared-variable'
  /** Never even evaluated: an earlier override in the same fragment matched
   *  first in every state that got here (first-match-wins). */
  | 'always-preempted'
  /** Evaluated, but no reachable state satisfied it. */
  | 'unreachable-combination'
  /** Two overrides share an `order` — first-match-wins has no defined winner. */
  | 'duplicate-order'
  /** A choice writes a variable that was never declared, so nothing can read
   *  it back. */
  | 'undeclared-write'
  /** A declared variable that no condition anywhere reads. */
  | 'never-read'

export type Severity = 'dead' | 'warning'

export type Finding = {
  /** Stable across runs — the row id, so the UI can key and link on it. */
  id: string
  kind: FindingKind
  severity: Severity
  targetType: 'override' | 'block' | 'chapter' | 'choice' | 'variable'
  title: string
  /** Plain language: what is wrong and what to do about it. Never "invalid". */
  detail: string
  condition?: string
  bookId?: string
  bookTitle?: string
  chapterId?: string
  chapterTitle?: string
  chapterOrder?: number
  /** The block that holds this finding — the conditional fragment, the choice
   *  point, or the gated block itself. Feeds the editor's existing
   *  `?block=<id>` deep link, so a finding can be opened at the thing it is
   *  about rather than at the top of a long chapter. Absent for chapter-level
   *  and series-level findings, which have no single block. */
  blockId?: string
  /** How many reachable states reached this gate, and how many satisfied it.
   *  The evidence — a finding without it is one nobody should believe. */
  evaluated: number
  matched: number
}

export type ReachabilityReport = {
  findings: Finding[]
  summary: {
    chapters: number
    choicePoints: number
    overrides: number
    gatedBlocks: number
    chapterGates: number
    gatedChoices: number
    variables: number
    /** Largest number of distinct live states at any point in the spine. */
    peakStates: number
    dead: number
    warnings: number
    /** Findings per book id, so the book list can badge without re-running. */
    deadByBook: Record<string, number>
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === '') return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

type Compoundish = { op?: string; clauses?: { var: string }[] }

/** Variable names a condition reads. Mirrors matchesCondition's two shapes. */
function conditionVars(cond: Condition | null): string[] {
  if (!cond) return []
  const c = cond as Compoundish
  if (Array.isArray(c.clauses)) return c.clauses.map(cl => cl.var)
  return Object.keys(cond as Record<string, unknown>)
}

/** True when the condition is a real gate rather than "always show". */
function isGate(raw: string | null): boolean {
  if (!raw || raw === '' || raw === '{}') return false
  const parsed = parseJson<Record<string, unknown> | null>(raw, null)
  if (!parsed) return false
  return Object.keys(parsed).length > 0
}

/**
 * The first earlier override in the same fragment whose condition is a strict
 * subset of `o`'s — it therefore matches wherever `o` would, and wins on order.
 *
 * Legacy implicit-AND shapes only. A compound condition (`or`, `hide`, or a
 * comparison operator) has no cheap subset test, and guessing at one would
 * produce a confident wrong explanation — the runtime counts still catch those.
 */
function findSubsetSibling(
  o: ReachOverride,
  siblings: ReachOverride[],
): ReachOverride | null {
  const mine = parseJson<Record<string, unknown>>(o.condition, {})
  if (!mine || Array.isArray((mine as Compoundish).clauses)) return null
  for (const other of siblings) {
    if (other.order >= o.order || other.id === o.id) continue
    const theirs = parseJson<Record<string, unknown>>(other.condition, {})
    if (!theirs || Array.isArray((theirs as Compoundish).clauses)) continue
    const keys = Object.keys(theirs)
    if (keys.length === 0 || keys.length >= Object.keys(mine).length) continue
    if (keys.every(k => mine[k] === theirs[k])) return other
  }
  return null
}

// ── The analysis ─────────────────────────────────────────────────────────────
export function analyzeReachability(input: ReachabilityInput): ReachabilityReport {
  const { books, chapters, blocks, choices, overrides, variables } = input

  const declared = new Set(variables.map(v => v.name))
  const bookById = new Map(books.map(b => [b.id, b]))

  // Order the spine: books by order, chapters by order within book.
  const bookOrder = new Map(books.map(b => [b.id, b.order]))
  const spine = [...chapters].sort((a, b) =>
    ((bookOrder.get(a.bookId) ?? 0) - (bookOrder.get(b.bookId) ?? 0)) || (a.order - b.order))

  const blocksByChapter = new Map<string, ReachBlock[]>()
  for (const b of blocks) {
    const arr = blocksByChapter.get(b.chapterId)
    if (arr) arr.push(b); else blocksByChapter.set(b.chapterId, [b])
  }
  for (const arr of blocksByChapter.values()) arr.sort((a, b) => a.order - b.order)

  const choicesByPoint = new Map<string, ReachChoice[]>()
  for (const c of choices) {
    const arr = choicesByPoint.get(c.choicePointId)
    if (arr) arr.push(c); else choicesByPoint.set(c.choicePointId, [c])
  }
  for (const arr of choicesByPoint.values()) arr.sort((a, b) => a.order - b.order)

  const overridesByFragment = new Map<string, ReachOverride[]>()
  for (const o of overrides) {
    const arr = overridesByFragment.get(o.conditionalFragmentId)
    if (arr) arr.push(o); else overridesByFragment.set(o.conditionalFragmentId, [o])
  }
  for (const arr of overridesByFragment.values()) arr.sort((a, b) => a.order - b.order)

  // Parsed conditions, once.
  const condOf = new Map<string, Condition | null>()
  for (const ch of spine) condOf.set(ch.id, isGate(ch.condition) ? parseJson<Condition>(ch.condition, {}) : null)
  for (const b of blocks) condOf.set(b.id, isGate(b.condition) ? parseJson<Condition>(b.condition, {}) : null)
  for (const o of overrides) condOf.set(o.id, parseJson<Condition>(o.condition, {}))
  for (const c of choices) condOf.set(c.id, isGate(c.condition) ? parseJson<Condition>(c.condition, {}) : null)

  // ── Live-variable projection ───────────────────────────────────────────────
  // A variable stops mattering once nothing downstream reads it. Deduping
  // states on only the still-readable projection is LOSSLESS — two states
  // agreeing on every readable variable behave identically from here on — and
  // it is what keeps this tractable: on the current series it takes the peak
  // frontier from >200,000 (capped, unsound) to ~152 (exact, milliseconds).
  const readsAt: Set<string>[] = spine.map(ch => {
    const s = new Set<string>()
    for (const v of conditionVars(condOf.get(ch.id) ?? null)) s.add(v)
    for (const blk of blocksByChapter.get(ch.id) ?? []) {
      for (const v of conditionVars(condOf.get(blk.id) ?? null)) s.add(v)
      for (const o of overridesByFragment.get(blk.id) ?? []) {
        for (const v of conditionVars(condOf.get(o.id) ?? null)) s.add(v)
      }
      for (const c of choicesByPoint.get(blk.id) ?? []) {
        for (const v of conditionVars(condOf.get(c.id) ?? null)) s.add(v)
      }
    }
    return s
  })
  const liveFrom: Set<string>[] = new Array(spine.length + 1)
  liveFrom[spine.length] = new Set()
  for (let i = spine.length - 1; i >= 0; i--) {
    liveFrom[i] = new Set([...readsAt[i], ...liveFrom[i + 1]])
  }
  const everRead = liveFrom[0] ?? new Set<string>()

  // ── Initial state: every declared variable at its default ──────────────────
  const initial: StoryState = {}
  for (const v of variables) {
    initial[v.name] = parseJson<boolean | number | string>(v.defaultValue, '')
  }

  // ── Counters ───────────────────────────────────────────────────────────────
  const evaluated = new Map<string, number>()
  const matched = new Map<string, number>()
  /** For an override never evaluated: which earlier override kept winning. */
  const preemptedBy = new Map<string, Map<string, number>>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

  let peakStates = 0
  let liveNow: Set<string> = everRead
  const key = (st: StoryState) => {
    let out = ''
    for (const k of [...liveNow].sort()) out += k + ' ' + String(st[k]) + ''
    return out
  }

  /** Fork one state through a choice point. Returns forward states ([] when
   *  every available option ends the run). */
  function forkChoicePoint(blockId: string, st: StoryState): { forward: StoryState[]; ended: StoryState[] } {
    const opts = choicesByPoint.get(blockId) ?? []
    if (opts.length === 0) return { forward: [st], ended: [] }

    const available: ReachChoice[] = []
    for (const c of opts) {
      // Orders 0 and 1 are the base pair: they always render and cannot be
      // gated, so a reader is never left with an empty choice point.
      const gate = c.order >= 2 ? condOf.get(c.id) ?? null : null
      if (!gate) { bump(evaluated, c.id); bump(matched, c.id); available.push(c); continue }
      bump(evaluated, c.id)
      if (matchesCondition(gate, st)) { bump(matched, c.id); available.push(c) }
    }
    if (available.length === 0) return { forward: [st], ended: [] }

    const forward: StoryState[] = []
    const ended: StoryState[] = []
    for (const c of available) {
      // A bad ending terminates the run: it contributes no forward state.
      if (c.isBadEnding) continue
      const setsVariables = parseJson<Record<string, ChoiceSetValue>>(c.setsVariables, {})
      // Delegated, so counter ops (+=/-=) fold exactly as the reader does.
      const { newState } = applyChoice(st, [], blockId, {
        id: c.id, setsVariables, targetChapterId: null,
      })
      if (c.endsChapter) ended.push(newState)
      else forward.push(newState)
    }
    return { forward, ended }
  }

  // ── Walk the spine ─────────────────────────────────────────────────────────
  let frontier = new Map<string, StoryState>([[key(initial), initial]])

  for (let ci = 0; ci < spine.length; ci++) {
    const ch = spine[ci]
    if (frontier.size === 0) break

    // Collapse onto the variables still readable from here on.
    liveNow = liveFrom[ci]
    const collapsed = new Map<string, StoryState>()
    for (const st of frontier.values()) {
      const k = key(st)
      if (!collapsed.has(k)) collapsed.set(k, st)
    }
    frontier = collapsed
    if (frontier.size > peakStates) peakStates = frontier.size

    // A gated chapter is skipped by states that fail it; those states continue
    // to the next chapter unchanged, so the chapter is unreachable only if NO
    // reachable state satisfies its gate.
    let live = new Map<string, StoryState>()
    const skipped = new Map<string, StoryState>()
    const chGate = condOf.get(ch.id) ?? null
    if (chGate) {
      for (const [k, st] of frontier) {
        bump(evaluated, ch.id)
        if (matchesCondition(chGate, st)) { bump(matched, ch.id); live.set(k, st) }
        else skipped.set(k, st)
      }
    } else {
      live = new Map(frontier)
    }

    // States that ended this chapter early rejoin at the chapter boundary.
    const ended = new Map<string, StoryState>()

    for (const blk of blocksByChapter.get(ch.id) ?? []) {
      if (live.size === 0) break
      const gate = condOf.get(blk.id) ?? null

      // A gated block renders or not; either way the state is unchanged. The
      // one exception is a choice point, which only forks the states that can
      // actually see it.
      let sees = live
      if (gate) {
        const pass = new Map<string, StoryState>()
        const fail = new Map<string, StoryState>()
        for (const [k, st] of live) {
          bump(evaluated, blk.id)
          if (matchesCondition(gate, st)) { bump(matched, blk.id); pass.set(k, st) }
          else fail.set(k, st)
        }
        sees = pass
        if (blk.type === 'choice_point') {
          const next = new Map<string, StoryState>(fail)
          for (const st of pass.values()) {
            const { forward, ended: e } = forkChoicePoint(blk.id, st)
            for (const ns of forward) next.set(key(ns), ns)
            for (const ns of e) ended.set(key(ns), ns)
          }
          live = next
          continue
        }
      } else if (blk.type === 'choice_point') {
        const next = new Map<string, StoryState>()
        for (const st of live.values()) {
          const { forward, ended: e } = forkChoicePoint(blk.id, st)
          for (const ns of forward) next.set(key(ns), ns)
          for (const ns of e) ended.set(key(ns), ns)
        }
        live = next
        continue
      }

      if (blk.type === 'conditional_fragment') {
        const list = overridesByFragment.get(blk.id) ?? []
        for (const [k, st] of sees) {
          // First match wins — exactly resolveOverride's rule.
          let winner: ReachOverride | null = null
          for (const o of list) {
            bump(evaluated, o.id)
            if (matchesCondition(condOf.get(o.id) ?? {}, st)) { bump(matched, o.id); winner = o; break }
          }
          if (winner) {
            // Everything after the winner was never evaluated in this state.
            for (const o of list) {
              if (o.order <= winner.order && o.id !== winner.id) continue
              if (o.id === winner.id) continue
              const m = preemptedBy.get(o.id) ?? new Map<string, number>()
              m.set(winner.id, (m.get(winner.id) ?? 0) + 1)
              preemptedBy.set(o.id, m)
            }
            if (winner.endsChapter) { live.delete(k); ended.set(k, st) }
          }
        }
      }
    }

    frontier = new Map([...live, ...skipped, ...ended])
  }

  // ── Turn counters into findings ────────────────────────────────────────────
  const findings: Finding[] = []
  const chapterById = new Map(spine.map(c => [c.id, c]))
  const blockById = new Map(blocks.map(b => [b.id, b]))

  function place(chapterId: string | undefined) {
    const ch = chapterId ? chapterById.get(chapterId) : undefined
    const bk = ch ? bookById.get(ch.bookId) : undefined
    return {
      bookId: bk?.id, bookTitle: bk?.title,
      chapterId: ch?.id, chapterTitle: ch?.title, chapterOrder: ch ? ch.order + 1 : undefined,
    }
  }

  const undeclaredIn = (cond: Condition | null) =>
    conditionVars(cond).filter(v => !declared.has(v))

  // Overrides — the richest case, and where all three real bugs live.
  for (const o of overrides) {
    const ev = evaluated.get(o.id) ?? 0
    const mt = matched.get(o.id) ?? 0
    if (mt > 0) continue

    const frag = blockById.get(o.conditionalFragmentId)
    const cond = condOf.get(o.id) ?? null
    const loc = place(frag?.chapterId)
    const undeclared = undeclaredIn(cond)
    const base = {
      id: o.id, severity: 'dead' as const, targetType: 'override' as const,
      condition: o.condition, evaluated: ev, matched: mt,
      blockId: o.conditionalFragmentId, ...loc,
    }

    if (undeclared.length > 0) {
      findings.push({
        ...base,
        kind: 'undeclared-variable',
        title: `Override #${o.order} reads a variable that doesn't exist`,
        detail: `${undeclared.map(v => `"${v}"`).join(', ')} ${undeclared.length > 1 ? 'are' : 'is'} not a story variable, so this clause compares against nothing and never matches. Check for a typo, or add the variable.`,
      })
      continue
    }

    const pre = preemptedBy.get(o.id)
    if (ev === 0 && pre && pre.size > 0) {
      const [winnerId] = [...pre.entries()].sort((a, b) => b[1] - a[1])[0]
      const winner = overrides.find(x => x.id === winnerId)
      findings.push({
        ...base,
        kind: 'always-preempted',
        title: `Override #${o.order} never gets a turn`,
        detail: `Override #${winner?.order ?? '?'} matches first in every state that reaches this fragment, and the first match wins. Move this above it to make it reachable.`,
      })
      continue
    }

    // An earlier sibling whose condition is a strict subset wins wherever this
    // one would: every state matching all of THIS condition's clauses already
    // matches all of that one's. Structural, so it holds regardless of which
    // states happen to be reachable — and it names the concrete fix, which
    // "this combination never happens" does not.
    const subsetSibling = findSubsetSibling(o, overridesByFragment.get(o.conditionalFragmentId) ?? [])
    if (subsetSibling) {
      findings.push({
        ...base,
        kind: 'always-preempted',
        title: `Override #${o.order} never gets a turn`,
        detail: `Override #${subsetSibling.order} asks for less than this one and sits above it, so it matches first every time — the first match wins. Move this above #${subsetSibling.order}, or make #${subsetSibling.order} more specific.`,
      })
      continue
    }

    findings.push({
      ...base,
      kind: 'unreachable-combination',
      title: `Override #${o.order} needs a combination that never happens`,
      detail: ev === 0
        ? 'No reader ever reaches this fragment on a path where this could apply.'
        : `All ${ev} state${ev === 1 ? '' : 's'} that reach this fragment ${ev === 1 ? 'was' : 'were'} checked and none satisfied it — the variable values it asks for never occur together. This is usually a lock working as intended somewhere earlier.`,
    })
  }

  // Chapter gates, gated blocks, gated choices — same rule, less commentary.
  for (const ch of spine) {
    if (!condOf.get(ch.id)) continue
    const ev = evaluated.get(ch.id) ?? 0
    if ((matched.get(ch.id) ?? 0) > 0 || ev === 0) continue
    const undeclared = undeclaredIn(condOf.get(ch.id) ?? null)
    findings.push({
      id: ch.id, kind: undeclared.length ? 'undeclared-variable' : 'unreachable-combination',
      severity: 'dead', targetType: 'chapter',
      title: `Chapter "${ch.title}" is never shown`,
      detail: undeclared.length
        ? `Its condition reads ${undeclared.map(v => `"${v}"`).join(', ')}, which ${undeclared.length > 1 ? 'are' : 'is'} not a story variable.`
        : `All ${ev} states that reach this point were checked and none satisfied the chapter's condition.`,
      condition: ch.condition ?? undefined, evaluated: ev, matched: 0, ...place(ch.id),
    })
  }

  for (const b of blocks) {
    if (!condOf.get(b.id)) continue
    const ev = evaluated.get(b.id) ?? 0
    if ((matched.get(b.id) ?? 0) > 0 || ev === 0) continue
    const undeclared = undeclaredIn(condOf.get(b.id) ?? null)
    findings.push({
      id: b.id, kind: undeclared.length ? 'undeclared-variable' : 'unreachable-combination',
      severity: 'dead', targetType: 'block',
      title: 'A gated block never renders',
      detail: undeclared.length
        ? `Its condition reads ${undeclared.map(v => `"${v}"`).join(', ')}, which ${undeclared.length > 1 ? 'are' : 'is'} not a story variable.`
        : `All ${ev} states that reach this block were checked and none satisfied its condition.`,
      condition: b.condition ?? undefined, evaluated: ev, matched: 0,
      blockId: b.id, ...place(b.chapterId),
    })
  }

  for (const c of choices) {
    if (c.order < 2 || !condOf.get(c.id)) continue
    const ev = evaluated.get(c.id) ?? 0
    if ((matched.get(c.id) ?? 0) > 0 || ev === 0) continue
    const frag = blockById.get(c.choicePointId)
    const undeclared = undeclaredIn(condOf.get(c.id) ?? null)
    findings.push({
      id: c.id, kind: undeclared.length ? 'undeclared-variable' : 'unreachable-combination',
      severity: 'dead', targetType: 'choice',
      title: `The option "${c.label}" is never offered`,
      detail: undeclared.length
        ? `Its condition reads ${undeclared.map(v => `"${v}"`).join(', ')}, which ${undeclared.length > 1 ? 'are' : 'is'} not a story variable.`
        : `All ${ev} states that reach this choice point were checked and none unlocked this option.`,
      condition: c.condition ?? undefined, evaluated: ev, matched: 0,
      blockId: c.choicePointId, ...place(frag?.chapterId),
    })
  }

  // ── Warnings ───────────────────────────────────────────────────────────────
  // Two overrides at the same order: first-match-wins has no defined winner.
  for (const [fragId, list] of overridesByFragment) {
    const byOrder = new Map<number, ReachOverride[]>()
    for (const o of list) {
      const arr = byOrder.get(o.order)
      if (arr) arr.push(o); else byOrder.set(o.order, [o])
    }
    for (const [order, group] of byOrder) {
      if (group.length < 2) continue
      const frag = blockById.get(fragId)
      findings.push({
        id: `${fragId}:order-${order}`, kind: 'duplicate-order', severity: 'warning',
        targetType: 'override',
        title: `Two overrides share position #${order}`,
        detail: 'The first match wins, but these two are tied — which one a reader gets is not defined. Give them distinct positions.',
        evaluated: 0, matched: 0, blockId: fragId, ...place(frag?.chapterId),
      })
    }
  }

  // A choice writing a variable nothing declared: nothing can ever read it back.
  const writtenBy = new Map<string, string[]>()
  for (const c of choices) {
    for (const name of Object.keys(parseJson<Record<string, unknown>>(c.setsVariables, {}))) {
      if (declared.has(name)) continue
      const arr = writtenBy.get(name)
      if (arr) arr.push(c.label); else writtenBy.set(name, [c.label])
    }
  }
  for (const [name, labels] of writtenBy) {
    findings.push({
      id: `undeclared-write:${name}`, kind: 'undeclared-write', severity: 'warning',
      targetType: 'variable',
      title: `"${name}" is set but was never created`,
      detail: `${labels.length} choice${labels.length === 1 ? '' : 's'} (${labels.map(l => `"${l}"`).join(', ')}) write this, but it isn't a story variable — so no condition can ever read it back. Create it, or drop it from those choices.`,
      evaluated: 0, matched: 0,
    })
  }

  // Declared but never read by any condition.
  const neverRead = variables.map(v => v.name).filter(n => !everRead.has(n))
  if (neverRead.length > 0) {
    findings.push({
      id: 'never-read', kind: 'never-read', severity: 'warning', targetType: 'variable',
      title: `${neverRead.length} variable${neverRead.length === 1 ? '' : 's'} nothing reads`,
      detail: `${neverRead.join(', ')} — no condition anywhere depends on ${neverRead.length === 1 ? 'it' : 'them'}. Fine if you're still building toward that; worth knowing if you thought something branched on it.`,
      evaluated: 0, matched: 0,
    })
  }

  // Dead first, then by position in the series.
  const bookRank = new Map(books.map(b => [b.id, b.order]))
  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'dead' ? -1 : 1
    const ab = bookRank.get(a.bookId ?? '') ?? 999
    const bb = bookRank.get(b.bookId ?? '') ?? 999
    return ab - bb || (a.chapterOrder ?? 999) - (b.chapterOrder ?? 999)
  })

  const deadByBook: Record<string, number> = {}
  for (const f of findings) {
    if (f.severity === 'dead' && f.bookId) deadByBook[f.bookId] = (deadByBook[f.bookId] ?? 0) + 1
  }

  return {
    findings,
    summary: {
      chapters: chapters.length,
      choicePoints: blocks.filter(b => b.type === 'choice_point').length,
      overrides: overrides.length,
      gatedBlocks: blocks.filter(b => isGate(b.condition)).length,
      chapterGates: chapters.filter(c => isGate(c.condition)).length,
      gatedChoices: choices.filter(c => c.order >= 2 && isGate(c.condition)).length,
      variables: variables.length,
      peakStates,
      dead: findings.filter(f => f.severity === 'dead').length,
      warnings: findings.filter(f => f.severity === 'warning').length,
      deadByBook,
    },
  }
}
