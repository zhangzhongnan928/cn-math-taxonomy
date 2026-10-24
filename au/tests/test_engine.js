#!/usr/bin/env node
/* Engine tests for the K-6 Learning Map: node au/tests/test_engine.js (no dependencies, assert only).
 * Hand-made graphs, the two-question rule, marking, then the fixture dataset in au/tests/fixtures.
 * If au/data/*.json exist, the same property checks also run on the real data. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const E = require('../assets/engine.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}
const sorted = (it) => Array.from(it).sort();

/* ------------------------------------------------------------ small hand-made graph
 *   X(external) <- F <- E <- C <---hard--- T
 *                  F <- D <---hard--- T
 *                  F <- B <---soft--- T
 *   Z is unrelated to T
 * topics order: X F E C D B T Z (prerequisites of equal strength are asked in this order)
 */
function mk(id, extra) {
  return Object.assign({
    id: id, name: id, external: false,
    diagnostic_question: { question: id + '?', answer: '1' }
  }, extra || {});
}
const smallTopics = [
  mk('X', { external: true, diagnostic_question: undefined }),
  mk('F'), mk('E'), mk('C'), mk('D'), mk('B'), mk('T'), mk('Z')
];
const smallDeps = [
  { topicId: 'F', prerequisiteId: 'X', strength: 'hard' },
  { topicId: 'E', prerequisiteId: 'F', strength: 'hard' },
  { topicId: 'C', prerequisiteId: 'E', strength: 'hard' },
  { topicId: 'D', prerequisiteId: 'F', strength: 'hard' },
  { topicId: 'B', prerequisiteId: 'F', strength: 'hard' },
  { topicId: 'T', prerequisiteId: 'B', strength: 'soft' },   // soft written before hard on purpose
  { topicId: 'T', prerequisiteId: 'D', strength: 'hard' },
  { topicId: 'T', prerequisiteId: 'C', strength: 'hard' }
];
const G = E.buildGraph(smallTopics, smallDeps);

function run(session, script) {
  // script: {id: 'correct'|'wrong'|'skip'} - answer in the engine's order; returns [session, asked order]
  const asked = [];
  let s = session;
  for (let guard = 0; guard < 100; guard++) {
    const q = E.nextQuestion(G, s);
    if (!q) break;
    asked.push(q);
    assert.ok(script[q], 'no scripted answer for ' + q);
    s = E.applyAnswer(G, s, q, script[q]);
  }
  return [s, asked];
}

function assertTopological(order, graph) {
  const pos = new Map(order.map((id, i) => [id, i]));
  order.forEach((id) => {
    graph.prereqs[id].forEach((p) => {
      if (pos.has(p.id)) assert.ok(pos.get(p.id) < pos.get(id), p.id + ' should come before ' + id);
    });
  });
}

console.log('Small hand-made graph (one question per skill, fallback mode: wrong means weak)');

test('ancestor subgraph: target + all ancestors (including external), nothing unrelated', () => {
  assert.deepStrictEqual(sorted(E.ancestors(G, 'T')), ['B', 'C', 'D', 'E', 'F', 'X']);
  assert.deepStrictEqual(sorted(E.ancestors(G, 'E')), ['F', 'X']);
  assert.deepStrictEqual(sorted(E.ancestors(G, 'X')), []);
  const sub = E.subgraph(G, ['T']);
  assert.deepStrictEqual(sorted(sub.nodes), ['B', 'C', 'D', 'E', 'F', 'T', 'X']);
});

test('topological order: every prerequisite comes before the skill that needs it', () => {
  const sub = E.subgraph(G, ['T']);
  assertTopological(sub.nodes, G);
  assert.strictEqual(sub.nodes[0], 'X');
  assert.strictEqual(sub.nodes[sub.nodes.length - 1], 'T');
  const multi = E.subgraph(G, ['C', 'D']);
  assertTopological(multi.nodes, G);
  assert.deepStrictEqual(sorted(multi.nodes), ['C', 'D', 'E', 'F', 'X']);
});

test('prerequisites sorted hard first, then soft', () => {
  assert.deepStrictEqual(G.prereqs.T.map((p) => p.id + ':' + p.strength), ['C:hard', 'D:hard', 'B:soft']);
});

test('the first question is the target itself', () => {
  const s = E.createSession(G, ['T']);
  assert.strictEqual(E.nextQuestion(G, s), 'T');
});

test('correct: the skill and all its ancestors (including external) are mastered and skipped', () => {
  let s = E.createSession(G, ['T']);
  s = E.applyAnswer(G, s, 'T', 'correct');
  assert.strictEqual(E.nextQuestion(G, s), null);
  ['B', 'C', 'D', 'E', 'F', 'X', 'T'].forEach((id) => assert.strictEqual(E.statusOf(s, id), 'mastered', id));
  assert.strictEqual(s.status.T.src, 'direct');
  assert.strictEqual(s.status.F.src, 'inferred');
  assert.strictEqual(E.statusOf(s, 'Z'), 'unknown');
  const sum = E.summarize(G, s);
  assert.deepStrictEqual(sum.weak, []);
  assert.deepStrictEqual(sum.roots, []);
  assert.deepStrictEqual(sum.path, []);
  assert.strictEqual(sum.asked, 1);
});

test('wrong: backtrack into prerequisites, hard before soft, depth first', () => {
  const s0 = E.createSession(G, ['T']);
  const [s, asked] = run(s0, { T: 'wrong', C: 'wrong', E: 'correct', D: 'correct', B: 'correct' });
  assert.deepStrictEqual(asked, ['T', 'C', 'E', 'D', 'B']);
  assert.strictEqual(E.nextQuestion(G, s), null);
});

test('after a wrong answer the first follow-up is a hard prerequisite, soft comes last', () => {
  let s = E.createSession(G, ['T']);
  s = E.applyAnswer(G, s, 'T', 'wrong');
  assert.strictEqual(E.nextQuestion(G, s), 'C');
  s = E.applyAnswer(G, s, 'C', 'correct');
  assert.strictEqual(E.nextQuestion(G, s), 'D');
  s = E.applyAnswer(G, s, 'D', 'correct');
  assert.strictEqual(E.nextQuestion(G, s), 'B');
});

test('"don\'t know" (skip) counts the same as wrong', () => {
  const [a] = run(E.createSession(G, ['T']), { T: 'skip', C: 'skip', E: 'correct', D: 'correct', B: 'correct' });
  const [b] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'correct', D: 'correct', B: 'correct' });
  assert.deepStrictEqual(a.status, b.status);
});

test('decided skills are never asked again; shared prerequisites are asked once', () => {
  const [, asked] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'wrong', F: 'correct', D: 'wrong', B: 'wrong' });
  assert.strictEqual(new Set(asked).size, asked.length);
  assert.deepStrictEqual(asked, ['T', 'C', 'E', 'F', 'D', 'B']);
});

