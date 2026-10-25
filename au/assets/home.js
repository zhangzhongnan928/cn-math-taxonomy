/* Home page: subject switch, quick-start cards, live stats and the year grid, all computed from au/data. */
(function () {
  'use strict';
  var A = window.AU;
  var K = window.AuKids;
  var raw = location.hash.replace(/^#/, '');
  try { raw = decodeURIComponent(raw); } catch (e) { /* keep as is */ }
  if (/^au[me]_[A-Za-z0-9_]+$/.test(raw)) return;

  var subject = A.detectSubject();
  var name = A.SUBJECTS[subject];
  A.applyChrome(subject);
  var h = A.h;
  var w = function (href) { return A.withSubject(href, subject); };

  document.title = 'K–6 Learning Map · ' + name;
  document.getElementById('eyebrow').textContent = name + ' · Kindergarten to Year 6 · NSW syllabus';
  document.getElementById('stats-title').textContent = 'What’s in the ' + name + ' map';
  document.getElementById('cta-check').setAttribute('href', w('diagnose/'));
  document.getElementById('cta-map').setAttribute('href', w('explore/'));
  var demo = document.getElementById('demo-link');
  demo.setAttribute('href', w('diagnose/?demo=1'));
  demo.textContent = 'See a demo first (a pretend child answers a ' + name + ' check-up)';

  var kids = K.list();
  function yParam(y) { return y === 0 ? 'K' : String(y); }
  function limitFor(y) { return y <= 2 ? 24 : 40; }

  /** Year-grid check-ups: straight in for the one kid in that year; otherwise the start page, to pick who is answering. */
  function yearHref(y) {
    var inYear = kids.filter(function (k) { return k.year === y; });
    if (inYear.length === 1) return w('diagnose/?year=' + yParam(y) + '&kid=' + encodeURIComponent(inYear[0].id));
    return w('diagnose/?pick=' + yParam(y));
  }

  function quickCard(y, kid, count) {
    var read = kid ? K.readAloudFor(kid) : y <= 2;
    return h('a', {
      class: 'quick-card', id: kid ? 'quick-kid-' + kid.id : 'quick-y' + y, 'data-year': String(y),
      href: w('diagnose/?year=' + yParam(y) + (kid ? '&kid=' + encodeURIComponent(kid.id) : ''))
    },
      h('span', { class: 'qc-kicker', text: name + (kid ? ' \u00b7 for ' + kid.name : '') }),
      h('span', { class: 'qc-title', text: A.yearLabel(y) + ' check-up' }),
      h('span', { class: 'qc-sub', text: (count != null ? A.plural(count, 'skill') + ' in ' + A.yearLabel(y) + '. ' : '') + 'Up to ' + limitFor(y) + ' questions' + (read ? ', read aloud.' : '.') }),
      h('span', { class: 'qc-go', text: 'Start' }));
  }

  /** One card per kid at their year; with no kids yet, Year 1 and Year 6. */
  var quick = document.getElementById('quick');
  function renderQuick(counts) {
    var cards = kids.length
      ? kids.map(function (k) { return quickCard(k.year, k, counts ? counts[k.year] : null); })
      : [quickCard(1, null, counts ? counts[1] : null), quickCard(6, null, counts ? counts[6] : null)];
    quick.replaceChildren.apply(quick, cards);
  }
  renderQuick(null);

  var kidsLine = document.getElementById('kids-line');
  if (kids.length) {
    A.append(kidsLine, 'Checking for ', A.listJoin(kids.map(function (k) { return k.name + ' (' + K.yearName(k.year) + ')'; })), '. ',
      h('a', { href: w('kids/'), text: 'Manage kids' }));
  } else {
    A.append(kidsLine, 'Add your kids first and each check-up is saved to their profile. ', h('a', { href: w('kids/'), text: 'Add kids' }));
  }

  function setText(id, value) { var n = document.getElementById(id); if (n) n.textContent = value; }
  function fail(message) {
    var box = document.getElementById('load-error');
    box.hidden = false;
    box.textContent = message;
  }

  A.loadData('data/', subject).then(function (D) {
    setText('n-topics', String(D.topics.length));
    setText('n-edges', String(D.deps.length));
    setText('n-questions', String((D.questions || []).length));
    setText('n-standards', String(D.stdItems.filter(function (x) {
      return x.subject ? x.subject === subject : (subject === 'english' ? /^(EN|AC9E)/.test(x.id) : /^(MA|AC9M)/.test(x.id));
    }).length));
    var counts = {};
    A.YEARS.forEach(function (y) { counts[y] = D.topics.filter(function (t) { return t.year === y; }).length; });
    renderQuick(counts);
    var grid = document.getElementById('years');
    grid.replaceChildren();
    grid.removeAttribute('aria-busy');
    A.YEARS.forEach(function (y) {
      var list = D.topics.filter(function (t) { return t.year === y; });
      var strands = {};
      list.forEach(function (t) { strands[t.strand] = true; });
      var sCount = Object.keys(strands).length;
      A.append(grid, h('div', { class: 'year-card band-' + A.bandOf(y), id: 'year-' + y },
        h('span', { class: 'yc-stage', text: A.stageOf(y) }),
        h('strong', { text: A.yearLabel(y) }),
        h('span', { class: 'yc-count', text: A.plural(list.length, 'skill') + (sCount ? ' · ' + A.plural(sCount, 'strand') : '') }),
        h('div', { class: 'yc-links' },
          h('a', { class: 'btn', href: w('explore/?year=' + y), text: 'Explore' }),
          list.length ? h('a', { class: 'btn btn-primary', href: yearHref(y), text: 'Check-up' }) : null)));
    });
  }).catch(function (error) {
    ['n-topics', 'n-edges', 'n-questions', 'n-standards'].forEach(function (id) { setText(id, '–'); });
    fail('The data did not load (' + (error && error.message ? error.message : error) + '). If you are running the site yourself, start a local web server in the project folder (for example python3 -m http.server 8000) rather than opening the file directly.');
  });
})();
