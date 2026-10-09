#!/usr/bin/env python3
"""
clean_audio.py — narrate one book's chapter segments with the swear words in
ops/clean_words.txt bleeped out. Driven by `generate_audiobook.sh --clean`,
which handles the Pages export, the chapter split and the final .m4b.

Why narrate-then-bleep (instead of splitting the text around each word and
narrating the pieces): each chapter is narrated whole by the Swift helper
(scripts/native/narrate.swift — the same AVSpeechSynthesizer + Tom voice as
Loom's in-app narration), so intonation is identical to the regular book. The
helper also reports when each word starts (willSpeakRange), which tells us
exactly which slice of audio to overwrite with a tone.

Those callbacks are not 1:1 with words (see reconcileTiming in
src/lib/narration/tokens.ts): sometimes one callback spans a whole phrase, and
sometimes a word is announced again after it was spoken. So a word's onset
prefers the first callback that starts exactly on it, and only interpolates
inside a multi-word callback as a fallback. Its end is the next word's onset,
trimmed back to where the audio actually goes quiet, so a swear word at the
end of a sentence doesn't bleep through the pause that follows.

Per chapter, under <work>/:
  <stem>.raw.m4a + <stem>.timing.json   unbleeped narration (the slow part,
                                        ~6x real time), reused until the
                                        chapter's text changes
  <stem>.stamp                          text+word-list hash of the current
                                        <out>/<stem>.m4a; a match skips it
A word-list edit therefore only re-bleeps (seconds per chapter), never
re-narrates.

usage:
  clean_audio.py book <words.txt> <chapters_txt_dir> <work_dir> <out_dir> [--jobs N]
  clean_audio.py samples <work_dir> <out_dir> <samples.m4a> [--count N]
"""
import array
import hashlib
import json
import math
import os
import random
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
NARRATE_SRC = HERE.parent / "scripts" / "native" / "narrate.swift"
# A private build of the helper, so compiling it never touches the binary the
# live Loom service spawns (scripts/native/bin/narrate).
NARRATE_BIN = Path(os.environ.get("CLEAN_NARRATE_BIN")
                   or Path.home() / "Writing" / "Audiobooks" / "Clean" / ".bin" / "narrate")
VOICE = "Tom (Enhanced)"
RATE = 22050
NARRATE_TIMEOUT_S = 1800   # the longest chapter (~4.4k words) takes ~4 min
MAX_TRIES = 3

TONE_HZ = 1000
TONE_AMP = 0.3             # Tom's speech averages around -17 dBFS; this is ~-10
FADE_S = 0.005
PAD_BEFORE_S = 0.06        # timing marks land within ~30ms of the real onset
# An interpolated onset (word inside a multi-word callback, e.g. "Oh—shit.")
# is only an estimate, so start well early: clipping the end of the word
# before beats letting the swear's first sound through.
PAD_BEFORE_INTERP_S = 0.15
PAD_AFTER_S = 0.03
SILENCE_RMS = 0.006        # ~-44 dBFS: "the word is over"
SILENCE_RUN_S = 0.06
MIN_WORD_S = 0.08          # never look for the trailing silence before this
SUSPECT_LONG_S = 1.6       # bleeps longer than this get flagged in the report
# Part of every chapter's stamp: bump it when the bleep placement changes so
# the next run re-bleeps every chapter (from cached narration — seconds each).
BLEEP_VERSION = 4


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# --- word list -------------------------------------------------------------

def _alternation(entries):
    alts = []
    for w in entries:
        lead, trail = w.startswith("*"), w.endswith("*")
        core = w.strip("*")
        pat = r"\s+".join(re.escape(p) for p in core.split())
        alts.append(("[A-Za-z]*" if lead else "") + pat + ("[A-Za-z]*" if trail else ""))
    alts.sort(key=len, reverse=True)   # prefer a phrase over a word inside it
    return re.compile(r"(?<![A-Za-z])(?:" + "|".join(alts) + r")(?![A-Za-z])", re.I)


