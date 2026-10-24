#!/usr/bin/env python3
"""Validate the Australian edition data in au/data (standard library only).

Usage: python3 au/scripts/validate.py [--warn-only]
Prints "VALIDATION PASSED" and exits 0 when there are no errors.
Warnings (style, possible redundancy) never change the exit code.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from fractions import Fraction
import math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

SUBJECT_PREFIX = {"maths": "aum", "english": "aue"}
STRANDS = {
    "maths": {"Number", "Algebra", "Measurement", "Space", "Statistics", "Probability"},
    "english": {
        "Phonological awareness", "Phonics and word recognition", "Spelling", "Vocabulary",
        "Grammar and punctuation", "Reading comprehension", "Text and literature",
    },
}
TYPES = {"conceptual", "procedural", "reasoning", "application"}
Q_TYPES = {"numeric", "choice", "short", "self"}
DIFFS = {"basic", "standard", "advanced"}
YEAR_TAG = {0: "k", 1: "y1", 2: "y2", 3: "y3", 4: "y4", 5: "y5", 6: "y6"}
ID_RE = re.compile(r"^(aum|aue)_(k|y[1-6])_(\d{2})$")
QID_RE = re.compile(r"^(.+)_q([1-5])$")
CJK_RE = re.compile(r"[　-〿㐀-鿿＀-￯]")
# American spellings that should be Australian. Word-boundary matched, case-insensitive.
US_SPELLINGS = {
    r"\bcolor": "colour", r"\bcenter": "centre", r"\bmeters?\b": "metre", r"\bliters?\b": "litre",
    r"\bcentimeters?\b": "centimetre", r"\bmillimeters?\b": "millimetre", r"\bkilometers?\b": "kilometre",
    r"\bmilliliters?\b": "millilitre", r"\bfavorite": "favourite", r"\bbehavior": "behaviour",
    r"\bneighbor": "neighbour", r"\bgray\b": "grey", r"\bmath\b": "maths", r"\borganiz": "organis",
    r"\brecogniz": "recognis", r"\bcategoriz": "categoris", r"\bsummariz": "summaris",
    r"\banalyz": "analys", r"\bfavor\b": "favour", r"\bhonor": "honour", r"\blabeled": "labelled",
    r"\bmodeled": "modelled", r"\btraveled": "travelled", r"\bjewelry": "jewellery",
    r"\bcheck\b(?=.*\bbank\b)": "cheque", r"\bfall\b(?= season)": "autumn",
    r"\bcandy\b": "lollies", r"\bcookies?\b": "biscuit", r"\bsoccer\b": None,
    r"\bpennies\b|\bpenny\b|\bnickels?\b|\bdimes?\b|\bquarters? \(coin\)": "Australian coins",
    r"\binch(es)?\b|\bfeet\b|\bfoot\b(?! of)|\bpounds?\b|\bounces?\b|\bmiles?\b|\bfahrenheit\b": "metric units",
}
SKIP_US_IN_ENGLISH_ITEMS = True  # English questions may deliberately show wrong spellings as distractors

errors = []
warnings = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def load(name, default=None):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        if default is not None:
            return default
        err(f"missing file au/data/{name}")
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def safe_eval(expr):
    env = {"Fraction": Fraction, "math": math, "round": round, "abs": abs, "min": min, "max": max,
           "sum": sum, "len": len, "int": int, "float": float, "str": str, "sorted": sorted}
    return eval(expr, {"__builtins__": {}}, env)  # noqa: S307 (trusted repo data)


def to_fraction(s):
    s = str(s).strip().replace(",", "")
    m = re.fullmatch(r"(-?\d+) (\d+)/(\d+)", s)
    if m:
        whole, n, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return Fraction(whole) + (Fraction(n, d) if whole >= 0 else -Fraction(n, d))
    return Fraction(s)


def norm_text(s):
    s = str(s).strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s.rstrip(".")


def all_text(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, list):
        for x in obj:
            yield from all_text(x)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("figure", "verify"):
                continue
            yield from all_text(v)


def main():
    topics = load("topics.json")
    deps = load("dependencies.json")
    questions = load("questions.json")
    standards = load("standards.json")
    if None in (topics, deps, questions, standards):
        return finish()

    std_ids = {it["id"] for it in standards.get("items", [])}
    std_dupes = [k for k, v in Counter(it["id"] for it in standards.get("items", [])).items() if v > 1]
    for k in std_dupes:
        err(f"standards: duplicate id {k}")
    for it in standards.get("items", []):
        for f in ("id", "framework", "subject", "text"):
            if not it.get(f):
                err(f"standards {it.get('id')}: missing {f}")

    by_id = {}
    names = defaultdict(set)
    for t in topics:
        tid = t.get("id", "?")
        if tid in by_id:
            err(f"{tid}: duplicate topic id")
        by_id[tid] = t
        m = ID_RE.match(tid)
        subj = t.get("subject")
        if subj not in SUBJECT_PREFIX:
            err(f"{tid}: bad subject {subj!r}")
            continue
        if not m:
            err(f"{tid}: id does not match aum_/aue_<k|yN>_NN")
        else:
            if m.group(1) != SUBJECT_PREFIX[subj]:
                err(f"{tid}: id prefix does not match subject {subj}")
            if YEAR_TAG.get(t.get("year")) != m.group(2):
                err(f"{tid}: id year tag does not match year {t.get('year')}")
        if t.get("strand") not in STRANDS[subj]:
            err(f"{tid}: strand {t.get('strand')!r} not allowed for {subj}")
        for f in ("focusArea", "name", "description"):
            if not isinstance(t.get(f), str) or not t[f].strip():
                err(f"{tid}: missing {f}")
        if len(t.get("name", "")) > 60:
            err(f"{tid}: name longer than 60 characters")
        if t.get("name", "").endswith("."):
            warn(f"{tid}: name ends with a full stop")
        key = norm_text(t.get("name", ""))
        if key in names[subj]:
            err(f"{tid}: duplicate name {t.get('name')!r} in {subj}")
        names[subj].add(key)
        if t.get("type") not in TYPES:
            err(f"{tid}: bad type {t.get('type')!r}")
        mc = t.get("mastery_criteria")
        if not isinstance(mc, list) or not 2 <= len(mc) <= 3:
            err(f"{tid}: mastery_criteria must have 2-3 items")
        st = t.get("standards")
        if not isinstance(st, list) or not 1 <= len(st) <= 3:
            err(f"{tid}: standards must have 1-3 entries")
            st = []
        has_nsw = False
        for s in st:
            if s.get("id") not in std_ids:
                err(f"{tid}: unknown standard {s.get('id')}")
            if s.get("confidence") not in ("exact", "inferred"):
                err(f"{tid}: bad confidence on {s.get('id')}")
            if re.match(r"^(MA|EN)", str(s.get("id"))):
                has_nsw = True
        if st and not has_nsw:
            err(f"{tid}: needs at least one NSW outcome code")
        if t.get("external") is not False:
            err(f"{tid}: external must be false")
        for txt in all_text(t):
            if CJK_RE.search(txt):
                err(f"{tid}: contains CJK characters")
                break

    # ------------------------------------------------------------ edges
    prereqs = defaultdict(list)
    seen = set()
    for d in deps:
        a, b = d.get("topicId"), d.get("prerequisiteId")
        tag = f"edge {a} <- {b}"
        if a not in by_id or b not in by_id:
            err(f"{tag}: unknown topic")
            continue
        if a == b:
            err(f"{tag}: self loop")
        if (a, b) in seen:
            err(f"{tag}: duplicate")
        seen.add((a, b))
        if d.get("strength") not in ("hard", "soft"):
            err(f"{tag}: bad strength")
        if not d.get("reason"):
            err(f"{tag}: missing reason")
        if by_id[a]["subject"] != by_id[b]["subject"]:
            err(f"{tag}: crosses subjects")
        if by_id[b]["year"] > by_id[a]["year"]:
            err(f"{tag}: prerequisite is in a later year")
        if by_id[a]["year"] - by_id[b]["year"] > 2:
            warn(f"{tag}: spans {by_id[a]['year'] - by_id[b]['year']} years")
        prereqs[a].append(b)

    # cycle check (iterative DFS)
    state = {}
    order = []
    for start in by_id:
        if start in state:
            continue
        stack = [(start, iter(prereqs[start]))]
        state[start] = 1
        while stack:
            node, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                state[node] = 2
                order.append(node)
                stack.pop()
            elif state.get(nxt) == 1:
                err(f"cycle through {nxt} and {node}")
            elif nxt not in state:
                state[nxt] = 1
                stack.append((nxt, iter(prereqs[nxt])))

    anc = {}
    for node in order:  # prerequisites first
        s = set()
        for p in prereqs[node]:
            s.add(p)
            s |= anc.get(p, set())
        anc[node] = s
    for a, ps in prereqs.items():
        for b in ps:
            if any(b in anc.get(c, set()) for c in ps if c != b):
                warn(f"edge {a} <- {b}: redundant (implied through another prerequisite)")

    for tid, t in by_id.items():
        if not prereqs[tid] and not t.get("root_reason"):
            if not (t["year"] == 0):
                err(f"{tid}: no prerequisites and no root_reason")
            else:
                warn(f"{tid}: Kindergarten root without root_reason")
    dependents = Counter(b for ps in prereqs.values() for b in ps)
    for tid, t in by_id.items():
        if not prereqs[tid] and not dependents[tid]:
            warn(f"{tid}: isolated topic (no edges)")

    # ------------------------------------------------------------ questions
    qs_by_topic = defaultdict(list)
    qids = set()
    prompts = defaultdict(list)
    for q in questions:
        qid = q.get("id", "?")
        if qid in qids:
            err(f"{qid}: duplicate question id")
        qids.add(qid)
        m = QID_RE.match(qid)
        if not m or m.group(1) != q.get("topicId"):
            err(f"{qid}: id must be <topicId>_q<N>")
        if q.get("topicId") not in by_id:
            err(f"{qid}: unknown topic")
            continue
        t = by_id[q["topicId"]]
        qs_by_topic[q["topicId"]].append(q)
        typ = q.get("type")
        if typ not in Q_TYPES:
            err(f"{qid}: bad type {typ!r}")
        if q.get("difficulty") not in DIFFS:
            err(f"{qid}: bad difficulty")
        for f in ("prompt", "answer", "explanation"):
            if not isinstance(q.get(f), str) or not q[f].strip():
                err(f"{qid}: missing {f}")
        for txt in all_text(q):
            if CJK_RE.search(txt):
                err(f"{qid}: contains CJK characters")
                break
        prompts[(t["subject"], norm_text(q.get("prompt", "")), q.get("say", ""), q.get("figure", ""),
                 tuple(norm_text(c.get("text", "")) for c in q.get("choices", [])))].append(qid)
        words = len(q.get("prompt", "").split())
        if t["year"] <= 2 and words > 30:
            warn(f"{qid}: K-2 prompt has {words} words")
        if t["subject"] == "maths" or not SKIP_US_IN_ENGLISH_ITEMS:
            blob = " ".join(all_text(q))
            for pat, fix in US_SPELLINGS.items():
                if fix and re.search(pat, blob, re.I):
                    warn(f"{qid}: possible non-Australian usage /{pat}/ -> {fix}")
        ans = q.get("answer", "")
        ver = q.get("verify")
        if typ == "choice":
            ch = q.get("choices")
            if not isinstance(ch, list) or not 3 <= len(ch) <= 4:
                err(f"{qid}: choice needs 3-4 options")
                continue
            keys = [c.get("key") for c in ch]
            if keys != list("ABCD"[: len(ch)]):
                err(f"{qid}: choice keys must be A, B, C(, D) in order")
            texts = [re.sub(r"\s+", " ", c.get("text", "")).strip() for c in ch]
            if len(set(texts)) != len(texts) and not all(c.get("figure") for c in ch):
                err(f"{qid}: duplicate choice texts")
            if ans not in keys:
                err(f"{qid}: answer {ans!r} is not a choice key")
            elif ver is not None:
                try:
                    v = safe_eval(ver)
                    right = next(c for c in ch if c["key"] == ans)["text"]
                    if norm_text(v) != norm_text(right):
                        err(f"{qid}: verify {v!r} != correct choice text {right!r}")
                except Exception as e:  # noqa: BLE001
                    err(f"{qid}: verify failed: {e}")
        elif typ == "numeric":
            parts = [p.strip() for p in re.split(r"[;,](?!\d{3}\b)", ans)] if re.search(r"[;]", ans) else [ans]
            try:
                vals = [to_fraction(p) for p in parts]
            except Exception:  # noqa: BLE001
                err(f"{qid}: numeric answer {ans!r} is not a number")
                vals = None
            if ver is None:
                err(f"{qid}: numeric question without verify")
            elif vals is not None:
                try:
                    v = safe_eval(ver)
                    got = list(v) if isinstance(v, (list, tuple)) else [v]
                    got = [Fraction(x).limit_denominator(10**6) if isinstance(x, float) else Fraction(x) for x in got]
                    if q.get("unordered"):
                        ok = sorted(got) == sorted(vals)
                    else:
                        ok = got == vals
                    if not ok:
                        err(f"{qid}: verify {ver!r} = {got} but answer is {ans!r}")
                except Exception as e:  # noqa: BLE001
                    err(f"{qid}: verify failed: {e}")
        elif typ == "short":
            if ver is not None:
                try:
                    v = safe_eval(ver)
                    refs = [ans] + list(q.get("accept", []))
                    if norm_text(v) not in {norm_text(r) for r in refs}:
                        err(f"{qid}: verify {v!r} not in answer/accept")
                except Exception as e:  # noqa: BLE001
                    err(f"{qid}: verify failed: {e}")
            if len(ans.split()) > 4:
                warn(f"{qid}: short answer has more than 4 words (hard to auto-mark)")
        elif typ == "self":
            warn(f"{qid}: self-marked question")
        if q.get("figure"):
            fig = q["figure"]
            if not fig.startswith("<svg") or re.search(r"<\s*script|foreignObject|<\s*image\b|https?://(?!www\.w3\.org/2000/svg)", fig, re.I):
                err(f"{qid}: figure must be a plain inline SVG")
        if "say" in q and not str(q["say"]).strip():
            err(f"{qid}: empty say")

    for key, ids in prompts.items():
        if len(ids) > 1:
            err(f"duplicate prompt in {key[0]}: {', '.join(ids)}")

    for tid in by_id:
        qs = sorted(qs_by_topic.get(tid, []), key=lambda q: q["id"])
        if not 4 <= len(qs) <= 5:
            err(f"{tid}: has {len(qs)} questions (need 4-5)")
            continue
        nums = sorted(int(QID_RE.match(q["id"]).group(2)) for q in qs)
        if nums != list(range(1, len(qs) + 1)):
            err(f"{tid}: question numbers are not 1..{len(qs)}")
        diffs = Counter(q["difficulty"] for q in qs)
        if diffs["basic"] < 2:
            err(f"{tid}: needs at least two basic questions")
        if diffs["standard"] < 1:
            err(f"{tid}: needs at least one standard question")
        q1 = next((q for q in qs if q["id"].endswith("_q1")), None)
        if q1 and q1["difficulty"] == "advanced":
            err(f"{tid}: q1 must not be advanced")
        letters = [q["answer"] for q in qs if q.get("type") == "choice"]
        if len(letters) >= 3 and len(set(letters)) == 1:
            warn(f"{tid}: every choice answer is {letters[0]}")

    return finish(by_id, deps, questions)


def finish(by_id=None, deps=None, questions=None):
    if by_id is not None:
        c = Counter((t["subject"], t["year"]) for t in by_id.values())
        print("topics per subject/year:", dict(sorted(c.items())))
        print(f"topics {len(by_id)}, edges {len(deps)}, questions {len(questions)}")
    for w in warnings[:200]:
        print("WARNING", w)
    if len(warnings) > 200:
        print(f"... {len(warnings) - 200} more warnings")
    for e in errors[:300]:
        print("ERROR", e)
    if len(errors) > 300:
        print(f"... {len(errors) - 300} more errors")
    print(f"{len(errors)} errors, {len(warnings)} warnings")
    if errors and "--warn-only" not in sys.argv:
        sys.exit(1)
    print("VALIDATION PASSED" if not errors else "VALIDATION FAILED (warn-only)")


if __name__ == "__main__":
    main()
