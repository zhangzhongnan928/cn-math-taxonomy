/* Kids page: add, edit and delete profiles, pick the current kid, and the ?add=Name:year setup shortcut.
 * Data comes from ../assets/kids.js (localStorage). */
(function () {
  'use strict';
  var A = window.AU;
  var K = window.AuKids;
  var h = A.h;
  var subject = A.detectSubject();
  A.applyChrome(subject);
  var listBox = document.getElementById('list');
  var form = document.getElementById('form');
  var nameIn = document.getElementById('f-name');
  var yearBox = document.getElementById('f-year');
  var yearValue = null;
  var errBox = document.getElementById('f-error');
  var submitBtn = document.getElementById('f-submit');
  var cancelBtn = document.getElementById('f-cancel');
  var formTitle = document.getElementById('form-title');
  var banner = document.getElementById('banner');
  var editing = null;

  /* Year as big tap buttons: quicker than a menu on an iPad. */
  function setYear(y) {
    yearValue = y;
    yearBox.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-year') === String(y))); });
  }
  K.YEARS.forEach(function (y) {
    A.append(yearBox, h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-year': String(y), id: 'f-year-' + y,
      'aria-label': K.yearName(y), onclick: function () { setYear(y); } }, y === 0 ? 'K' : 'Year ' + y));
  });
  /* The note about Home Screen storage matters on iPad and iPhone, and inside the installed app it is already true. */
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  var iosNote = document.getElementById('ios-note');
  if (standalone) iosNote.textContent = 'This Home Screen app keeps its own list of kids. Add them here (it only takes a moment).';
  else if (!isIOS) iosNote.textContent = 'Tip: on an iPad or iPhone, add the site to the Home Screen first, then add your kids inside the app. The app keeps its own separate list.';

  var params = new URLSearchParams(location.search);

  /* Setup shortcut: ?add=Name:1,Other:6 (K or 0 = Kindergarten). Names only ever arrive through the link. */
  if (params.has('add')) {
    var res = K.addFromSpec(params.get('add'));
    params.delete('add');
    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    var bits = [];
    if (res.added.length) bits.push('Added ' + A.listJoin(res.added.map(function (c) { return c.name + ' (' + K.yearName(c.year) + ')'; })) + '.');
    if (res.existing.length) bits.push(A.listJoin(res.existing.map(function (c) { return c.name; })) + (res.existing.length === 1 ? ' was' : ' were') + ' already here.');
    if (res.errors.length) bits.push('Skipped ' + A.listJoin(res.errors.map(function (e) { return '“' + e.raw + '” (' + e.error + ')'; })) + '.');
    if (bits.length) A.append(banner, h('p', { class: 'kid-banner' + (res.errors.length && !res.added.length ? ' warn' : ''), id: 'add-result', text: bits.join(' ') }));
  }

  if (params.get('from') === 'diagnose') {
    var back = document.getElementById('back');
    A.append(back, h('a', { href: A.withSubject('../diagnose/', subject), text: '← Back to the check-up' }));
    back.hidden = false;
  }

  function showError(msg) { errBox.textContent = msg || ''; errBox.hidden = !msg; }

  function resetForm() {
    editing = null;
    nameIn.value = '';
    setYear(null);
    formTitle.textContent = 'Add a kid';
    submitBtn.textContent = 'Add kid';
    cancelBtn.hidden = true;
    showError('');
  }

  function startEdit(c) {
    editing = c.id;
    nameIn.value = c.name;
    setYear(c.year);
    formTitle.textContent = 'Edit ' + c.name;
    submitBtn.textContent = 'Save changes';
    cancelBtn.hidden = false;
    showError('');
    document.getElementById('form-card').scrollIntoView({ block: 'center' });
    nameIn.focus();
  }

  function stats(c) {
    var recs = K.recordsOf(c.id);
    var by = K.latestStatus(c.id);
    var weak = 0;
    Object.keys(by).forEach(function (id) { if (by[id].status === 'weak') weak++; });
    return { runs: recs.length, weak: weak };
  }

  function card(c, isCurrent) {
    var st = stats(c);
    var readId = 'read-' + c.id;
    var read = h('input', { type: 'checkbox', id: readId, checked: !!K.readAloudFor(c) });
    read.addEventListener('change', function () { K.setReadAloud(c.id, read.checked); });
    return h('article', { class: 'kid-card' + (isCurrent ? ' is-current' : ''), 'data-kid': c.id },
      h('div', { class: 'kid-head' }, h('h3', { text: c.name }), isCurrent ? h('span', { class: 'kid-badge', text: 'Current' }) : null),
      h('p', { class: 'kid-meta', text: K.yearName(c.year) + ' · ' + A.stageOf(c.year) }),
      h('p', { class: 'kid-stat', text: st.runs
        ? A.plural(st.runs, 'check-up') + ' so far, ' + A.plural(st.weak, 'skill') + ' still needing work'
        : 'No check-ups yet' }),
      h('div', { class: 'kid-read' }, read, h('label', { for: readId, text: 'Read questions aloud' + (c.year <= 2 ? ' (recommended for ' + K.yearName(c.year) + ')' : '') })),
      h('div', { class: 'kid-actions' },
        h('a', { class: 'btn btn-primary', href: '../diagnose/?year=' + (c.year === 0 ? 'K' : c.year) + '&kid=' + encodeURIComponent(c.id), text: K.yearName(c.year) + ' Maths check-up' }),
        h('a', { class: 'btn btn-primary', href: '../diagnose/?subject=english&year=' + (c.year === 0 ? 'K' : c.year) + '&kid=' + encodeURIComponent(c.id), text: K.yearName(c.year) + ' English check-up' })),
      h('div', { class: 'kid-actions', style: 'margin-top:8px' },
        isCurrent ? null : h('button', { type: 'button', class: 'primary', onclick: function () { K.setCurrent(c.id); render(); } }, 'Make current'),
        h('a', { class: 'btn', href: A.withSubject('history.html?child=' + encodeURIComponent(c.id), subject), text: 'History' }),
        h('button', { type: 'button', onclick: function () { startEdit(c); } }, 'Edit'),
        h('button', { type: 'button', class: 'danger', onclick: function () {
          if (!confirm('Delete ' + c.name + '’s profile and all their check-up results? This can’t be undone.')) return;
          K.remove(c.id);
          if (editing === c.id) resetForm();
          render();
        } }, 'Delete')));
  }

  function render() {
    var kids = K.list();
    var cur = K.current();
    listBox.textContent = '';
    if (!kids.length) {
      A.append(listBox, h('p', { class: 'kid-empty', text: 'No kids yet. Type a name and choose a school year below to add the first one.' }));
    } else {
      kids.forEach(function (c) { A.append(listBox, card(c, !!cur && cur.id === c.id)); });
    }
    var full = kids.length >= K.MAX_CHILDREN && !editing;
    document.getElementById('form-card').hidden = full;
    if (full) A.append(listBox, h('p', { class: 'muted small', text: 'That’s the most profiles this page keeps (' + K.MAX_CHILDREN + '). Delete one to add another.' }));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = { name: nameIn.value, year: yearValue };
    var res = editing ? K.update(editing, f) : K.add(f);
    if (!res.ok) { showError(res.error); return; }
    if (!editing && window.cnmTrack) window.cnmTrack('child_added');
    resetForm();
    render();
  });
  cancelBtn.addEventListener('click', function () { resetForm(); render(); });

  resetForm();
  render();
  if (!K.list().length) nameIn.focus();
})();
