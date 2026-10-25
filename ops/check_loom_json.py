"""Verify the .loom.json per-book snapshots parse and carry real content.

These are the only backup of the CYOA branch structure outside the DB — the
.pages/.txt/.docx exports don't represent choices at all. So "does it parse"
is not enough; we count chapters, choices, and words.

Usage: check_loom_json.py <loom-json-dir> [<path/to/dev.db>]

An export with no chapters is a failure, EXCEPT when Loom's database agrees
the book has none (a book created ahead of being written). That needs the db:
without it, or when the book can't be found there, an empty export still fails.
Checked against the db rather than waved through, because "the export dropped
every chapter" also comes out as chapters=0, and must keep failing.
"""
import glob
import json
import os
import sqlite3
import sys


def walk_words(node):
    """Count words in TipTap text nodes.

    The payload carries prose as blocks[].content and has no wordCount field
    of its own, so counting text nodes is the only way to confirm the prose
    survived rather than just the structure.

    Note: blocks[].content is a JSON *string* holding the TipTap doc, not a
    nested object, so strings that look like documents get parsed one more
    level down. Miss that and every count comes back zero.
    """
    total = 0
    if isinstance(node, dict):
        if node.get("type") == "text" and isinstance(node.get("text"), str):
            total += len(node["text"].split())
        for v in node.values():
            total += walk_words(v)
    elif isinstance(node, list):
        for v in node:
            total += walk_words(v)
    elif isinstance(node, str) and node.startswith('{"type":'):
        try:
            total += walk_words(json.loads(node))
        except json.JSONDecodeError:
            pass
    return total


def count_key(node, key):
    n = 0
    if isinstance(node, dict):
        if key in node and isinstance(node[key], list):
            n += len(node[key])
        for v in node.values():
            n += count_key(v, key)
    elif isinstance(node, list):
        for v in node:
            n += count_key(v, key)
    return n


def db_chapter_counts(db_path):
    """book id -> chapter count, from Loom's db (read-only), or None if unreadable.

    Read-only with a short timeout: a reader holds dev.db's rollback journal
    lock, so this must stay one small query and never wait on the editor.
    """
    if not db_path or not os.path.exists(db_path):
        return None
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
        try:
            rows = con.execute(
                "SELECT b.id, COUNT(c.id) FROM Book b LEFT JOIN Chapter c ON c.bookId = b.id GROUP BY b.id"
            ).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return None
    return dict(rows)


def unwritten(doc, counts):
    """True if every book in this export has no chapters in the db either."""
    if counts is None:
        return False
    books = (doc.get("series") or {}).get("books") or []
    return bool(books) and all(counts.get(b.get("_ref")) == 0 for b in books)


root = sys.argv[1]
counts = db_chapter_counts(sys.argv[2] if len(sys.argv) > 2 else None)
files = sorted(glob.glob(os.path.join(root, "*", "*.loom.json")))
if not files:
    sys.exit("no .loom.json files found under " + root)

failures = 0
for path in files:
    name = os.path.basename(path)
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except Exception as exc:  # noqa: BLE001 - drill wants the reason, not a trace
        print(f"FAIL  {name}: {exc}")
        failures += 1
        continue

    chapters = count_key(doc, "chapters")
    choices = count_key(doc, "choices")
    words = walk_words(doc)
    version = doc.get("loomVersion")
    exported = doc.get("exportedAt", "?")[:19]

    if chapters and words:
        status = "ok  "
    elif chapters == 0 and unwritten(doc, counts):
        status = "empty"  # no chapters written yet, and the db agrees
    else:
        status = "WARN"
        failures += 1
    print(
        f"{status}  {name[:42]:44} v{version}  exported={exported}  "
        f"chapters={chapters:4}  choices={choices:3}  words={words:,}"
    )

print()
print(f"{len(files)} file(s), {failures} problem(s)")
sys.exit(1 if failures else 0)
