/* Check-up page. All the logic lives in ../assets/engine.js; this file loads data, renders the start page,
 * the question screen and the results, and keeps progress in localStorage. */
(function () {
  'use strict';

  /* Demo targets per subject, used by ?demo=1 without a target. The real ids are not final yet:
   * if a configured id is missing from the data, a sensible default is picked at runtime (see demoTargets). */
  const DEMO_TARGETS = { maths: ['aum_y2_02'], english: ['aue_y1_03'] };

  const E = window.DiagEngine;
  const A = window.AU;
  const K = window.AuKids;
  const S = window.AuSpeech;
  const h = A.h;

  const LS_SETTINGS = 'auDiagnose.settings.v1';
  const LS_SEEN = 'auDiagnose.seen.v1';
  const LIMIT_MIN = 8, LIMIT_MAX = 30;
  const SCREEN_MIN = 10, SCREEN_MAX = 60;
  const RESULT_LABEL = { correct: 'Right', wrong: 'Not right', skip: 'Didn’t know' };
  const STATUS_LABEL = { mastered: 'Got it', shaky: 'Shaky', weak: 'Needs work', unknown: 'Not checked' };
  const DIFF_LABEL = { basic: 'Basic', standard: 'Standard', advanced: 'Challenge' };
  const TYPE_LABEL = { numeric: 'Number answer', choice: 'Choose one', short: 'Short answer', self: 'Open answer', legacy: 'Question' };
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const PATH_FOLD_AT = 40;

  const root = document.getElementById('root');
  let D = null;            // data: {topics, deps, stdById, graph, groups}
  let session = null;      // engine session
  let sessionMeta = null;  // {label, kidId, url: {param, value}}
  let demo = null;         // demo mode: {oracle}
  let ui = { key: null, phase: 'ask', answer: '', verdict: null, picked: null, spoken: null };
  let subject = 'maths';
  let startQuery = '';
  let startYear = '';
  let browseOpen = false;
  let screenYear = null;
  let seedParam = null;
  let pathCy = null;
  let pathToken = 0;
  let pathTipLock = false;
  let pathExpanded = false;
  let shareBlobUrl = null;
  let shareToken = 0;
  let speechUnsub = null;     // listener of the question on screen
  let nextSpeechUnsub = null; // listener of the question being built

  /* ------------------------------------------------------------ small helpers */
  function w(href) { return A.withSubject(href, subject); }
  function nameOf(id) { const t = D.graph.byId[id]; return t ? t.name : id; }
  function namesOf(ids) { return A.quoteList(ids.map(nameOf)); }
  function subjectName() { return A.SUBJECTS[subject]; }
  function sessionKeyFor(kidId) { return 'auDiagnose.session.' + subject + '.' + (kidId || 'none') + '.v1'; }
  function currentKid() { return K.current(); }
  function sessionKid() { return sessionMeta && sessionMeta.kidId ? K.get(sessionMeta.kidId) : null; }
  function kidLabel(c) { return c.name + ' (' + K.yearName(c.year) + ')'; }

  function getSettings() {
    const st = A.lsGet(LS_SETTINGS) || {};
    let limit = parseInt(st.limit, 10);
    if (!(limit >= LIMIT_MIN && limit <= LIMIT_MAX)) limit = E.DEFAULT_LIMIT;
    let screenLimit = parseInt(st.screenLimit, 10);
    if (!(screenLimit >= SCREEN_MIN && screenLimit <= SCREEN_MAX)) screenLimit = null;
    return { limit: limit, screenLimit: screenLimit, readAloud: typeof st.readAloud === 'boolean' ? st.readAloud : null };
  }
  function setSetting(k, v) { const st = A.lsGet(LS_SETTINGS) || {}; st[k] = v; A.lsSet(LS_SETTINGS, st); }
  /** Whole-year limit: the saved setting, otherwise 20 for K to Year 2 and 40 from Year 3. */
  function screenLimitFor(year) {
    const st = getSettings();
    if (st.screenLimit) return st.screenLimit;
    return year != null && year <= 2 ? 20 : E.SCREEN_LIMIT;
  }

  /** Read aloud: the kid's setting (default on for K to Year 2); without a kid, the saved choice or the question's year. */
  function readAloudOn(topic) {
    const kid = session ? sessionKid() : currentKid();
    if (kid) return K.readAloudFor(kid);
    const st = getSettings();
    if (st.readAloud != null) return st.readAloud;
    return !!(topic && topic.year <= 2);
  }
  function setReadAloud(on) {
    const kid = session ? sessionKid() : currentKid();
    if (kid) K.setReadAloud(kid.id, on);
    else setSetting('readAloud', !!on);
  }
  function isYoung(topic) {
    const kid = session ? sessionKid() : currentKid();
    if (kid) return kid.year <= 2;
    return !!(topic && topic.year <= 2);
  }

  function seenAll() { const v = A.lsGet(LS_SEEN); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function seenList(kidId) { const v = seenAll()[kidId || 'none']; return Array.isArray(v) ? v : []; }
  function markSeen(qid) {
    if (!qid || demo) return;
    const all = seenAll();
    const k = (sessionMeta && sessionMeta.kidId) || 'none';
    const list = Array.isArray(all[k]) ? all[k] : [];
    if (list.indexOf(qid) < 0) { list.push(qid); all[k] = list.slice(-2000); A.lsSet(LS_SEEN, all); }
  }
  function newSeed() { return seedParam != null ? seedParam : Math.random().toString(36).slice(2, 10); }
  function resetUi() { ui = { key: null, phase: 'ask', answer: '', verdict: null, picked: null, spoken: null }; }
  function clearRoot() { while (root.firstChild) root.removeChild(root.firstChild); }
  function teardownPath() {
    pathToken++;
    pathTipLock = false;
    if (pathCy) { pathCy.destroy(); pathCy = null; window.__pathCy = null; }
  }
  function show(node, keepScroll) {
    teardownPath();
    closeShare();
    if (speechUnsub) speechUnsub();
    speechUnsub = nextSpeechUnsub;
    nextSpeechUnsub = null;
    clearRoot();
    root.append(node);
    if (!keepScroll) window.scrollTo(0, 0);
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function theme() {
    return {
      early: cssVar('--node-primary'), earlyBg: cssVar('--node-primary-bg'),
      middle: cssVar('--node-junior'), middleBg: cssVar('--node-junior-bg'),
      upper: cssVar('--node-senior'), upperBg: cssVar('--node-senior-bg'),
      currentBg: cssVar('--node-current-bg'), currentBorder: cssVar('--node-current-border'),
      text: cssVar('--node-text'), edge: cssVar('--edge'), edgeSoft: cssVar('--edge-soft'),
      bad: cssVar('--diagram-bad'), badBg: cssVar('--diagram-bad-bg')
    };
  }
  function narrow() { return window.matchMedia('(max-width: 700px)').matches; }
  function clipLabel(name) {
    const limit = narrow() ? 30 : 38;
    const s = String(name || '');
    return s.length <= limit ? s : s.slice(0, limit - 1).trim() + '…';
  }
  function tag(cls, text) { return h('span', { class: 'tag ' + cls, text: text }); }

  /* ------------------------------------------------------------ data */
  async function loadData() {
    const data = await A.loadData('../data/', subject);
    const graph = E.buildGraph(data.topics, data.deps, data.questions);
    D = { topics: data.topics, deps: data.deps, stdById: data.stdById, graph: graph, groups: buildGroups(data.topics) };
  }

  /** Year -> focus areas -> topics, in teaching order. */
  function buildGroups(topics) {
    const years = [];
    const byYear = {};
    topics.forEach(function (t) {
      if (t.external) return;
      let y = byYear[t.year];
      if (!y) { y = byYear[t.year] = { year: t.year, groups: [], byKey: {} }; years.push(y); }
      const g0 = E.groupOf(t);
      let g = y.byKey[g0.key];
      if (!g) { g = y.byKey[g0.key] = { key: g0.key, year: t.year, strand: g0.strand, focusArea: g0.focusArea, label: g0.label, topics: [] }; y.groups.push(g); }
      g.topics.push(t);
    });
    years.sort(function (a, b) { return a.year - b.year; });
    return years;
  }
  function findGroup(key) {
    for (let i = 0; i < D.groups.length; i++) {
      const hit = D.groups[i].groups.find(function (g) { return g.key === key; });
      if (hit) return hit;
    }
    return null;
  }

  /* ------------------------------------------------------------ kid profiles */
  function kidsHref(path) { return '../kids/' + (path || ''); }
  function fromQuery() { return '?from=diagnose' + (subject !== 'maths' ? '&subject=' + subject : ''); }
  function kidSelect(selectedId, onPick, noneLabel) {
    const sel = h('select', { id: 'kid-select', 'aria-label': 'Kid' },
      K.list().map(function (c) { return h('option', { value: c.id, selected: selectedId === c.id }, kidLabel(c)); }),
      h('option', { value: '' }, noneLabel || 'Don’t save (no profile)'));
    sel.value = selectedId || '';
    sel.addEventListener('change', function () { onPick(sel.value || null); });
    return sel;
  }
  function readAloudSwitch(onChange) {
    const input = h('input', { type: 'checkbox', id: 'read-aloud', checked: !!readAloudOn(null) });
    input.addEventListener('change', function () { setReadAloud(input.checked); if (onChange) onChange(input.checked); });
    return h('label', { class: 'switch', for: 'read-aloud' }, input, 'Auto read aloud');
  }
  function childBar(mode) {
    if (demo) return null;
    const kids = K.list();
    if (mode === 'question') {
      if (!kids.length) return null;
      const kid = sessionKid();
      return h('div', { class: 'child-bar compact row no-print', id: 'child-bar' },
        h('span', { class: 'muted small' }, 'Answering:'),
        kidSelect(kid ? kid.id : null, function (id) { moveSessionTo(id); render(); }));
    }
    if (mode === 'result') {
      const kid = sessionKid();
      const key = recordKey();
      return h('div', { class: 'card child-bar no-print', id: 'child-bar' },
        h('p', { style: 'margin:0 0 8px' }, kid
          ? [h('b', { text: 'Saved to ' + kid.name + '’s profile.' }), ' Pick someone else to move it.']
          : [h('b', { text: 'Not saved to a profile yet.' }), kids.length ? ' Pick a kid to save it.' : ' Add a kid to keep results.']),
        h('div', { class: 'row' },
          kids.length ? [h('label', { for: 'kid-select' }, 'Save to'),
            kidSelect(kid ? kid.id : null, function (id) {
              if (kid && id !== kid.id) { if (id) K.moveRecord(key, kid.id, id); else K.removeRecord(kid.id, key); }
              moveSessionTo(id);
              renderResult();
            }, 'Don’t save')] : h('a', { class: 'btn btn-primary', href: w(kidsHref(fromQuery())), text: 'Add a kid' }),
          kid ? h('a', { class: 'btn', id: 'link-history', href: w(kidsHref('history.html?child=' + encodeURIComponent(kid.id))), text: 'See ' + kid.name + '’s history' }) : null));
    }
    const cur = currentKid();
    return h('div', { class: 'card child-bar no-print', id: 'child-bar' },
      kids.length ? h('div', { class: 'row' },
        h('label', { for: 'kid-select' }, 'Who’s doing the check-up?'),
        kidSelect(cur ? cur.id : null, function (id) { K.setCurrent(id); renderStart(); }),
        h('span', { class: 'grow' }),
        cur ? h('a', { class: 'btn', href: w(kidsHref('history.html?child=' + encodeURIComponent(cur.id))), text: 'History' }) : null,
        h('a', { class: 'btn', href: w(kidsHref(fromQuery())), text: 'Kids' }))
        : h('p', { style: 'margin:0 0 8px' }, h('b', { text: 'No kid profiles yet. ' }),
          'Add your kids and each check-up is saved to their profile, so you can see progress over time. ',
          h('a', { class: 'btn btn-primary', href: w(kidsHref(fromQuery())), text: 'Add kids' })),
      h('div', { class: 'setting-row' },
        readAloudSwitch(),
        h('span', { class: 'muted small' }, cur
          ? 'Reads each question and its choices out loud' + (cur.year <= 2 ? ' (on by default for ' + K.yearName(cur.year) + ').' : '.')
          : 'Reads each question and its choices out loud. Handy for Kindergarten to Year 2.')));
  }
  /** Move the session (and its saved progress) to another kid, or to no kid. */
  function moveSessionTo(id) {
    K.setCurrent(id);
    if (!session || !sessionMeta) return;
    const oldKey = sessionKeyFor(sessionMeta.kidId);
    sessionMeta.kidId = id || null;
    if (!demo) { A.lsDel(oldKey); save(); }
  }
  function recordKey() { return [subject, session.seed, session.targets.join(',')].join('|'); }
  function saveToChild(sum) {
    const kid = sessionKid();
    if (demo || !kid || !sum.asked) return;
    K.saveRecord(kid.id, {
      key: recordKey(), subject: subject, label: sessionMeta.label, mode: sum.mode, asked: sum.asked,
      year: session.mode === 'screen' ? screenYearOf(session.targets) : null,
      targets: sum.mode === 'screen' || sum.targets.length > 8 ? null : sum.targets,
      counts: { weak: sum.weak.length, shaky: sum.shaky.length, mastered: sum.mastered.length, untested: sum.untested.length },
      weak: sum.weak, roots: sum.roots.map(function (r) { return r.id; }), shaky: sum.shaky, mastered: sum.mastered
    });
  }
  function screenYearOf(ids) {
    const t = D.graph.byId[ids[0]];
    return t ? t.year : null;
  }

  /* ------------------------------------------------------------ session */
  function save() {
    if (demo || !session) return;
    A.lsSet(sessionKeyFor(sessionMeta.kidId), {
      v: 1, mode: session.mode, targets: session.targets, limit: session.limit, label: sessionMeta.label, url: sessionMeta.url,
      answers: session.answers, seed: session.seed, avoid: session.avoid, kidId: sessionMeta.kidId, savedAt: new Date().toISOString()
    });
  }

  function setUrl(spec) {
    const params = new URLSearchParams();
    if (subject !== 'maths') params.set('subject', subject);
    if (spec && spec.param) params.set(spec.param, spec.value);
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }

  function startSession(targets, label, limit, mode, urlSpec) {
    pathExpanded = false;
    const screen = mode === 'screen';
    const kid = currentKid();
    session = E.createSession(D.graph, targets, {
      mode: mode, limit: limit || (screen ? screenLimitFor(screenYearOf(targets)) : getSettings().limit),
      seed: newSeed(), avoid: seenList(kid ? kid.id : null)
    });
    sessionMeta = { label: label, kidId: kid ? kid.id : null, url: urlSpec || null };
    resetUi();
    save();
    setUrl(urlSpec);
    if (window.cnmTrack) window.cnmTrack('checkup_started', { mode: session.mode, subject: subject });
    render();
  }

  function restoreSession(saved) {
    try {
      session = E.replay(D.graph, saved.targets, saved.answers, { mode: saved.mode, limit: saved.limit, seed: saved.seed, avoid: saved.avoid });
      sessionMeta = { label: saved.label || saved.targets.map(nameOf).join(', '), kidId: saved.kidId || null, url: saved.url || null };
      resetUi();
      setUrl(sessionMeta.url);
      return true;
    } catch (e) { return false; }
  }

  function restart() {
    pathExpanded = false;
    if (session && sessionMeta && !demo) A.lsDel(sessionKeyFor(sessionMeta.kidId));
    session = null; sessionMeta = null; demo = null;
    setUrl(null);
    render();
  }

  function commit(result) {
    const item = E.nextItem(D.graph, session);
    session = E.applyAnswer(D.graph, session, item.topicId, result, { text: ui.answer });
    markSeen(item.question.id);
    resetUi();
    save();
    render();
  }

  function rebuild(answers, limit) {
    session = E.replay(D.graph, session.targets, answers, {
      mode: session.mode, limit: limit == null ? session.limit : limit, seed: session.seed, avoid: session.avoid
    });
    resetUi();
    save();
    render();
  }

  /* ------------------------------------------------------------ demo mode */
  /** DEMO_TARGETS[subject] when the ids exist; otherwise the testable Year 1-4 skill with the longest chain behind it. */
  function demoTargets() {
    const G = D.graph;
    const wanted = (DEMO_TARGETS[subject] || []).filter(function (id) { return E.isTestable(G, id); });
    if (wanted.length) return wanted;
    let best = null, bestN = -1;
    D.topics.forEach(function (t) {
      if (!E.isTestable(G, t.id)) return;
      const inRange = t.year >= 1 && t.year <= 4;
      const n = E.ancestors(G, t.id).size + (inRange ? 1000 : 0);
      if (n > bestN) { best = t; bestN = n; }
    });
    return best ? [best.id] : [];
  }
  // The pretend child: the target is missed twice (needs work); so is its first testable prerequisite;
  // one step further back (or another prerequisite) is wrong then right (shaky); everything else is right.
  function makeOracle(targets, mode) {
    const G = D.graph;
    if (mode === 'screen') {
      return function (id, attempt) {
        const i = G.index[id];
        if (i % 6 === 0) return 'wrong';
        if (i % 6 === 3) return attempt === 1 ? 'wrong' : 'correct';
        return 'correct';
      };
    }
    const t0 = E.createSession(G, targets).stack[0];
    const testablePre = function (id) { return G.prereqs[id].filter(function (x) { return E.isTestable(G, x.id); }).map(function (x) { return x.id; }); };
    const weak = new Set([t0]);
    const shaky = new Set();
    const p = testablePre(t0);
    if (p.length) {
      const q = testablePre(p[0]);
      if (q.length) { weak.add(p[0]); shaky.add(q[0]); }
      else if (p.length > 1) { weak.add(p[0]); shaky.add(p[1]); }
      else shaky.add(p[0]);
    }
    return function (id, attempt) {
      if (weak.has(id)) return 'wrong';
      if (shaky.has(id)) return attempt === 1 ? 'wrong' : 'correct';
      return 'correct';
    };
  }
  function runDemo(steps) {
    let n = 0;
    while (n < steps) {
      const item = E.nextItem(D.graph, session);
      if (!item) break;
      session = E.applyAnswer(D.graph, session, item.topicId, demo.oracle(item.topicId, item.attempt));
      n++;
    }
  }
  function demoBanner() {
    return h('div', { class: 'banner demo no-print', id: 'demo-banner' }, 'Demo: a pretend child is answering. Nothing is saved. ',
      h('a', { href: w(location.pathname.replace(/.*\//, './')), text: 'Leave the demo' }));
  }

  /* ------------------------------------------------------------ render entry */
  function render() {
    if (!session) return renderStart();
    const item = E.nextItem(D.graph, session);
    if (item) renderQuestion(item); else renderResult();
  }

  /* ------------------------------------------------------------ start page */
  function tabs(label, items, current, onPick, id) {
    return h('div', { class: 'stage-tabs', role: 'tablist', 'aria-label': label, id: id || null }, items.map(function (it) {
      return h('button', {
        type: 'button', class: 'stage-tab' + (current === it[0] ? ' on' : ''), role: 'tab',
        'aria-selected': current === it[0] ? 'true' : 'false', 'data-value': it[0],
        onclick: function () { onPick(it[0]); }
      }, it[1]);
    }));
  }
  function yearsWithTopics() { return D.groups.map(function (y) { return y.year; }); }
  function startYearCheck(year) {
    const g = E.gradeTargets(D.graph, year, subject);
    if (!g) return;
    startSession(g.ids, g.label + ' (whole year)', null, 'screen', { param: 'year', value: year === 0 ? 'K' : String(year) });
  }

  function renderStart(errMsg) {
    const page = h('div');
    const kid = currentKid();
    const saved = A.lsGet(sessionKeyFor(kid ? kid.id : null));
    if (saved && saved.targets && saved.targets.every(function (id) { return D.graph.byId[id]; })) {
      A.append(page, h('div', { class: 'banner', id: 'resume-banner' },
        h('b', { text: (kid ? kid.name + ' has' : 'There is') + ' an unfinished check-up: ' }), saved.label || saved.targets.map(nameOf).join(', '),
        ' (' + A.plural((saved.answers || []).length, 'answer') + ' so far). ',
        h('button', { class: 'primary', id: 'btn-resume', onclick: function () { if (restoreSession(saved)) render(); else { A.lsDel(sessionKeyFor(kid ? kid.id : null)); renderStart('That saved check-up could not be restored, so it was cleared.'); } } }, 'Keep going'),
        ' ', h('button', { id: 'btn-discard', onclick: function () { A.lsDel(sessionKeyFor(kid ? kid.id : null)); renderStart(); } }, 'Throw it away')));
    }
    if (errMsg) A.append(page, h('p', { class: 'err', text: errMsg }));
    A.append(page, childBar('start'));

    if (kid && E.gradeTargets(D.graph, kid.year, subject)) {
      A.append(page, h('div', { class: 'card', id: 'kid-quick' },
        h('h2', { text: 'Quick start for ' + kid.name }),
        h('div', { class: 'quick-start' },
          h('button', { class: 'primary', id: 'btn-kid-year', onclick: function () { startYearCheck(kid.year); } },
            K.yearName(kid.year) + ' ' + subjectName() + ' check-up'),
          kid.year > 0 && E.gradeTargets(D.graph, kid.year - 1, subject)
            ? h('button', { id: 'btn-kid-prev', onclick: function () { startYearCheck(kid.year - 1); } }, K.yearName(kid.year - 1) + ' (a year back)') : null),
        h('p', { class: 'muted small', text: 'A whole-year check-up samples skills from that year. Up to ' + screenLimitFor(kid.year) + ' questions.' })));
    }

    const st = getSettings();
    const limitInput = h('input', { type: 'number', min: LIMIT_MIN, max: LIMIT_MAX, step: 1, value: String(st.limit), id: 'limit-input', inputmode: 'numeric', 'aria-label': 'Question limit' });
    limitInput.addEventListener('change', function () {
      let v = parseInt(limitInput.value, 10);
      if (!(v >= LIMIT_MIN)) v = LIMIT_MIN;
      if (v > LIMIT_MAX) v = LIMIT_MAX;
      limitInput.value = String(v);
      setSetting('limit', v);
    });
    const listBox = h('div', { id: 'target-list' });
    const browser = h('details', { class: 'chapter-browser', id: 'chapter-browser', open: browseOpen || !!startQuery },
      h('summary', null, 'Browse by year and focus area'),
      listBox);
    browser.addEventListener('toggle', function () { browseOpen = browser.open; });
    const yearItems = [['', 'All']].concat(yearsWithTopics().map(function (y) { return [String(y), y === 0 ? 'K' : 'Year ' + y]; }));
    A.append(page, h('div', { class: 'card', id: 'pick-card' },
      h('h1', { text: 'Check one skill' }),
      h('p', { class: 'muted' }, 'Pick a skill your child is learning. A right answer means they’ve got it. A wrong answer gets one more, easier question. If that one is tricky too, the check-up steps back to the skills it builds on to find where the gap starts.'),
      tabs('Year', yearItems, startYear, function (v) { startYear = v; renderStart(); }, 'year-tabs'),
      h('input', {
        type: 'search', class: 'search-lg', id: 'search',
        placeholder: subject === 'english' ? 'Search, e.g. rhyme, digraphs, commas' : 'Search, e.g. counting, fractions, area',
        value: startQuery, autocomplete: 'off', 'aria-label': 'Search skills',
        oninput: function (e) {
          startQuery = e.target.value;
          fillList(listBox);
          if (startQuery.trim()) { browser.open = true; browseOpen = true; }
        }
      }),
      h('p', { class: 'muted small', id: 'match-count' }),
      browser,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('label', null, 'Question limit (' + LIMIT_MIN + '–' + LIMIT_MAX + ') ', limitInput),
        h('span', { class: 'muted small' }, 'At most 2 questions per skill. Skills not reached are marked “Not checked”.'))));
    A.append(page, yearCard());
    A.append(page, h('p', { class: 'muted small' },
      A.plural(D.topics.length, 'skill') + ' to check in ' + subjectName() + '. Progress stays in this browser. ',
      h('a', { href: w('./?demo=1'), id: 'link-demo', text: 'Watch a demo' })));
    show(page);
    fillList(listBox);
    if (startQuery) { const el = document.getElementById('search'); if (el) el.focus(); }
  }

  function yearCard() {
    const box = h('div', { class: 'card', id: 'grade-card' });
    const ys = yearsWithTopics();
    const kid = currentKid();
    if (screenYear == null || ys.indexOf(screenYear) < 0) screenYear = kid && ys.indexOf(kid.year) >= 0 ? kid.year : (ys.indexOf(1) >= 0 ? 1 : ys[0]);
    const fill = function () {
      while (box.firstChild) box.removeChild(box.firstChild);
      const g = screenYear == null ? null : E.gradeTargets(D.graph, screenYear, subject);
      const st = getSettings();
      const limitInput = h('input', {
        type: 'number', min: SCREEN_MIN, max: SCREEN_MAX, step: 1, value: String(screenLimitFor(screenYear)), id: 'screen-limit-input', inputmode: 'numeric', 'aria-label': 'Whole-year question limit'
      });
      limitInput.addEventListener('change', function () {
        let v = parseInt(limitInput.value, 10);
        if (!(v >= SCREEN_MIN)) v = SCREEN_MIN;
        if (v > SCREEN_MAX) v = SCREEN_MAX;
        limitInput.value = String(v);
        setSetting('screenLimit', v);
      });
      A.append(box, 
        h('h2', { text: 'Whole-year check-up' }),
        h('p', { class: 'muted' }, 'No need to pick a skill: the check-up samples the whole year. A right answer also covers the skills it builds on, and a tricky skill is followed back only within that year. The results show which focus areas need work. Good for the start of a term or a holiday catch-up.'),
        tabs('Year', ys.map(function (y) { return [String(y), K.yearName(y)]; }), String(screenYear), function (v) { screenYear = parseInt(v, 10); fill(); }, 'screen-tabs'),
        h('p', { class: 'muted', id: 'grade-info' }, g ? g.label + ': ' + A.plural(g.ids.length, 'skill') + '.' : 'No skills for this year yet.'),
        h('div', { class: 'row' },
          h('label', null, 'Question limit (' + SCREEN_MIN + '–' + SCREEN_MAX + ') ', limitInput),
          h('button', { class: 'primary', id: 'btn-grade-start', disabled: !g, onclick: function () { if (g) startYearCheck(screenYear); } }, 'Start the ' + (g ? g.label : '') + ' check-up')),
        h('p', { class: 'muted small' }, st.screenLimit ? 'Your saved limit is used for every year.' : 'The default is 20 questions for Kindergarten to Year 2 and ' + E.SCREEN_LIMIT + ' from Year 3.'));
    };
    fill();
    return box;
  }

  function fillList(box) {
    while (box.firstChild) box.removeChild(box.firstChild);
    const q = startQuery.trim().toLowerCase();
    let shown = 0;
    D.groups.forEach(function (yv) {
      if (startYear !== '' && String(yv.year) !== startYear) return;
      const groups = [];
      yv.groups.forEach(function (g) {
        const gHit = q && (g.focusArea + ' ' + g.strand).toLowerCase().indexOf(q) >= 0;
        const rows = g.topics.filter(function (t) {
          if (!q || gHit) return true;
          return (t.name + ' ' + t.description + ' ' + t.id).toLowerCase().indexOf(q) >= 0;
        });
        if (rows.length) groups.push({ g: g, rows: rows });
      });
      if (!groups.length) return;
      const count = groups.reduce(function (n, c) { return n + c.rows.length; }, 0);
      shown += count;
      const det = h('details', { class: 'vol', open: !!q || startYear !== '' },
        h('summary', null, A.yearLabel(yv.year) + ' (' + A.plural(count, 'skill') + ')'));
      groups.forEach(function (c) {
        const g = c.g;
        A.append(det, h('div', { class: 'chap' },
          h('div', { class: 'chap-head area-head' },
            h('span', { class: 't' }, g.focusArea, h('small', { text: g.strand })),
            h('button', {
              class: 'primary', title: 'Check all ' + A.plural(g.topics.length, 'skill') + ' in this focus area',
              onclick: function () { startSession(g.topics.map(function (t) { return t.id; }), g.label + ' (focus area)', null, null, { param: 'group', value: g.key }); }
            }, 'Check this focus area')),
          c.rows.map(function (t) {
            return h('div', { class: 'topic-row', title: t.description },
              h('span', { class: 'nm', text: t.name }),
              h('button', { 'data-target': t.id, onclick: function () { startSession([t.id], t.name, null, null, { param: 'target', value: t.id }); } }, 'Check this'));
          })));
      });
      A.append(box, det);
    });
    if (!shown) A.append(box, h('p', { class: 'muted', text: 'No skills match.' }));
    const mc = document.getElementById('match-count');
    if (mc) mc.textContent = (q ? 'Found ' : 'The list has ') + A.plural(shown, 'skill');
    const browser = document.getElementById('chapter-browser');
    if (browser && q) browser.open = true;
  }

  /* ------------------------------------------------------------ question screen */
  function reasonFor(item) {
    const id = item.topicId;
    if (item.attempt === 2) return 'The first question was tricky, so here is one more' + (item.question.difficulty === 'basic' ? ', easier' : '') + '. If this one is tricky too, we’ll check what it builds on.';
    for (let i = session.answers.length - 1; i >= 0; i--) {
      const a = session.answers[i];
      if (a.result === 'correct') continue;
      const p = D.graph.prereqs[a.id].find(function (x) { return x.id === id; });
      if (p && E.statusOf(session, a.id) === 'weak') return '“' + nameOf(a.id) + '” was tricky twice, so now we’re checking a skill it builds on.';
    }
    if (session.mode === 'screen') return 'Whole-year check-up: sampling skills from this year. A right answer also covers the skills it builds on.';
    if (session.targets.length > 1) return 'Checking this focus area, starting with its last skill.';
    return session.targets.indexOf(id) >= 0 ? 'This is the skill you chose.' : 'Checking a skill that comes before the one you chose.';
  }

  function judgeAndGo(item) {
    const q = item.question;
    const val = String(ui.answer || '').trim();
    if (!val) { const el = document.getElementById('ans'); if (el) el.focus(); return; }
    const r = E.judgeQuestion(q, val);
    ui.verdict = r;
    ui.phase = r.verdict === 'manual' ? 'self' : 'auto';
    renderQuestion(item);
  }

  function answerText(q) {
    if (q.type === 'choice') {
      const c = (q.choices || []).find(function (x) { return x.key === q.answer; });
      return q.answer + (c ? '. ' + c.text : '');
    }
    return q.answer;
  }
  function answerOfKey(q, key) {
    const c = (q.choices || []).find(function (x) { return x.key === key; });
    return c ? c.key + '. ' + c.text : key;
  }
  function feedbackBlock(q) {
    return h('div', { class: 'feedback' },
      h('div', { class: 'refans', id: 'refans' }, h('b', null, 'Answer: '), answerText(q)),
      q.explanation ? h('div', { class: 'explain', id: 'explain' }, h('b', null, 'How it works: '), q.explanation) : null);
  }

  function inputModeFor(q) {
    if (q.type !== 'numeric') return 'text';
    const refs = [q.answer].concat(q.accept || []).join(' ');
    if (/^\d+$/.test(String(q.answer).trim()) && !/[^\d\s]/.test(refs)) return 'numeric';
    if (/^[\d.\s]+$/.test(refs)) return 'decimal';
    return 'text';
  }

  function speechParts(q) {
    const parts = [q.say ? q.say : q.prompt];
    if (q.type === 'choice') (q.choices || []).forEach(function (c) { parts.push(c.key + ', ' + c.text); });
    return parts;
  }
  function speakQuestion(q, btn) {
    const ok = S.speak(speechParts(q), { onend: function () { if (btn) btn.classList.remove('speaking'); } });
    if (ok && btn) btn.classList.add('speaking');
  }
  function speechControls(q) {
    const btn = h('button', { type: 'button', class: 'speak-btn', id: 'btn-speak', 'aria-label': 'Read the question aloud' },
      h('span', { class: 'ico', 'aria-hidden': 'true', text: '🔊' }), h('span', { class: 'lbl', text: 'Read to me' }));
    btn.addEventListener('click', function () {
      if (S.isSpeaking()) { S.stop(); btn.classList.remove('speaking'); return; }
      speakQuestion(q, btn);
    });
    const note = h('p', { class: 'speech-note', id: 'speech-note', hidden: true });
    const row = h('div', { class: 'speak-row no-print', id: 'speak-row' }, btn, note);
    const reveal = q.say ? h('details', { class: 'say-reveal no-print', id: 'say-reveal', hidden: true },
      h('summary', null, 'Show the word to a grown-up'),
      h('p', { class: 'muted small', text: 'Read this out to your child, then let them type what they hear.' }),
      h('p', { class: 'say-text', text: q.say })) : null;
    const sync = function () {
      const un = S.status() === 'unavailable';
      btn.disabled = un;
      note.hidden = !un;
      note.textContent = un ? (q.say
        ? 'Read-aloud isn’t available on this device, so a grown-up needs to read the word.'
        : 'Read-aloud isn’t available on this device. A grown-up can read the question instead.') : '';
      if (reveal) reveal.hidden = !un;
    };
    sync();
    if (nextSpeechUnsub) nextSpeechUnsub();
    nextSpeechUnsub = S.onChange(sync);
    return [row, reveal];
  }

  function kindLine(kind) {
    const lines = {
      ok: ['That’s right! Great work.', 'Yes! You got it.', 'Spot on!'],
      no: ['Not quite, and that’s OK. Let’s look at it together.', 'Good try! Here’s how it works.'],
      skip: ['That’s OK! Here’s the answer.']
    }[kind];
    return lines[(session.answers.length) % lines.length];
  }

  function renderQuestion(item) {
    const id = item.topicId;
    const q = item.question;
    const t = D.graph.byId[id];
    const key = id + '#' + item.attempt;
    if (ui.key !== key) ui = { key: key, phase: 'ask', answer: '', verdict: null, picked: null, spoken: null };
    const n = session.answers.length;
    const young = isYoung(t);
    const autoRead = readAloudOn(t);
    const card = h('div', { class: 'card q-card' + (young ? ' young' : ''), id: 'q-card', 'data-qid': q.id });
    A.append(card, 
      h('div', { class: 'row' },
        h('span', { class: 'muted small' }, 'Checking: ' + sessionMeta.label),
        h('span', { class: 'grow' }),
        h('span', { class: 'muted small', id: 'q-count' }, 'Question ' + (n + 1) + ' of up to ' + session.limit)),
      h('div', { class: 'progress' }, h('i', { style: 'width:' + Math.round(n / session.limit * 100) + '%' })),
      h('h2', { class: 'q-topic', id: 'q-topic' }, t.name, ' ', tag('', A.yearLabel(t.year))),
      h('div', { class: 'q-meta small' },
        tag('diff-' + q.difficulty, DIFF_LABEL[q.difficulty] || q.difficulty),
        tag('', TYPE_LABEL[q.type] || q.type),
        item.attempt === 2 ? tag('shaky', 'Second try') : null),
      h('div', { class: 'reason muted', text: reasonFor(item) }));
    if (item.attempt === 2 && ui.phase === 'ask') A.append(card, h('p', { class: 'feedback-kind skip', text: 'Let’s try another one!' }));
    A.append(card, speechControls(q));
    A.append(card, h('div', { class: 'q-text', id: 'q-text', text: q.prompt }));
    const fig = A.figureEl(q.figure);
    if (fig) A.append(card, fig);

    if (ui.phase === 'ask') {
      if (q.type === 'choice') {
        A.append(card, h('div', { class: 'choices', id: 'choices', role: 'group', 'aria-label': 'Choices' }, (q.choices || []).map(function (c) {
          const kids = [h('b', { class: 'choice-key', text: c.key }), document.createTextNode(c.text)];
          const cf = c.figure ? A.figureEl(c.figure) : null;
          if (cf) kids.push(cf);
          return h('button', {
            type: 'button', class: 'choice' + (c.figure ? ' fig-choice' : '') + (ui.picked === c.key ? ' picked' : ''),
            id: 'choice-' + c.key, 'data-key': c.key, 'aria-pressed': ui.picked === c.key ? 'true' : 'false',
            onclick: function () { ui.picked = c.key; ui.answer = c.key; renderQuestion(item); }
          }, kids);
        })));
      } else if (q.type === 'self') {
        A.append(card, h('textarea', {
          class: 'ans-input', id: 'ans', rows: 3, placeholder: 'Write your answer here, then tap “Show the answer”.', value: ui.answer,
          oninput: function (e) { ui.answer = e.target.value; }
        }));
      } else {
        const mode = inputModeFor(q);
        A.append(card, h('input', {
          type: 'text', class: 'ans-input', id: 'ans', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
          inputmode: mode, enterkeyhint: 'done', 'aria-label': 'Your answer',
          placeholder: q.type === 'numeric' ? 'Type a number' : 'Type your answer', value: ui.answer,
          oninput: function (e) { ui.answer = e.target.value; },
          onkeydown: function (e) { if (e.key === 'Enter' && !e.isComposing) judgeAndGo(item); }
        }));
      }
      A.append(card, h('div', { class: 'q-actions' },
        q.type === 'self' ? null : h('button', { class: 'primary', id: 'btn-submit', disabled: q.type === 'choice' && !ui.picked, onclick: function () { judgeAndGo(item); } }, 'Check my answer'),
        q.type === 'choice' ? null : h('button', { id: 'btn-peek', onclick: function () { ui.phase = 'self'; ui.verdict = null; renderQuestion(item); } }, 'Show the answer'),
        h('button', { id: 'btn-skip', onclick: function () { ui.phase = 'skip'; renderQuestion(item); } }, 'I don’t know yet')));
    } else if (ui.phase === 'auto') {
      const ok = ui.verdict.verdict === 'correct';
      A.append(card, 
        h('div', { class: 'feedback-kind ' + (ok ? 'ok' : 'no'), id: 'verdict', role: 'status' }, kindLine(ok ? 'ok' : 'no')),
        h('div', { class: 'muted' }, 'Your answer: ' + (q.type === 'choice' ? answerOfKey(q, ui.answer) : ui.answer)),
        feedbackBlock(q),
        h('div', { class: 'q-actions' },
          h('button', { class: 'primary', id: 'btn-next', onclick: function () { commit(ok ? 'correct' : 'wrong'); } }, 'Next question')),
        h('div', { class: 'row small', style: 'margin-top:8px' },
          h('button', { id: 'btn-flip', class: 'small', onclick: function () { commit(ok ? 'wrong' : 'correct'); } }, ok ? 'Marked right, but it wasn’t' : 'Marked wrong, but it was right'),
          h('button', { class: 'small', id: 'btn-change', onclick: function () { ui.phase = 'ask'; renderQuestion(item); } }, 'Change the answer')));
      if (autoRead && ui.spoken !== key + ':auto') { ui.spoken = key + ':auto'; S.speak([kindLine(ok ? 'ok' : 'no')]); }
    } else if (ui.phase === 'skip') {
      A.append(card, 
        h('div', { class: 'feedback-kind skip', id: 'verdict', role: 'status' }, kindLine('skip')),
        feedbackBlock(q),
        h('div', { class: 'q-actions' }, h('button', { class: 'primary', id: 'btn-next', onclick: function () { commit('skip'); } }, 'Next question')));
      if (autoRead && ui.spoken !== key + ':skip') { ui.spoken = key + ':skip'; S.speak([kindLine('skip')]); }
    } else {
      A.append(card, 
        ui.answer ? h('div', { class: 'muted' }, 'Your answer: ' + ui.answer) : null,
        h('div', { class: 'feedback-kind skip', id: 'verdict' }, q.type === 'self' || !ui.verdict
          ? 'Have a look at the answer. Did you get it right?'
          : 'The computer can’t tell for sure. Have a look: did you get it right?'),
        feedbackBlock(q),
        h('div', { class: 'q-actions' },
          h('button', { class: 'good', id: 'btn-right', onclick: function () { commit('correct'); } }, 'Yes, I got it'),
          h('button', { class: 'bad', id: 'btn-wrong', onclick: function () { commit('wrong'); } }, 'Not quite'),
          h('button', { id: 'btn-skip2', onclick: function () { commit('skip'); } }, 'I didn’t know')));
    }

    A.append(card, h('details', { class: 'grown-up no-print', id: 'grown-up' },
      h('summary', null, 'For grown-ups'),
      h('p', { class: 'muted small' }, 'Answers are marked automatically for numbers, choices and single words. Words, units and fractions are compared loosely, and you can always correct a mark here or in the answer log on the results page.'),
      h('div', { class: 'row' },
        n > 0 ? h('button', { class: 'small', id: 'btn-undo', onclick: function () { rebuild(session.answers.slice(0, -1)); } }, 'Undo the last answer') : null,
        h('button', { class: 'small', id: 'btn-restart', onclick: function () { if (confirm('Stop this check-up and go back to the start?')) restart(); } }, 'Start again'))));
    const page = h('div', { class: young ? 'young-page' : '' });
    if (demo) A.append(page, demoBanner());
    A.append(page, childBar('question'));
    A.append(page, card);
    show(page, ui.phase === 'ask' && ui.picked != null);
    const inp = document.getElementById('ans');
    if (inp && ui.phase === 'ask' && !('ontouchstart' in window && young)) {
      inp.focus();
      if (inp.setSelectionRange && inp.tagName === 'INPUT') inp.setSelectionRange(inp.value.length, inp.value.length);
    }
    if (ui.phase === 'ask' && autoRead && ui.spoken !== key) {
      ui.spoken = key;
      speakQuestion(q, document.getElementById('btn-speak'));
    }
  }

  /* ------------------------------------------------------------ share card */
  function onShareKey(e) { if (e.key === 'Escape') closeShare(); }
  function closeShare() {
    shareToken++;
    document.removeEventListener('keydown', onShareKey);
    const modal = document.getElementById('share-modal');
    if (modal) modal.remove();
    document.body.classList.remove('share-open');
    if (shareBlobUrl) { URL.revokeObjectURL(shareBlobUrl); shareBlobUrl = null; }
  }
  function shareScopeText() {
    const raw = sessionMeta && sessionMeta.label ? String(sessionMeta.label) : 'Check-up';
    return raw.replace(/ \((whole year|focus area)\)$/, '').replace(/\s+/g, ' ').trim() || 'Check-up';
  }
  function buildShareModel(sum, chapters) {
    let spots = [];
    let spotKind = 'topic';
    if (chapters && chapters.length) {
      spotKind = 'chapter';
      let hot = chapters.filter(function (c) { return c.weak > 0 || c.shaky > 0; });
      if (!hot.length) hot = chapters.slice(0, 3);
      spots = hot.slice(0, 3).map(function (c) {
        return { title: c.focusArea, detail: c.strand + ' · needs work ' + c.weak + ' · shaky ' + c.shaky + ' · not checked ' + c.untested };
      });
    } else {
      const seen = Object.create(null);
      const ids = [];
      const pushId = function (id) { if (!id || seen[id] || ids.length >= 3) return; seen[id] = true; ids.push(id); };
      sum.roots.forEach(function (r) { pushId(r.id); });
      sum.weak.forEach(pushId);
      sum.shaky.forEach(pushId);
      spots = ids.map(function (id) { return { title: nameOf(id), detail: A.yearLabel(D.graph.byId[id].year) + ' · ' + STATUS_LABEL[E.statusOf(session, id)] }; });
    }
    return {
      siteName: 'K–6 Learning Map', subject: subjectName(), scope: shareScopeText(),
      mastered: sum.mastered.length, shaky: sum.shaky.length, weak: sum.weak.length, untested: sum.untested.length,
      spotKind: spotKind, spots: spots, roots: sum.roots.slice(0, 2).map(function (r) { return nameOf(r.id); }),
      date: A.fmtDate(new Date().toISOString()),
      url: new URL('../?from=share' + (subject === 'english' ? '&subject=english' : ''), location.href).href
    };
  }
  function mountShareModal(url) {
    const old = document.getElementById('share-modal');
    if (old) old.remove();
    const img = h('img', { id: 'share-preview', alt: 'Check-up share card', src: url });
    const modal = h('div', {
      id: 'share-modal', class: 'share-modal no-print', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'share-title',
      onclick: function (e) { if (e.target === modal) closeShare(); }
    }, h('div', { class: 'share-panel', onclick: function (e) { e.stopPropagation(); } },
      h('div', { class: 'share-bar' },
        h('h2', { id: 'share-title', text: 'Share card' }),
        h('button', { type: 'button', id: 'share-close', onclick: closeShare }, 'Close')),
      h('p', { id: 'share-hint', class: 'share-hint', text: 'Press and hold the picture to save it' }),
      h('div', { class: 'share-scroll' }, img),
      h('div', { class: 'share-actions' },
        h('a', { id: 'share-download', class: 'btn btn-primary', href: url, download: 'k6-checkup.png' }, 'Download picture'))));
    document.body.classList.add('share-open');
    document.body.append(modal);
    document.addEventListener('keydown', onShareKey);
  }
  function openShare() {
    if (!window.ShareCard) {
      const host0 = document.getElementById('summary');
      if (host0) host0.append(h('p', { id: 'share-error', class: 'err', text: 'The share card could not be made: its script did not load.' }));
      return;
    }
    const token = ++shareToken;
    const sum = E.summarize(D.graph, session);
    const chapters = session.mode === 'screen' ? E.chapterSummary(D.graph, session) : null;
    const model = buildShareModel(sum, chapters);
    window.__shareModel = model;
    const canvas = document.createElement('canvas');
    try { window.ShareCard.draw(canvas, model); }
    catch (err) {
      const host = document.getElementById('summary');
      if (host) host.append(h('p', { id: 'share-error', class: 'err', text: 'The share card could not be made: ' + (err && err.message ? err.message : err) }));
      return;
    }
    const finish = function (url) {
      if (token !== shareToken) { if (String(url).indexOf('blob:') === 0) URL.revokeObjectURL(url); return; }
      if (shareBlobUrl && shareBlobUrl !== url) URL.revokeObjectURL(shareBlobUrl);
      shareBlobUrl = String(url).indexOf('blob:') === 0 ? url : null;
      mountShareModal(url);
    };
    if (canvas.toBlob) {
      canvas.toBlob(function (blob) {
        if (token !== shareToken) return;
        if (!blob) { finish(canvas.toDataURL('image/png')); return; }
        finish(URL.createObjectURL(blob));
      }, 'image/png');
    } else finish(canvas.toDataURL('image/png'));
  }

  /* ------------------------------------------------------------ results */
  function stdLine(code) {
    const item = D.stdById[code];
    return h('div', { class: 'std' },
      h('code', { text: code }), ' ', h('span', { class: 'fw', text: A.frameworkName(item, code) }),
      h('div', { text: item ? item.text : 'Not in standards.json yet.' }),
      item && item.url ? h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open the curriculum page' }) : null);
  }
  function topicBody(id, extra) {
    const t = D.graph.byId[id];
    const body = h('div', { class: 'body' });
    A.append(body, h('div', { class: 'muted' }, A.yearLabel(t.year) + ' · ' + t.strand + ' · ' + t.focusArea));
    A.append(body, h('div', { text: t.description }));
    if (t.mastery_criteria && t.mastery_criteria.length) {
      A.append(body, h('div', null, h('b', null, 'Success looks like:'), h('ul', null, t.mastery_criteria.map(function (m) { return h('li', { text: m }); }))));
    }
    if (extra) A.append(body, extra);
    const list = t.standards || [];
    if (list.length) A.append(body, h('div', null, h('b', null, 'Curriculum: '), list.map(function (sd) { return stdLine(sd.id); })));
    A.append(body, h('a', { class: 'btn small', href: w('../explore/#' + encodeURIComponent(id)), text: 'Open in the skill map' }));
    return body;
  }
  function topicItem(id, tags, extra) {
    const t = D.graph.byId[id];
    return h('details', { class: 'topic', 'data-topic': id },
      h('summary', null, tags, h('span', { text: t.name }), ' ', h('span', { class: 'muted small', text: A.yearLabel(t.year) })),
      topicBody(id, extra));
  }
  function statusTags(id, rootSet, targetSet) {
    const st = E.statusOf(session, id);
    const out = [];
    if (targetSet.has(id)) out.push(tag('target', 'Goal'));
    if (rootSet.has(id)) out.push(tag('root', 'Gap starts here'));
    out.push(tag(st, STATUS_LABEL[st]));
    return out;
  }
  function stat(cls, n, label, id) { return h('div', { class: 'stat ' + cls, id: id || null }, h('b', { text: String(n) }), label); }

  function renderResult() {
    const sum = E.summarize(D.graph, session);
    const rootSet = new Set(sum.roots.map(function (r) { return r.id; }));
    const screen = session.mode === 'screen';
    const targetSet = new Set(screen ? [] : session.targets);
    const page = h('div');
    if (demo) A.append(page, demoBanner());
    saveToChild(sum);
    if (window.cnmTrack && !demo && !renderResult.tracked) { renderResult.tracked = true; window.cnmTrack('checkup_finished', { mode: session.mode, subject: subject }); }
    A.append(page, childBar('result'));

    const targetsMastered = session.targets.every(function (id) { return E.statusOf(session, id) === 'mastered'; });
    const chapters = screen ? E.chapterSummary(D.graph, session) : null;
    const outOfScope = screen ? sum.roots.filter(function (r) { return r.outOfScopePrereqs.length; }) : [];
    let headline;
    if (screen) {
      if (!sum.weak.length && !sum.shaky.length) headline = sum.untested.length
        ? 'No gaps in the skills we checked. ' + A.plural(sum.untested.length, 'skill was', 'skills were') + ' not reached.'
        : 'Every skill in this year looks solid. No gaps found.';
      else headline = A.plural(session.targets.length, 'skill') + ' in this year: ' + sum.weak.length + ' need work, ' + sum.shaky.length + ' shaky, ' + sum.untested.length + ' not checked. The focus areas with the most gaps come first below.';
    }
    else if (!sum.roots.length && !sum.shaky.length && targetsMastered) headline = 'Got it! No gaps in the skills this builds on.';
    else if (!sum.roots.length && !sum.shaky.length) headline = 'No gaps found, but not everything was checked.';
    else if (!sum.roots.length) headline = 'No big gaps, but ' + A.plural(sum.shaky.length, 'skill is', 'skills are') + ' shaky (wrong first, right second). A little practice will help.';
    else headline = 'Found ' + A.plural(sum.roots.length, 'place') + ' where the gap starts' + (sum.shaky.length ? ' and ' + A.plural(sum.shaky.length, 'shaky skill') : '') + '. Work down the list below, from the top.';

    const more = screen ? 10 : 4;
    const kid = sessionKid();
    A.append(page, h('div', { class: 'card', id: 'summary' },
      h('h2', null, 'Check-up results: ' + sessionMeta.label, kid ? [' ', h('span', { class: 'kid-chip', text: kid.name })] : null),
      h('p', { id: 'headline' }, headline),
      h('div', { class: 'stats' },
        stat('ask', sum.asked, 'Answered', 'stat-asked'),
        stat('bad', sum.weak.length, STATUS_LABEL.weak, 'stat-weak'),
        stat('shaky', sum.shaky.length, STATUS_LABEL.shaky, 'stat-shaky'),
        stat('ok', sum.mastered.length, STATUS_LABEL.mastered, 'stat-mastered'),
        stat('unk', sum.untested.length, STATUS_LABEL.unknown, 'stat-untested')),
      sum.unconfirmed.length ? h('p', { class: 'notice' }, namesOf(sum.unconfirmed) + ' missed the first question and the limit ran out before a second try, so for now ' + (sum.unconfirmed.length === 1 ? 'it counts' : 'they count') + ' as needing work.') : null,
      sum.limitReached ? h('p', { class: 'notice' }, 'The question limit (' + sum.limit + ') was reached, so some skills are “Not checked”. If a gap’s earlier skills were not reached, the real gap may start even earlier.',
        session.limit >= 60 ? null : h('button', { class: 'no-print', id: 'btn-more', style: 'margin-left:8px', onclick: function () { rebuild(session.answers, Math.min(session.limit + more, 60)); } }, 'Answer ' + Math.min(more, 60 - session.limit) + ' more')) : null,
      h('p', { class: 'muted small' }, 'Marking is automatic and can be wrong; you can fix any answer in the answer log. ' + A.fmtDate(new Date().toISOString(), true)),
      h('div', { class: 'row no-print' },
        h('button', { class: 'primary', id: 'btn-share', onclick: openShare }, 'Share card'),
        h('button', { id: 'btn-export', onclick: exportJson }, 'Export JSON'),
        h('button', { id: 'btn-print', onclick: function () { window.print(); } }, 'Print or save as PDF'),
        h('button', { id: 'btn-restart', onclick: function () { if (confirm('Start again? This clears the current results from this page (saved profile records stay).')) restart(); } }, 'Start again'),
        session.answers.length ? h('button', { id: 'btn-undo', onclick: function () { rebuild(session.answers.slice(0, -1)); } }, 'Undo the last answer') : null)));
    if (screen) A.append(page, chaptersCard(chapters, outOfScope));

    A.append(page, h('div', { class: 'card', id: 'roots' },
      h('h2', { text: 'Where the gap starts' }),
      h('p', { class: 'muted small' }, 'A skill that needs work while the skills it builds on are fine. Start here. Tap a skill for details.'),
      sum.roots.length ? sum.roots.map(function (r) {
        const notes = h('div');
        if (r.pendingPrereqs.length) A.append(notes, h('div', { class: 'notice', text: 'Not reached before the limit: ' + namesOf(r.pendingPrereqs) + '. The gap may start even earlier.' }));
        if (r.outOfScopePrereqs.length) A.append(notes, h('div', { class: 'notice', text: 'Earlier skills outside this year were not checked: ' + namesOf(r.outOfScopePrereqs) + '.' }));
        if (r.externalPrereqs.length) A.append(notes, h('div', { class: 'muted small', text: 'Earlier skills without questions: ' + namesOf(r.externalPrereqs) + '.' }));
        return topicItem(r.id, statusTags(r.id, rootSet, targetSet), notes);
      }) : h('p', { text: targetsMastered ? 'None.' : 'None found so far.' })));

    A.append(page, h('div', { class: 'card', id: 'shaky' },
      h('h2', { text: 'Shaky (' + sum.shaky.length + ')' }),
      h('p', { class: 'muted small' }, 'Wrong the first time, right the second. Could be a slip, could be not quite secure. They are in the practice list, but the check-up didn’t step back from them.'),
      sum.shaky.length ? sum.shaky.map(function (id) { return topicItem(id, statusTags(id, rootSet, targetSet)); }) : h('p', { text: 'None.' })));

    A.append(page, h('div', { class: 'card', id: 'path' },
      h('h2', { text: 'What to practise next, in order' }),
      h('p', { class: 'muted small' }, 'From where the gap starts up to the goal, earliest year first. Skills marked “Not checked” are worth a quick look too.'),
      sum.path.length ? h('ol', { class: 'path' }, sum.path.map(function (p) {
        return h('li', null, topicItem(p.id, statusTags(p.id, rootSet, targetSet)));
      })) : h('p', { text: 'Nothing to practise from this check-up.' })));

    A.append(page, h('div', { class: 'card', id: 'graph' },
      h('h2', { text: 'Path graph' }),
      h('p', { class: 'muted small' }, 'Earlier skills are at the top. Solid lines: needed first. Dashed: helps. Dotted: skills in between are not drawn. Red border: where the gap starts. Orange: the goal. Pinch or scroll to zoom.'),
      h('div', { class: 'path-tools no-print' },
        h('button', { type: 'button', id: 'path-zoom-out', onclick: function () { pathZoom(0.8); } }, 'Zoom out'),
        h('button', { type: 'button', id: 'path-zoom-in', onclick: function () { pathZoom(1.25); } }, 'Zoom in'),
        h('button', { type: 'button', id: 'path-fit', onclick: pathFit }, 'Fit')),
      h('p', { id: 'path-fold', class: 'graph-fold no-print', hidden: true }),
      h('ul', { class: 'legend' },
        h('li', null, h('i', { class: 'swatch sw-early' }), 'K–Year 2'),
        h('li', null, h('i', { class: 'swatch sw-middle' }), 'Years 3–4'),
        h('li', null, h('i', { class: 'swatch sw-upper' }), 'Years 5–6'),
        h('li', null, h('i', { class: 'swatch sw-root' }), 'Gap starts here'),
        h('li', null, h('i', { class: 'swatch sw-target' }), 'Goal'),
        h('li', null, h('i', { class: 'swatch line-hard' }), 'Needed first'),
        h('li', null, h('i', { class: 'swatch line-soft' }), 'Helps'),
        h('li', null, h('i', { class: 'swatch line-skip' }), 'Skips steps')),
      h('div', { class: 'path-graph' },
        h('div', { id: 'path-cy', role: 'img', 'aria-label': 'Path graph of the skills checked' }),
        h('div', { id: 'node-tip', class: 'node-tip', role: 'tooltip', hidden: true }))));

    A.append(page, h('details', { class: 'card', id: 'mastered' },
      h('summary', null, h('b', null, 'Got it (' + sum.mastered.length + ')')),
      sum.mastered.map(function (id) {
        const src = session.status[id].src === 'direct' ? 'Answered right' : 'Covered by a later skill';
        return topicItem(id, [tag('mastered', src)]);
      })));
    A.append(page, h('details', { class: 'card', id: 'untested' },
      h('summary', null, h('b', null, 'Not checked (' + sum.untested.length + ')')),
      h('p', { class: 'muted small' }, 'Skills the check-up didn’t need to ask, or didn’t reach before the limit.'),
      sum.untested.map(function (id) { return topicItem(id, statusTags(id, rootSet, targetSet)); })));
    A.append(page, standardsCard(sum));
    A.append(page, logCard());
    show(page);
    mountPathGraph(sum);
  }

  function chaptersCard(chapters, outOfScope) {
    const seg = function (cls, n, total) { return n ? h('i', { class: cls, style: 'width:' + (n / total * 100) + '%' }) : null; };
    return h('div', { class: 'card', id: 'chapters' },
      h('h2', { text: 'By focus area' }),
      h('p', { class: 'muted small' }, 'Focus areas with the most gaps come first. Tap one to see the skills. Bar: got it, shaky, needs work, not checked.'),
      outOfScope.length ? h('p', { class: 'notice', id: 'out-of-scope' }, 'Some gaps build on skills from earlier years, which a whole-year check-up doesn’t test (for example ' +
        namesOf(outOfScope.slice(0, 3).map(function (r) { return r.id; })) + '). Check one of those skills on its own to follow it further back.') : null,
      chapters.map(function (c) {
        return h('details', { class: 'topic chap-sum', open: c.weak > 0 || c.shaky > 0, 'data-key': c.key },
          h('summary', null,
            h('span', { class: 'chap-name' }, c.focusArea, h('span', { class: 'area-sub', text: c.yearLabel + ' · ' + c.strand })),
            h('span', { class: 'chap-counts' },
              tag('mastered', 'Got it ' + c.mastered), tag('shaky', 'Shaky ' + c.shaky), tag('weak', 'Needs work ' + c.weak), tag('unknown', 'Not checked ' + c.untested)),
            h('span', { class: 'chap-bar', 'aria-hidden': 'true' },
              seg('m', c.mastered, c.total), seg('s', c.shaky, c.total), seg('w', c.weak, c.total), seg('u', c.untested, c.total))),
          h('div', { class: 'body' },
            h('div', { class: 'muted small', text: A.plural(c.total, 'skill') }),
            c.weakIds.length ? h('div', { class: 'chap-names' }, tag('weak', 'Needs work'), c.weakIds.map(nameOf).join(', ')) : null,
            c.shakyIds.length ? h('div', { class: 'chap-names' }, tag('shaky', 'Shaky'), c.shakyIds.map(nameOf).join(', ')) : null,
            !c.weakIds.length && !c.shakyIds.length ? h('div', { class: 'muted small', text: c.untested ? 'No gaps found; ' + c.untested + ' not checked.' : 'No gaps found.' }) : null));
      }));
  }

  function standardsCard(sum) {
    const ids = new Set(session.mode === 'screen' ? [] : session.targets);
    sum.path.forEach(function (p) { ids.add(p.id); });
    const by = {};
    ids.forEach(function (id) {
      (D.graph.byId[id].standards || []).forEach(function (sd) { (by[sd.id] || (by[sd.id] = [])).push(id); });
    });
    const keys = Object.keys(by).sort(function (a, b) { return (/^AC9/.test(a) ? 1 : 0) - (/^AC9/.test(b) ? 1 : 0) || a.localeCompare(b); });
    return h('div', { class: 'card', id: 'standards' },
      h('h2', { text: 'Curriculum links' }),
      h('p', { class: 'muted small' }, 'NSW ' + subjectName() + ' K–10 syllabus (2022) outcomes, and the matching Australian Curriculum v9 content descriptions, for the goal and the practice list.'),
      keys.length ? keys.map(function (k) {
        const line = stdLine(k);
        A.append(line, h('div', { class: 'muted small', text: 'Skills: ' + by[k].map(nameOf).join(', ') }));
        return line;
      }) : h('p', { class: 'muted', text: 'None.' }));
  }

  function logCard() {
    const rows = session.answers.map(function (a, i) {
      const q = E.questionById(D.graph, a.qid) || { prompt: '', answer: '' };
      const sel = h('select', {
        'aria-label': 'Result for answer ' + (i + 1),
        onchange: function (e) {
          const next = session.answers.map(function (x, j) { return j === i ? Object.assign({}, x, { result: e.target.value }) : x; });
          rebuild(next);
        }
      }, ['correct', 'wrong', 'skip'].map(function (r) { return h('option', { value: r, selected: r === a.result }, RESULT_LABEL[r]); }));
      const prompt = q.prompt || '';
      return h('tr', null, h('td', { text: String(i + 1) }),
        h('td', null, nameOf(a.id), h('div', { class: 'muted small', text: prompt.length > 70 ? prompt.slice(0, 69) + '…' : prompt })),
        h('td', { class: 'muted', text: q.type === 'choice' && a.text ? answerOfKey(q, a.text) : (a.text || '') }),
        h('td', null, sel), h('td', { class: 'muted', text: q.answer ? answerText(q) : '' }));
    });
    return h('div', { class: 'card', id: 'log' },
      h('h2', { text: 'Answer log' }),
      h('p', { class: 'muted small' }, 'If something was marked wrongly, change it here. The whole check-up is worked out again, and later questions may change.'),
      session.answers.length ? h('table', { class: 'log' },
        h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Skill and question' }), h('th', { text: 'Answer given' }), h('th', { text: 'Result' }), h('th', { text: 'Correct answer' }))),
        h('tbody', null, rows)) : h('p', { class: 'muted', text: 'No answers yet.' }));
  }

  /* ------------------------------------------------------------ path graph (Cytoscape + dagre) */
  function toneOf(year, colors) {
    const band = A.bandOf(year);
    return [colors[band + 'Bg'], colors[band], band];
  }
  function pathNodeElement(n, colors) {
    const topic = D.graph.byId[n.id];
    const year = topic && typeof topic.year === 'number' ? topic.year : 0;
    const tone = toneOf(year, colors);
    const name = nameOf(n.id);
    const bits = [name, A.yearLabel(year)];
    if (n.isRoot) bits.push('gap starts here');
    if (n.isTarget) bits.push('goal');
    bits.push(STATUS_LABEL[n.status] || n.status);
    let bg = tone[0], border = tone[1];
    if (n.isTarget) { bg = colors.currentBg; border = colors.currentBorder; }
    if (n.isRoot) { bg = colors.badBg; border = colors.bad; }
    const classes = [tone[2]];
    if (n.isRoot) classes.push('root');
    if (n.isTarget) classes.push('target', 'current');
    return { data: { id: n.id, name: name, full: bits.join(' · '), label: clipLabel(name), bg: bg, border: border, color: colors.text }, classes: classes.join(' ') };
  }
  function buildPathElements(lay, colors, folded) {
    const elements = [];
    const bucket = new Map();
    const members = new Map();
    lay.nodes.forEach(function (n) {
      if (!folded || n.isRoot || n.isTarget) { bucket.set(n.id, n.id); elements.push(pathNodeElement(n, colors)); return; }
      const topic = D.graph.byId[n.id];
      const year = topic && typeof topic.year === 'number' ? topic.year : 0;
      if (!members.has(year)) members.set(year, []);
      members.get(year).push(n.id);
    });
    members.forEach(function (ids, year) {
      const id = 'year-' + year;
      const tone = toneOf(year, colors);
      const name = A.yearLabel(year) + ': ' + A.plural(ids.length, 'skill');
      elements.push({ data: { id: id, name: name, full: name, label: name, bg: tone[0], border: tone[1], color: colors.text }, classes: tone[2] + ' grade' });
      ids.forEach(function (topicId) { bucket.set(topicId, id); });
    });
    const seen = new Map();
    lay.edges.forEach(function (e) {
      const a = bucket.get(e.from), b = bucket.get(e.to);
      if (!a || !b || a === b) return;
      const key = a + '>' + b;
      const kind = !e.direct ? 'indirect' : (e.strength === 'soft' ? 'soft' : 'hard');
      const rank = kind === 'hard' ? 3 : kind === 'soft' ? 2 : 1;
      const prev = seen.get(key);
      if (!prev || rank > prev.rank) seen.set(key, { kind: kind, rank: rank });
    });
    let edgeIndex = 0;
    seen.forEach(function (info, key) {
      const parts = key.split('>');
      elements.push({ data: { id: 'e' + (edgeIndex++), source: parts[0], target: parts[1], color: info.kind === 'hard' ? colors.edge : colors.edgeSoft }, classes: info.kind });
    });
    return elements;
  }
  function updatePathFold(total, folded) {
    const box = document.getElementById('path-fold');
    if (!box) return;
    if (total <= PATH_FOLD_AT) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    if (folded) box.replaceChildren(document.createTextNode('A long path, so skills in between are grouped by year. The gap and the goal are still shown. '),
      h('button', { type: 'button', id: 'btn-path-expand', text: 'Show all ' + total }));
    else box.replaceChildren(document.createTextNode('Showing all ' + total + ' skills. '), h('button', { type: 'button', id: 'btn-path-collapse', text: 'Group by year' }));
  }
  function pathZoom(factor) {
    if (!pathCy) return;
    const rect = pathCy.container().getBoundingClientRect();
    pathCy.zoom({ level: Math.max(pathCy.minZoom(), Math.min(pathCy.maxZoom(), pathCy.zoom() * factor)), renderedPosition: { x: rect.width / 2, y: rect.height / 2 } });
  }
  function pathFit() { if (pathCy) { pathCy.resize(); pathCy.fit(undefined, 28); } }
  function hidePathTip() { const tip = document.getElementById('node-tip'); if (tip) tip.hidden = true; }
  function showPathTip(node) {
    const tip = document.getElementById('node-tip');
    const stage = document.querySelector('.path-graph');
    if (!tip || !stage || !pathCy || !node || node.empty()) return;
    const text = node.data('full') || node.data('label') || '';
    if (!text) { tip.hidden = true; return; }
    tip.textContent = text;
    tip.hidden = false;
    const stageRect = stage.getBoundingClientRect();
    const cyRect = pathCy.container().getBoundingClientRect();
    const bb = node.renderedBoundingBox({ includeLabels: true });
    const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
    const cx = cyRect.left - stageRect.left + (bb.x1 + bb.x2) / 2;
    const top = cyRect.top - stageRect.top + bb.y1;
    const left = Math.max(8, Math.min(cx - tipW / 2, Math.max(8, stageRect.width - tipW - 8)));
    let y = top - tipH - 8;
    if (y < 4) y = cyRect.top - stageRect.top + bb.y2 + 8;
    if (y + tipH > stageRect.height - 4) y = Math.max(4, stageRect.height - tipH - 4);
    tip.style.left = left + 'px';
    tip.style.top = y + 'px';
  }
  function ensureDagre() {
    if (!window.cytoscape || !window.dagre || !window.cytoscapeDagre) throw new Error('the graph library did not load');
    if (!ensureDagre.ready) { window.cytoscape.use(window.cytoscapeDagre); ensureDagre.ready = true; }
  }
  function mountPathGraph(sum) {
    const token = ++pathToken;
    if (pathCy) { pathCy.destroy(); pathCy = null; window.__pathCy = null; }
    const cyEl = document.getElementById('path-cy');
    if (!cyEl) return;
    cyEl.dataset.ready = '0';
    hidePathTip();
    const lay = E.layout(D.graph, session, sum);
    requestAnimationFrame(function () {
      if (token !== pathToken || !document.body.contains(cyEl)) return;
      try {
        ensureDagre();
        const colors = theme();
        const boxW = narrow() ? 132 : 156;
        const total = lay.nodes.length;
        const folded = total > PATH_FOLD_AT && !pathExpanded;
        const heavy = !folded && total > 48;
        updatePathFold(total, folded);
        cyEl.dataset.mode = folded ? 'grade' : 'full';
        cyEl.dataset.total = String(total);
        pathCy = window.cytoscape({
          container: cyEl, elements: buildPathElements(lay, colors, folded),
          minZoom: heavy ? 0.45 : 0.2, maxZoom: 2.8,
          boxSelectionEnabled: false, autoungrabify: true, userPanningEnabled: true, userZoomingEnabled: true,
          style: [
            { selector: 'node', style: {
              label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': (boxW - 14) + 'px',
              'text-valign': 'center', 'text-halign': 'center', 'line-height': 1.2,
              'font-size': 12, 'font-family': FONT, color: 'data(color)',
              'background-color': 'data(bg)', 'border-width': 2, 'border-color': 'data(border)',
              shape: 'round-rectangle', width: boxW, height: 46, padding: 0, 'corner-radius': 8
            } },
            { selector: 'node.current', style: { 'border-width': 4, 'z-index': 8 } },
            { selector: 'node.root', style: { 'background-color': colors.badBg, 'border-color': colors.bad, 'border-width': 4, 'z-index': 11 } },
            { selector: 'edge', style: {
              width: 1.6, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)',
              'target-arrow-shape': 'triangle', 'curve-style': heavy ? 'straight' : 'bezier', 'arrow-scale': 0.8, 'line-style': 'solid'
            } },
            { selector: 'edge.soft', style: { 'line-style': 'dashed', width: 1.5 } },
            { selector: 'edge.indirect', style: { 'line-style': 'dotted', width: 1.4 } }
          ]
        });
        window.__pathCy = pathCy;
        pathCy.on('mouseover', 'node', function (event) { showPathTip(event.target); });
        pathCy.on('mouseout', 'node', function () { if (!pathTipLock) hidePathTip(); });
        pathCy.on('tap', 'node', function (event) { pathTipLock = true; showPathTip(event.target); });
        pathCy.on('tap', function (event) { if (event.target === pathCy) { pathTipLock = false; hidePathTip(); } });
        const layout = pathCy.layout({
          name: 'dagre', rankDir: 'TB', rankSep: heavy ? 46 : 56, nodeSep: heavy ? 16 : 22, edgeSep: heavy ? 8 : 10,
          ranker: heavy ? 'longest-path' : 'network-simplex', padding: 16, animate: false, fit: true,
          nodeDimensionsIncludeLabels: false, spacingFactor: heavy ? 1.02 : 1.05
        });
        layout.one('layoutstop', function () {
          if (token !== pathToken || !pathCy) return;
          requestAnimationFrame(function () {
            if (token !== pathToken || !pathCy) return;
            pathCy.resize();
            pathCy.fit(undefined, heavy ? 20 : 24);
            if (pathCy.zoom() > 1.4) { pathCy.zoom(1.4); pathCy.center(); }
            if (heavy && pathCy.zoom() < 0.7) {
              pathCy.zoom(0.8);
              const focusNode = lay.nodes.find(function (n) { return n.isRoot; }) || lay.nodes.find(function (n) { return n.isTarget; }) || lay.nodes[0];
              const focus = focusNode ? pathCy.getElementById(focusNode.id) : null;
              if (focus && !focus.empty()) pathCy.center(focus);
            }
            cyEl.dataset.ready = '1';
          });
        });
        layout.run();
      } catch (error) {
        cyEl.dataset.ready = 'err';
        cyEl.append(h('p', { class: 'muted', text: 'The graph could not be drawn: ' + (error && error.message ? error.message : error) }));
      }
    });
  }

  /* ------------------------------------------------------------ export / print */
  function exportJson() {
    const sum = E.summarize(D.graph, session);
    const stdIds = new Set();
    const brief = function (id) { const t = D.graph.byId[id]; return { id: id, name: nameOf(id), year: t ? t.year : null }; };
    sum.path.concat(session.mode === 'screen' ? [] : session.targets.map(function (id) { return { id: id }; })).forEach(function (p) {
      (D.graph.byId[p.id].standards || []).forEach(function (sd) { stdIds.add(sd.id); });
    });
    const chapters = session.mode === 'screen' ? E.chapterSummary(D.graph, session) : null;
    const kid = sessionKid();
    const out = {
      tool: 'cn-math-taxonomy/au/diagnose', version: 1, subject: subject, mode: session.mode || 'target', generatedAt: new Date().toISOString(),
      note: 'Marking is automatic and approximate; check against the reference answers.',
      label: sessionMeta.label, kidYear: kid ? kid.year : null,
      targets: session.targets.map(brief),
      limit: session.limit, seed: session.seed, asked: sum.asked, finished: sum.finished, limitReached: sum.limitReached,
      answers: session.answers.map(function (a, i) {
        const q = E.questionById(D.graph, a.qid) || {};
        return {
          order: i + 1, topicId: a.id, name: nameOf(a.id), questionId: a.qid, difficulty: q.difficulty, type: q.type,
          prompt: q.prompt, userAnswer: a.text == null ? null : a.text, result: a.result,
          referenceAnswer: q.answer, explanation: q.explanation || ''
        };
      }),
      focusAreas: chapters ? chapters.map(function (c) {
        return {
          year: c.year, strand: c.strand, focusArea: c.focusArea, total: c.total, mastered: c.mastered, shaky: c.shaky, weak: c.weak, untested: c.untested,
          weakTopics: c.weakIds.map(brief), shakyTopics: c.shakyIds.map(brief), untestedTopics: c.untestedIds.map(brief)
        };
      }) : undefined,
      gapStarts: sum.roots.map(function (r) {
        return Object.assign(brief(r.id), {
          pendingPrereqs: r.pendingPrereqs, outOfScopePrereqs: r.outOfScopePrereqs, externalPrereqs: r.externalPrereqs,
          masteryCriteria: D.graph.byId[r.id].mastery_criteria || [],
          standards: (D.graph.byId[r.id].standards || []).map(function (sd) { return sd.id; })
        });
      }),
      practiseNext: sum.path.map(function (p, i) { return Object.assign({ order: i + 1 }, brief(p.id), { status: p.status, isRoot: p.isRoot, isTarget: p.isTarget }); }),
      weak: sum.weak.map(brief),
      shaky: sum.shaky.map(brief),
      mastered: sum.mastered.map(function (id) { return Object.assign(brief(id), { source: session.status[id].src }); }),
      untested: sum.untested.map(brief),
      standards: Array.from(stdIds).sort().map(function (k) { return { id: k, text: D.stdById[k] ? D.stdById[k].text : '', url: D.stdById[k] ? D.stdById[k].url : '' }; })
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'checkup-' + subject + '-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  window.addEventListener('beforeprint', function () {
    document.querySelectorAll('details:not([open])').forEach(function (d) { d.setAttribute('open', ''); d.dataset.autoOpen = '1'; });
    if (pathCy) { pathCy.resize(); pathCy.fit(undefined, 20); }
  });
  window.addEventListener('afterprint', function () {
    document.querySelectorAll('details[data-auto-open]').forEach(function (d) { d.removeAttribute('open'); delete d.dataset.autoOpen; });
  });

  /* ------------------------------------------------------------ start-up */
  function resolveFromUrl(params) {
    const t = params.get('target');
    if (t) {
      const ids = E.resolveTargets(t.split(',').map(function (x) { return x.trim(); }).filter(Boolean));
      const bad = ids.filter(function (id) { return !D.graph.byId[id] || !E.isTestable(D.graph, id); });
      if (bad.length) throw new Error('This link points to a skill that isn’t in the ' + subjectName() + ' map: ' + bad.join(', '));
      return { ids: ids, label: ids.length <= 3 ? ids.map(nameOf).join(', ') : A.plural(ids.length, 'skill'), url: { param: 'target', value: ids.join(',') } };
    }
    const gk = params.get('group');
    if (gk) {
      const g = findGroup(gk.trim());
      if (!g) throw new Error('This link points to a focus area that isn’t in the ' + subjectName() + ' map.');
      return { ids: g.topics.map(function (x) { return x.id; }), label: g.label + ' (focus area)', url: { param: 'group', value: g.key } };
    }
    const yRaw = (params.get('year') || params.get('grade') || '').trim();
    if (yRaw) {
      const year = E.parseYear(yRaw);
      const g = year == null ? null : E.gradeTargets(D.graph, year, subject);
      if (!g) throw new Error('No ' + subjectName() + ' skills for “' + yRaw + '”. Use K or Kindergarten, or a year from 1 to 6.');
      return { ids: g.ids, label: g.label + ' (whole year)', mode: 'screen', year: year, url: { param: 'year', value: year === 0 ? 'K' : String(year) } };
    }
    return null;
  }

  async function init() {
    subject = A.detectSubject();
    A.applyChrome(subject);
    document.title = 'Check-up · ' + subjectName() + ' · K–6 Learning Map';
    const params = new URLSearchParams(location.search);
    const kidParam = params.get('kid');
    if (kidParam && K.get(kidParam)) K.setCurrent(kidParam);
    try { await loadData(); } catch (e) {
      clearRoot();
      root.append(h('div', { class: 'card' }, h('h2', { class: 'err', text: 'The data did not load' }),
        h('p', null, String(e.message || e)),
        h('p', null, 'If you are running the site yourself, start a web server in the project folder (for example ', h('code', { text: 'python3 -m http.server 8000' }), ') and open http://localhost:8000/au/diagnose/ rather than the file itself.')));
      return;
    }
    let resolved = null;
    try { resolved = resolveFromUrl(params); } catch (e) { setUrl(null); renderStart(e.message); return; }
    if (params.get('seed')) seedParam = params.get('seed');
    const paramLimit = parseInt(params.get('limit'), 10);
    const limit = paramLimit > 0 ? paramLimit : undefined;
    if (params.get('demo')) {
      if (!resolved) {
        const ids = demoTargets();
        if (!ids.length) { renderStart('There is nothing to demo yet: the ' + subjectName() + ' map has no questions.'); return; }
        resolved = { ids: ids, label: ids.map(nameOf).join(', ') };
      }
      demo = { oracle: makeOracle(resolved.ids, resolved.mode) };
      session = E.createSession(D.graph, resolved.ids, {
        mode: resolved.mode, limit: limit || (resolved.mode === 'screen' ? screenLimitFor(resolved.year) : getSettings().limit),
        seed: seedParam == null ? 'demo' : seedParam
      });
      sessionMeta = { label: resolved.label, kidId: null, url: null };
      const step = parseInt(params.get('step'), 10);
      runDemo(step >= 0 ? step : Infinity);
      render();
      return;
    }
    if (resolved) {
      const kid = currentKid();
      const saved = A.lsGet(sessionKeyFor(kid ? kid.id : null));
      const same = saved && JSON.stringify(saved.targets) === JSON.stringify(Array.from(new Set(resolved.ids))) &&
        (saved.mode || 'target') === (resolved.mode || 'target') && (seedParam == null || saved.seed === seedParam);
      if (same && restoreSession(saved)) { render(); return; }
      startSession(resolved.ids, resolved.label, limit, resolved.mode, resolved.url);
      return;
    }
    renderStart();
  }

  document.addEventListener('click', function (event) {
    const origin = event.target && event.target.closest ? event.target : (event.target && event.target.parentElement);
    if (!origin || !origin.closest) return;
    if (!origin.closest('#btn-path-expand') && !origin.closest('#btn-path-collapse')) return;
    pathExpanded = !!origin.closest('#btn-path-expand');
    if (session && D) mountPathGraph(E.summarize(D.graph, session));
  });
  if (window.matchMedia) {
    const relayout = function () { if (session && D && document.getElementById('path-cy')) mountPathGraph(E.summarize(D.graph, session)); };
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    if (scheme.addEventListener) scheme.addEventListener('change', relayout);
    const nar = window.matchMedia('(max-width: 700px)');
    if (nar.addEventListener) nar.addEventListener('change', relayout);
  }

  init();
})();
