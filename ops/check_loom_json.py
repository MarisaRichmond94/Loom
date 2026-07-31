"""Verify the .loom.json per-book snapshots parse and carry real content.

These are the only backup of the CYOA branch structure outside the DB — the
.pages/.txt/.docx exports don't represent choices at all. So "does it parse"
is not enough; we count chapters, choices, and words.
"""
import glob
import json
import os
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


root = sys.argv[1]
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

    status = "ok  " if chapters and words else "WARN"
    if not (chapters and words):
        failures += 1
    print(
        f"{status}  {name[:42]:44} v{version}  exported={exported}  "
        f"chapters={chapters:4}  choices={choices:3}  words={words:,}"
    )

print()
print(f"{len(files)} file(s), {failures} problem(s)")
sys.exit(1 if failures else 0)
