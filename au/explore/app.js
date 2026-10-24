/* Skill map: search and filters on the left, the local prerequisite graph in the middle, skill details on the right. */
(function () {
  'use strict';
  var A = window.AU;
  var el = A.h;

  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var TYPE_LABEL = { conceptual: 'Understanding', procedural: 'Skill', reasoning: 'Reasoning', application: 'Applying' };
  var STRAND_ORDER = {
    maths: ['Number', 'Algebra', 'Measurement', 'Space', 'Statistics', 'Probability'],
    english: ['Phonological awareness', 'Phonics and word recognition', 'Spelling', 'Vocabulary', 'Grammar and punctuation', 'Reading comprehension', 'Text and literature']
  };
  var FOLD_AT = 40;

  var subject = 'maths';
  var topics = [];
  var deps = [];
  var byId = new Map();
  var indexOf = new Map();
  var pre = new Map();
  var post = new Map();
  var stdById = {};
  var questionsByTopic = new Map();
  var selected = null;
  var year = '';
  var strand = '';
  var focus = '';
  var query = '';
  var upDepth = 2;
  var ancestorsOpen = false;
  var tipFromTap = false;
  var cy = null;
  var graphToken = 0;
  var dagreReady = false;

  function $(id) { return document.getElementById(id); }
  function w(href) { return A.withSubject(href, subject); }

  function readHash() {
    var hash = location.hash.replace(/^#/, '');
    if (!hash) return '';
    try { hash = decodeURIComponent(hash); } catch (error) { /* keep as is */ }
    return hash;
  }
  function writeHash(id) {
    if (readHash() === id) return;
    history.replaceState(null, '', location.pathname + location.search + '#' + id);
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function theme() {
    return {
      early: cssVar('--node-primary'), earlyBg: cssVar('--node-primary-bg'),
      middle: cssVar('--node-junior'), middleBg: cssVar('--node-junior-bg'),
      upper: cssVar('--node-senior'), upperBg: cssVar('--node-senior-bg'),
      currentBg: cssVar('--node-current-bg'), currentBorder: cssVar('--node-current-border'),
      text: cssVar('--node-text'), edge: cssVar('--edge'), edgeSoft: cssVar('--edge-soft')
    };
  }
  function paint(y, colors) {
    var band = A.bandOf(y);
    return { bg: colors[band + 'Bg'], border: colors[band], cls: band };
  }

  function narrow() { return window.matchMedia('(max-width: 700px)').matches; }
  function clipLabel(name) {
    var limit = narrow() ? 30 : 38;
    var s = String(name || '');
    return s.length <= limit ? s : s.slice(0, limit - 1).trim() + '…';
  }

  function restoreDepth() {
    try {
      var saved = sessionStorage.getItem('auExplore.depth');
      if (saved === '1' || saved === '2' || saved === '3') upDepth = parseInt(saved, 10);
      else if (saved === 'all') upDepth = 'all';
    } catch (error) { /* private browsing */ }
  }
  function syncDepthButtons() {
    var current = upDepth === 'all' ? 'all' : String(upDepth);
    document.querySelectorAll('#depth-switch [data-depth]').forEach(function (button) {
      var on = button.getAttribute('data-depth') === current;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function closeDrawerIfMobile() {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    $('side').classList.remove('open');
    $('list-toggle').setAttribute('aria-expanded', 'false');
    $('list-toggle').textContent = 'Show the skill list';
  }

  /* ---------------------------------------------------------------- filters and list */
  function passBase(topic, ignoreFocus) {
    if (year !== '' && String(topic.year) !== year) return false;
    if (strand && topic.strand !== strand) return false;
    if (!ignoreFocus && focus && topic.focusArea !== focus) return false;
    return true;
  }
  function passFilter(topic) {
    if (!passBase(topic)) return false;
    if (query) {
      var codes = (topic.standards || []).map(function (s) { return s.id; }).join(' ');
      var blob = [topic.name, topic.description, topic.focusArea, topic.strand, topic.id, codes, A.yearLabel(topic.year)].join('\n').toLowerCase();
      if (blob.indexOf(query) < 0) return false;
    }
    return true;
  }

  function fillStrands() {
    var seen = {};
    topics.forEach(function (t) { if (t.strand) seen[t.strand] = true; });
    var names = (STRAND_ORDER[subject] || []).filter(function (n) { return seen[n]; });
    Object.keys(seen).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    var sel = $('fStrand');
    sel.replaceChildren(el('option', { value: '', text: 'All strands' }));
    names.forEach(function (n) { sel.append(el('option', { value: n, text: n })); });
    if (strand && !seen[strand]) strand = '';
    sel.value = strand;
  }
  function fillFocus() {
    var names = [];
    topics.forEach(function (t) {
      if (!passBase(t, true) || !t.focusArea) return;
      if (names.indexOf(t.focusArea) < 0) names.push(t.focusArea);
    });
    var sel = $('fFocus');
    sel.replaceChildren(el('option', { value: '', text: 'All focus areas' }));
    names.forEach(function (n) { sel.append(el('option', { value: n, text: n })); });
    if (focus && names.indexOf(focus) < 0) focus = '';
    sel.value = focus;
  }
  function syncControls() {
    $('fYear').value = year;
    fillStrands();
    fillFocus();
    syncDepthButtons();
  }
  function writeQuery() {
    var params = new URLSearchParams(location.search);
    ['year', 'strand', 'focus'].forEach(function (k) { params.delete(k); });
    if (year !== '') params.set('year', year);
    if (strand) params.set('strand', strand);
    if (focus) params.set('focus', focus);
    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  function renderList() {
    var years = [];
    var yearMap = new Map();
    topics.forEach(function (topic) {
      if (!passFilter(topic)) return;
      var yv = yearMap.get(topic.year);
      if (!yv) { yv = { year: topic.year, groups: [], groupMap: new Map() }; yearMap.set(topic.year, yv); years.push(yv); }
      var key = topic.focusArea || topic.strand || 'Other';
      var g = yv.groupMap.get(key);
      if (!g) { g = { label: key, topics: [] }; yv.groupMap.set(key, g); yv.groups.push(g); }
      g.topics.push(topic);
    });
    years.sort(function (a, b) { return a.year - b.year; });
    var shown = 0;
    var box = $('list');
    box.replaceChildren();
    var filtering = !!(query || year !== '' || strand || focus);
    years.forEach(function (yv) {
      var count = yv.groups.reduce(function (n, g) { return n + g.topics.length; }, 0);
      shown += count;
      var has = yv.groups.some(function (g) { return g.topics.some(function (t) { return t.id === selected; }); });
      var details = el('details', { class: 'vol' });
      details.open = filtering || has;
      details.append(el('summary', null, A.yearLabel(yv.year), el('span', { class: 'count-pill', text: ' ' + count })));
      yv.groups.forEach(function (g) {
        var gHas = g.topics.some(function (t) { return t.id === selected; });
        var gd = el('details', { class: 'chap' });
        gd.open = !!query || !!focus || gHas;
        gd.append(el('summary', { text: g.label }));
        g.topics.forEach(function (topic) {
          gd.append(el('button', { type: 'button', class: 'topic-item' + (topic.id === selected ? ' sel' : ''), 'data-jump': topic.id },
            el('span', { class: 'nm', text: topic.name }), el('span', { class: 'meta', text: topic.strand })));
        });
        details.append(gd);
      });
      A.append(box, details);
    });
    if (!shown) A.append(box, el('p', { class: 'muted', text: 'No skills match. Try a shorter search or clear a filter.', style: 'padding:12px' }));
    $('count').textContent = 'Showing ' + shown + ' of ' + topics.length + ' skills';
  }

  function sideVisible() { var side = $('side'); return side.offsetParent !== null && side.getBoundingClientRect().height > 0; }
  function highlight(scroll) {
    document.querySelectorAll('#list .topic-item').forEach(function (button) {
      var on = button.getAttribute('data-jump') === selected;
      button.classList.toggle('sel', on);
      if (on) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
    var current = document.querySelector('#list .topic-item.sel');
    if (!current) return;
    var parent = current.parentElement;
    while (parent && parent.id !== 'list') { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
    if (scroll && sideVisible()) current.scrollIntoView({ block: 'nearest' });
  }

  /* ---------------------------------------------------------------- detail panel */
  function countReach(map, id) {
    var seen = new Set();
    var stack = [id];
    while (stack.length) {
      (map.get(stack.pop()) || []).forEach(function (edge) { if (!seen.has(edge.id)) { seen.add(edge.id); stack.push(edge.id); } });
    }
    return seen.size;
  }
  function badge(strength) {
    var hard = strength === 'hard';
    return el('span', { class: 'badge ' + (hard ? 'hard' : 'soft'), text: hard ? 'Needed first' : 'Helps' });
  }
  function relButton(edge) {
    var other = byId.get(edge.id);
    return el('button', { type: 'button', class: 'rel-row', 'data-jump': edge.id },
      badge(edge.strength),
      el('span', { class: 'rel-name', text: other ? other.name : edge.id }),
      el('span', { class: 'rel-where', text: other ? A.yearLabel(other.year) + ' · ' + other.strand : '' }),
      edge.reason ? el('span', { class: 'why', text: edge.reason }) : null);
  }
  function metaItem(label, value, wide) {
    return el('div', { class: wide ? 'span-2' : '' }, el('dt', { text: label }), el('dd', { text: value || '—' }));
  }
  function stdBlock(entry) {
    var item = stdById[entry.id];
    var isNsw = item ? String(item.framework || '').indexOf('nsw') === 0 : /^(MA|EN)/.test(entry.id);
    return el('div', { class: 'std' },
      el('div', { class: 'std-id' }, el('code', { text: entry.id }), ' ',
        el('span', { class: 'fw', text: A.frameworkName(item, entry.id) + ' · ' + (entry.confidence === 'exact' ? 'direct match' : 'closest match') })),
      el('p', { text: item ? item.text : 'This code is not in standards.json yet.' }),
      item && item.url ? el('p', null, el('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: isNsw ? 'Open the NSW syllabus' : 'Open the Australian Curriculum' })) : null);
  }
  function answerText(q) {
    if (q.type === 'choice') {
      var c = (q.choices || []).filter(function (x) { return x.key === q.answer; })[0];
      return q.answer + (c ? '. ' + c.text : '');
    }
    return q.answer;
  }
  function sampleQuestion(q, i) {
    var parts = [el('p', { class: 'sample-q', text: q.prompt })];
    if (q.say) parts.push(el('p', { class: 'sample-say', text: 'Read aloud to the child: “' + q.say + '”' }));
    var fig = A.figureEl(q.figure);
    if (fig) parts.push(fig);
    if (q.choices && q.choices.length) {
      parts.push(el('div', { class: 'sample-choices' }, q.choices.map(function (c) {
        return el('div', { class: 'sample-choice' }, el('b', { text: c.key + '.' }), ' ' + c.text);
      })));
    }
    var ans = el('details', { class: 'ans' });
    A.append(ans, el('summary', { text: 'Show answer' }), el('p', null, el('b', { text: 'Answer: ' }), answerText(q)), q.explanation ? el('p', { class: 'muted', text: q.explanation }) : null);
    parts.push(ans);
    return el('div', { class: 'sample-item', 'data-qid': q.id }, el('div', { class: 'muted small', text: 'Example ' + (i + 1) + ' · ' + q.difficulty }), parts);
  }

  function renderDetail() {
    var box = $('detail');
    if (!selected || !byId.has(selected)) {
      box.replaceChildren(el('div', { class: 'detail-empty' },
        el('h1', { text: 'Choose a skill' }),
        el('p', { text: 'Search, or open a year on the left. The graph shows what the skill builds on and what comes next.' })));
      document.title = 'Skill map · ' + A.SUBJECTS[subject] + ' · K–6 Learning Map';
      return;
    }
    var topic = byId.get(selected);
    var parts = [];
    parts.push(el('h1', { class: 'detail-title', text: topic.name }));
    var band = A.bandOf(topic.year);
    parts.push(el('div', { class: 'pills' },
      el('span', { class: 'pill pill-' + (band === 'early' ? 'p' : band === 'middle' ? 'j' : 'h'), text: A.yearLabel(topic.year) }),
      el('span', { class: 'pill', style: 'background:var(--bg-muted)', text: A.stageOf(topic.year) }),
      el('code', { class: 'id-code', text: topic.id })));
    parts.push(el('a', { class: 'btn btn-primary btn-lg diag-btn', id: 'check-topic', href: w('../diagnose/?target=' + encodeURIComponent(topic.id)) }, 'Check this topic'));
    parts.push(el('dl', { class: 'meta-grid' },
      metaItem('Year', A.yearLabel(topic.year)),
      metaItem('Type', TYPE_LABEL[topic.type] || topic.type),
      metaItem('Strand', topic.strand, true),
      metaItem('Focus area', topic.focusArea, true)));
    if (topic.description) parts.push(el('p', { class: 'desc', text: topic.description }));
    if (topic.root_reason) parts.push(el('p', { class: 'root-reason', text: 'Starting point: ' + topic.root_reason }));
    if (topic.mastery_criteria && topic.mastery_criteria.length) {
      parts.push(el('section', null, el('h2', { text: 'Success looks like' }),
        el('ul', { class: 'plain' }, topic.mastery_criteria.map(function (m) { return el('li', { text: m }); }))));
    }
    var standards = topic.standards || [];
    parts.push(el('section', { id: 'curriculum' }, el('h2', { text: 'Curriculum links' }),
      standards.length ? standards.map(stdBlock) : el('p', { class: 'muted', text: 'No curriculum code yet.' })));

    var qs = (questionsByTopic.get(topic.id) || []).slice(0, 2);
    if (qs.length) {
      parts.push(el('section', { id: 'samples' }, el('h2', { text: 'Sample questions' }),
        el('p', { class: 'muted small', text: 'The check-up picks from ' + A.plural((questionsByTopic.get(topic.id) || []).length, 'question') + ' like these.' }),
        el('div', { class: 'sample-list' }, qs.map(sampleQuestion))));
    }

    var pres = pre.get(topic.id) || [];
    parts.push(el('section', { id: 'prereqs' },
      el('h2', { text: 'Builds on' }),
      el('p', { class: 'muted', text: A.plural(pres.length, 'direct prerequisite') + ', ' + countReach(pre, topic.id) + ' in total going back.' }),
      pres.length ? pres.map(relButton) : el('p', { text: 'This is a starting point: nothing earlier in the map is needed.' })));
    var posts = post.get(topic.id) || [];
    parts.push(el('section', { id: 'dependents' },
      el('h2', { text: 'Leads to' }),
      el('p', { class: 'muted', text: A.plural(posts.length, 'skill') + ' use this directly, ' + countReach(post, topic.id) + ' in total.' }),
      posts.length ? posts.map(relButton) : el('p', { text: 'No later skill in the map builds on this yet.' })));
    box.replaceChildren.apply(box, parts);
    box.scrollTop = 0;
    document.title = topic.name + ' · Skill map';
  }

  /* ---------------------------------------------------------------- graph */
  function upstream(id, depth) {
    var seen = new Set([id]);
    var frontier = [id];
    var limit = depth === Infinity ? 10000 : depth;
    for (var step = 0; step < limit; step++) {
      var next = [];
      frontier.forEach(function (current) {
        (pre.get(current) || []).forEach(function (edge) { if (!seen.has(edge.id)) { seen.add(edge.id); next.push(edge.id); } });
      });
      if (!next.length) break;
      frontier = next;
    }
    return seen;
  }
  function hideTip() { var tip = $('node-tip'); if (tip) tip.hidden = true; }
  function showTip(node) {
    var tip = $('node-tip');
    var stage = $('graph-stage');
    if (!tip || !stage || !cy || !node || node.empty()) return;
    var text = node.data('full') || node.data('label') || '';
    if (!text) { tip.hidden = true; return; }
    tip.textContent = text;
    tip.hidden = false;
    var stageRect = stage.getBoundingClientRect();
    var cyRect = cy.container().getBoundingClientRect();
    var bb = node.renderedBoundingBox({ includeLabels: true });
    var tipW = tip.offsetWidth, tipH = tip.offsetHeight;
    var cx = cyRect.left - stageRect.left + (bb.x1 + bb.x2) / 2;
    var top = cyRect.top - stageRect.top + bb.y1;
    var left = Math.max(8, Math.min(cx - tipW / 2, Math.max(8, stageRect.width - tipW - 8)));
    var y = top - tipH - 8;
    if (y < 4) y = cyRect.top - stageRect.top + bb.y2 + 8;
    if (y + tipH > stageRect.height - 4) y = Math.max(4, stageRect.height - tipH - 4);
    tip.style.left = left + 'px';
    tip.style.top = y + 'px';
  }
  function ensureDagre() {
    if (dagreReady) return;
    if (!window.cytoscape || !window.dagre || !window.cytoscapeDagre) throw new Error('the graph library did not load');
    window.cytoscape.use(window.cytoscapeDagre);
    dagreReady = true;
  }
  function topicElement(id, colors) {
    var topic = byId.get(id);
    var tone = paint(topic.year, colors);
    var current = id === selected;
    return {
      data: {
        id: id, name: topic.name, full: topic.name + ' · ' + A.yearLabel(topic.year), label: clipLabel(topic.name),
        bg: current ? colors.currentBg : tone.bg, border: current ? colors.currentBorder : tone.border, color: colors.text
      },
      classes: tone.cls + (current ? ' current' : '')
    };
  }
  function edgeElement(id, source, target, soft, colors) {
    return { data: { id: id, source: source, target: target, color: soft ? colors.edgeSoft : colors.edge }, classes: soft ? 'soft' : 'hard' };
  }
  function updateFold(total, folded) {
    var box = $('graph-fold');
    if (upDepth !== 'all' || total <= FOLD_AT) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    if (folded) {
      box.replaceChildren(document.createTextNode('Lots of earlier skills, so they are grouped by year. '),
        el('button', { type: 'button', id: 'btn-expand-all', text: 'Show all ' + total }));
    } else {
      box.replaceChildren(document.createTextNode('Showing all ' + total + ' skills. '),
        el('button', { type: 'button', id: 'btn-collapse-all', text: 'Group by year' }));
    }
  }
  function buildFoldedElements(nodeSet, colors) {
    var downIds = {};
    (post.get(selected) || []).forEach(function (edge) { downIds[edge.id] = edge.strength; });
    var members = new Map();
    nodeSet.forEach(function (id) {
      if (id === selected || downIds[id]) return;
      var y = byId.get(id).year;
      if (!members.has(y)) members.set(y, []);
      members.get(y).push(id);
    });
    var yearOf = new Map();
    var elements = [];
    members.forEach(function (ids, y) {
      var tone = paint(y, colors);
      var name = A.yearLabel(y) + ': ' + A.plural(ids.length, 'skill');
      ids.forEach(function (id) { yearOf.set(id, y); });
      elements.push({ data: { id: 'year-' + y, name: name, full: name + ' this builds on', label: name, bg: tone.bg, border: tone.border, color: colors.text }, classes: tone.cls + ' grade' });
    });
    elements.push(topicElement(selected, colors));
    Object.keys(downIds).forEach(function (id) { if (nodeSet.has(id)) elements.push(topicElement(id, colors)); });
    var between = new Map();
    deps.forEach(function (edge) {
      var a = yearOf.get(edge.prerequisiteId), b = yearOf.get(edge.topicId);
      if (a == null || b == null || a === b) return;
      var key = a + '>' + b;
      if (edge.strength !== 'soft') between.set(key, 'hard'); else if (!between.has(key)) between.set(key, 'soft');
    });
    between.forEach(function (kind, key) {
      var p = key.split('>');
      elements.push(edgeElement('g-' + p[0] + '-' + p[1], 'year-' + p[0], 'year-' + p[1], kind === 'soft', colors));
    });
    var into = new Map();
    (pre.get(selected) || []).forEach(function (edge) {
      var y = yearOf.get(edge.id);
      if (y == null) return;
      if (edge.strength !== 'soft') into.set(y, 'hard'); else if (!into.has(y)) into.set(y, 'soft');
    });
    into.forEach(function (kind, y) { elements.push(edgeElement('gs' + y, 'year-' + y, selected, kind === 'soft', colors)); });
    Object.keys(downIds).forEach(function (id) { if (nodeSet.has(id)) elements.push(edgeElement('sd-' + id, selected, id, downIds[id] === 'soft', colors)); });
    return elements;
  }
  function buildFullElements(nodeSet, colors) {
    var elements = [];
    nodeSet.forEach(function (id) { elements.push(topicElement(id, colors)); });
    deps.forEach(function (edge, i) {
      if (!nodeSet.has(edge.topicId) || !nodeSet.has(edge.prerequisiteId)) return;
      elements.push(edgeElement('e' + i, edge.prerequisiteId, edge.topicId, edge.strength === 'soft', colors));
    });
    return elements;
  }
  function renderGraph() {
    var token = ++graphToken;
    tipFromTap = false;
    hideTip();
    if (cy) { cy.destroy(); cy = null; window.__cy = null; }
    var cyEl = $('cy'), emptyEl = $('graph-empty'), meta = $('graph-meta');
    if (!selected || !byId.has(selected)) {
      cyEl.hidden = true; cyEl.dataset.ready = '0'; emptyEl.hidden = false; meta.textContent = '';
      updateFold(0, false);
      return;
    }
    var upSet = upstream(selected, upDepth === 'all' ? Infinity : upDepth);
    var nodeSet = new Set(upSet);
    (post.get(selected) || []).forEach(function (edge) { nodeSet.add(edge.id); });
    var total = nodeSet.size;
    var folded = upDepth === 'all' && total > FOLD_AT && !ancestorsOpen;
    var edgeCount = 0;
    if (!folded) deps.forEach(function (edge) { if (nodeSet.has(edge.topicId) && nodeSet.has(edge.prerequisiteId)) edgeCount++; });
    var back = upDepth === 'all' ? 'all the way back' : A.plural(upDepth, 'step') + ' back';
    meta.textContent = folded
      ? 'Grouped by year: ' + A.plural(total, 'skill') + ', ' + back + ' and one step forward.'
      : A.plural(total, 'skill') + ' and ' + A.plural(edgeCount, 'link') + ', ' + back + ' and one step forward.';
    updateFold(total, folded);
    cyEl.hidden = false;
    emptyEl.hidden = true;
    cyEl.dataset.ready = '0';
    cyEl.dataset.mode = folded ? 'grade' : 'full';
    cyEl.dataset.total = String(total);
    var heavy = !folded && total > 80;
    var kick = heavy ? function (fn) { setTimeout(fn, 40); } : requestAnimationFrame;
    kick(function () {
      if (token !== graphToken) return;
      try {
        ensureDagre();
        if (cyEl.clientHeight < 40) cyEl.style.minHeight = '420px';
        var colors = theme();
        var nar = narrow();
        var boxW = nar ? 132 : 156;
        var elements = folded ? buildFoldedElements(nodeSet, colors) : buildFullElements(nodeSet, colors);
        cy = window.cytoscape({
          container: cyEl, elements: elements,
          minZoom: heavy ? 0.5 : 0.05, maxZoom: 2.8,
          boxSelectionEnabled: false, autoungrabify: true, userPanningEnabled: true, userZoomingEnabled: true,
          style: [
            { selector: 'node', style: {
              label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': (boxW - 14) + 'px',
              'text-valign': 'center', 'text-halign': 'center', 'line-height': 1.2,
              'font-size': 12, 'font-family': FONT, color: 'data(color)',
              'background-color': 'data(bg)', 'border-width': 2, 'border-color': 'data(border)',
              shape: 'round-rectangle', width: boxW, height: 46, padding: 0, 'corner-radius': 8
            } },
            { selector: 'node.current', style: { 'border-width': 4, 'z-index': 10 } },
            { selector: 'edge', style: {
              width: 1.6, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)',
              'target-arrow-shape': 'triangle', 'curve-style': heavy ? 'straight' : 'bezier', 'arrow-scale': 0.8, 'line-style': 'solid'
            } },
            { selector: 'edge.soft', style: { 'line-style': 'dashed', width: 1.5 } }
          ]
        });
        window.__cy = cy;
        cy.on('mouseover', 'node', function (event) { showTip(event.target); });
        cy.on('mouseout', 'node', function () { if (!tipFromTap) hideTip(); });
        cy.on('tap', 'node', function (event) {
          var id = event.target.id();
          tipFromTap = true;
          showTip(event.target);
          if (!id || String(id).indexOf('year-') === 0 || id === selected) return;
          select(id, 'user');
        });
        cy.on('tap', function (event) { if (event.target === cy) { tipFromTap = false; hideTip(); } });
        var layout = cy.layout({
          name: 'dagre', rankDir: 'TB', rankSep: heavy ? 48 : 60, nodeSep: heavy ? 18 : 24, edgeSep: heavy ? 8 : 12,
          ranker: heavy ? 'longest-path' : 'network-simplex', padding: 16, animate: false, fit: true,
          nodeDimensionsIncludeLabels: false, spacingFactor: heavy ? 1.02 : 1.05
        });
        layout.one('layoutstop', function () {
          if (token !== graphToken) return;
          requestAnimationFrame(function () {
            if (token !== graphToken || !cy) return;
            cy.resize();
            cy.fit(undefined, 28);
            if (cy.zoom() > 1.4) { cy.zoom(1.4); cy.center(); }
            if (heavy && cy.zoom() < 0.72) {
              cy.zoom(0.85);
              var focusNode = cy.getElementById(selected);
              if (focusNode && !focusNode.empty()) cy.center(focusNode);
            }
            cyEl.dataset.ready = '1';
          });
        });
        layout.run();
      } catch (error) {
        cyEl.dataset.ready = 'err';
        meta.textContent = 'The graph could not be drawn: ' + (error && error.message ? error.message : error);
      }
    });
  }

  function select(raw, source) {
    if (!raw || !byId.has(raw)) {
      if (source === 'hash' && raw) {
        $('detail').replaceChildren(el('div', { class: 'detail-empty' },
          el('h1', { text: 'Skill not found' }),
          el('p', { text: 'There is no skill with the code ' + raw + ' in the ' + A.SUBJECTS[subject] + ' map.' })));
      }
      return;
    }
    var same = raw === selected;
    if (!same) ancestorsOpen = false;
    selected = raw;
    if (source === 'user') { writeHash(selected); closeDrawerIfMobile(); }
    highlight(true);
    renderDetail();
    if (!same) renderGraph();
  }

  function zoomBy(factor) {
    if (!cy) return;
    var rect = cy.container().getBoundingClientRect();
    cy.zoom({ level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)), renderedPosition: { x: rect.width / 2, y: rect.height / 2 } });
  }

  function sampleTopic() {
    var best = null, bestN = -1;
    topics.forEach(function (t) {
      if (t.year < 1 || t.year > 4) return;
      var n = countReach(pre, t.id);
      if (n > bestN) { best = t; bestN = n; }
    });
    return best || topics[0] || null;
  }

  function applyQuery() {
    var params = new URLSearchParams(location.search);
    var y = params.get('year') || '';
    if (/^[0-6]$/.test(y)) year = y;
    else if (/^k$/i.test(y)) year = '0';
    strand = params.get('strand') || '';
    focus = params.get('focus') || '';
  }

  function bootSelection() {
    var hash = readHash();
    if (hash && byId.has(hash)) { select(hash, 'hash'); return; }
    if (hash) { select(hash, 'hash'); renderGraph(); return; }
    if (year !== '' || strand || focus) {
      var first = topics.filter(passFilter)[0];
      if (first) { select(first.id, 'user'); return; }
    }
    renderDetail();
    renderGraph();
  }

  function bind() {
    $('q').addEventListener('input', function () { query = $('q').value.trim().toLowerCase(); renderList(); highlight(false); });
    $('fYear').addEventListener('change', function () { year = $('fYear').value; fillFocus(); writeQuery(); renderList(); highlight(false); });
    $('fStrand').addEventListener('change', function () { strand = $('fStrand').value; fillFocus(); writeQuery(); renderList(); highlight(false); });
    $('fFocus').addEventListener('change', function () { focus = $('fFocus').value; writeQuery(); renderList(); highlight(false); });
    $('depth-switch').addEventListener('click', function (event) {
      var button = event.target.closest('[data-depth]');
      if (!button) return;
      var value = button.getAttribute('data-depth');
      upDepth = value === 'all' ? 'all' : parseInt(value, 10);
      ancestorsOpen = false;
      try { sessionStorage.setItem('auExplore.depth', value); } catch (error) { /* ignore */ }
      syncDepthButtons();
      renderGraph();
    });
    $('graph-fold').addEventListener('click', function (event) {
      if (event.target.closest('#btn-expand-all')) ancestorsOpen = true;
      else if (event.target.closest('#btn-collapse-all')) ancestorsOpen = false;
      else return;
      renderGraph();
    });
    $('list-toggle').addEventListener('click', function () {
      var open = $('side').classList.toggle('open');
      $('list-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
      $('list-toggle').textContent = open ? 'Hide the skill list' : 'Show the skill list';
    });
    $('btn-fit').addEventListener('click', function () { if (cy) { cy.resize(); cy.fit(undefined, 36); } });
    $('btn-zoom-in').addEventListener('click', function () { zoomBy(1.25); });
    $('btn-zoom-out').addEventListener('click', function () { zoomBy(0.8); });
    $('pick-sample').addEventListener('click', function () { var t = sampleTopic(); if (t) select(t.id, 'user'); });
    document.body.addEventListener('click', function (event) {
      var jump = event.target.closest('[data-jump]');
      if (jump) select(jump.getAttribute('data-jump'), 'user');
    });
    window.addEventListener('hashchange', function () { var hash = readHash(); if (hash) select(hash, 'hash'); });
    if (window.ResizeObserver) new ResizeObserver(function () { if (cy) cy.resize(); }).observe($('cy'));
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    if (scheme.addEventListener) scheme.addEventListener('change', function () { if (selected) renderGraph(); });
    var nar = window.matchMedia('(max-width: 700px)');
    if (nar.addEventListener) nar.addEventListener('change', function () { if (selected) renderGraph(); });
  }

  function showLoadError(message) {
    $('count').textContent = '';
    $('list').replaceChildren(el('p', { class: 'muted', text: message, style: 'padding:12px' }));
    $('detail').replaceChildren(el('div', { class: 'detail-empty' }, el('h1', { text: 'The data did not load' }), el('p', { text: message })));
    $('graph-meta').textContent = '';
  }

  subject = A.detectSubject();
  A.applyChrome(subject);
  document.title = 'Skill map · ' + A.SUBJECTS[subject] + ' · K–6 Learning Map';
  restoreDepth();
  syncDepthButtons();
  applyQuery();
  bind();
  A.loadData('../data/', subject).then(function (D) {
    topics = D.topics;
    deps = D.deps;
    stdById = D.stdById;
    topics.forEach(function (t, i) { byId.set(t.id, t); indexOf.set(t.id, i); pre.set(t.id, []); post.set(t.id, []); });
    deps.forEach(function (edge) {
      pre.get(edge.topicId).push({ id: edge.prerequisiteId, strength: edge.strength, reason: edge.reason || '' });
      post.get(edge.prerequisiteId).push({ id: edge.topicId, strength: edge.strength, reason: edge.reason || '' });
    });
    pre.forEach(function (list) {
      list.sort(function (a, b) { return ((a.strength === 'hard' ? 0 : 1) - (b.strength === 'hard' ? 0 : 1)) || (indexOf.get(a.id) - indexOf.get(b.id)); });
    });
    post.forEach(function (list) { list.sort(function (a, b) { return indexOf.get(a.id) - indexOf.get(b.id); }); });
    (D.questions || []).forEach(function (q) {
      var bucket = questionsByTopic.get(q.topicId);
      if (!bucket) questionsByTopic.set(q.topicId, bucket = []);
      bucket.push(q);
    });
    questionsByTopic.forEach(function (list) {
      list.sort(function (a, b) { return (parseInt(a.id.split('_q').pop(), 10) || 0) - (parseInt(b.id.split('_q').pop(), 10) || 0); });
    });
    syncControls();
    renderList();
    bootSelection();
  }).catch(function (error) {
    showLoadError('Could not read the data (' + (error && error.message ? error.message : error) + '). Serve the site from a local web server rather than opening the file directly.');
  });
})();
