/* Check-up engine for the K-6 Learning Map. Pure functions, no DOM, no dependencies.
 * In the browser it is window.DiagEngine; in Node, require() it.
 *
 * Data flow: buildGraph(topics, deps, questions?) -> graph
 *            createSession(graph, targets, {limit, seed, avoid, mode}) -> session   (plain, JSON-serialisable)
 *            nextQuestion(graph, session) -> topicId | null      (next skill to check)
 *            nextItem(graph, session) -> {topicId, question, attempt} | null   (attempt is 1 or 2)
 *            applyAnswer(graph, session, id, 'correct'|'wrong'|'skip', {text}) -> new session (input untouched)
 *            summarize(graph, session) -> result (roots, learning path, mastered / shaky / weak / unknown)
 *            gradeTargets(graph, 'K'|'Kindergarten'|'Year 1'|'1'|..., subject?) -> {ids, years, volumes, label} | null
 *              subject defaults to 'maths'; 'english' takes English only; 'all' takes both.
 *            createSession(graph, ids, {mode:'screen'}) -> whole-year screening: scope = the targets themselves,
 *              backtracking never leaves the scope, default limit SCREEN_LIMIT
 *            chapterSummary(graph, session) -> summary per year + strand + focus area (weakest first)
 *            layout(graph, session, summary) -> layered layout for the path graph
 *            judgeQuestion(question, userText) -> {verdict:'correct'|'wrong'|'manual', reason}
 *            judgeAnswer(user, reference) -> same, comparing against the reference text only
 *
 * Topics carry `year` (0 = Kindergarten, 1-6 = Year 1 to Year 6), `strand` and `focusArea`.
 *
 * At most 2 questions per skill: first right -> mastered (and its ancestors are inferred mastered);
 * first wrong / "don't know" -> a second question at the same level or easier:
 *   second right -> shaky (no backtracking); second wrong too -> weak (backtrack into prerequisites, hard before soft).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.DiagEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ graph */

  const DIFF_RANK = { basic: 0, standard: 1, advanced: 2 };

  function qNum(q) { const m = /_q(\d+)$/.exec(q.id); return m ? parseInt(m[1], 10) : 0; }

  function buildGraph(topics, deps, questions) {
    const byId = Object.create(null);
    const index = Object.create(null);
    topics.forEach(function (t, i) { byId[t.id] = t; index[t.id] = i; });
    const prereqs = Object.create(null);
    const dependents = Object.create(null);
    topics.forEach(function (t) { prereqs[t.id] = []; dependents[t.id] = []; });
    const seen = Object.create(null);
    deps.forEach(function (d) {
      if (!byId[d.topicId] || !byId[d.prerequisiteId]) return;
      const k = d.topicId + '<' + d.prerequisiteId;
      if (seen[k]) return;
      seen[k] = true;
      const strength = d.strength === 'soft' ? 'soft' : 'hard';
      prereqs[d.topicId].push({ id: d.prerequisiteId, strength: strength, reason: d.reason });
      dependents[d.prerequisiteId].push({ id: d.topicId, strength: strength });
    });
    // Prerequisites: hard first, then soft; ties keep topics.json order, so question order is deterministic.
    const rank = function (e) { return (e.strength === 'hard' ? 0 : 1) * 1e6 + index[e.id]; };
    Object.keys(prereqs).forEach(function (id) {
      prereqs[id].sort(function (a, b) { return rank(a) - rank(b); });
      dependents[id].sort(function (a, b) { return index[a.id] - index[b.id]; });
    });
    // Question bank per topic, sorted by question number. A topic without bank questions falls back
    // to its `diagnostic_question` (kept for hand-made test graphs).
    const bank = Object.create(null);
    topics.forEach(function (t) { bank[t.id] = []; });
    let fromFile = 0;
    (Array.isArray(questions) ? questions : []).forEach(function (q) {
      if (q && bank[q.topicId] && !byId[q.topicId].external) { bank[q.topicId].push(q); fromFile++; }
    });
    topics.forEach(function (t) {
      const dq = t.diagnostic_question;
      if (!t.external && !bank[t.id].length && dq && dq.question) {
        bank[t.id].push({ id: t.id + '_q1', topicId: t.id, difficulty: 'standard', type: 'legacy', prompt: dq.question, answer: dq.answer, explanation: '' });
      }
    });
    Object.keys(bank).forEach(function (id) { bank[id].sort(function (a, b) { return qNum(a) - qNum(b); }); });
    return {
      topics: topics, byId: byId, index: index, prereqs: prereqs, dependents: dependents, bank: bank,
      hasBank: fromFile > 0, _anc: Object.create(null)
    };
  }

  /** Strict ancestor set (excluding the node itself), memoised. */
  function ancestorSet(graph, id) {
    const memo = graph._anc;
    if (memo[id]) return memo[id];
    const visiting = graph._visiting || (graph._visiting = Object.create(null));
    if (visiting[id]) throw new Error('The prerequisite graph has a cycle at ' + id);
    visiting[id] = true;
    const out = new Set();
    graph.prereqs[id].forEach(function (p) {
      out.add(p.id);
      ancestorSet(graph, p.id).forEach(function (a) { out.add(a); });
    });
    visiting[id] = false;
    memo[id] = out;
    return out;
  }

  function ancestors(graph, ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const out = new Set();
    list.forEach(function (id) { ancestorSet(graph, id).forEach(function (a) { out.add(a); }); });
    return out;
  }

  /** Topological sort of a subset (prerequisites first); ties keep topics.json order. */
  function topoSort(graph, ids) {
    const set = new Set(ids);
    const indeg = Object.create(null);
    set.forEach(function (id) {
      indeg[id] = graph.prereqs[id].filter(function (p) { return set.has(p.id); }).length;
    });
    const ready = [];
    set.forEach(function (id) { if (indeg[id] === 0) ready.push(id); });
    const byIndex = function (a, b) { return graph.index[a] - graph.index[b]; };
    const order = [];
    while (ready.length) {
      ready.sort(byIndex);
      const id = ready.shift();
      order.push(id);
      graph.dependents[id].forEach(function (d) {
        if (!set.has(d.id)) return;
        indeg[d.id] -= 1;
        if (indeg[d.id] === 0) ready.push(d.id);
      });
    }
    if (order.length !== set.size) throw new Error('Topological sort failed: the subgraph has a cycle');
    return order;
  }

  /** Prerequisite subgraph of the targets: targets + all ancestors, in topological order. */
  function subgraph(graph, targets) {
    const set = new Set(targets);
    ancestors(graph, targets).forEach(function (a) { set.add(a); });
    return { nodes: topoSort(graph, set), set: set };
  }

  function isTestable(graph, id) {
    const t = graph.byId[id];
    return !!(t && !t.external && graph.bank[id] && graph.bank[id].length);
  }

  function questionById(graph, qid) {
    const m = /^(.*)_q\d+$/.exec(qid || '');
    const list = m ? graph.bank[m[1]] : null;
    return (list || []).find(function (q) { return q.id === qid; }) || null;
  }

  /* ------------------------------------------------------------------ session */

  const RESULTS = { correct: 1, wrong: 1, skip: 1 };
  const DEFAULT_LIMIT = 16;
  const SCREEN_LIMIT = 40;

  function createSession(graph, targets, opts) {
    opts = opts || {};
    const ts = Array.from(new Set(targets));
    if (!ts.length) throw new Error('At least one target skill is needed');
    ts.forEach(function (id) { if (!graph.byId[id]) throw new Error('Unknown skill: ' + id); });
    const screen = opts.mode === 'screen';
    const limit = Math.max(1, Math.floor(opts.limit == null ? (screen ? SCREEN_LIMIT : DEFAULT_LIMIT) : opts.limit));
    // Screening: the scope is the target set itself (ancestors are not added); backtracking stays inside it.
    const sub = screen ? { nodes: topoSort(graph, ts) } : subgraph(graph, ts);
    const pos = Object.create(null);
    sub.nodes.forEach(function (id, i) { pos[id] = i; });
    // The target furthest along (latest in topological order) is asked first; the rest wait on the stack.
    const stack = ts.filter(function (id) { return isTestable(graph, id); })
      .sort(function (a, b) { return pos[b] - pos[a]; });
    return {
      targets: ts, limit: limit, order: sub.nodes, status: {}, stack: stack, answers: [], attempts: {},
      mode: screen ? 'screen' : 'target', scope: screen ? ts.slice() : null,
      seed: opts.seed == null ? 'default' : String(opts.seed),
      avoid: Array.from(new Set(opts.avoid || []))
    };
  }

  function cloneSession(s) {
    const attempts = {};
    Object.keys(s.attempts).forEach(function (k) { attempts[k] = s.attempts[k].slice(); });
    return {
      targets: s.targets.slice(), limit: s.limit, order: s.order, stack: s.stack.slice(),
      status: Object.assign({}, s.status), answers: s.answers.slice(), attempts: attempts,
      seed: s.seed, avoid: s.avoid, mode: s.mode, scope: s.scope ? s.scope.slice() : null
    };
  }

  /* ---- Seeded randomness: the same (seed, skill, attempt) always gives the same number, so sessions replay ---- */
  function hashStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rand01(seed, key) {
    const f = mulberry32(hashStr(String(seed) + '|' + key));
    f();
    return f();
  }

  const rankOf = function (q) { return DIFF_RANK[q.difficulty] == null ? 1 : DIFF_RANK[q.difficulty]; };

  /**
   * Pick question number `attempt` (1 or 2) for skill `id`.
   *  - a question already asked in this session is never repeated;
   *  - first question: prefer questions not seen before (outside session.avoid) and avoid `advanced` when possible;
   *  - second question: same level or easier - basic first, then the first question's level, then anything easier,
   *    and only when nothing else is left the easiest harder one; difficulty beats "not seen before",
   *    and within a tier unseen questions still win;
   *  - within the chosen tier a seeded pseudo-random number picks one.
   */
  function pickQuestion(graph, session, id, attempt) {
    const all = graph.bank[id] || [];
    const tried = (session.attempts[id] || []).map(function (a) { return a.qid; });
    const pool = all.filter(function (q) { return tried.indexOf(q.id) < 0; });
    if (!pool.length) return null;
    const avoid = new Set(session.avoid || []);
    const freshFirst = function (list) {
      const f = list.filter(function (q) { return !avoid.has(q.id); });
      return f.length ? f : list;
    };
    let cand;
    if (attempt <= 1) {
      cand = freshFirst(pool);
      const nonAdv = cand.filter(function (q) { return rankOf(q) < 2; });
      if (nonAdv.length) cand = nonAdv;
    } else {
      const first = all.find(function (q) { return q.id === tried[0]; });
      const r0 = first ? rankOf(first) : 1;
      const tiers = [
        pool.filter(function (q) { return rankOf(q) === 0; }),
        pool.filter(function (q) { return rankOf(q) === r0; }),
        pool.filter(function (q) { return rankOf(q) < r0; })
      ];
      const hit = tiers.find(function (t) { return t.length; });
      if (hit) cand = freshFirst(hit);
      else {
        const lo = Math.min.apply(null, pool.map(rankOf));
        cand = freshFirst(pool.filter(function (q) { return rankOf(q) === lo; }));
      }
    }
    const idx = Math.min(cand.length - 1, Math.floor(rand01(session.seed, id + '|' + attempt) * cand.length));
    return cand[idx];
  }

  /**
   * Record one answer (to the question nextItem offered).
   *  - first question correct: the skill and every undecided ancestor become mastered (ancestors as inferred);
   *  - first question wrong/skip: no verdict yet; the skill stays on top and gets a second question
   *    (if there is no second question it is weak straight away);
   *  - second question correct: shaky, no backtracking;
   *  - second question wrong/skip: weak, and its prerequisites (hard first, then soft) go on top of the stack.
   * A direct verdict is never overwritten by an inferred one. extra.text is what the child typed (for the log).
   */
  function applyAnswer(graph, session, id, result, extra) {
    if (!RESULTS[result]) throw new Error('The result must be correct, wrong or skip');
    if (!graph.byId[id]) throw new Error('Unknown skill: ' + id);
    const s = cloneSession(session);
    if (s.status[id]) { delete s.status[id]; s.attempts[id] = []; } // answering a decided skill again starts it over
    const prev = s.attempts[id] || [];
    const q = pickQuestion(graph, s, id, prev.length + 1);
    const rec = { id: id, qid: q ? q.id : null, result: result };
    if (extra && extra.text != null && extra.text !== '') rec.text = String(extra.text);
    s.answers.push(rec);
    s.attempts[id] = prev.concat([{ qid: rec.qid, result: result }]);
    const nth = s.attempts[id].length;
    if (result === 'correct') {
      if (nth === 1) {
        s.status[id] = { s: 'mastered', src: 'direct' };
        ancestorSet(graph, id).forEach(function (a) {
          if (!s.status[a]) s.status[a] = { s: 'mastered', src: 'inferred' };
        });
      } else {
        s.status[id] = { s: 'shaky', src: 'direct' };
      }
    } else if (nth === 1 && pickQuestion(graph, s, id, 2)) {
      // First question missed: wait for the second one before deciding.
    } else {
      s.status[id] = { s: 'weak', src: 'direct' };
      const scope = s.scope ? new Set(s.scope) : null;
      const push = graph.prereqs[id]
        .map(function (p) { return p.id; })
        .filter(function (p) { return isTestable(graph, p) && !s.status[p] && (!scope || scope.has(p)); });
      const pushed = new Set(push);
      s.stack = push.concat(s.stack.filter(function (x) { return !pushed.has(x); }));
    }
    return s;
  }

  function nextQuestion(graph, session) {
    if (session.answers.length >= session.limit) return null;
    for (let i = 0; i < session.stack.length; i++) {
      const id = session.stack[i];
      if (!session.status[id] && isTestable(graph, id)) return id;
    }
    return null;
  }

  function nextItem(graph, session) {
    const id = nextQuestion(graph, session);
    if (!id) return null;
    const attempt = (session.attempts[id] || []).length + 1;
    const q = pickQuestion(graph, session, id, attempt);
    return q ? { topicId: id, question: q, attempt: attempt } : null;
  }

  /** Rebuild a session from its answer log (resume after refresh, undo, corrections). */
  function replay(graph, targets, answers, opts) {
    let s = createSession(graph, targets, opts);
    answers.forEach(function (a) { s = applyAnswer(graph, s, a.id, a.result, { text: a.text }); });
    return s;
  }

  /** mastered / shaky / weak / unknown. A skill that missed its first question when the limit ran out counts as weak. */
  function statusOf(session, id) {
    const st = session.status[id];
    if (st) return st.s;
    return isUnconfirmed(session, id) ? 'weak' : 'unknown';
  }

  /** First question wrong, but no room left for the second one. */
  function isUnconfirmed(session, id) {
    const a = session.attempts[id];
    return !session.status[id] && !!a && a.length === 1 && a[0].result !== 'correct';
  }

  /* ------------------------------------------------------------------ results */

  function summarize(graph, session) {
    const nodes = session.order;
    const st = function (id) { return statusOf(session, id); };
    const mastered = nodes.filter(function (id) { return st(id) === 'mastered'; });
    const shaky = nodes.filter(function (id) { return st(id) === 'shaky'; });
    const weak = nodes.filter(function (id) { return st(id) === 'weak'; });
    const unconfirmed = weak.filter(function (id) { return isUnconfirmed(session, id); });
    const untested = nodes.filter(function (id) { return st(id) === 'unknown'; });
    const scope = session.scope ? new Set(session.scope) : null;
    const inScope = function (id) { return !scope || scope.has(id); };

    const roots = weak.filter(function (id) {
      return !graph.prereqs[id].some(function (p) { return st(p.id) === 'weak'; });
    }).map(function (id) {
      const unk = graph.prereqs[id].filter(function (p) { return st(p.id) === 'unknown'; });
      const testableUnk = unk.filter(function (p) { return isTestable(graph, p.id); });
      return {
        id: id,
        // Prerequisites not reached before the limit ran out - the real root may be earlier.
        pendingPrereqs: testableUnk.filter(function (p) { return inScope(p.id); }).map(function (p) { return p.id; }),
        // Screening only: prerequisites outside the chosen year (not checked).
        outOfScopePrereqs: testableUnk.filter(function (p) { return !inScope(p.id); }).map(function (p) { return p.id; }),
        // Prerequisites with no questions (not checked).
        externalPrereqs: unk.filter(function (p) { return !isTestable(graph, p.id); }).map(function (p) { return p.id; })
      };
    });

    // Learning path: everything reachable downstream from (roots + shaky) inside the subgraph, minus mastered.
    const inSub = new Set(nodes);
    const reach = new Set();
    const queue = roots.map(function (r) { return r.id; }).concat(shaky);
    queue.forEach(function (id) { reach.add(id); });
    while (queue.length) {
      const id = queue.shift();
      graph.dependents[id].forEach(function (d) {
        if (inSub.has(d.id) && !reach.has(d.id)) { reach.add(d.id); queue.push(d.id); }
      });
    }
    const rootSet = new Set(roots.map(function (r) { return r.id; }));
    const targetSet = new Set(scope ? [] : session.targets); // in screening every skill is a target, so none is marked
    const topoPos = Object.create(null);
    nodes.forEach(function (id, i) { topoPos[id] = i; });
    const path = nodes.filter(function (id) { return reach.has(id) && st(id) !== 'mastered'; })
      .map(function (id) {
        return { id: id, status: st(id), isRoot: rootSet.has(id), isTarget: targetSet.has(id) };
      });
    // Ordered by year (Kindergarten first); within a year, topological order (prerequisites first).
    path.sort(function (a, b) {
      return gradeRank(graph, a.id) - gradeRank(graph, b.id) || topoPos[a.id] - topoPos[b.id];
    });

    const pending = session.stack.filter(function (id) { return !session.status[id] && isTestable(graph, id); });
    const next = nextQuestion(graph, session);
    return {
      mode: session.mode || 'target',
      targets: session.targets.slice(),
      asked: session.answers.length,
      limit: session.limit,
      finished: next === null,
      limitReached: session.answers.length >= session.limit && pending.length > 0,
      mastered: mastered, shaky: shaky, weak: weak, unconfirmed: unconfirmed, untested: untested,
      roots: roots, path: path
    };
  }

  /* ------------------------------------------------------------------ path graph layout */

  /**
   * Nodes drawn: learning path + targets + roots + every skill actually asked.
   * Edges: transitive reduction of reachability between those nodes; edges that are not a direct
   * prerequisite get direct:false (drawn dotted). Layers run top to bottom, prerequisites on top.
   */
  function layout(graph, session, summary) {
    const S = new Set();
    const screen = !!session.scope;
    summary.path.forEach(function (p) { S.add(p.id); });
    if (!screen) session.targets.forEach(function (id) { S.add(id); });
    summary.roots.forEach(function (r) { S.add(r.id); });
    session.answers.forEach(function (a) { S.add(a.id); });
    if (S.size < 3 && !screen) {
      session.targets.forEach(function (id) {
        graph.prereqs[id].slice(0, 6).forEach(function (p) { S.add(p.id); });
      });
    }
    const ids = topoSort(graph, S);
    const edges = [];
    ids.forEach(function (b) {
      const anc = ancestorSet(graph, b);
      ids.forEach(function (a) {
        if (a === b || !anc.has(a)) return;
        const between = ids.some(function (c) {
          return c !== a && c !== b && anc.has(c) && ancestorSet(graph, c).has(a);
        });
        if (between) return;
        const direct = graph.prereqs[b].find(function (p) { return p.id === a; });
        edges.push({ from: a, to: b, direct: !!direct, strength: direct ? direct.strength : 'hard' });
      });
    });
    const layer = Object.create(null);
    ids.forEach(function (id) {
      let l = 0;
      edges.forEach(function (e) { if (e.to === id) l = Math.max(l, layer[e.from] + 1); });
      layer[id] = l;
    });
    const nLayers = ids.reduce(function (m, id) { return Math.max(m, layer[id] + 1); }, 1);
    const rows = [];
    for (let i = 0; i < nLayers; i++) rows.push([]);
    ids.forEach(function (id) { rows[layer[id]].push(id); });
    // Barycentre passes to reduce crossings.
    const slot = Object.create(null);
    rows.forEach(function (r) { r.forEach(function (id, i) { slot[id] = i; }); });
    const bary = function (id, nbrs) {
      if (!nbrs.length) return slot[id];
      return nbrs.reduce(function (s, n) { return s + slot[n]; }, 0) / nbrs.length;
    };
    for (let it = 0; it < 4; it++) {
      for (let l = 1; l < nLayers; l++) {
        rows[l].sort(function (a, b) {
          return bary(a, edges.filter(function (e) { return e.to === a; }).map(function (e) { return e.from; })) -
                 bary(b, edges.filter(function (e) { return e.to === b; }).map(function (e) { return e.from; }));
        });
        rows[l].forEach(function (id, i) { slot[id] = i; });
      }
      for (let l = nLayers - 2; l >= 0; l--) {
        rows[l].sort(function (a, b) {
          return bary(a, edges.filter(function (e) { return e.from === a; }).map(function (e) { return e.to; })) -
                 bary(b, edges.filter(function (e) { return e.from === b; }).map(function (e) { return e.to; }));
        });
        rows[l].forEach(function (id, i) { slot[id] = i; });
      }
    }
    const rootSet = new Set(summary.roots.map(function (r) { return r.id; }));
    const targetSet = new Set(screen ? [] : session.targets);
    const nodes = [];
    rows.forEach(function (r, l) {
      r.forEach(function (id, i) {
        nodes.push({
          id: id, layer: l, col: i, cols: r.length,
          status: statusOf(session, id), isTarget: targetSet.has(id), isRoot: rootSet.has(id)
        });
      });
    });
    return { nodes: nodes, edges: edges, layers: nLayers, maxCols: rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1) };
  }

  /* ------------------------------------------------------------------ years, strands, focus areas */

  /** 'Kindergarten' for 0, 'Year 1' ... 'Year 6'. */
  function yearLabel(year) {
    if (year === 0) return 'Kindergarten';
    if (typeof year === 'number' && year >= 1) return 'Year ' + year;
    return '';
  }

  /** NSW stage of a year: 0 -> 'Early Stage 1', 1-2 -> 'Stage 1', 3-4 -> 'Stage 2', 5-6 -> 'Stage 3'. */
  function stageOf(year) {
    if (year === 0) return 'Early Stage 1';
    if (year === 1 || year === 2) return 'Stage 1';
    if (year === 3 || year === 4) return 'Stage 2';
    if (year === 5 || year === 6) return 'Stage 3';
    return '';
  }

  /**
   * Parse a whole-year scope: 'K', 'Kindergarten', 'Kindy', 'Foundation', 'F', '0' -> 0;
   * 'Year 1', 'Yr 1', 'Y1', '1', 1 -> 1, ... up to 6. Anything else -> null.
   */
  function parseYear(scope) {
    if (typeof scope === 'number') return scope >= 0 && scope <= 6 && scope % 1 === 0 ? scope : null;
    const s = String(scope == null ? '' : scope).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    if (/^(k|kindy|kinder|kindergarten|f|foundation|prep|0|year 0|y0|yr 0)$/.test(s)) return 0;
    const m = /^(?:year|yr|y)? ?([1-6])$/.exec(s);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Year used to order the learning path. Hand-made graphs without `year` get 0. */
  function gradeRank(graph, id) {
    const t = graph.byId[id];
    if (!t || typeof t.year !== 'number') return 0;
    return t.year;
  }

  /** Grouping used by the summary: year + strand + focus area. */
  function groupOf(topic) {
    const t = topic || {};
    const year = typeof t.year === 'number' ? t.year : null;
    const strand = t.strand || '';
    const focusArea = t.focusArea || strand || 'Other';
    const yl = year == null ? '' : yearLabel(year);
    return {
      key: (year == null ? '' : year) + '|' + strand + '|' + focusArea,
      year: year, yearLabel: yl, strand: strand, focusArea: focusArea,
      label: [yl, strand, focusArea].filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' · ')
    };
  }

  /** Compatibility with the original engine: {volume, chapterNo, chapterName, section}. */
  function parseChapter(topicOrText) {
    if (topicOrText && typeof topicOrText === 'object') {
      const g = groupOf(topicOrText);
      return { volume: g.yearLabel, chapterNo: g.strand, chapterName: g.focusArea, section: '' };
    }
    return { volume: '', chapterNo: '', chapterName: String(topicOrText || ''), section: '' };
  }

  /** Subject: the `subject` field wins; otherwise aue_ means English and everything else is maths. */
  function subjectOf(topic) {
    if (!topic) return 'maths';
    if (topic.subject === 'english') return 'english';
    if (topic.subject === 'maths' || topic.subject === 'math') return 'maths';
    if (String(topic.id || '').indexOf('aue_') === 0) return 'english';
    return 'maths';
  }

  function normSubject(subject) {
    if (subject == null || subject === '') return 'maths';
    if (subject === 'math') return 'maths';
    return subject;
  }

  /**
   * Every skill in a whole year for one subject. scope: 'K', 'Kindergarten', 'Year 1', '1', ...
   * subject: 'maths' (default), 'english' or 'all'.
   * Returns {ids, years, volumes, label} with ids in topics.json order, or null when the scope
   * is not understood or the year has no skills.
   */
  function gradeTargets(graph, scope, subject) {
    const subj = normSubject(subject);
    const year = parseYear(scope);
    if (year == null) return null;
    const ids = graph.topics.filter(function (t) {
      if (t.external) return false;
      if (subj !== 'all' && subjectOf(t) !== subj) return false;
      return t.year === year;
    }).map(function (t) { return t.id; });
    const label = yearLabel(year);
    return ids.length ? { ids: ids, years: [year], volumes: [label], label: label } : null;
  }

  /**
   * Summary by year + strand + focus area: counts of got it / shaky / needs work / not checked, plus the ids.
   * Groups come in teaching order, then a stable sort puts the most "needs work", then most "shaky", first.
   */
  function chapterSummary(graph, session) {
    const inOrder = new Set(session.order);
    const byKey = Object.create(null);
    const list = [];
    graph.topics.forEach(function (t) {
      if (t.external || !inOrder.has(t.id)) return;
      const g = groupOf(t);
      let ch = byKey[g.key];
      if (!ch) {
        ch = byKey[g.key] = {
          key: g.key, year: g.year, yearLabel: g.yearLabel, strand: g.strand, focusArea: g.focusArea,
          volume: g.yearLabel, chapterNo: g.strand, chapterName: g.focusArea, label: g.label,
          total: 0, mastered: 0, shaky: 0, weak: 0, untested: 0, weakIds: [], shakyIds: [], untestedIds: [], _i: list.length
        };
        list.push(ch);
      }
      const st = statusOf(session, t.id);
      ch.total++;
      if (st === 'mastered') ch.mastered++;
      else if (st === 'shaky') { ch.shaky++; ch.shakyIds.push(t.id); }
      else if (st === 'weak') { ch.weak++; ch.weakIds.push(t.id); }
      else { ch.untested++; ch.untestedIds.push(t.id); }
    });
    list.sort(function (a, b) { return b.weak - a.weak || b.shaky - a.shaky || a._i - b._i; });
    list.forEach(function (ch) { delete ch._i; });
    return list;
  }

  /**
   * Expand ids from the URL into graph topics. aliases look like { "old_id": { targets: [...] } } or { id: [...] }.
   * Unknown ids are kept so createSession can report them.
   */
  function resolveTargets(rawIds, aliases) {
    const map = aliases || {};
    const out = [];
    const seen = Object.create(null);
    (Array.isArray(rawIds) ? rawIds : [rawIds]).forEach(function (id) {
      if (!id) return;
      let targets = null;
      const spec = map[id];
      if (spec && Array.isArray(spec.targets)) targets = spec.targets;
      else if (Array.isArray(spec)) targets = spec;
      const list = targets && targets.length ? targets : [id];
      list.forEach(function (tid) {
        if (!seen[tid]) { seen[tid] = true; out.push(tid); }
      });
    });
    return out;
  }

  /* ------------------------------------------------------------------ marking */

  const VULGAR = {
    '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5',
    '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8',
    '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅐': '1/7', '⅑': '1/9', '⅒': '1/10'
  };
  const MIXED = '_'; // internal marker between the whole part and the fraction of a mixed number ("1 1/2" -> "1_1/2")

  /**
   * Normalise an answer for comparison: Unicode compatibility forms, minus signs, quotes, x and division signs,
   * vulgar fractions, mixed numbers, "°C", lower case, all spaces removed, an "answer:" prefix and a trailing
   * full stop / exclamation / question mark removed, surrounding quotes removed, thousands separators removed.
   */
  function normalizeText(input) {
    let s = String(input == null ? '' : input);
    s = s.replace(/[½⅐-⅞¼¾]/g, function (c) { return ' ' + VULGAR[c]; });
    s = s.replace(/²/g, '^2').replace(/³/g, '^3').replace(/[º˚∘]/g, '°');
    s = s.normalize('NFKC');
    s = s.replace(/[−‐-―﹣]/g, '-')
      .replace(/⁄/g, '/')
      .replace(/[“”„]/g, '"')
      .replace(/[‘’‚ʼ`]/g, "'")
      .replace(/[×·⋅∙]/g, '*')
      .replace(/÷/g, '/')
      .replace(/¢/g, 'c')
      .replace(/[≦⩽]/g, '≤').replace(/[≧⩾]/g, '≥')
      .replace(/<=/g, '≤').replace(/>=/g, '≥')
      .replace(/[\[\]{}]/g, function (c) { return c === '[' || c === '{' ? '(' : ')'; });
    s = s.replace(/(\d)\s+and\s+(?=\d+\s*\/\s*\d+)/gi, '$1 '); // "1 and 1/2" is a mixed number, not a list
    s = s.replace(/(\d)\s+(\d+\s*\/\s*\d+)/g, '$1' + MIXED + '$2'); // mixed number "1 1/2"
    s = s.replace(/(\d)\s*(?:degrees?\s*celsius|deg\s*c|celsius)\b/gi, '$1°c');
    s = s.replace(/(\d)\s*(?:degrees?|deg)\b/gi, '$1°');
    s = s.replace(/\s+/g, '').toLowerCase();
    s = s.replace(/^(?:answer|ans|a)[:=]/, '');
    s = s.replace(/[.!?]+$/, '');
    s = s.replace(/^["']+(.*?)["']+$/, '$1');
    if (/^[+-]?\$?\d{1,3}(,\d{3})+(\.\d+)?[a-z°$%^0-9]*$/.test(s)) s = s.replace(/,/g, ''); // thousands separators
    return s;
  }

  /** Turn "3 and 4", "3 or 4", "3 & 4" into a comma list before normalising. */
  function listify(input) {
    return String(input == null ? '' : input)
      .replace(/(\d)\s+and\s+(?=\d+\s*\/\s*\d+)/gi, '$1 ')
      .replace(/\s+(?:and|or|&)\s+/gi, ', ');
  }

  function splitTop(s, seps) {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && seps.indexOf(c) >= 0) { parts.push(cur); cur = ''; } else cur += c;
    }
    parts.push(cur);
    return parts.filter(function (p) { return p !== ''; });
  }

  function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { const t = a % b; a = b; b = t; } return a; }

  function ratio(n, d) {
    if (d === 0n) return null;
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    return [n / g, d / g];
  }

  function decToRatio(str) {
    const i = str.indexOf('.');
    if (i < 0) return ratio(BigInt(str), 1n);
    const frac = str.slice(i + 1);
    const whole = str.slice(0, i) || '0';
    return ratio(BigInt(whole + frac), 10n ** BigInt(frac.length));
  }

  function isWrapped(t) {
    if (t[0] !== '(' || t[t.length - 1] !== ')') return false;
    let depth = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')') { depth--; if (depth === 0 && i < t.length - 1) return false; }
    }
    return depth === 0;
  }

  // Unit spellings after normalisation (lower case, no spaces) -> canonical unit.
  const UNIT_ALIASES = {
    'mm': 'mm', 'millimetre': 'mm', 'millimetres': 'mm', 'millimeter': 'mm', 'millimeters': 'mm',
    'cm': 'cm', 'centimetre': 'cm', 'centimetres': 'cm', 'centimeter': 'cm', 'centimeters': 'cm',
    'm': 'm', 'metre': 'm', 'metres': 'm', 'meter': 'm', 'meters': 'm',
    'km': 'km', 'kilometre': 'km', 'kilometres': 'km', 'kilometer': 'km', 'kilometers': 'km',
    'g': 'g', 'gram': 'g', 'grams': 'g', 'gm': 'g',
    'kg': 'kg', 'kilogram': 'kg', 'kilograms': 'kg', 'kilo': 'kg', 'kilos': 'kg',
    'ml': 'mL', 'millilitre': 'mL', 'millilitres': 'mL', 'milliliter': 'mL', 'milliliters': 'mL',
    'l': 'L', 'litre': 'L', 'litres': 'L', 'liter': 'L', 'liters': 'L',
    'min': 'min', 'mins': 'min', 'minute': 'min', 'minutes': 'min',
    'h': 'h', 'hr': 'h', 'hrs': 'h', 'hour': 'h', 'hours': 'h',
    's': 's', 'sec': 's', 'secs': 's', 'second': 's', 'seconds': 's',
    '°c': '°C', '°': '°',
    '$': '$', 'dollar': '$', 'dollars': '$',
    'c': 'c', 'cent': 'c', 'cents': 'c',
    '%': '%', 'percent': '%', 'percentage': '%',
    'mm^2': 'mm^2', 'cm^2': 'cm^2', 'm^2': 'm^2', 'km^2': 'km^2', 'cm^3': 'cm^3', 'm^3': 'm^3',
    'mm2': 'mm^2', 'cm2': 'cm^2', 'm2': 'm^2', 'km2': 'km^2', 'cm3': 'cm^3', 'm3': 'm^3',
    'squarecentimetres': 'cm^2', 'squaremetres': 'm^2', 'squarekilometres': 'km^2', 'squaremillimetres': 'mm^2',
    'cubiccentimetres': 'cm^3', 'cubicmetres': 'm^3',
    'ha': 'ha', 'hectare': 'ha', 'hectares': 'ha', 't': 't', 'tonne': 't', 'tonnes': 't'
  };

  function canonUnit(u) {
    if (!u) return { name: '', known: true };
    if (UNIT_ALIASES[u]) return { name: UNIT_ALIASES[u], known: true };
    return null; // does not look like a unit, so this is not "number + unit"
  }

  /** Parse a number: integer, decimal, fraction a/b, mixed number, sign, brackets, "$" prefix, unit suffix. null if not a number. */
  function parseNumeric(str) {
    let t = str;
    let neg = false;
    for (let guard = 0; guard < 4; guard++) {
      if (isWrapped(t)) { t = t.slice(1, -1); continue; }
      if ((t[0] === '-' || t[0] === '+') && isWrapped(t.slice(1))) { if (t[0] === '-') neg = !neg; t = t.slice(2, -1); continue; }
      break;
    }
    let dollarPrefix = false;
    const pre = /^([+-]?)\$(.*)$/.exec(t);
    if (pre) { dollarPrefix = true; t = pre[1] + pre[2]; }
    const m = new RegExp('^([+-]?)(?:(\\d+)' + MIXED + ')?(\\d+(?:\\.\\d+)?|\\.\\d+)(?:/(\\d+(?:\\.\\d+)?|\\.\\d+))?(.*)$').exec(t);
    if (!m) return null;
    const whole = m[2], numS = m[3], denS = m[4];
    const rest = m[5];
    if (whole && !denS) return null;
    let val;
    if (whole) {
      const n = decToRatio(numS), d = decToRatio(denS);
      if (!n || !d || d[0] === 0n) return null;
      const f = ratio(n[0] * d[1], n[1] * d[0]);
      const w = ratio(BigInt(whole), 1n);
      val = ratio(w[0] * f[1] + f[0], f[1]);
    } else if (denS) {
      const n = decToRatio(numS), d = decToRatio(denS);
      if (!n || !d || d[0] === 0n) return null;
      val = ratio(n[0] * d[1], n[1] * d[0]);
    } else {
      val = decToRatio(numS);
    }
    if (!val) return null;
    if (m[1] === '-') neg = !neg;
    const n = neg ? -val[0] : val[0];
    const d = val[1];
    let unit = { name: '', known: true };
    if (dollarPrefix) {
      if (rest && rest !== '$' && rest !== 'dollars' && rest !== 'dollar') return null;
      unit = { name: '$', known: true };
    } else if (rest) {
      unit = canonUnit(rest);
      if (!unit) return null;
    }
    return { key: n + '/' + d, unit: unit };
  }

  function analyzePart(p) {
    let variable = '';
    let body = p;
    const m = /^([a-z](?:\([a-z]\))?)=(.+)$/.exec(p);
    if (m) { variable = m[1]; body = m[2]; }
    const num = parseNumeric(body);
    if (num) return { raw: p, variable: variable, kind: 'num', key: num.key, unit: num.unit };
    const tm = /^\((.+)\)$/.exec(body);
    if (tm) {
      const items = splitTop(tm[1], ',');
      const nums = items.map(parseNumeric);
      if (items.length > 1 && nums.every(Boolean)) {
        return { raw: p, variable: variable, kind: 'tuple', key: 't:' + nums.map(function (x) { return x.key; }).join(','), unit: { name: '', known: true } };
      }
    }
    return { raw: p, variable: variable, kind: 'text', key: body, unit: { name: '', known: true } };
  }

  function parseAnswer(input) {
    const norm = normalizeText(input);
    const parts = splitTop(normalizeText(listify(input)), ',;').map(analyzePart);
    return { norm: norm, parts: parts };
  }

  // 'eq' | 'ne' | 'unsure'
  function partCompare(a, b) {
    if (a.kind !== b.kind || a.key !== b.key) return 'ne';
    const ua = a.unit, ub = b.unit;
    if (!ua.name || !ub.name || ua.name === ub.name) return 'eq';
    return ua.known && ub.known ? 'ne' : 'unsure';
  }

  function sameMultiset(as, bs, ignoreVar) {
    if (as.length !== bs.length) return null;
    const left = bs.slice();
    let fuzzy = false;
    for (let i = 0; i < as.length; i++) {
      let hit = -1;
      for (let j = 0; j < left.length; j++) {
        if (!ignoreVar && as[i].variable !== left[j].variable) continue;
        const c = partCompare(as[i], left[j]);
        if (c === 'ne') continue;
        if (c === 'unsure') fuzzy = true;
        hit = j;
        break;
      }
      if (hit < 0) return null;
      left.splice(hit, 1);
    }
    return fuzzy ? 'unsure' : 'eq';
  }

  function allNumeric(parts) { return parts.every(function (p) { return p.kind === 'num' || p.kind === 'tuple'; }); }

  function compareParsed(u, r) {
    let res = null;
    if (u.parts.length === r.parts.length) {
      const refVars = r.parts.map(function (p) { return p.variable; });
      const refVarsDistinct = r.parts.length > 1 && refVars.every(Boolean) && new Set(refVars).size === refVars.length;
      if (refVarsDistinct) {
        if (u.parts.every(function (p) { return p.variable; })) res = sameMultiset(u.parts, r.parts, false);
        else if (u.parts.every(function (p) { return !p.variable; })) {
          // No variable names written: match the reference in order (x first, then y).
          res = 'eq';
          for (let i = 0; i < u.parts.length; i++) {
            const c = partCompare(u.parts[i], r.parts[i]);
            if (c === 'ne') { res = null; break; }
            if (c === 'unsure') res = 'unsure';
          }
        } else return { relation: 'unsure' };
      } else {
        res = sameMultiset(u.parts, r.parts, true);
      }
    }
    if (res === 'eq') return { relation: 'equal' };
    if (res === 'unsure') return { relation: 'unsure' };
    return { relation: allNumeric(u.parts) && allNumeric(r.parts) ? 'different' : 'unsure' };
  }

  /**
   * Mark against a reference text. Only gives correct/wrong when that is reliable; otherwise 'manual'
   * (the child or a grown-up compares with the answer).
   *  - identical after normalising, or equal as numbers / the same set of answers -> correct
   *  - both sides are numbers (or coordinates) but differ -> wrong
   *  - anything else (words, expressions) -> manual
   */
  function judgeAnswer(user, reference) {
    const u = parseAnswer(user);
    const r = parseAnswer(reference);
    if (!u.norm) return { verdict: 'manual', reason: 'empty' };
    if (u.norm === r.norm) return { verdict: 'correct', reason: 'identical' };
    if (!r.parts.length) return { verdict: 'manual', reason: 'no-reference' };
    const c = compareParsed(u, r);
    if (c.relation === 'equal') return { verdict: 'correct', reason: 'equivalent' };
    if (c.relation === 'different') return { verdict: 'wrong', reason: 'numeric-mismatch' };
    return { verdict: 'manual', reason: 'unsure' };
  }

  /* ------------------------------------------------------------------ marking by question type */

  const MANUAL_EMPTY = { verdict: 'manual', reason: 'empty' };

  const SMALL = {
    zero: 0, nought: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
  };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

  /** "seven", "twenty-one", "one hundred and five" -> number; anything else -> null. Up to 999. */
  function wordsToNumber(input) {
    const s = String(input == null ? '' : input).trim().toLowerCase().replace(/[.!]+$/, '').replace(/-/g, ' ').replace(/\s+/g, ' ');
    if (!s || !/^[a-z ]+$/.test(s)) return null;
    const words = s.split(' ').filter(function (w) { return w !== 'and'; });
    if (!words.length) return null;
    let total = 0, cur = 0, any = false;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === 'a' && words[i + 1] === 'hundred') { cur = 1; continue; }
      if (SMALL[w] != null) { cur += SMALL[w]; any = true; }
      else if (TENS[w] != null) { cur += TENS[w]; any = true; }
      else if (w === 'hundred') { cur = (cur || 1) * 100; any = true; }
      else return null;
    }
    total += cur;
    return any ? total : null;
  }

  function judgeChoice(user, q) {
    const raw = String(user == null ? '' : user).trim();
    if (!raw) return MANUAL_EMPTY;
    const choices = q.choices || [];
    const keys = choices.map(function (c) { return c.key; });
    let letter = null;
    const m = /^\(?([A-Za-z])[).:]?$/.exec(raw);
    if (m) letter = m[1].toUpperCase();
    else {
      const n = normalizeText(raw);
      const hit = choices.find(function (c) { return normalizeText(c.text) === n; });
      if (hit) letter = hit.key;
    }
    if (!letter || keys.indexOf(letter) < 0) return { verdict: 'manual', reason: 'unrecognized' };
    return letter === q.answer ? { verdict: 'correct', reason: 'choice' } : { verdict: 'wrong', reason: 'choice' };
  }

  function judgeNumeric(user, q) {
    const words = wordsToNumber(user);
    if (words != null) user = String(words);
    const u = parseAnswer(user);
    if (!u.norm) return MANUAL_EMPTY;
    const refs = [q.answer].concat(q.accept || []);
    for (let i = 0; i < refs.length; i++) {
      if (parseAnswer(refs[i]).norm === u.norm) return { verdict: 'correct', reason: 'identical' };
    }
    const main = parseAnswer(q.answer);
    if (!q.unordered && main.parts.length > 1) {
      // Several answers where order matters: compare item by item (variable names ignored).
      if (u.parts.length !== main.parts.length) {
        return allNumeric(u.parts) ? { verdict: 'wrong', reason: 'count-mismatch' } : { verdict: 'manual', reason: 'unsure' };
      }
      let res = 'eq';
      for (let i = 0; i < u.parts.length; i++) {
        const c = partCompare(u.parts[i], main.parts[i]);
        if (c === 'ne') { res = 'ne'; break; }
        if (c === 'unsure') res = 'unsure';
      }
      if (res === 'eq') return { verdict: 'correct', reason: 'equivalent' };
      if (res === 'ne' && allNumeric(u.parts) && allNumeric(main.parts)) return { verdict: 'wrong', reason: 'numeric-mismatch' };
      return { verdict: 'manual', reason: 'unsure' };
    }
    const r = judgeAnswer(user, q.answer);
    if (r.verdict === 'correct') return r;
    for (let i = 1; i < refs.length; i++) {
      if (judgeAnswer(user, refs[i]).verdict === 'correct') return { verdict: 'correct', reason: 'accept' };
    }
    return r;
  }

  const WORD_RE = /^[a-z']+$/;

  /**
   * Short answers: equal to `answer` or one of `accept` after normalising (case, spaces, a trailing full stop) -> correct.
   * A single word against a single-word reference that does not match -> wrong (spelling, a word to find).
   * Anything else that does not match -> manual (there are too many ways to phrase a sentence).
   */
  function judgeShort(user, q) {
    const u = normalizeText(user);
    if (!u) return MANUAL_EMPTY;
    const refs = [q.answer].concat(q.accept || []);
    for (let i = 0; i < refs.length; i++) {
      if (normalizeText(refs[i]) === u) return { verdict: 'correct', reason: i ? 'accept' : 'identical' };
    }
    for (let i = 0; i < refs.length; i++) {
      if (judgeAnswer(user, refs[i]).verdict === 'correct') return { verdict: 'correct', reason: 'equivalent' };
    }
    const oneWord = function (s) { return WORD_RE.test(s) && String(s).trim().split(/\s+/).length === 1; };
    const userWord = oneWord(String(user).trim().toLowerCase().replace(/[.!?]+$/, '').replace(/[‘’]/g, "'"));
    const refWords = refs.every(function (r) { return oneWord(String(r).trim().toLowerCase().replace(/[.!?]+$/, '').replace(/[‘’]/g, "'")); });
    if (userWord && refWords) return { verdict: 'wrong', reason: 'word-mismatch' };
    return { verdict: 'manual', reason: 'unsure' };
  }

  /** By type: choice compares the letter (or option text); numeric by value; short exact + accept; self is always manual. */
  function judgeQuestion(q, user) {
    switch (q.type) {
      case 'choice': return judgeChoice(user, q);
      case 'numeric': return judgeNumeric(user, q);
      case 'short': return judgeShort(user, q);
      case 'self': return { verdict: 'manual', reason: 'self' };
      default: return judgeAnswer(user, q.answer); // legacy: diagnostic_question
    }
  }

  return {
    DEFAULT_LIMIT: DEFAULT_LIMIT,
    SCREEN_LIMIT: SCREEN_LIMIT,
    gradeTargets: gradeTargets,
    parseYear: parseYear,
    yearLabel: yearLabel,
    stageOf: stageOf,
    groupOf: groupOf,
    subjectOf: subjectOf,
    chapterSummary: chapterSummary,
    buildGraph: buildGraph,
    questionById: questionById,
    pickQuestion: pickQuestion,
    nextItem: nextItem,
    isUnconfirmed: isUnconfirmed,
    mulberry32: mulberry32,
    judgeQuestion: judgeQuestion,
    ancestors: ancestors,
    topoSort: topoSort,
    subgraph: subgraph,
    isTestable: isTestable,
    createSession: createSession,
    applyAnswer: applyAnswer,
    nextQuestion: nextQuestion,
    replay: replay,
    statusOf: statusOf,
    summarize: summarize,
    layout: layout,
    parseChapter: parseChapter,
    gradeRank: gradeRank,
    resolveTargets: resolveTargets,
    normalizeText: normalizeText,
    wordsToNumber: wordsToNumber,
    judgeAnswer: judgeAnswer
  };
});
