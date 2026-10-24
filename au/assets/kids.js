/* Kid profiles and their check-up records. Stored only in this browser's localStorage (no account, nothing uploaded).
 * Shared by the check-up page and the Kids pages. Exposed as window.AuKids.
 * Keys are separate from the Chinese site: auKids.v1 and auKids.records.v1. */
(function () {
  'use strict';
  var KEY = 'auKids.v1';
  var REC_KEY = 'auKids.records.v1';
  var MAX_CHILDREN = 8;
  var MAX_RECORDS = 40;
  var MAX_NAME = 20;
  var YEARS = [0, 1, 2, 3, 4, 5, 6];

  function yearName(y) { return y === 0 ? 'Kindergarten' : 'Year ' + y; }

  function read(k, fallback) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  function state() {
    var s = read(KEY, null);
    if (!s || !Array.isArray(s.children)) s = { v: 1, current: null, children: [] };
    if (s.current && !s.children.some(function (c) { return c.id === s.current; })) s.current = s.children.length ? s.children[0].id : null;
    return s;
  }
  function records() {
    var r = read(REC_KEY, null);
    return r && typeof r === 'object' && !Array.isArray(r) ? r : {};
  }
  function newId() { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function list() { return state().children.slice(); }
  function get(id) { return state().children.filter(function (c) { return c.id === id; })[0] || null; }
  function current() { var s = state(); return s.current ? get(s.current) : null; }
  function setCurrent(id) {
    var s = state();
    if (id && !s.children.some(function (c) { return c.id === id; })) return false;
    s.current = id || null;
    return write(KEY, s);
  }

  function parseYearValue(v) {
    if (typeof v === 'number') return YEARS.indexOf(v) >= 0 ? v : null;
    var t = String(v == null ? '' : v).trim().toLowerCase();
    if (t === 'k' || t === '0' || t === 'kindergarten' || t === 'kindy') return 0;
    var m = /^(?:year|yr|y)?\s*([1-6])$/.exec(t);
    return m ? parseInt(m[1], 10) : null;
  }

  function clean(f) {
    var name = String(f && f.name || '').replace(/\s+/g, ' ').trim();
    var year = parseYearValue(f && f.year);
    return { name: name, year: year };
  }
  function sameName(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  function check(s, f, selfId) {
    if (!f.name) return 'Please type a name.';
    if (f.name.length > MAX_NAME) return 'Names can be up to ' + MAX_NAME + ' characters.';
    if (f.year == null) return 'Please choose a school year.';
    if (s.children.some(function (c) { return c.id !== selfId && sameName(c.name, f.name); })) return 'There is already a profile called ' + f.name + '.';
    return '';
  }

  /* Returns { ok, error, child } */
  function add(form) {
    var s = state();
    var f = clean(form);
    if (s.children.length >= MAX_CHILDREN) return { ok: false, error: 'You can have up to ' + MAX_CHILDREN + ' profiles.' };
    var err = check(s, f, null);
    if (err) return { ok: false, error: err };
    var child = { id: newId(), name: f.name, year: f.year, createdAt: new Date().toISOString() };
    s.children.push(child);
    if (!s.current) s.current = child.id;
    if (!write(KEY, s)) return { ok: false, error: 'This browser will not let the site save data (private browsing?), so the profile cannot be kept.' };
    return { ok: true, child: child };
  }
  function update(id, form) {
    var s = state();
    var f = clean(form);
    var i = s.children.map(function (c) { return c.id; }).indexOf(id);
    if (i < 0) return { ok: false, error: 'That profile no longer exists.' };
    var err = check(s, f, id);
    if (err) return { ok: false, error: err };
    s.children[i] = Object.assign({}, s.children[i], f);
    write(KEY, s);
    return { ok: true, child: s.children[i] };
  }
  function remove(id) {
    var s = state();
    s.children = s.children.filter(function (c) { return c.id !== id; });
    if (s.current === id) s.current = s.children.length ? s.children[0].id : null;
    write(KEY, s);
    var r = records();
    delete r[id];
    write(REC_KEY, r);
  }

  /** Read-aloud: the kid's own setting if set, otherwise on for Kindergarten to Year 2. null when there is no kid. */
  function readAloudFor(kid) {
    if (!kid) return null;
    if (typeof kid.readAloud === 'boolean') return kid.readAloud;
    return kid.year <= 2;
  }
  function setReadAloud(id, on) {
    var s = state();
    var i = s.children.map(function (c) { return c.id; }).indexOf(id);
    if (i < 0) return false;
    s.children[i] = Object.assign({}, s.children[i], { readAloud: !!on });
    return write(KEY, s);
  }

  /**
   * Setup shortcut: "George:1,Chloe:6" (name:year, K or 0 = Kindergarten).
   * Returns [{name, year}] for valid entries and [{raw, error}] for the rest.
   */
  function parseAddSpec(spec) {
    var out = { kids: [], errors: [] };
    String(spec == null ? '' : spec).split(/[,;]/).forEach(function (raw) {
      var part = raw.trim();
      if (!part) return;
      var m = /^(.+?)\s*[:=]\s*([^:=]+)$/.exec(part);
      if (!m) { out.errors.push({ raw: part, error: 'needs name:year' }); return; }
      var name = m[1].replace(/\s+/g, ' ').trim();
      var year = parseYearValue(m[2]);
      if (!name || name.length > MAX_NAME) { out.errors.push({ raw: part, error: 'name is empty or too long' }); return; }
      if (year == null) { out.errors.push({ raw: part, error: 'year should be K or 1 to 6' }); return; }
      out.kids.push({ name: name, year: year });
    });
    return out;
  }
  /** Create the profiles in spec that do not exist yet (matched by name, any case). */
  function addFromSpec(spec) {
    var parsed = parseAddSpec(spec);
    var res = { added: [], existing: [], errors: parsed.errors.slice() };
    parsed.kids.forEach(function (k) {
      var hit = list().filter(function (c) { return sameName(c.name, k.name); })[0];
      if (hit) { res.existing.push(hit); return; }
      var r = add(k);
      if (r.ok) res.added.push(r.child);
      else res.errors.push({ raw: k.name, error: r.error });
    });
    return res;
  }

  function recordsOf(childId) {
    var r = records()[childId];
    return Array.isArray(r) ? r.slice().sort(function (a, b) { return String(b.savedAt).localeCompare(String(a.savedAt)); }) : [];
  }
  /* Keyed by rec.key: reopening or correcting the same check-up updates its one record. */
  function saveRecord(childId, rec) {
    if (!childId || !rec || !rec.key) return false;
    var all = records();
    var arr = Array.isArray(all[childId]) ? all[childId] : [];
    var i = arr.map(function (x) { return x.key; }).indexOf(rec.key);
    var now = new Date().toISOString();
    if (i >= 0) arr[i] = Object.assign({}, rec, { savedAt: arr[i].savedAt, updatedAt: now });
    else arr.push(Object.assign({}, rec, { savedAt: now, updatedAt: now }));
    arr.sort(function (a, b) { return String(b.savedAt).localeCompare(String(a.savedAt)); });
    all[childId] = arr.slice(0, MAX_RECORDS);
    return write(REC_KEY, all);
  }
  function hasRecord(childId, key) {
    return recordsOf(childId).some(function (x) { return x.key === key; });
  }
  function moveRecord(key, fromId, toId) {
    if (!key || fromId === toId) return;
    var all = records();
    var from = Array.isArray(all[fromId]) ? all[fromId] : [];
    var rec = from.filter(function (x) { return x.key === key; })[0];
    if (!rec) return;
    all[fromId] = from.filter(function (x) { return x.key !== key; });
    var to = Array.isArray(all[toId]) ? all[toId] : [];
    if (!to.some(function (x) { return x.key === key; })) to.push(rec);
    to.sort(function (a, b) { return String(b.savedAt).localeCompare(String(a.savedAt)); });
    all[toId] = to.slice(0, MAX_RECORDS);
    write(REC_KEY, all);
  }
  function removeRecord(childId, key) {
    var all = records();
    if (!Array.isArray(all[childId])) return;
    all[childId] = all[childId].filter(function (x) { return x.key !== key; });
    write(REC_KEY, all);
  }

  /* Merge a kid's records into "where each skill stands now": newer records win.
   * Returns { id: { status, recKey, at, label, root, subject } } */
  function latestStatus(childId, subject) {
    var recs = recordsOf(childId).filter(function (r) { return !subject || r.subject === subject; }).reverse();
    var by = {};
    recs.forEach(function (r) {
      var roots = {};
      (r.roots || []).forEach(function (id) { roots[id] = true; });
      var put = function (ids, status) {
        (ids || []).forEach(function (id) { by[id] = { status: status, recKey: r.key, at: r.savedAt, label: r.label, root: !!roots[id], subject: r.subject }; });
      };
      put(r.mastered, 'mastered');
      put(r.shaky, 'shaky');
      put(r.weak, 'weak');
    });
    return by;
  }

  window.AuKids = {
    YEARS: YEARS, MAX_CHILDREN: MAX_CHILDREN, MAX_NAME: MAX_NAME, yearName: yearName, parseYearValue: parseYearValue,
    list: list, get: get, current: current, setCurrent: setCurrent,
    add: add, update: update, remove: remove,
    readAloudFor: readAloudFor, setReadAloud: setReadAloud,
    parseAddSpec: parseAddSpec, addFromSpec: addFromSpec,
    recordsOf: recordsOf, saveRecord: saveRecord, hasRecord: hasRecord, moveRecord: moveRecord, removeRecord: removeRecord,
    latestStatus: latestStatus
  };
})();
