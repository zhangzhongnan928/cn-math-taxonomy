# Data format (au/data)

The Australian edition is a separate, English-only site under `au/`. It shares nothing at runtime with the Chinese site except the vendored libraries in `assets/vendor/` and the icons. Its data lives in `au/data/`:

| File | Content |
|---|---|
| `topics.json` | Array of knowledge points (Mathematics and English, Kindergarten to Year 6) |
| `dependencies.json` | Array of prerequisite edges |
| `questions.json` | Array of diagnostic questions (4 per topic) |
| `standards.json` | `{ "source": {...}, "items": [...] }` curriculum outcomes and content descriptions the topics map to |

## Years and subjects

- `year` is an integer: `0` = Kindergarten (NSW name for the first year of school; Foundation in the Australian Curriculum), `1`–`6` = Year 1–Year 6.
- NSW stages: Early Stage 1 = K, Stage 1 = Years 1–2, Stage 2 = Years 3–4, Stage 3 = Years 5–6.
- `subject` is `"maths"` or `"english"`. The two graphs are not connected: no edge crosses subjects.

## topics.json

```json
{
  "id": "aum_y1_04",
  "subject": "maths",
  "year": 1,
  "strand": "Number",
  "focusArea": "Representing whole numbers",
  "name": "Counting to 120",
  "type": "procedural",
  "description": "Counts forwards and backwards by ones from any starting point up to 120.",
  "mastery_criteria": ["Counts on from any number to 120", "Counts back from any number within 120"],
  "standards": [{ "id": "MA1-RWN-01", "confidence": "exact" }, { "id": "AC9M1N01", "confidence": "exact" }],
  "external": false
}
```

| Field | Rule |
|---|---|
| `id` | `aum_<k|y1..y6>_<NN>` for maths, `aue_<k|y1..y6>_<NN>` for English. `NN` is two digits, in teaching order within the year. Never reuse or renumber an id once published. |
| `subject`, `year` | As above. |
| `strand` | Maths: one of `Number`, `Algebra`, `Measurement`, `Space`, `Statistics`, `Probability`. English: one of `Phonological awareness`, `Phonics and word recognition`, `Spelling`, `Vocabulary`, `Grammar and punctuation`, `Reading comprehension`, `Text and literature`. |
| `focusArea` | The NSW syllabus focus area the topic belongs to (for example `Additive relations`, `Reading comprehension`), written exactly as the syllabus names it. |
| `name` | Short, sentence case, no full stop, at most 60 characters. Unique within the subject. |
| `type` | `conceptual`, `procedural`, `reasoning` or `application`. |
| `description` | One or two sentences, Australian English, what the student can do. |
| `mastery_criteria` | 2–3 observable statements. |
| `standards` | 1–3 entries. At least one NSW syllabus outcome code; add the matching Australian Curriculum v9 content description code when there is one. `confidence` is `exact` (the outcome or descriptor states this) or `inferred`. Every id must exist in `standards.json`. |
| `root_reason` | Required only when the topic has no prerequisite: one sentence on why nothing earlier is needed. |
| `external` | Always `false` (kept for engine compatibility). |

## dependencies.json

```json
{ "topicId": "aum_y1_05", "prerequisiteId": "aum_y1_04", "strength": "hard", "reason": "Skip counting by tens to 120 needs counting by ones to 120." }
```

- `strength`: `hard` = cannot learn the topic without it; `soft` = helps, but is not required.
- The prerequisite is in the same year or an earlier year, same subject. The graph must be acyclic.
- Prefer the nearest real prerequisite over a distant one (no transitive shortcuts).
- `reason` is one plain English sentence.

## questions.json

```json
{
  "id": "aum_y1_04_q1",
  "topicId": "aum_y1_04",
  "difficulty": "basic",
  "type": "numeric",
  "prompt": "What number comes just after 109?",
  "answer": "110",
  "explanation": "Counting on by one from 109 gives 110.",
  "verify": "109 + 1"
}
```

| Field | Rule |
|---|---|
| `id` | `<topicId>_q<N>`, N = 1..4 (5 allowed). |
| `difficulty` | `basic`, `standard` or `advanced`. Each topic has at least two `basic` and at least one `standard`; `q1` is never `advanced`. |
| `type` | `numeric` (a number), `choice` (3–4 options), `short` (a short word or phrase, exact match after normalising case and spaces), `self` (open answer, the child or parent compares with the reference; avoid). |
| `prompt` | Self-contained. Units go in the prompt, the answer has no unit. Australian English spelling (colour, centre, metre, litre, maths), Australian money (dollars and cents), metric units, Australian everyday contexts. K–Year 2 prompts are short (about 20 words at most) and use decodable, everyday words, because they are read aloud to the child. |
| `say` | Optional. Text that the read-aloud button speaks instead of the prompt. Use it for spelling dictation and sound questions where the prompt must not show the word, e.g. prompt `Listen, then type the word you hear.`, say `ship. The ship sailed out of the harbour. ship.` |
| `answer` | String. numeric: one number (integer, decimal, fraction `a/b` or mixed numeral `2 3/4`); choice: the option letter; short: the canonical answer. |
| `accept` | Optional list of other accepted answers (short and numeric). |
| `choices` | Required for `choice`: `[{"key":"A","text":"…"}, …]`, keys A, B, C, D in order, texts distinct. The correct letter should vary across a topic's questions. |
| `figure` | Optional inline SVG string (`<svg viewBox=…>`, uses `currentColor`, no external references, no script). |
| `explanation` | 1–3 sentences shown after answering, kind and plain. |
| `verify` | numeric: a Python expression that evaluates to the answer (`"109 + 1"`, `"Fraction(3, 4)"`). choice and short: the correct answer text as a Python string literal (`"'ship'"`). Checked by `au/scripts/validate.py`. |
| `readChoices` | Optional, `false` on choice items where hearing the options would give the answer away (spelling, decoding, punctuation). The read-aloud button then reads only the prompt. Set automatically for English choice items in the Spelling and Phonics strands, punctuation topics, and options that differ only slightly. |
| `readAloud` | Optional, `false` on reading items from Year 3 with a passage in the prompt: no read-aloud button, so the item tests reading rather than listening. |
| `unordered` | numeric with several answers where order does not matter. |

## standards.json

```json
{
  "source": { "nsw-maths": {...}, "nsw-english": {...}, "ac9-maths": {...}, "ac9-english": {...} },
  "items": [
    { "id": "MA1-RWN-01", "framework": "nsw-maths", "subject": "maths", "stage": "S1", "years": [1, 2],
      "focusArea": "Representing whole numbers", "text": "…verbatim outcome…", "url": "https://…", "verbatim": true }
  ]
}
```

`id` is the official code (NSW outcome codes such as `MA1-RWN-01`, `EN1-SPELL-01`; Australian Curriculum v9 codes such as `AC9M1N01`, `AC9E1LY09`). `verbatim: true` only when `text` was copied from the official page on the date in `source`.