test('the question limit holds; the rest is marked not checked', () => {
  const s0 = E.createSession(G, ['T'], { limit: 2 });
  const [s, asked] = run(s0, { T: 'wrong', C: 'wrong' });
  assert.deepStrictEqual(asked, ['T', 'C']);
  assert.strictEqual(E.nextQuestion(G, s), null);
  const sum = E.summarize(G, s);
  assert.strictEqual(sum.asked, 2);
  assert.strictEqual(sum.limitReached, true);
  assert.deepStrictEqual(sorted(sum.untested), ['B', 'D', 'E', 'F', 'X']);
  assert.deepStrictEqual(sorted(sum.weak), ['C', 'T']);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['C']);
  assert.deepStrictEqual(sum.roots[0].pendingPrereqs, ['E']);
});

test('default limit 16; limit 1 asks only the target', () => {
  assert.strictEqual(E.DEFAULT_LIMIT, 16);
  assert.strictEqual(E.createSession(G, ['T']).limit, 16);
  const [, asked] = run(E.createSession(G, ['T'], { limit: 1 }), { T: 'wrong' });
  assert.deepStrictEqual(asked, ['T']);
});

test('roots: weak with no weak prerequisite; path is topological and has no mastered skill', () => {
  const [s] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'correct', D: 'correct', B: 'correct' });
  const sum = E.summarize(G, s);
  assert.deepStrictEqual(sorted(sum.weak), ['C', 'T']);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['C']);
  assert.deepStrictEqual(sum.path.map((p) => p.id), ['C', 'T']);
  assert.strictEqual(sum.path[0].isRoot, true);
  assert.strictEqual(sum.path[1].isTarget, true);
  assert.deepStrictEqual(sorted(sum.mastered), ['B', 'D', 'E', 'F', 'X']);
  assert.strictEqual(sum.finished, true);
  assert.strictEqual(sum.limitReached, false);
});

test('several roots: the path holds every unmastered skill between roots and target', () => {
  const [s] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'wrong', F: 'correct', D: 'wrong', B: 'correct' });
  const sum = E.summarize(G, s);
  assert.deepStrictEqual(sorted(sum.roots.map((r) => r.id)), ['D', 'E']);
  assert.deepStrictEqual(sorted(sum.path.map((p) => p.id)), ['C', 'D', 'E', 'T']);
  assertTopological(sum.path.map((p) => p.id), G);
  sum.path.forEach((p) => assert.notStrictEqual(p.status, 'mastered'));
});

test('external skills get no questions; a root lists its external prerequisites', () => {
  const [s, asked] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'wrong', F: 'wrong', D: 'wrong', B: 'wrong' });
  assert.ok(!asked.includes('X'));
  const sum = E.summarize(G, s);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['F']);
  assert.deepStrictEqual(sum.roots[0].externalPrereqs, ['X']);
  assert.deepStrictEqual(sum.roots[0].pendingPrereqs, []);
  assert.deepStrictEqual(sum.untested, ['X']);
});

test('several targets: the furthest along is asked first; one right covers the others', () => {
  const s0 = E.createSession(G, ['C', 'T', 'D']);
  assert.strictEqual(E.nextQuestion(G, s0), 'T');
  const s1 = E.applyAnswer(G, s0, 'T', 'correct');
  assert.strictEqual(E.nextQuestion(G, s1), null);
  assert.deepStrictEqual(E.summarize(G, s1).path, []);
});

test('several targets: unrelated targets are all asked', () => {
  const [, asked] = run(E.createSession(G, ['T', 'Z']), { T: 'correct', Z: 'correct' });
  assert.deepStrictEqual(sorted(asked), ['T', 'Z']);
});

test('a direct verdict is not overwritten by an inferred one', () => {
  let s = E.createSession(G, ['T']);
  s = E.applyAnswer(G, s, 'E', 'wrong');
  s = E.applyAnswer(G, s, 'T', 'correct');
  assert.strictEqual(E.statusOf(s, 'E'), 'weak');
  assert.strictEqual(E.statusOf(s, 'C'), 'mastered');
});

test('applyAnswer leaves its input alone; replay matches step-by-step answers; errors are English', () => {
  const s0 = E.createSession(G, ['T']);
  const snap = JSON.stringify(s0);
  const s1 = E.applyAnswer(G, s0, 'T', 'wrong');
  assert.strictEqual(JSON.stringify(s0), snap);
  const s2 = E.applyAnswer(G, s1, 'C', 'correct');
  const r = E.replay(G, ['T'], [{ id: 'T', result: 'wrong' }, { id: 'C', result: 'correct' }]);
  assert.deepStrictEqual(r, s2);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s2)), s2);
  assert.throws(() => E.applyAnswer(G, s0, 'T', 'maybe'), /correct, wrong or skip/);
  assert.throws(() => E.createSession(G, ['nope']), /Unknown skill: nope/);
  assert.throws(() => E.createSession(G, []), /At least one target/);
});

test('path graph layout: prerequisites on higher layers, no edge goes back', () => {
  const [s] = run(E.createSession(G, ['T']), { T: 'wrong', C: 'wrong', E: 'wrong', F: 'correct', D: 'wrong', B: 'correct' });
  const sum = E.summarize(G, s);
  const lay = E.layout(G, s, sum);
  const layer = Object.fromEntries(lay.nodes.map((n) => [n.id, n.layer]));
  lay.edges.forEach((e) => assert.ok(layer[e.from] < layer[e.to], e.from + '->' + e.to));
  assert.ok(lay.nodes.some((n) => n.id === 'T' && n.isTarget));
  assert.ok(lay.nodes.some((n) => n.id === 'E' && n.isRoot));
});

test('a cycle is reported in English', () => {
  const g = E.buildGraph([mk('P'), mk('Q')], [{ topicId: 'P', prerequisiteId: 'Q' }, { topicId: 'Q', prerequisiteId: 'P' }]);
  assert.throws(() => E.ancestors(g, 'P'), /cycle/);
});

/* ------------------------------------------------------------ two questions per skill (hand-made bank) */
console.log('Two questions per skill');

const DIFFS = { b: 'basic', s: 'standard', a: 'advanced' };
function mq(topicId, n, diff, extra) {
  return Object.assign({
    id: topicId + '_q' + n, topicId: topicId, difficulty: DIFFS[diff] || diff, type: 'numeric',
    prompt: topicId + ' question ' + n, answer: '1', explanation: 'Because.'
  }, extra || {});
}
// T needs P1 (hard) <- R, and P2 (hard); 4 questions each: q1 standard, q2 standard, q3 basic, q4 advanced
const bankTopics = ['R', 'P1', 'P2', 'T'].map((id) => mk(id, { diagnostic_question: undefined }));
const bankDeps = [
  { topicId: 'P1', prerequisiteId: 'R', strength: 'hard' },
  { topicId: 'T', prerequisiteId: 'P1', strength: 'hard' },
  { topicId: 'T', prerequisiteId: 'P2', strength: 'hard' }
];
const bankQs = [];
['R', 'P1', 'P2', 'T'].forEach((id) => { bankQs.push(mq(id, 1, 's'), mq(id, 2, 's'), mq(id, 3, 'b'), mq(id, 4, 'a')); });
const G2 = E.buildGraph(bankTopics, bankDeps, bankQs);