def load_words(path):
    """(bleep regex, exception regex or None). A "!" line is an exception: a
    match inside it is never bleeped ("!pin-prick" keeps "pin-prick thin")."""
    bleep, keep = [], []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        w = line.strip()
        if w and not w.startswith("#"):
            (keep if w.startswith("!") else bleep).append(w.lstrip("!").strip())
    return _alternation(bleep), (_alternation(keep) if keep else None)


def find_spans(text, rxs):
    """Matched spans as (utf16_start, utf16_end, matched_text). The helper's
    callback offsets are NSString (UTF-16) offsets, not Python indices."""
    rx, keep = rxs
    kept = [(m.start(), m.end()) for m in keep.finditer(text)] if keep else []
    spans = []
    for m in rx.finditer(text):
        if any(ks <= m.start() and m.end() <= ke for ks, ke in kept):
            continue
        a = len(text[: m.start()].encode("utf-16-le")) // 2
        b = a + len(m.group(0).encode("utf-16-le")) // 2
        spans.append((a, b, m.group(0)))
    return spans


# --- narration -------------------------------------------------------------

def ensure_narrate_bin():
    if NARRATE_BIN.exists() and NARRATE_BIN.stat().st_mtime >= NARRATE_SRC.stat().st_mtime:
        return
    NARRATE_BIN.parent.mkdir(parents=True, exist_ok=True)
    log("  compiling narrate helper…")
    subprocess.run(["swiftc", "-O", str(NARRATE_SRC), "-o", str(NARRATE_BIN)], check=True)


def narrate(txt_path, raw_m4a, timing_json, text_sha):
    env = dict(os.environ, NARRATE_TIMEOUT_S=str(NARRATE_TIMEOUT_S))
    with tempfile.TemporaryDirectory() as tmp:
        caf, js = os.path.join(tmp, "a.caf"), os.path.join(tmp, "a.json")
        for attempt in range(1, MAX_TRIES + 1):
            p = subprocess.run([str(NARRATE_BIN), VOICE, str(txt_path), caf, js],
                               env=env, capture_output=True, text=True)
            # The helper writes whatever it has even when it gives up, so
            # done=true is the only proof the audio isn't cut short.
            if p.returncode == 0 and "done=true" in p.stderr:
                break
            log(f"    retry {attempt}: {txt_path.name}: {p.stderr.strip()[-200:]}")
        else:
            raise RuntimeError(f"narration failed for {txt_path.name}")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", caf, "-c:a", "aac", "-b:a", "64k",
                        str(raw_m4a)], check=True)
        timing = json.loads(Path(js).read_text())
    timing["textSha"] = text_sha
    Path(timing_json).write_text(json.dumps(timing))


# --- audio -----------------------------------------------------------------

def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1",
                          "-ar", str(RATE), "-"], check=True, capture_output=True).stdout
    a = array.array("f")
    a.frombytes(raw)
    return a


def encode(samples, out_path):
    tmp = str(out_path) + ".tmp.m4a"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "1",
                    "-i", "-", "-c:a", "aac", "-b:a", "32k", tmp],   # = the regular edition's
                   input=samples.tobytes(), check=True)
    os.replace(tmp, out_path)   # never leave a half-written chapter behind


def rms(samples, i, n):
    seg = samples[i:i + n]
    return math.sqrt(sum(x * x for x in seg) / len(seg)) if seg else 0.0


def speech_end(samples, start, limit):
    """First moment after start (and at least MIN_WORD_S in) where the audio
    stays quiet for SILENCE_RUN_S; `limit` if it never does."""
    hop = int(0.01 * RATE)
    need = int(SILENCE_RUN_S / 0.01)
    i, quiet = start + int(MIN_WORD_S * RATE), 0
    while i + hop <= limit:
        if rms(samples, i, hop) < SILENCE_RMS:
            quiet += 1
            if quiet >= need:
                return i - (need - 1) * hop
        else:
            quiet = 0
        i += hop
    return limit


