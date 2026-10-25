# K–6 Learning Map (NSW Maths & English)

An English-language, Australian edition of the knowledge graph and adaptive check-up in this repository, built for primary school children in New South Wales. It covers **Kindergarten to Year 6** in two subjects, **Mathematics** and **English**, aligned to the NSW syllabuses (2022) with Australian Curriculum v9 codes as a second mapping.

Open `au/` on the site (for example `https://<site>/au/`). It is a separate site: nothing in it depends on the Chinese pages, apart from the shared vendor libraries and icons.

## What it does

- **Skill map** (`au/explore/`): every skill as a node, prerequisites as edges, with the NSW outcome and AC v9 content description it maps to, and sample questions.
- **Check-up** (`au/diagnose/`): pick a skill or a whole year. The check-up asks about the skill first. A wrong answer gets a second, easier question; a second miss walks back along the prerequisites until it finds where the gap starts. The result lists what to practise next, earliest year first.
- **Kids** (`au/kids/`): one profile per child (Kindergarten to Year 6). Check-ups are saved per child, on this device only. To create profiles in one step, open `au/kids/?add=Name:1,OtherName:6` (`K` for Kindergarten). Names live only in that link and in the browser's local storage, never in the repository.
- **Read-aloud**: every question has a 🔊 button (speech synthesis, Australian voice when available), on by default for Kindergarten to Year 2. Spelling dictation speaks the word without showing it. Items where hearing the options would give the answer away (spelling, decoding, punctuation) read only the prompt, and reading-comprehension passages from Year 3 are not read aloud.
- Works on iPad and phones, and can be added to the home screen (PWA, scope `au/`). On iPad and iPhone the home-screen app keeps its own storage, separate from Safari: add it to the home screen first, then add the kids inside the app.
- Whole-year check-ups take turns across strands in teaching order, starting with an easy core skill (24 questions by default for K–Year 2, 40 from Year 3).

## What is in the data

| | Skills | Prerequisite links | Questions |
|---|---:|---:|---:|
| Mathematics K–6 | 224 | 331 | 896 |
| English K–6 | 178 | 243 | 712 |

- Skills per year, maths: K 26, Y1 29, Y2 34, Y3 33, Y4 35, Y5 34, Y6 33. English: K 31, Y1 19, Y2 34, Y3 22, Y4 25, Y5 24, Y6 23.
- 442 curriculum items in `data/standards.json`, copied verbatim from the official sites on 2026-10-24: NSW Mathematics K–10 (74 outcomes), NSW English K–10 (40 outcomes), AC v9 Mathematics F–6 (139 content descriptions) and AC v9 English F–6 (189). Sources and caveats: [docs/curriculum-sources.md](docs/curriculum-sources.md).
- Questions: 1047 multiple choice, 483 numeric, 71 short answer (mostly spelling dictation), 7 parent-marked read-aloud checks for early decoding; 279 have a drawn figure.
- Format: [docs/data-format.md](docs/data-format.md).

## How skills were placed and what is left out

- Year placement follows the NSW stage first (Early Stage 1 = K, Stage 1 = Years 1–2, Stage 2 = Years 3–4, Stage 3 = Years 5–6). Within a stage, the AC v9 year decides; where AC v9 puts content later than NSW, the skill sits in the NSW stage and its AC v9 code is marked `inferred`.
- Every AC v9 maths description F–6 and every NSW maths outcome K–Stage 3 is covered. 32 hands-on NSW maths dot points (building models, collecting data, using a protractor) are not testable on screen and are left out.
- English leaves out what a screen cannot check: speaking and listening, handwriting, extended writing and reading fluency rate. 141 of 189 AC v9 English descriptions and 27 of 40 NSW English outcomes are covered.

## Status and checks

**This is an AI-generated first draft. No teacher has reviewed it.** Skill boundaries, year placement, prerequisite links and answer keys need review by a NSW primary teacher before they are used for teaching decisions.

Checks that were run:

- `python3 au/scripts/validate.py`: schema, ids, curriculum codes, acyclic graph, prerequisite year order, 4 questions per skill with the difficulty mix the engine needs, `verify` expressions recomputed against every numeric answer, duplicate prompts, Australian spelling. Passes with 0 errors.
- `node au/tests/test_engine.js`: engine unit tests plus property tests on the real data (a simulated student who knows exactly a given set of skills is diagnosed exactly; every answer key is marked correct by the engine). 77 passing.
- Every question was solved again by an independent reviewer who saw only what the child sees (no answer key), with every figure rendered. Across all 1608 questions this found 1 wrong answer key (fixed) and 32 flagged items: ambiguous wording, possibly above year level, or giving the answer away when read aloud. 26 were fixed or guarded; the other 6 were year-level flags that the NSW syllabus places in that year (for example millimetres and tenths in Year 3), so they stayed.

## Known limitations

- Numeric answers are compared by value, so where a question asks for a particular form (a decimal, a mixed numeral) an equivalent form is also accepted. Fill-the-gap and multiple-choice items are used where the form is the point.
- Read-aloud was tested with a simulated speech engine; it has not been heard on a real iPad yet.

## Running locally

```sh
python3 -m http.server 8000   # from the repository root
# open http://localhost:8000/au/
node au/tests/test_engine.js
python3 au/scripts/validate.py
```