function run2(session, script) {
  const seq = [];
  let s = session;
  for (let guard = 0; guard < 100; guard++) {
    const it = E.nextItem(G2, s);
    if (!it) break;
    seq.push(it.topicId + '#' + it.attempt);
    const r = script[it.topicId][it.attempt - 1];
    assert.ok(r, 'script is missing ' + it.topicId + ' attempt ' + it.attempt);
    s = E.applyAnswer(G2, s, it.topicId, r);
  }
  return [s, seq];
}

test('bank: isTestable looks at the bank; hasBank is true with a bank and false in fallback mode', () => {
  assert.strictEqual(G2.hasBank, true);
  assert.strictEqual(G.hasBank, false);
  assert.strictEqual(G2.bank.T.length, 4);
  assert.strictEqual(G.bank.T[0].type, 'legacy');
});

test('first right -> mastered, ancestors inferred; one question only', () => {
  const [s, seq] = run2(E.createSession(G2, ['T']), { T: ['correct'] });
  assert.deepStrictEqual(seq, ['T#1']);
  ['T', 'P1', 'P2', 'R'].forEach((id) => assert.strictEqual(E.statusOf(s, id), 'mastered', id));
  assert.strictEqual(s.status.R.src, 'inferred');
});

test('first wrong -> a second question on the same skill, no verdict and no backtracking yet', () => {
  let s = E.createSession(G2, ['T']);
  s = E.applyAnswer(G2, s, 'T', 'wrong');
  assert.strictEqual(E.nextQuestion(G2, s), 'T');
  const it = E.nextItem(G2, s);
  assert.strictEqual(it.attempt, 2);
  assert.notStrictEqual(it.question.id, s.answers[0].qid);
  assert.strictEqual(s.status.T, undefined);
  assert.strictEqual(E.isUnconfirmed(s, 'T'), true);
});

test('wrong + wrong -> weak, then backtrack (P1, P2 in order, then deeper to R)', () => {
  const [s, seq] = run2(E.createSession(G2, ['T']), {
    T: ['wrong', 'skip'], P1: ['wrong', 'wrong'], R: ['correct'], P2: ['correct']
  });
  assert.deepStrictEqual(seq, ['T#1', 'T#2', 'P1#1', 'P1#2', 'R#1', 'P2#1']);
  assert.strictEqual(E.statusOf(s, 'T'), 'weak');
  assert.strictEqual(E.statusOf(s, 'P1'), 'weak');
  assert.strictEqual(E.statusOf(s, 'R'), 'mastered');
  const sum = E.summarize(G2, s);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['P1']);
  assert.deepStrictEqual(sum.shaky, []);
});

test('wrong + right -> shaky, no backtracking, but on the learning path', () => {
  const [s, seq] = run2(E.createSession(G2, ['T']), { T: ['wrong', 'correct'] });
  assert.deepStrictEqual(seq, ['T#1', 'T#2']);
  assert.strictEqual(E.statusOf(s, 'T'), 'shaky');
  assert.strictEqual(E.nextQuestion(G2, s), null);
  ['P1', 'P2', 'R'].forEach((id) => assert.strictEqual(E.statusOf(s, id), 'unknown', id));
  const sum = E.summarize(G2, s);
  assert.deepStrictEqual(sum.shaky, ['T']);
  assert.deepStrictEqual(sum.roots, []);
  assert.deepStrictEqual(sorted(sum.untested), ['P1', 'P2', 'R']);
  assert.deepStrictEqual(sum.path.map((p) => [p.id, p.status]), [['T', 'shaky']]);
});

test('a shaky prerequisite next to a weak one: the path holds it and what follows', () => {
  const [s] = run2(E.createSession(G2, ['T']), {
    T: ['wrong', 'wrong'], P1: ['wrong', 'correct'], P2: ['wrong', 'wrong'], R: ['correct']
  });
  assert.strictEqual(E.statusOf(s, 'P1'), 'shaky');
  assert.strictEqual(E.statusOf(s, 'P2'), 'weak');
  const sum = E.summarize(G2, s);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['P2']);
  assert.deepStrictEqual(sorted(sum.path.map((p) => p.id)), ['P1', 'P2', 'T']);
  assertTopological(sum.path.map((p) => p.id), G2);
});

test('second question prefers basic; if the first was basic, the same level, else the easiest left', () => {
  const firstDiffs = new Set();
  for (let i = 0; i < 60; i++) {
    const s1 = E.applyAnswer(G2, E.createSession(G2, ['P2'], { seed: 'k' + i }), 'P2', 'wrong');
    const first = E.questionById(G2, s1.answers[0].qid);
    firstDiffs.add(first.difficulty);
    assert.notStrictEqual(first.difficulty, 'advanced');
    const second = E.nextItem(G2, s1).question;
    if (first.difficulty === 'standard') assert.strictEqual(second.id, 'P2_q3');
    else assert.strictEqual(second.difficulty, 'standard');
  }
  assert.ok(firstDiffs.has('standard') && firstDiffs.has('basic'));
  const topics3 = [mk('M', { diagnostic_question: undefined })];
  const G3 = E.buildGraph(topics3, [], [mq('M', 1, 's'), mq('M', 2, 's'), mq('M', 3, 's'), mq('M', 4, 'a')]);
  for (let i = 0; i < 20; i++) {
    const s1 = E.applyAnswer(G3, E.createSession(G3, ['M'], { seed: i }), 'M', 'wrong');
    assert.strictEqual(E.nextItem(G3, s1).question.difficulty, 'standard');
  }
  const G4 = E.buildGraph(topics3, [], [mq('M', 1, 'a'), mq('M', 2, 'a')]);
  const s4 = E.applyAnswer(G4, E.createSession(G4, ['M'], { seed: 1 }), 'M', 'wrong');
  assert.strictEqual(E.nextItem(G4, s4).question.difficulty, 'advanced');
});

test('a fixed seed fixes the questions; different seeds vary them; replay keeps question ids', () => {
  const trace = (seed) => {
    const [s] = run2(E.createSession(G2, ['T'], { seed: seed }), {
      T: ['wrong', 'wrong'], P1: ['wrong', 'wrong'], R: ['wrong', 'wrong'], P2: ['wrong', 'wrong']
    });
    return s.answers.map((a) => a.qid).join(',');
  };
  assert.strictEqual(trace('abc'), trace('abc'));
  assert.strictEqual(trace(42), trace('42'));
  const variants = new Set();
  for (let i = 0; i < 40; i++) variants.add(trace('s' + i));
  assert.ok(variants.size > 5, 'got ' + variants.size + ' variants');
  const [s2] = run2(E.createSession(G2, ['T'], { seed: 9 }), { T: ['wrong', 'correct'] });
  assert.deepStrictEqual(E.replay(G2, ['T'], s2.answers, { seed: 9 }), s2);
});

test('seen questions are avoided when possible, and never block the session', () => {
  const avoid = ['T_q1', 'T_q2'];
  for (let i = 0; i < 40; i++) {
    const first = E.nextItem(G2, E.createSession(G2, ['T'], { seed: i, avoid: avoid })).question;
    assert.ok(!avoid.includes(first.id), first.id);
  }
  const all = G2.bank.T.map((q) => q.id);
  const it = E.nextItem(G2, E.createSession(G2, ['T'], { seed: 1, avoid: all }));
  assert.ok(it && all.includes(it.question.id));
  const [s3] = run2(E.createSession(G2, ['T']), { T: ['wrong', 'wrong'], P1: ['wrong', 'wrong'], P2: ['wrong', 'wrong'], R: ['wrong', 'wrong'] });
  const qids = s3.answers.map((a) => a.qid);
  assert.strictEqual(new Set(qids).size, qids.length);
});