# --- span -> time ----------------------------------------------------------

def locate(span, words, total_ms):
    """(onset_ms, next_onset_ms, method) for a UTF-16 span."""
    a, b, _ = span
    exact = next((i for i, w in enumerate(words) if w["charStart"] == a), None)
    if exact is not None:
        i, onset, method = exact, words[exact]["timeMs"], "exact"
    else:
        # Inside a multi-word callback: interpolate by character position
        # between its onset and the next later callback.
        cover = [i for i, w in enumerate(words)
                 if w["charStart"] <= a < w["charStart"] + w["charLen"]]
        if not cover:
            return None
        i = min(cover, key=lambda k: words[k]["charLen"])
        w = words[i]
        if not re.search(r"[A-Za-z0-9]", w["word"][: a - w["charStart"]]):
            # Only silent punctuation before the word (“Fuck!” is one
            # callback starting at the quote mark): its onset IS the word's.
            onset, method = w["timeMs"], "exact"
        else:
            nxt = next((x["timeMs"] for x in words[i + 1:] if x["timeMs"] > w["timeMs"]), total_ms)
            onset = w["timeMs"] + (a - w["charStart"]) / max(w["charLen"], 1) * (nxt - w["timeMs"])
            method = "interp"
    nxt = next((x["timeMs"] for x in words[i + 1:]
                if x["charStart"] >= b and x["timeMs"] > onset), total_ms)
    return onset, nxt, method


def bleep(samples, s, e):
    n, fade = e - s, int(FADE_S * RATE)
    for k in range(n):
        env = min(1.0, k / fade, (n - 1 - k) / fade) if fade else 1.0
        samples[s + k] = TONE_AMP * env * math.sin(2 * math.pi * TONE_HZ * k / RATE)


def clean_chapter(txt_path, rx, words_sha, work, out_dir):
    stem = txt_path.stem
    text = txt_path.read_text(encoding="utf-8")
    text_sha = hashlib.sha256(text.encode()).hexdigest()
    out = out_dir / f"{stem}.m4a"
    stamp = work / f"{stem}.stamp"
    want = f"{text_sha} {words_sha} v{BLEEP_VERSION}"
    if out.exists() and stamp.exists() and stamp.read_text() == want:
        return stem, None, "cached"

    raw, tj = work / f"{stem}.raw.m4a", work / f"{stem}.timing.json"
    narrated = False
    if not (raw.exists() and tj.exists() and json.loads(tj.read_text()).get("textSha") == text_sha):
        narrate(txt_path, raw, tj, text_sha)
        narrated = True
    timing = json.loads(tj.read_text())
    samples = decode(raw)
    total_ms = len(samples) / RATE * 1000

    # Locate every span first, then merge overlapping/adjacent bleeps
    # ("fucking asshole") into one continuous tone.
    regions, rows = [], []
    for span in find_spans(text, rx):
        loc = locate(span, timing["words"], total_ms)
        if loc is None:
            rows.append([stem, span[2], "", "", "unlocated"])
            continue
        onset_ms, next_ms, method = loc
        pad = PAD_BEFORE_INTERP_S if method == "interp" else PAD_BEFORE_S
        s = max(0, int((onset_ms / 1000 - pad) * RATE))
        limit = min(len(samples), int(next_ms / 1000 * RATE))
        e = min(limit, speech_end(samples, int(onset_ms / 1000 * RATE), limit)
                + int(PAD_AFTER_S * RATE))
        e = max(e, s + int(MIN_WORD_S * RATE))
        flag = method if (e - s) / RATE <= SUSPECT_LONG_S else method + ",long"
        regions.append((s, e))
        rows.append([stem, span[2], f"{s / RATE:.2f}", f"{(e - s) / RATE * 1000:.0f}", flag])
    regions.sort()
    merged = []
    for s, e in regions:
        if merged and s <= merged[-1][1] + int(0.05 * RATE):
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    for s, e in merged:
        bleep(samples, s, e)

    encode(samples, out)
    (work / f"{stem}.report.tsv").write_text("\n".join("\t".join(r) for r in rows) + ("\n" if rows else ""))
    stamp.write_text(want)
    return stem, rows, "narrated+bleeped" if narrated else "re-bleeped"


