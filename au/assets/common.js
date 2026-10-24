/* Shared helpers for every page of the K-6 Learning Map: subject switch, navigation, small DOM helpers,
 * years and stages, safe localStorage, and data loading. Exposed as window.AU. */
(function () {
  'use strict';

  var SUBJECTS = { maths: 'Maths', english: 'English' };
  var YEARS = [0, 1, 2, 3, 4, 5, 6];
  var ABOUT_URL = 'https://github.com/zhangzhongnan928/cn-math-taxonomy/tree/main/au';

  function yearLabel(y) { return y === 0 ? 'Kindergarten' : (typeof y === 'number' && y > 0 ? 'Year ' + y : ''); }
  function yearShort(y) { return y === 0 ? 'K' : 'Year ' + y; }
  function stageOf(y) {
    if (y === 0) return 'Early Stage 1';
    if (y === 1 || y === 2) return 'Stage 1';
    if (y === 3 || y === 4) return 'Stage 2';
    if (y === 5 || y === 6) return 'Stage 3';
    return '';
  }
  /** Colour band used in graphs: K-2, 3-4, 5-6. */
  function bandOf(y) { return y <= 2 ? 'early' : y <= 4 ? 'middle' : 'upper'; }

  function subjectOfTopic(t) {
    if (!t) return 'maths';
    if (t.subject === 'english') return 'english';
    if (t.subject === 'maths' || t.subject === 'math') return 'maths';
    return String(t.id || '').indexOf('aue_') === 0 ? 'english' : 'maths';
  }
  function subjectOfId(id) { return String(id || '').indexOf('aue_') === 0 ? 'english' : 'maths'; }

  /** ?subject=english wins; otherwise an aue_ id in ?target= or the hash means English. */
  function detectSubject() {
    var params = new URLSearchParams(location.search);
    var explicit = params.get('subject');
    if (explicit === 'english' || explicit === 'maths') return explicit;
    if (explicit === 'math') return 'maths';
    var target = params.get('target') || '';
    var hash = (location.hash || '').replace(/^#/, '');
    try { hash = decodeURIComponent(hash); } catch (e) { /* keep as is */ }
    if (/(^|,)\s*aue_/.test(target) || /^aue_/.test(hash)) {
      params.set('subject', 'english');
      history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash);
      return 'english';
    }
    return 'maths';
  }

  function withSubject(href, subject) {
    if (subject !== 'english' || !href || href.indexOf('subject=') >= 0 || /^(https?:|mailto:|#)/.test(href)) return href;
    var hashAt = href.indexOf('#');
    var base = hashAt >= 0 ? href.slice(0, hashAt) : href;
    var hash = hashAt >= 0 ? href.slice(hashAt) : '';
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'subject=english' + hash;
  }

  /** Subject colours, nav links that carry the subject, and the Maths | English switch state. */
  function applyChrome(subject) {
    document.body.classList.toggle('subject-english', subject === 'english');
    document.body.classList.toggle('subject-maths', subject !== 'english');
    document.querySelectorAll('.site-nav a.page-link, a.brand').forEach(function (link) {
      var href = link.getAttribute('data-href') || link.getAttribute('href');
      link.setAttribute('data-href', href);
      link.setAttribute('href', withSubject(href, subject));
    });
    document.querySelectorAll('.subject-link').forEach(function (link) {
      var on = link.getAttribute('data-subject') === subject;
      link.classList.toggle('on', on);
      if (on) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'open' || k === 'disabled' || k === 'selected' || k === 'value' || k === 'checked') el[k] = v === true ? true : v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) appendOne(el, arguments[i]);
    return el;
  }
  function appendOne(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { appendOne(el, x); }); return; }
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  /** Like Element.append, but skips null/false and flattens arrays. */
  function append(el) {
    for (var i = 1; i < arguments.length; i++) appendOne(el, arguments[i]);
    return el;
  }

  /** Inline SVG figure from the question bank; anything with scripts or outside links is dropped. */
  function figureEl(svg) {
    if (typeof svg !== 'string' || svg.indexOf('<svg') !== 0) return null;
    if (/<\s*script|foreignObject|<\s*image\b|\son\w+\s*=|https?:\/\//i.test(svg.replace('xmlns="http://www.w3.org/2000/svg"', ''))) return null;
    var wrap = h('div', { class: 'q-figure' });
    wrap.innerHTML = svg;
    var node = wrap.querySelector('svg');
    if (!node) return null;
    node.setAttribute('role', 'img');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('focusable', 'false');
    return wrap;
  }

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function listJoin(items) {
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  function quoteList(names) { return listJoin(names.map(function (n) { return '“' + n + '”'; })); }

  function fmtDate(iso, withTime) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var opts = { day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
    try { return d.toLocaleString('en-AU', opts); } catch (e) { return d.toISOString().slice(0, 10); }
  }

  /** Load au/data for one subject. base is the relative path to au/data/ ("data/" or "../data/"). */
  function loadData(base, subject, opts) {
    var o = opts || {};
    var files = ['topics.json', 'dependencies.json', 'standards.json'];
    if (o.questions !== false) files.push('questions.json');
    return Promise.all(files.map(function (f) {
      return fetch(base + f).then(function (r) {
        if (!r.ok) throw new Error(f + ' (HTTP ' + r.status + ')');
        return r.json();
      });
    })).then(function (js) {
      var allTopics = Array.isArray(js[0]) ? js[0] : [];
      var topics = allTopics.filter(function (t) { return subject === 'all' || subjectOfTopic(t) === subject; });
      var allow = {};
      topics.forEach(function (t) { allow[t.id] = true; });
      var deps = (Array.isArray(js[1]) ? js[1] : []).filter(function (d) { return allow[d.topicId] && allow[d.prerequisiteId]; });
      var std = js[2] || {};
      var items = Array.isArray(std.items) ? std.items : [];
      var stdById = {};
      items.forEach(function (x) { stdById[x.id] = x; });
      var questions = js[3] ? (Array.isArray(js[3]) ? js[3] : []).filter(function (q) { return allow[q.topicId]; }) : null;
      return {
        topics: topics, deps: deps, questions: questions, stdItems: items, stdById: stdById,
        stdSource: std.source || {}, allTopics: allTopics
      };
    });
  }

  /** Short framework name for a curriculum code. */
  function frameworkName(item, id) {
    var fw = item && item.framework ? item.framework : (/^AC9/.test(id) ? 'ac9' : 'nsw');
    if (fw.indexOf('nsw') === 0) return 'NSW syllabus';
    if (fw.indexOf('ac9') === 0) return 'Australian Curriculum v9';
    return fw;
  }

  window.AU = {
    SUBJECTS: SUBJECTS, YEARS: YEARS, ABOUT_URL: ABOUT_URL,
    yearLabel: yearLabel, yearShort: yearShort, stageOf: stageOf, bandOf: bandOf,
    subjectOfTopic: subjectOfTopic, subjectOfId: subjectOfId, detectSubject: detectSubject,
    withSubject: withSubject, applyChrome: applyChrome,
    h: h, append: append, figureEl: figureEl,
    lsGet: lsGet, lsSet: lsSet, lsDel: lsDel,
    plural: plural, listJoin: listJoin, quoteList: quoteList, fmtDate: fmtDate,
    loadData: loadData, frameworkName: frameworkName
  };
})();
