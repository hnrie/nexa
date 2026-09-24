#!/usr/bin/env python3
"""Turns the SQLite schema into the Postgres one.

The two are close: ids are numbers we generate ourselves, times are Unix
milliseconds, booleans are 0/1, and nothing uses a SQLite-only feature in a
column. What changes is the spelling of the types and a couple of table
options SQLite has and Postgres does not.
"""
import re, sys
from pathlib import Path

src = Path(sys.argv[1]).read_text()
out = []

# Only the type word is rewritten, never a column that happens to share the
# name: user_settings has a column called `blob`, which is not a type.
TYPES = [
    (r"\bINTEGER PRIMARY KEY\b", "BIGINT PRIMARY KEY"),
    (r"\bINTEGER\b", "BIGINT"),
    (r"\bBLOB\b", "BYTEA"),
    (r"\bREAL\b", "DOUBLE PRECISION"),
]


def retype(line):
    """Rewrites the types in one line of a table body, leaving names alone.

    A line may hold one column, or several when SQLite has folded in the ones a
    later ALTER TABLE added: ", a INTEGER, b BLOB);".
    """
    parts = re.split(r"(,)", line)
    out = []
    for part in parts:
        if part == ",":
            out.append(part)
            continue
        m = re.match(r"(\s*)([\"\w]+)(\s+)(.*)$", part, re.S)
        if not m:
            out.append(part)
            continue
        indent, name, gap, rest = m.groups()
        for pat, rep in TYPES:
            rest = re.sub(pat, rep, rest, flags=re.I)
        out.append(indent + name + gap + rest)
    return "".join(out)

for stmt in src.split(";\n"):
    s = stmt.strip()
    if not s:
        continue
    # SQLite's storage hint; Postgres has no such thing
    s = re.sub(r"\)\s*WITHOUT ROWID\s*$", ")", s, flags=re.I)
    s = re.sub(r"\bAUTOINCREMENT\b", "", s, flags=re.I)
    if re.match(r"CREATE TABLE", s, re.I):
        # a table body: the first word of each line is a column name
        head, _, body = s.partition("(")
        lines = body.split("\n")
        s = head + "(" + "\n".join(
            retype(l) if l.startswith((" ", "\t", ",")) else l for l in lines
        )
    else:
        for pat, rep in TYPES:
            s = re.sub(pat, rep, s, flags=re.I)
    # SQLite quotes a table it rebuilt during a migration; Postgres needs no quotes
    s = re.sub(r'(CREATE TABLE (?:IF NOT EXISTS )?)"(\w+)"', r"\1\2", s, flags=re.I)
    # "now" in a default or a migration
    s = s.replace("CAST(strftime('%s', 'now') AS BIGINT) * 1000",
                  "(EXTRACT(EPOCH FROM now()) * 1000)::BIGINT")
    # Postgres wants IF NOT EXISTS spelled the same way; keep what is there
    out.append(s + ";")

header = """-- The schema chatd runs on Postgres, generated from the SQLite one
-- (internal/db/migrations) so the two cannot drift: same tables, same columns,
-- same indexes, same foreign keys.
--
-- Ids are snowflakes this process generates, not sequences, so every id column
-- is a plain BIGINT with no default. Times are Unix milliseconds. Booleans are
-- 0/1 BIGINTs, as they are in SQLite, so every query reads the same either way.
--
-- Do not edit by hand: run tools/gen_pg_schema.sh.
"""

# A table that only takes new rows refuses the rest with a trigger. SQLite
# writes that as RAISE(ABORT) in the trigger's own body; Postgres keeps the
# body in a function, so one shared function does the refusing and each
# trigger hands it the message.
REFUSE = re.compile(
    r"CREATE TRIGGER (\w+) BEFORE (UPDATE|DELETE) ON (\w+)\s+BEGIN\s+SELECT RAISE\(ABORT,\s*'([^']*)'\);\s*END;$",
    re.I | re.S,
)
REFUSE_FUNCTION = """CREATE OR REPLACE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%', TG_ARGV[0];
END
$$;"""

# Postgres needs a table to exist before another references it, so the tables
# come out in dependency order rather than the alphabetical one SQLite lists
# them in, and every index follows the lot.
tables, indexes, other, triggers = {}, [], [], []
for s in out:
    m = re.match(r'CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?', s, re.I)
    t = REFUSE.match(s)
    if m:
        tables[m.group(1)] = s
    elif re.match(r"CREATE (?:UNIQUE )?INDEX", s, re.I):
        indexes.append(s)
    elif t:
        name, event, table, message = t.groups()
        triggers.append(f"CREATE TRIGGER {name} BEFORE {event.upper()} ON {table} FOR EACH ROW EXECUTE FUNCTION refuse_change('{message}');")
    elif re.match(r"CREATE TRIGGER", s, re.I):
        sys.exit(f"pg_schema.py: no Postgres translation for trigger:\n{s}")
    else:
        other.append(s)
if triggers:
    other += [REFUSE_FUNCTION] + triggers

def refs(body, name):
    found = set(re.findall(r"REFERENCES\s+(\w+)", body, re.I))
    found.discard(name)
    return {f for f in found if f in tables}

ordered, seen = [], set()

def visit(name, stack=()):
    if name in seen:
        return
    if name in stack:
        # a cycle: emit it anyway and let the constraint sort itself out
        return
    for dep in sorted(refs(tables[name], name)):
        visit(dep, stack + (name,))
    if name not in seen:
        seen.add(name)
        ordered.append(tables[name])

for name in sorted(tables):
    visit(name)

print(header)
print("\n\n".join(ordered + indexes + other))
