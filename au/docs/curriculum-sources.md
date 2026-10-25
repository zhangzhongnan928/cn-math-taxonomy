# Curriculum sources (au edition)

Checked on 2026-10-24. Everything in `au/data/standards.json` was copied from the official sites by script, not typed from memory. `verbatim` is `true` for all 442 items. The only change of notation is in MA3-RQF-02, whose fractions are MathML on the site and are written `1/2, 1/4, 1/5 and 1/10` here.

## What was fetched

| Framework | Publisher | Where the text came from | Items |
|---|---|---|---|
| NSW Mathematics K–10 Syllabus (2022) | NESA | `__NEXT_DATA__` JSON in each focus-area page under https://curriculum.nsw.edu.au/learning-areas/mathematics/mathematics-k-10-2022/content/… (66 pages, ES1–S3) | 74 outcomes |
| NSW English K–10 Syllabus (2022) | NESA | as above, https://curriculum.nsw.edu.au/learning-areas/english/english-k-10-2022/content/… (35 pages) | 40 outcomes |
| Australian Curriculum v9.0 Mathematics F–6 | ACARA | `https://www.australiancurriculum.edu.au/conf/acara/api/spa/ac/curriculum.MATMAT{FY,Y1..Y6}.json` (the JSON the v9 pages load) | 139 content descriptions |
| Australian Curriculum v9.0 English F–6 | ACARA | `…/curriculum.ENGENG{FY,Y1..Y6}.json` | 189 content descriptions |

Counts by stage or year:

- NSW maths: ES1 16, S1 16, S2 20, S3 21, plus MAO-WM-01 (stage `all`, years 0–6).
- NSW English: ES1 11, S1 9, S2 11, S3 9.
- AC9 maths: F 12, Y1 15, Y2 18, Y3 23, Y4 23, Y5 24, Y6 24.
- AC9 English: F 29, Y1 30, Y2 27, Y3 28, Y4 28, Y5 24, Y6 23.

The NSW site has a Kontent.ai backend, but its delivery API is not exposed to the browser. Each focus-area page carries its own outcomes, content groups and content items in the embedded Next.js data.

Raw dumps for topic design are kept outside the repo, in the session scratchpad `au-src/`:

- `nsw_maths_content.json`: 797 content dot points.
- `nsw_english_content.json`: 706 content dot points.
- `ac9_maths.json` and `ac9_english.json`: each with elaborations, level description and achievement standard.

## Spot checks (rendered pages, Playwright)

- NSW: 6 rendered focus-area pages, 168 strings checked (outcome codes, outcome statements, content group titles, every dot point). The pages were ES1 Representing whole numbers, S2 Additive relations A, S3 Representing quantity fractions B, S1 Spelling, ES1 Phonic knowledge and S3 Creating written texts. 166 matched exactly. The 2 that did not match contain MathJax fractions, which do not appear in the page's plain text; the words around the fractions match.
- AC9: 5 rendered year pages, 224 strings checked (every code and statement on each page): Maths F, Y4, Y6 and English Y1, Y6. All matched. On maths pages only three strands show at a time, so the strand chips had to be clicked to reveal Space, Statistics and Probability.

## Stages, years and Parts A/B

- Early Stage 1 = Kindergarten (`year` 0). Stage 1 = Years 1–2, Stage 2 = Years 3–4, Stage 3 = Years 5–6. NSW outcomes are written per stage, not per year.
- **Maths, Stage 1–3:** every focus area is split into Part A and Part B. Both parts share the same outcomes. Early Stage 1 is not split.
- **English:** no focus area is split, and no content item carries a year-level tag.

The source for Parts A and B is the maths overview page, section "Organisation of Mathematics K–10", heading "K–6 Parts A and B". It says, verbatim:

> "Part A typically focuses on early concept development"; "Part B builds on these early concepts."
>
> "The content across Parts A and B relates to the same stage-based outcomes. Teachers can choose which content from Part A and/or Part B to address, based on students' prior learning, needs and abilities."
>
> "For example, in Stage 2, Part A does not equate to Year 3 only. When teaching a Year 4 class, the teacher may need to address or consolidate some concepts within Part A prior to addressing concepts in Part B."