def cmd_book(words_path, txt_dir, work, out_dir, jobs):
    txt_dir, work, out_dir = Path(txt_dir), Path(work), Path(out_dir)
    work.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    rx = load_words(words_path)
    words_sha = hashlib.sha256(Path(words_path).read_bytes()).hexdigest()
    ensure_narrate_bin()

    txts = sorted(txt_dir.glob("*.txt"))
    live = {t.stem for t in txts}
    for f in list(out_dir.glob("*.m4a")) + list(work.glob("*.*")):
        stem = f.name.split(".")[0]
        if stem not in live:            # chapter no longer exists in the book
            f.unlink()

    failed, total_bleeps, flagged = 0, 0, []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futs = {pool.submit(clean_chapter, t, rx, words_sha, work, out_dir): t for t in txts}
        for n, fut in enumerate(as_completed(futs), 1):
            t = futs[fut]
            try:
                stem, rows, how = fut.result()
            except Exception as ex:   # one bad chapter must not sink the book
                failed += 1
                log(f"    !! {t.stem}: {ex}")
                continue
            if rows is not None:
                total_bleeps += len(rows)
                flagged += [r for r in rows if r[4] != "exact"]
                log(f"    [{n}/{len(txts)}] {how}: {stem} ({len(rows)} bleeps)")
    log(f"    {total_bleeps} bleeps in changed chapters; "
        f"{len(flagged)} located approximately (see *.report.tsv in {work})")
    for r in flagged[:20]:
        log("      ~ " + "  ".join(r))
    return 1 if failed else 0


def cmd_samples(work, out_dir, dest, count):
    """One file of `count` bleeps with 2s of context each, to spot-check by ear
    that the tone covers the word and nothing else."""
    rows = []
    for rep in sorted(Path(work).glob("*.report.tsv")):
        rows += [l.split("\t") for l in rep.read_text().splitlines() if l and l.split("\t")[2]]
    # Every approximately-placed bleep, then random exact ones up to `count`.
    approx = [r for r in rows if r[4] != "exact"]
    exact = [r for r in rows if r[4] == "exact"]
    random.seed(1)
    picks = sorted(approx + random.sample(exact, max(0, min(count - len(approx), len(exact)))))
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for k, r in enumerate(picks):
            clip = os.path.join(tmp, f"{k:03d}.m4a")
            start = max(0.0, float(r[2]) - 2)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start}", "-t", "4.5",
                            "-i", str(Path(out_dir) / f"{r[0]}.m4a"),
                            "-af", "apad=pad_dur=0.8", "-c:a", "aac", "-b:a", "64k", clip], check=True)
            parts.append(clip)
            log(f"  {k + 1:2d}. {r[0]}  @{r[2]}s  “{r[1]}”")
        lst = os.path.join(tmp, "list.txt")
        Path(lst).write_text("".join(f"file '{p}'\n" for p in parts))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
                        "-c", "copy", dest], check=True)


if __name__ == "__main__":
    a = sys.argv[1:]
    jobs = int(a[a.index("--jobs") + 1]) if "--jobs" in a else 3
    count = int(a[a.index("--count") + 1]) if "--count" in a else 20
    if a[:1] == ["book"] and len(a) >= 5:
        sys.exit(cmd_book(a[1], a[2], a[3], a[4], jobs))
    if a[:1] == ["samples"] and len(a) >= 4:
        sys.exit(cmd_samples(a[1], a[2], a[3], count))
    print(__doc__, file=sys.stderr)
    sys.exit(2)