test('the limit counts questions; a skill with only its first (wrong) answer counts as weak and unconfirmed', () => {
  const [s, seq] = run2(E.createSession(G2, ['T'], { limit: 3 }), {
    T: ['wrong', 'wrong'], P1: ['wrong', 'wrong'], R: ['wrong', 'wrong'], P2: ['wrong', 'wrong']
  });
  assert.deepStrictEqual(seq, ['T#1', 'T#2', 'P1#1']);
  assert.strictEqual(E.statusOf(s, 'P1'), 'weak');
  const sum = E.summarize(G2, s);
  assert.deepStrictEqual(sum.unconfirmed, ['P1']);
  assert.strictEqual(sum.limitReached, true);
  assert.deepStrictEqual(sorted(sum.untested), ['P2', 'R']);
});

test('a skill with one question: wrong means weak straight away', () => {
  const G5 = E.buildGraph(bankTopics, bankDeps, [mq('T', 1, 's'), mq('P1', 1, 's'), mq('P2', 1, 's'), mq('R', 1, 's')]);
  const s = E.applyAnswer(G5, E.createSession(G5, ['T']), 'T', 'wrong');
  assert.strictEqual(E.statusOf(s, 'T'), 'weak');
  assert.strictEqual(E.nextQuestion(G5, s), 'P1');
});

test('answers log the question id and the typed text', () => {
  const s0 = E.createSession(G2, ['T'], { seed: 5 });
  const s1 = E.applyAnswer(G2, s0, 'T', 'wrong', { text: '42' });
  assert.strictEqual(s1.answers[0].text, '42');
  assert.ok(/^T_q\d$/.test(s1.answers[0].qid));
});

test('PRNG: mulberry32 repeats for the same seed and stays in [0,1)', () => {
  const a = E.mulberry32(123), b = E.mulberry32(123);
  for (let i = 0; i < 100; i++) { const x = a(); assert.strictEqual(x, b()); assert.ok(x >= 0 && x < 1); }
});

/* ------------------------------------------------------------ marking */
console.log('Marking');

const j = (q, u) => E.judgeQuestion(q, u).verdict;
function verdict(user, ref) { return E.judgeAnswer(user, ref).verdict; }

test('choice: letter in many forms, or the option text', () => {
  const ch = { type: 'choice', answer: 'B', choices: [{ key: 'A', text: 'hat' }, { key: 'B', text: 'tree' }, { key: 'C', text: '1/2' }] };
  ['B', ' b ', '(B)', 'B.', 'b)', 'tree', 'Tree.', ' TREE '].forEach((u) => assert.strictEqual(j(ch, u), 'correct', u));
  assert.strictEqual(j(ch, 'A'), 'wrong');
  assert.strictEqual(j(ch, 'hat'), 'wrong');
  assert.strictEqual(j(ch, '0.5'), 'manual'); // option text must match as text
  assert.strictEqual(j(ch, 'E'), 'manual');
  assert.strictEqual(j(ch, 'something else'), 'manual');
  assert.strictEqual(j(ch, ''), 'manual');
});

test('short: case, spaces and a trailing full stop do not matter; accept list; single-word mismatch is wrong', () => {
  const sh = { type: 'short', answer: 'ship' };
  ['ship', 'Ship', ' SHIP ', 'ship.', 'Ship!', '"ship"'].forEach((u) => assert.strictEqual(j(sh, u), 'correct', u));
  assert.strictEqual(j(sh, 'shipp'), 'wrong');
  assert.strictEqual(j(sh, 'chip'), 'wrong');
  assert.strictEqual(j(sh, 'a big ship'), 'manual');
  const multi = { type: 'short', answer: 'ice cream', accept: ['icecream', 'gelato'] };
  ['Ice Cream', 'ice  cream.', 'icecream', 'Gelato'].forEach((u) => assert.strictEqual(j(multi, u), 'correct', u));
  assert.strictEqual(j(multi, 'cake'), 'manual'); // the reference is not one word, so a grown-up decides
  const apos = { type: 'short', answer: "don't" };
  assert.strictEqual(j(apos, 'don’t'), 'correct');
  assert.strictEqual(j(apos, "Don't."), 'correct');
  assert.strictEqual(j({ type: 'short', answer: '-less' }, '-less'), 'correct');
  assert.strictEqual(j({ type: 'short', answer: '12' }, '12.0'), 'correct');
  assert.strictEqual(j({ type: 'self', answer: 'anything' }, 'anything'), 'manual');
  assert.strictEqual(j({ type: 'legacy', answer: '3' }, '3.0'), 'correct');
});

test('numeric: value equality for integers, decimals and fractions', () => {
  const num = { type: 'numeric', answer: '-1/2' };
  assert.strictEqual(j(num, '-0.5'), 'correct');
  assert.strictEqual(j(num, '−1/2'), 'correct');
  assert.strictEqual(j(num, '1/2'), 'wrong');
  assert.strictEqual(verdict('0.5', '1/2'), 'correct');
  assert.strictEqual(verdict('2/4', '1/2'), 'correct');
  assert.strictEqual(verdict('1/3', '0.333'), 'wrong');
  assert.strictEqual(verdict('3/5', '5/3'), 'wrong');
  assert.strictEqual(verdict('.5', '0.5'), 'correct');
});

test('numeric: mixed numbers "1 1/2", "1 and 1/2" and "1½"', () => {
  assert.strictEqual(verdict('1 1/2', '3/2'), 'correct');
  assert.strictEqual(verdict('1 1/2', '1.5'), 'correct');
  assert.strictEqual(verdict('1 and 1/2', '1.5'), 'correct');
  assert.strictEqual(verdict('1½', '1.5'), 'correct');
  assert.strictEqual(verdict('¾', '0.75'), 'correct');
  assert.strictEqual(verdict('2 3/4', '2.75'), 'correct');
  assert.strictEqual(verdict('2 1/4', '2.75'), 'wrong');
});

test('numeric: thousands separators', () => {
  assert.strictEqual(verdict('1,000', '1000'), 'correct');
  assert.strictEqual(verdict('12,345', '12345'), 'correct');
  assert.strictEqual(verdict('1,234,567', '1234567'), 'correct');
  assert.strictEqual(verdict('$1,250', '1250'), 'correct');
  assert.strictEqual(verdict('1,500 kg', '1500'), 'correct');
  assert.strictEqual(verdict('12 345', '12345'), 'correct');
});