So **Part A is not officially "first year" and Part B is not "second year"**. Treating A ≈ the first year of the stage and B ≈ the second year is only a planning heuristic. It is not syllabus text. The AC9 year-level codes are the finer-grained year anchor.

## NSW focus areas per stage

**Mathematics** (Stage 1–3 focus areas come as Part A and Part B):

- ES1: Representing whole numbers; Combining and separating quantities; Forming groups; Geometric measure; Two-dimensional spatial structure; Three-dimensional spatial structure; Non-spatial measure; Data.
- S1: Representing whole numbers; Combining and separating quantities; Forming groups; Geometric measure; Two-dimensional spatial structure; Three-dimensional spatial structure; Non-spatial measure; Data; Chance.
- S2: Representing numbers using place value; Additive relations; Multiplicative relations; Partitioned fractions; Geometric measure; Two-dimensional spatial structure; Three-dimensional spatial structure; Non-spatial measure; Data; Chance.
- S3: Represents numbers; Additive relations; Multiplicative relations; Representing quantity fractions; Geometric measure; Two-dimensional spatial structure; Three-dimensional spatial structure; Non-spatial measure; Data; Chance.
- All stages: Working mathematically (MAO-WM-01). It is an overarching outcome, not a separate focus area.

**English:**

- ES1: Oral language and communication; Vocabulary; Phonological awareness; Print conventions; Phonic knowledge; Reading fluency; Reading comprehension; Creating written texts; Spelling; Handwriting; Understanding and responding to literature.
- S1: Oral language and communication; Vocabulary; Phonic knowledge; Reading fluency; Reading comprehension; Creating written texts; Spelling; Handwriting; Understanding and responding to literature.
- S2: Oral language and communication; Vocabulary; Reading fluency; Reading comprehension; Creating written texts; Spelling; Handwriting and digital transcription; Understanding and responding to literature.
- S3: Oral language and communication; Vocabulary; Reading comprehension; Creating written texts; Spelling; Handwriting and digital transcription; Understanding and responding to literature.

Phonological awareness and Print conventions exist only in ES1, and Reading fluency stops after S2. NSW has no separate grammar focus area: grammar and punctuation content sits inside Creating written texts, and some of it in Reading comprehension. Topics with the strand `Grammar and punctuation` will therefore map to the CWT outcomes (for example EN2-CWT-01..03 and EN3-CWT-01).

## AC9 structure

- Maths strands: Number, Algebra, Measurement, Space, Statistics, Probability. There are no sub-strands. Probability starts in Year 3.
- English has three strands, each split into sub-strands:
  - Language: Language for interacting with others; Text structure and organisation; Language for expressing and developing ideas.
  - Literature: Literature and contexts; Engaging with and responding to literature; Examining literature; Creating literature.
  - Literacy: Texts in context; Interacting with others; Analysing, interpreting and evaluating; Creating texts; Phonic and word knowledge. Phonic and word knowledge contains the spelling and phonics descriptions.

## Normalisation applied

- HTML was converted to plain text and whitespace was collapsed.
- Non-breaking and narrow no-break spaces became plain spaces.
- Glossary links were reduced to their link text.
- MathML fractions became `a/b`. This affects 1 outcome and a few dot points and examples in the dump.
- NSW focus-area names in `standards.json` drop the ` A` / ` B` suffix.
- Each NSW item's `url` points to its Part A (or only) page. MAO-WM-01 points to the outcomes page.

## Gaps and things not verified

- Excluded from `standards.json`: NSW Life Skills outcomes, access content points, teaching advice and NSW examples. Examples are in the dump. Some examples rely on images; those are flagged `examples_have_images`, and only the image's long description is included.
- Version labels:
  - The AC "9.0" label is inferred from the `v9.` host and the `ac-version-9` asset paths. The page text did not state it.
  - NSW site records were last modified on 2026-09-16 (maths) and 2026-06-04 (English). Wording could change after 2026-10-24.
- AC9 elaboration codes are kept as published. One known oddity: under AC9M6P02, some elaboration codes read `AC9M6P03_E*`, even though no AC9M6P03 content description exists.
- English Stage 1 Handwriting is titled "Handwriting" on the site. From Stage 2 the title is "Handwriting and digital transcription". Both are recorded as published.
