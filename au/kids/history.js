/* History page: one kid's check-up results, plus the skills that still need work according to the latest
 * result for each skill (linked to the skill map). */
(function () {
  'use strict';
  var A = window.AU;
  var K = window.AuKids;
  var h = A.h;
  var subjectParam = A.detectSubject();
  A.applyChrome(subjectParam);
  var picker = document.getElementById('picker');
  var content = document.getElementById('content');
  var SUBJECTS = [['', 'All'], ['maths', 'Maths'], ['english', 'English']];
  var topics = null;
  var childId = null;
  var subjectSel = '';

  function exploreHref(id) {
    var sub = A.subjectOfId(id);
    return '../explore/' + (sub === 'english' ? '?subject=english' : '') + '#' + encodeURIComponent(id);
  }
  function nameOf(id) { return topics && topics[id] ? topics[id].name : id; }
  function whereOf(id) {
    var t = topics && topics[id];
    return t ? A.yearLabel(t.year) + ' · ' + (t.focusArea || t.strand || '') : '';
  }
  function tag(cls, text) { return h('span', { class: 'kid-tag ' + cls, text: text }); }
  function retestHref(ids) {
    var sub = A.subjectOfId(ids[0]);
    return '../diagnose/?' + (sub === 'english' ? 'subject=english&' : '') + 'target=' + ids.map(encodeURIComponent).join(',') + '&kid=' + encodeURIComponent(childId);
  }

  function topicRow(id, info) {
    var meta = [];
    var where = whereOf(id);
    if (where) meta.push(where);
    meta.push('checked ' + A.fmtDate(info.at));
    return h('li', { class: 'wk-item', 'data-topic': id },
      h('div', { class: 'wk-top' },
        h('a', { class: 'wk-name', href: exploreHref(id), text: nameOf(id) }),
        tag(info.status === 'weak' ? 'weak' : 'shaky', info.status === 'weak' ? 'Needs work' : 'Shaky'),
        info.root ? tag('root', 'Gap starts here') : null,
        tag('sub', A.SUBJECTS[A.subjectOfId(id)])),
      h('p', { class: 'wk-meta', text: meta.join(' · ') }),
      h('a', { class: 'wk-retest', href: retestHref([id]), text: 'Check again' }));
  }

  function weakSection(child) {
    var by = K.latestStatus(child.id, subjectSel || null);
    var ids = Object.keys(by).filter(function (id) { return by[id].status === 'weak' || by[id].status === 'shaky'; });
    var rank = function (id) { return (by[id].status === 'weak' ? 0 : 2) + (by[id].root ? 0 : 1); };
    var yearOf = function (id) { return topics && topics[id] && typeof topics[id].year === 'number' ? topics[id].year : 99; };
    ids.sort(function (a, b) { return rank(a) - rank(b) || yearOf(a) - yearOf(b) || String(by[b].at).localeCompare(String(by[a].at)); });
    var weakN = ids.filter(function (id) { return by[id].status === 'weak'; }).length;
    var sec = h('section', { class: 'kid-section', id: 'still-to-work-on' }, h('h2', { text: 'Still to work on' }));
    if (!K.recordsOf(child.id).length) {
      A.append(sec, h('p', { class: 'kid-empty', text: 'No check-ups yet. After the first one, anything that needs work shows up here.' }));
      return sec;
    }
    if (!ids.length) {
      A.append(sec, h('p', { class: 'kid-empty', text: 'Going by the latest check-ups, nothing needs work. Well done!' }));
      return sec;
    }
    A.append(sec, h('p', { class: 'muted small', text: 'If a skill was checked more than once, the latest result counts. ' + weakN + (weakN === 1 ? ' needs work, ' : ' need work, ') + (ids.length - weakN) + ' shaky. Tap a name to open it in the skill map.' }));
    A.append(sec, h('ul', { class: 'wk-list' }, ids.map(function (id) { return topicRow(id, by[id]); })));
    return sec;
  }

  function recordCard(child, r) {
    var c = r.counts || {};
    var rootSet = {};
    (r.roots || []).forEach(function (id) { rootSet[id] = true; });
    var body = h('div', { class: 'rec-body' },
      h('p', { class: 'muted small', text: A.plural(r.asked || 0, 'question') + ' answered' + (r.mode === 'screen' ? ', whole-year check-up' : '') + '.' }));
    var group = function (title, ids, status) {
      if (!ids || !ids.length) return;
      A.append(body, h('h4', { text: title + ' (' + ids.length + ')' }));
      A.append(body, h('ul', { class: 'rec-topics' }, ids.map(function (id) {
        return h('li', null, h('a', { href: exploreHref(id), text: nameOf(id) }), status === 'weak' && rootSet[id] ? [' ', tag('root', 'Gap starts here')] : null);
      })));
    };
    group('Needs work', r.weak, 'weak');
    group('Shaky', r.shaky, 'shaky');
    if (!(r.weak || []).length && !(r.shaky || []).length) A.append(body, h('p', { class: 'kid-empty', text: 'No gaps found in this check-up.' }));
    var again = null;
    if (r.targets && r.targets.length) again = h('a', { class: 'btn', href: retestHref(r.targets), text: 'Check again' });
    else if (r.mode === 'screen' && typeof r.year === 'number') {
      again = h('a', { class: 'btn', href: '../diagnose/?' + (r.subject === 'english' ? 'subject=english&' : '') + 'year=' + (r.year === 0 ? 'K' : r.year) + '&kid=' + encodeURIComponent(child.id), text: 'Do this year again' });
    }
    A.append(body, h('div', { class: 'rec-actions' }, again,
      h('button', { type: 'button', class: 'danger', onclick: function () {
        if (!confirm('Delete this check-up result?')) return;
        K.removeRecord(child.id, r.key);
        render();
      } }, 'Delete this result')));
    return h('details', { class: 'rec', 'data-key': r.key },
      h('summary', null,
        h('div', { class: 'rec-top' }, tag('sub', A.SUBJECTS[r.subject] || 'Maths'), h('b', { class: 'rec-label', text: r.label || 'Check-up' })),
        h('div', { class: 'rec-counts' },
          h('span', { class: 'rec-date', text: A.fmtDate(r.savedAt, true) }),
          tag('weak', 'Needs work ' + (c.weak || 0)),
          tag('shaky', 'Shaky ' + (c.shaky || 0)),
          tag('ok', 'Got it ' + (c.mastered || 0)),
          c.untested ? tag('unk', 'Not checked ' + c.untested) : null)),
      body);
  }

  function recordsSection(child) {
    var recs = K.recordsOf(child.id).filter(function (r) { return !subjectSel || r.subject === subjectSel; });
    var sec = h('section', { class: 'kid-section', id: 'records' }, h('h2', { text: 'Check-ups (' + recs.length + ')' }));
    if (!recs.length) A.append(sec, h('p', { class: 'kid-empty', text: subjectSel ? 'No ' + A.SUBJECTS[subjectSel] + ' check-ups yet.' : 'No check-ups yet.' }));
    else recs.forEach(function (r) { A.append(sec, recordCard(child, r)); });
    A.append(sec, h('a', { class: 'btn btn-primary', href: '../diagnose/' + (subjectSel === 'english' ? '?subject=english' : ''), text: 'Start a check-up' }));
    return sec;
  }

  function renderPicker(kids) {
    picker.textContent = '';
    if (!kids.length) return;
    var sel = h('select', { id: 'kid-select' }, kids.map(function (c) { return h('option', { value: c.id, text: c.name + ' (' + K.yearName(c.year) + ')' }); }));
    sel.value = childId;
    sel.addEventListener('change', function () {
      childId = sel.value;
      K.setCurrent(childId);
      history.replaceState(null, '', location.pathname + '?child=' + encodeURIComponent(childId));
      render();
    });
    A.append(picker, h('label', { for: 'kid-select', text: 'Kid' }), sel, h('a', { class: 'btn', href: './', text: 'Manage kids' }));
  }

  function renderTabs() {
    return h('div', { class: 'stage-tabs kid-tabs', role: 'tablist', 'aria-label': 'Subject' }, SUBJECTS.map(function (s) {
      return h('button', {
        type: 'button', class: 'stage-tab' + (subjectSel === s[0] ? ' on' : ''), role: 'tab', 'aria-selected': subjectSel === s[0] ? 'true' : 'false',
        onclick: function () { subjectSel = s[0]; render(); }
      }, s[1]);
    }));
  }

  function render() {
    var kids = K.list();
    renderPicker(kids);
    content.textContent = '';
    if (!kids.length) {
      A.append(content, h('p', { class: 'kid-empty', text: 'No kid profiles yet. Add a kid first, then check-up results are saved to them.' }),
        h('a', { class: 'btn btn-primary', href: './', text: 'Add a kid' }));
      return;
    }
    var child = K.get(childId) || kids[0];
    childId = child.id;
    A.append(content, h('p', { class: 'kid-meta', text: child.name + ' · ' + K.yearName(child.year) }), renderTabs(), weakSection(child), recordsSection(child));
  }

  function init() {
    var kids = K.list();
    var want = new URLSearchParams(location.search).get('child');
    var cur = K.current();
    childId = (want && K.get(want) && want) || (cur && cur.id) || (kids[0] && kids[0].id) || null;
    if (!kids.length) { render(); return; }
    fetch('../data/topics.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (rows) {
      topics = {};
      rows.forEach(function (t) { topics[t.id] = t; });
    }).catch(function () { topics = null; }).then(render);
  }
  init();
})();