test('numeric: metric units, time, temperature', () => {
  [['12 cm', '12'], ['12cm', '12'], ['12 centimetres', '12'], ['3 m', '3'], ['3 metres', '3'], ['4 km', '4'],
    ['250 g', '250'], ['2 kg', '2'], ['2 kilograms', '2'], ['500 mL', '500'], ['500ml', '500'], ['2 L', '2'], ['2 litres', '2'],
    ['45 min', '45'], ['45 minutes', '45'], ['3 h', '3'], ['3 hours', '3'], ['30 s', '30'], ['30 seconds', '30'],
    ['25 °C', '25'], ['25°C', '25'], ['25 degrees', '25'], ['25 degrees Celsius', '25'], ['60°', '60'],
    ['15 cm²', '15'], ['15 square centimetres', '15']].forEach((p) => assert.strictEqual(verdict(p[0], p[1]), 'correct', p[0]));
  assert.strictEqual(verdict('12 cm', '12 m'), 'wrong');
  assert.strictEqual(verdict('12 m', '12 metres'), 'correct');
  assert.strictEqual(verdict('2 kg', '2 g'), 'wrong');
  assert.strictEqual(verdict('13 cm', '12'), 'wrong');
});

test('numeric: money in dollars and cents', () => {
  [['$5', '5'], ['$ 5', '5'], ['5 dollars', '5'], ['$4.50', '4.5'], ['4.50', '4.5'], ['$0.50', '0.5'],
    ['50c', '50'], ['50 c', '50'], ['50 cents', '50'], ['50¢', '50'], ['5$', '5']].forEach((p) => assert.strictEqual(verdict(p[0], p[1]), 'correct', p[0]));
  assert.strictEqual(verdict('$5', '50 c'), 'wrong');
  assert.strictEqual(verdict('$6', '5'), 'wrong');
});

test('numeric: percentages are a unit label (the answer has no unit)', () => {
  const q = { type: 'numeric', answer: '25' };
  assert.strictEqual(j(q, '25%'), 'correct');
  assert.strictEqual(j(q, '25 percent'), 'correct');
  assert.strictEqual(j(q, '25'), 'correct');
  assert.strictEqual(j(q, '0.25'), 'wrong');
});

test('numeric: "and" / "or" / comma lists, ordered and unordered', () => {
  assert.strictEqual(verdict('3 and 4', '3, 4'), 'correct');
  assert.strictEqual(verdict('4 or 3', '3, 4'), 'correct');
  assert.strictEqual(verdict('3 & 4', '4; 3'), 'correct');
  assert.strictEqual(verdict('3', '3, 4'), 'wrong');
  const ord = { type: 'numeric', answer: '3, 5' };
  assert.strictEqual(j(ord, '3, 5'), 'correct');
  assert.strictEqual(j(ord, '3 and 5'), 'correct');
  assert.strictEqual(j(ord, '5, 3'), 'wrong');
  assert.strictEqual(j(ord, '3'), 'wrong');
  const unord = { type: 'numeric', answer: '3, 5', unordered: true };
  assert.strictEqual(j(unord, '5 and 3'), 'correct');
  assert.strictEqual(j(unord, '5, 4'), 'wrong');
});

test('numeric: number words for young children', () => {
  const q = { type: 'numeric', answer: '7' };
  ['seven', 'Seven', 'SEVEN.'].forEach((u) => assert.strictEqual(j(q, u), 'correct', u));
  assert.strictEqual(j({ type: 'numeric', answer: '21' }, 'twenty-one'), 'correct');
  assert.strictEqual(j({ type: 'numeric', answer: '105' }, 'one hundred and five'), 'correct');
  assert.strictEqual(j({ type: 'numeric', answer: '100' }, 'a hundred'), 'correct');
  assert.strictEqual(j(q, 'six'), 'wrong');
  assert.strictEqual(E.wordsToNumber('banana'), null);
  assert.strictEqual(E.wordsToNumber('twelve'), 12);
});

test('numeric: accept list and an "answer:" prefix', () => {
  const q = { type: 'numeric', answer: '0.5', accept: ['1/2'] };
  assert.strictEqual(j(q, '1/2'), 'correct');
  assert.strictEqual(j(q, 'Answer: 0.5'), 'correct');
  assert.strictEqual(j(q, '0.5.'), 'correct');
});

test('normaliser: what it removes and keeps', () => {
  assert.strictEqual(E.normalizeText('  Ship. '), 'ship');
  assert.strictEqual(E.normalizeText('Ice  Cream'), 'icecream');
  assert.strictEqual(E.normalizeText('１／２'), '1/2');
  assert.strictEqual(E.normalizeText('3 × 4'), '3*4');
  assert.strictEqual(E.normalizeText('1 1/2'), '1_1/2');
  assert.strictEqual(E.normalizeText('1,000'), '1000');
  assert.strictEqual(E.normalizeText('3,4'), '3,4');
  assert.strictEqual(E.normalizeText('25 degrees'), '25°');
  assert.strictEqual(E.normalizeText('‘hi’'), 'hi');
});

test('words, unclear text: equal only when identical, otherwise a grown-up decides', () => {
  assert.strictEqual(verdict('koalas', 'Koalas'), 'correct');
  assert.strictEqual(verdict('wombats', 'koalas'), 'manual');
  assert.strictEqual(verdict('', '3'), 'manual');
  assert.strictEqual(verdict("I don't know", '3'), 'manual');
});

test('marking never throws on odd input', () => {
  ['', ' ', '(', ')))', '1/0', '/', '--1', '1/2/3', '%', '$', '$$5', '😀', null, undefined, '12345678901234567890/3', '1_2', 'and', ' or '].forEach((u) => {
    ['3', '1/2', 'ship', '3, 4', '', '(1,2)', '$5'].forEach((r) => {
      const v = E.judgeAnswer(u, r).verdict;
      assert.ok(['correct', 'wrong', 'manual'].includes(v));
      ['numeric', 'short', 'choice'].forEach((type) => {
        const out = E.judgeQuestion({ type: type, answer: r || 'A', choices: [{ key: 'A', text: 'x' }] }, u);
        assert.ok(['correct', 'wrong', 'manual'].includes(out.verdict));
      });
    });
  });
});

/* ------------------------------------------------------------ years and subjects */
console.log('Years, stages and subjects');

test('parseYear accepts K, Kindergarten, Year 1, 1, Y1 ...', () => {
  [['K', 0], ['k', 0], ['Kindergarten', 0], ['kindy', 0], ['Foundation', 0], ['0', 0], [0, 0],
    ['Year 1', 1], ['year 1', 1], ['Yr 3', 3], ['Y6', 6], ['6', 6], [4, 4], [' Year  2 ', 2]].forEach((p) => {
    assert.strictEqual(E.parseYear(p[0]), p[1], String(p[0]));
  });
  ['Year 7', '7', 'Grade 1', '', null, 'K1', -1, 2.5].forEach((v) => assert.strictEqual(E.parseYear(v), null, String(v)));
});

test('yearLabel and stageOf follow NSW names', () => {
  assert.strictEqual(E.yearLabel(0), 'Kindergarten');
  assert.strictEqual(E.yearLabel(6), 'Year 6');
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6].map(E.stageOf), ['Early Stage 1', 'Stage 1', 'Stage 1', 'Stage 2', 'Stage 2', 'Stage 3', 'Stage 3']);
});

test('subjectOf: the subject field first, then the aum_/aue_ prefix', () => {
  assert.strictEqual(E.subjectOf({ id: 'aue_k_01' }), 'english');
  assert.strictEqual(E.subjectOf({ id: 'aum_k_01' }), 'maths');
  assert.strictEqual(E.subjectOf({ id: 'aum_k_01', subject: 'english' }), 'english');
  assert.strictEqual(E.subjectOf({ id: 'x', subject: 'maths' }), 'maths');
  assert.strictEqual(E.subjectOf(null), 'maths');
});

test('groupOf: year + strand + focus area', () => {
  const g = E.groupOf({ year: 1, strand: 'Number', focusArea: 'Representing whole numbers' });
  assert.strictEqual(g.key, '1|Number|Representing whole numbers');
  assert.strictEqual(g.label, 'Year 1 · Number · Representing whole numbers');
  assert.strictEqual(E.groupOf({ year: 2, strand: 'Spelling', focusArea: 'Spelling' }).label, 'Year 2 · Spelling');
});

/* ------------------------------------------------------------ dataset checks (fixtures, and au/data when present) */

const NUM_RE = /^-?\d+(\.\d+)?(\/\d+)?$/;
const STRANDS = {
  maths: ['Number', 'Algebra', 'Measurement', 'Space', 'Statistics', 'Probability'],
  english: ['Phonological awareness', 'Phonics and word recognition', 'Spelling', 'Vocabulary', 'Grammar and punctuation', 'Reading comprehension', 'Text and literature']
};

function loadSet(dir) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return { topics: read('topics.json'), deps: read('dependencies.json'), questions: read('questions.json'), standards: read('standards.json') };
}

function rng(seed) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }

function datasetSuite(label, data, opts) {
  const o = opts || {};
  const topics = data.topics, deps = data.deps, questions = data.questions;
  const RG = E.buildGraph(topics, deps, questions);
  const stdIds = new Set(data.standards.items.map((x) => x.id));
  const preMap = new Map();
  deps.forEach((d) => { (preMap.get(d.topicId) || preMap.set(d.topicId, []).get(d.topicId)).push(d.prerequisiteId); });
  const ancCache = new Map();
  const bfsAnc = (id) => {
    if (ancCache.has(id)) return ancCache.get(id);
    const seen = new Set();
    const q = [id];
    while (q.length) { (preMap.get(q.shift()) || []).forEach((p) => { if (!seen.has(p)) { seen.add(p); q.push(p); } }); }
    ancCache.set(id, seen);
    return seen;
  };
  const makeStudent = (rand, p) => {
    const known = new Set();
    topics.forEach((t) => { if (rand() < p) { known.add(t.id); bfsAnc(t.id).forEach((a) => known.add(a)); } });
    return known;
  };
  function sim(targets, known, flaky, limit, seed, mode) {
    let s = E.createSession(RG, targets, { limit: limit, seed: seed == null ? 'sim' : seed, mode: mode });
    const asked = [];
    for (let guard = 0; guard < 5000; guard++) {
      const it = E.nextItem(RG, s);
      if (!it) break;
      asked.push(it.topicId + '#' + it.attempt);
      let r = 'wrong';
      if (known.has(it.topicId)) r = 'correct';
      else if (flaky.has(it.topicId)) r = it.attempt === 1 ? 'wrong' : 'correct';
      s = E.applyAnswer(RG, s, it.topicId, r);
    }
    return { s: s, asked: asked };
  }

  console.log(label + ': data contract');

  test(label + ': topics follow data-format.md', () => {
    const ids = new Set();
    const names = { maths: new Set(), english: new Set() };
    topics.forEach((t) => {
      assert.ok(!ids.has(t.id), 'duplicate id ' + t.id);
      ids.add(t.id);
      assert.ok(/^au[me]_(k|y[1-6])_\d{2}$/.test(t.id), 'bad id ' + t.id);
      assert.ok(t.subject === 'maths' || t.subject === 'english', t.id + ' subject');
      assert.strictEqual(E.subjectOf(t), t.id.indexOf('aue_') === 0 ? 'english' : 'maths', t.id + ' subject vs prefix');
      assert.ok(Number.isInteger(t.year) && t.year >= 0 && t.year <= 6, t.id + ' year');
      const yTag = t.id.split('_')[1];
      assert.strictEqual(yTag === 'k' ? 0 : parseInt(yTag.slice(1), 10), t.year, t.id + ' year vs id');
      assert.ok(STRANDS[t.subject].includes(t.strand), t.id + ' strand ' + t.strand);
      assert.ok(t.focusArea && typeof t.focusArea === 'string', t.id + ' focusArea');
      assert.ok(t.name && t.name.length <= 60 && !/\.$/.test(t.name), t.id + ' name');
      assert.ok(!names[t.subject].has(t.name), t.id + ' duplicate name ' + t.name);
      names[t.subject].add(t.name);
      assert.ok(['conceptual', 'procedural', 'reasoning', 'application'].includes(t.type), t.id + ' type');
      assert.ok(t.description && t.mastery_criteria.length >= 2 && t.mastery_criteria.length <= 3, t.id + ' description / mastery');
      assert.ok(t.standards.length >= 1 && t.standards.length <= 3, t.id + ' standards count');
      t.standards.forEach((sd) => {
        assert.ok(stdIds.has(sd.id), t.id + ' unknown standard ' + sd.id);
        assert.ok(sd.confidence === 'exact' || sd.confidence === 'inferred', t.id + ' confidence');
      });
      assert.ok(t.standards.some((sd) => /^(MA|EN)/.test(sd.id)), t.id + ' needs a NSW outcome');
      assert.strictEqual(t.external, false, t.id + ' external');
      if (!preMap.has(t.id)) assert.ok(t.root_reason, t.id + ' has no prerequisite and no root_reason');
    });
  });

  test(label + ': dependencies are same-subject, not later in years, acyclic', () => {
    const byId = Object.fromEntries(topics.map((t) => [t.id, t]));
    deps.forEach((d) => {
      const a = byId[d.topicId], b = byId[d.prerequisiteId];
      assert.ok(a && b, 'edge to unknown topic ' + d.topicId + ' <- ' + d.prerequisiteId);
      assert.strictEqual(E.subjectOf(a), E.subjectOf(b), 'edge crosses subjects ' + d.topicId);
      assert.ok(b.year <= a.year, 'prerequisite in a later year ' + d.topicId + ' <- ' + d.prerequisiteId);
      assert.ok(d.strength === 'hard' || d.strength === 'soft');
      assert.ok(d.reason && typeof d.reason === 'string');
    });
    topics.forEach((t) => E.ancestors(RG, t.id)); // throws on a cycle
    E.topoSort(RG, topics.map((t) => t.id));
  });

  test(label + ': questions follow data-format.md and are marked right by the engine', () => {
    const byTopic = {};
    const ids = new Set();
    questions.forEach((q) => {
      assert.ok(!ids.has(q.id), 'duplicate ' + q.id);
      ids.add(q.id);
      assert.ok(new RegExp('^' + q.topicId + '_q[1-5]$').test(q.id), q.id);
      assert.ok(RG.byId[q.topicId], q.id + ' unknown topic');
      assert.ok(['basic', 'standard', 'advanced'].includes(q.difficulty), q.id);
      assert.ok(['numeric', 'choice', 'short', 'self'].includes(q.type), q.id);
      ['prompt', 'answer', 'explanation'].forEach((f) => assert.ok(typeof q[f] === 'string' && q[f].trim(), q.id + ' ' + f));
      if (/_q1$/.test(q.id)) assert.notStrictEqual(q.difficulty, 'advanced', q.id + ' q1 is advanced');
      if (q.type === 'numeric') {
        if (!q.unordered) assert.ok(NUM_RE.test(q.answer.trim()), q.id + ' numeric answer ' + q.answer);
      }
      if (q.type === 'choice') {
        assert.ok(q.choices.length >= 3 && q.choices.length <= 4, q.id + ' needs 3-4 choices');
        q.choices.forEach((c, i) => assert.strictEqual(c.key, 'ABCD'[i], q.id + ' key order'));
        assert.strictEqual(new Set(q.choices.map((c) => c.text)).size, q.choices.length, q.id + ' duplicate texts');
        assert.ok(q.choices.some((c) => c.key === q.answer), q.id + ' answer letter');
      }
      if (q.figure != null) {
        assert.ok(q.figure.indexOf('<svg') === 0 && q.figure.indexOf('viewBox=') > 0, q.id + ' figure');
        assert.ok(!/<\s*script|foreignObject|<\s*image\b/i.test(q.figure), q.id + ' figure tags');
        assert.ok(!/https?:\/\//i.test(q.figure.replace('xmlns="http://www.w3.org/2000/svg"', '')), q.id + ' figure link');
      }
      if (q.say != null) assert.ok(typeof q.say === 'string' && q.say.trim(), q.id + ' say');
      if (q.type !== 'self') {
        assert.strictEqual(E.judgeQuestion(q, q.answer).verdict, 'correct', q.id + ' own answer not accepted');
        (q.accept || []).forEach((a) => assert.strictEqual(E.judgeQuestion(q, a).verdict, 'correct', q.id + ' accept ' + a));
      }
      (byTopic[q.topicId] = byTopic[q.topicId] || []).push(q);
    });
    topics.forEach((t) => {
      const qs = byTopic[t.id] || [];
      assert.ok(qs.length >= 4 || o.loose, t.id + ' has ' + qs.length + ' questions');
      assert.ok(qs.filter((q) => q.difficulty === 'basic').length >= 2, t.id + ' needs two basic questions');
      assert.ok(qs.some((q) => q.difficulty === 'standard'), t.id + ' needs a standard question');
    });
  });

  test(label + ': standards.json shape', () => {
    assert.ok(data.standards.source && typeof data.standards.source === 'object');
    data.standards.items.forEach((x) => {
      assert.ok(x.id && x.framework && x.text, 'standard ' + x.id);
      assert.ok(x.subject === 'maths' || x.subject === 'english', x.id + ' subject');
    });
  });

  console.log(label + ': check-ups');

  const formal = topics.filter((t) => !t.external);

  test(label + ': consistent student + unlimited questions => weak set and roots recovered exactly', () => {
    const rand = rng(20261024);
    let cases = 0;
    [0.05, 0.2, 0.5].forEach((p) => {
      const known = makeStudent(rand, p);
      formal.forEach((t) => {
        const { s, asked } = sim([t.id], known, new Set(), 9999);
        cases++;
        const sum = E.summarize(RG, s);
        const sub = E.subgraph(RG, [t.id]);
        const unknown = sub.nodes.filter((id) => E.isTestable(RG, id) && !known.has(id));
        assert.deepStrictEqual(sorted(sum.weak), sorted(unknown), 'weak set ' + t.id);
        sum.mastered.forEach((id) => assert.ok(known.has(id), id + ' marked mastered but unknown'));
        const expectRoots = unknown.filter((id) => RG.prereqs[id].every((x) => !unknown.includes(x.id)));
        assert.deepStrictEqual(sorted(sum.roots.map((r) => r.id)), sorted(expectRoots), 'roots ' + t.id);
        const per = {};
        asked.forEach((a) => { const id = a.split('#')[0]; per[id] = (per[id] || 0) + 1; });
        Object.keys(per).forEach((id) => assert.strictEqual(per[id], known.has(id) ? 1 : 2, id));
        const pathIds = sum.path.map((x) => x.id);
        sum.weak.forEach((id) => assert.ok(pathIds.includes(id)));
        for (let i = 1; i < sum.path.length; i++) {
          assert.ok(E.gradeRank(RG, sum.path[i].id) >= E.gradeRank(RG, sum.path[i - 1].id), 'path ordered by year');
        }
        assert.strictEqual(sum.finished, true);
      });
    });
    assert.ok(cases >= formal.length * 3);
  });

  test(label + ': shaky skill (wrong then right) => 2 questions, no backtracking, on the path', () => {
    formal.forEach((t) => {
      const { s, asked } = sim([t.id], new Set(), new Set([t.id]), 9999);
      assert.deepStrictEqual(asked, [t.id + '#1', t.id + '#2'], t.id);
      const sum = E.summarize(RG, s);
      assert.deepStrictEqual(sum.shaky, [t.id]);
      assert.deepStrictEqual(sum.path.map((x) => x.id), [t.id]);
    });
  });

  test(label + ': limits (4/8/16) are never broken; totals add up', () => {
    const rand = rng(11);
    [4, 8, 16].forEach((limit) => {
      const known = makeStudent(rand, 0.05);
      formal.forEach((t) => {
        const { s, asked } = sim([t.id], known, new Set(), limit);
        assert.ok(asked.length <= limit);
        const sum = E.summarize(RG, s);
        assert.strictEqual(sum.mastered.length + sum.shaky.length + sum.weak.length + sum.untested.length, s.order.length);
        sum.unconfirmed.forEach((id) => assert.ok(sum.weak.includes(id)));
      });
    });
  });

  test(label + ': seeds replay exactly; sessions survive JSON round trips', () => {
    const deep = formal.slice().sort((a, b) => E.ancestors(RG, b.id).size - E.ancestors(RG, a.id).size)[0];
    const a = sim([deep.id], new Set(), new Set(), 16, 'fixed');
    const b = sim([deep.id], new Set(), new Set(), 16, 'fixed');
    assert.deepStrictEqual(a.s.answers.map((x) => x.qid), b.s.answers.map((x) => x.qid));
    const r = E.replay(RG, JSON.parse(JSON.stringify(a.s.targets)), JSON.parse(JSON.stringify(a.s.answers)), { limit: 16, seed: 'fixed' });
    assert.deepStrictEqual(r, a.s);
    const lay = E.layout(RG, a.s, E.summarize(RG, a.s));
    const layer = Object.fromEntries(lay.nodes.map((n) => [n.id, n.layer]));
    lay.edges.forEach((e) => assert.ok(layer[e.from] < layer[e.to]));
  });

  console.log(label + ': whole-year screening');

  test(label + ': gradeTargets for every year and subject; maths is the default', () => {
    ['maths', 'english'].forEach((subj) => {
      for (let y = 0; y <= 6; y++) {
        const want = formal.filter((t) => t.year === y && E.subjectOf(t) === subj).map((t) => t.id);
        const g = E.gradeTargets(RG, y === 0 ? 'Kindergarten' : 'Year ' + y, subj);
        if (!want.length) { assert.strictEqual(g, null, subj + ' ' + y); continue; }
        assert.deepStrictEqual(g.ids, want, subj + ' year ' + y);
        assert.strictEqual(g.label, E.yearLabel(y));
        assert.deepStrictEqual(g.years, [y]);
        assert.deepStrictEqual(E.gradeTargets(RG, String(y), subj).ids, want);
        if (y === 0) assert.deepStrictEqual(E.gradeTargets(RG, 'K', subj).ids, want);
      }
    });
    const k = E.gradeTargets(RG, 'K');
    if (k) assert.ok(k.ids.every((id) => E.subjectOf(RG.byId[id]) === 'maths'));
    const all = E.gradeTargets(RG, 'K', 'all');
    if (all) assert.strictEqual(all.ids.length, formal.filter((t) => t.year === 0).length);
    assert.strictEqual(E.gradeTargets(RG, 'Year 7'), null);
    assert.strictEqual(E.gradeTargets(RG, ''), null);
  });

  function screenRun(ids, student, limit, seed) {
    let s = E.createSession(RG, ids, { mode: 'screen', limit: limit, seed: seed == null ? 'scr' : seed });
    for (let guard = 0; guard < 5000; guard++) {
      const it = E.nextItem(RG, s);
      if (!it) break;
      s = E.applyAnswer(RG, s, it.topicId, student(it.topicId, it.attempt));
    }
    return s;
  }
  const indexStudent = (id, attempt) => {
    const i = RG.index[id];
    if (i % 6 === 0) return 'wrong';
    if (i % 6 === 3) return attempt === 1 ? 'wrong' : 'correct';
    return 'correct';
  };
  const years = [];
  ['maths', 'english'].forEach((subj) => { for (let y = 0; y <= 6; y++) { const g = E.gradeTargets(RG, y, subj); if (g) years.push([subj, y, g]); } });

  test(label + ': screening stays inside the year, never breaks the limit, totals add up', () => {
    years.forEach(([subj, y, g]) => {
      [[() => 'wrong', 40], [() => 'correct', 40], [indexStudent, 40], [indexStudent, 3]].forEach(([stu, limit]) => {
        const s = screenRun(g.ids, stu, limit);
        assert.ok(s.answers.length <= limit);
        const inScope = new Set(g.ids);
        s.answers.forEach((a) => assert.ok(inScope.has(a.id), 'asked outside the year ' + a.id));
        const sum = E.summarize(RG, s);
        assert.strictEqual(sum.mastered.length + sum.shaky.length + sum.weak.length + sum.untested.length, g.ids.length, subj + y);
        sum.roots.forEach((r) => r.outOfScopePrereqs.forEach((p) => assert.ok(!inScope.has(p))));
        assert.ok(sum.path.every((p) => inScope.has(p.id) && p.isTarget === false));
      });
    });
  });

  test(label + ': chapterSummary groups by year + strand + focus area, weakest first', () => {
    years.forEach(([subj, y, g]) => {
      const s = screenRun(g.ids, indexStudent, 40);
      const sum = E.summarize(RG, s);
      const chs = E.chapterSummary(RG, s);
      assert.strictEqual(chs.reduce((n, c) => n + c.total, 0), g.ids.length);
      chs.forEach((c) => {
        assert.strictEqual(c.mastered + c.shaky + c.weak + c.untested, c.total);
        assert.strictEqual(c.year, y);
        c.weakIds.concat(c.shakyIds, c.untestedIds).forEach((id) => {
          const t = RG.byId[id];
          assert.strictEqual(c.key, t.year + '|' + t.strand + '|' + t.focusArea);
        });
      });
      assert.strictEqual(chs.reduce((n, c) => n + c.weak, 0), sum.weak.length);
      assert.strictEqual(chs.reduce((n, c) => n + c.shaky, 0), sum.shaky.length);
      for (let i = 1; i < chs.length; i++) {
        assert.ok(chs[i - 1].weak > chs[i].weak || (chs[i - 1].weak === chs[i].weak && chs[i - 1].shaky >= chs[i].shaky));
      }
    });
  });

  test(label + ': screening with a consistent student finds exactly what they do not know', () => {
    years.forEach(([subj, y, g]) => {
      const known = makeStudent(rng(100 + y), 0.5);
      const s = screenRun(g.ids, (id) => (known.has(id) ? 'correct' : 'wrong'), 1000);
      const sum = E.summarize(RG, s);
      assert.deepStrictEqual(sorted(sum.weak), sorted(g.ids.filter((id) => !known.has(id))));
      assert.strictEqual(sum.untested.length, 0);
    });
  });

  return { RG: RG };
}

const fixtures = loadSet(path.join(__dirname, 'fixtures'));
const FX = datasetSuite('Fixtures', fixtures).RG;

console.log('Fixtures: specific paths');

test('fixtures: Year 6 percentages backtracks through fractions to Year 3 and orders the path by year', () => {
  let s = E.createSession(FX, ['aum_y6_01'], { limit: 30, seed: 'p' });
  for (let i = 0; i < 40; i++) {
    const it = E.nextItem(FX, s);
    if (!it) break;
    s = E.applyAnswer(FX, s, it.topicId, it.topicId === 'aum_y5_01' ? 'correct' : 'wrong');
  }
  const sum = E.summarize(FX, s);
  assert.deepStrictEqual(sum.roots.map((r) => r.id), ['aum_y3_02']);
  assert.deepStrictEqual(sum.path.map((p) => p.id), ['aum_y3_02', 'aum_y4_01', 'aum_y6_01']);
  const chs = E.chapterSummary(FX, E.createSession(FX, E.gradeTargets(FX, 'Year 6').ids, { mode: 'screen' }));
  assert.ok(chs.some((c) => c.focusArea === 'Geometric measure' && c.strand === 'Measurement'));
  assert.ok(chs.some((c) => c.focusArea === 'Geometric measure' && c.strand === 'Space'), 'strand is part of the key');
});

test('fixtures: the say question and the figure question exist and are well formed', () => {
  const say = fixtures.questions.filter((q) => q.say);
  const fig = fixtures.questions.filter((q) => q.figure);
  assert.ok(say.length >= 1 && fig.length >= 1);
  assert.ok(say[0].prompt.toLowerCase().indexOf(say[0].answer) < 0, 'the prompt must not show the dictated word');
  assert.strictEqual(E.judgeQuestion(say[0], 'Ship.').verdict, 'correct');
});

const realDir = path.join(__dirname, '..', 'data');
if (['topics.json', 'dependencies.json', 'questions.json', 'standards.json'].every((f) => fs.existsSync(path.join(realDir, f)))) {
  try {
    datasetSuite('au/data', loadSet(realDir));
  } catch (e) {
    failed++;
    console.log('  FAIL au/data could not be loaded: ' + e.message);
  }
} else {
  console.log('au/data is not complete yet: skipping the real-data checks');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
