/* PWA for the K-6 Learning Map: registers au/sw.js (scope au/) and offers "Add to Home Screen".
 * Android / desktop Chrome: catches beforeinstallprompt and shows the system install dialog.
 * iPad / iPhone Safari: there is no install API, so a short picture guide explains Share -> Add to Home Screen.
 * Closing the prompt is remembered (auPwa.dismissed.v1); nothing shows when already opened from the home screen. */
(function () {
  'use strict';
  var DISMISS_KEY = 'auPwa.dismissed.v1';
  var INSTALLED_KEY = 'auPwa.installed.v1';
  var script = document.currentScript;
  var root = script && script.src ? new URL('../', script.src).href : new URL('./', location.href).href;
  var track = window.cnmTrack || function () {};

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private browsing */ } }

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(root + 'sw.js', { scope: root }).catch(function () { /* unsupported or blocked */ });
    });
  }

  /* ---------- add to home screen ---------- */
  var standalone = window.cnmIsStandalone != null ? window.cnmIsStandalone
    : ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true);
  if (standalone) return;

  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isIOSSafari = isIOS && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\//.test(ua);
  var isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var deferred = null;
  var bar = null;
  var sheet = null;
  var footerLink = null;
  var shownTracked = false;

  function dismissed() { return !!lsGet(DISMISS_KEY); }
  function installed() { return lsGet(INSTALLED_KEY) === '1'; }
  function canInstall() { return !installed() && (!!deferred || isIOSSafari); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function closeBar(remember) {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    bar = null;
    if (remember) { lsSet(DISMISS_KEY, String(Date.now())); track('install_hint_closed', { platform: isIOSSafari ? 'ios' : 'chrome' }); }
  }

  function closeSheet(remember) {
    if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
    sheet = null;
    document.removeEventListener('keydown', onKey);
    if (remember) { lsSet(DISMISS_KEY, String(Date.now())); closeBar(false); }
  }

  function onKey(e) { if (e.key === 'Escape') closeSheet(false); }

  async function promptInstall() {
    if (!deferred) return;
    var p = deferred;
    deferred = null;
    closeBar(false);
    track('install_prompt_shown', { platform: 'chrome' });
    try {
      p.prompt();
      var choice = await p.userChoice;
      track(choice && choice.outcome === 'accepted' ? 'install_prompt_accepted' : 'install_prompt_dismissed', { platform: 'chrome' });
    } catch (e) { /* blocked */ }
    lsSet(DISMISS_KEY, String(Date.now()));
    refreshFooter();
  }

  /* Guide pictures: plain SVG using the site colours, readable in light and dark mode. */
  var host = location.host || 'this site';
  var SVG_OPEN = '<svg class="pwa-pic" viewBox="0 0 300 100" role="img" aria-hidden="true" focusable="false">';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var PICS = [
    SVG_OPEN +
      '<rect x="6" y="6" width="288" height="88" rx="14" class="pic-bg"/>' +
      '<rect x="24" y="16" width="252" height="22" rx="11" class="pic-field"/>' +
      '<text x="150" y="31" text-anchor="middle" class="pic-txt" font-size="11.5">' + esc(host) + '</text>' +
      '<circle cx="150" cy="68" r="19" class="pic-hit"/>' +
      '<g class="pic-line" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M46 60l-8 8 8 8"/><path d="M96 60l8 8-8 8"/>' +
        '<path d="M150 70V56m0 0l-5 5m5-5l5 5"/><path d="M143 63h-3v15h20V63h-3"/>' +
        '<path d="M200 62q8-3 14 0v14q-6-3-14 0zM214 62q6-3 14 0v14q-8-3-14 0z" stroke-width="1.8"/>' +
        '<rect x="248" y="60" width="16" height="16" rx="3" stroke-width="1.8"/><rect x="253" y="55" width="16" height="16" rx="3" stroke-width="1.8"/>' +
      '</g>' +
    '</svg>',
    SVG_OPEN +
      '<rect x="6" y="6" width="288" height="88" rx="14" class="pic-bg"/>' +
      '<g class="pic-txt" font-size="13">' +
        '<text x="24" y="26">Copy</text>' +
        '<text x="24" y="86">Add Bookmark</text>' +
      '</g>' +
      '<rect x="14" y="34" width="272" height="28" rx="8" class="pic-hit"/>' +
      '<g class="pic-line" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="256" y="40" width="16" height="16" rx="3"/><path d="M264 44v8M260 48h8"/>' +
      '</g>' +
      '<text x="24" y="53" class="pic-txt pic-strong" font-size="13.5">Add to Home Screen</text>' +
    '</svg>',
    SVG_OPEN +
      '<rect x="6" y="6" width="288" height="88" rx="14" class="pic-bg"/>' +
      '<g class="pic-txt" font-size="12.5"><text x="22" y="28">Cancel</text>' +
      '<text x="150" y="28" text-anchor="middle" class="pic-strong">Add to Home Screen</text></g>' +
      '<rect x="236" y="14" width="48" height="20" rx="10" class="pic-hit"/>' +
      '<text x="260" y="28.5" text-anchor="middle" class="pic-txt pic-strong" font-size="12.5">Add</text>' +
      '<rect x="22" y="44" width="40" height="40" rx="10" class="pic-icon"/>' +
      '<path d="M32 74h6q4 0 4-4v-4q0-3 3-3h4" class="pic-icon-line" fill="none" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="72" y="46" width="206" height="26" rx="8" class="pic-field"/>' +
      '<text x="82" y="63.5" class="pic-txt" font-size="13">K–6 Map</text>' +
      '<text x="72" y="84" class="pic-muted" font-size="10.5">' + esc(host) + '</text>' +
    '</svg>'
  ];

  function openGuide() {
    if (sheet) return;
    track('ios_guide_opened');
    sheet = el('div', 'pwa-sheet-wrap');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Add to Home Screen');
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(false); });
    var panel = el('div', 'pwa-sheet');
    panel.appendChild(el('h2', 'pwa-sheet-title', 'Add to Home Screen'));
    panel.appendChild(el('p', 'pwa-sheet-lead', 'Once it is on the Home Screen, the kids can open it with one tap, full screen like an app. The skill map works without internet too.'));
    var steps = [
      ['Tap the Share button ' + (isIPad ? 'next to the address bar' : 'in the toolbar at the bottom'), 'It looks like a square with an arrow pointing up.'],
      ['Scroll the menu and tap “Add to Home Screen”', 'If you cannot see it, scroll right to the bottom of the list.'],
      ['Tap “Add” in the top corner', 'A “K–6 Map” icon appears on your Home Screen.']
    ];
    var list = el('ol', 'pwa-steps');
    steps.forEach(function (s, i) {
      var li = el('li', 'pwa-step');
      var head = el('div', 'pwa-step-head');
      head.appendChild(el('span', 'pwa-step-no', String(i + 1)));
      head.appendChild(el('b', null, s[0]));
      li.appendChild(head);
      var pic = el('div', 'pwa-pic-wrap');
      pic.innerHTML = PICS[i];
      li.appendChild(pic);
      li.appendChild(el('p', 'pwa-step-note', s[1]));
      list.appendChild(li);
    });
    panel.appendChild(list);
    var row = el('div', 'pwa-sheet-actions');
    var ok = el('button', 'primary', 'Got it');
    ok.type = 'button';
    ok.addEventListener('click', function () { closeSheet(true); });
    row.appendChild(ok);
    panel.appendChild(row);
    sheet.appendChild(panel);
    document.body.appendChild(sheet);
    document.addEventListener('keydown', onKey);
    ok.focus();
  }

  function showBar() {
    if (bar || sheet || dismissed() || !canInstall()) return;
    if (document.querySelector('.q-card')) return; // never interrupt a child mid-question
    bar = el('div', 'pwa-bar');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Add to Home Screen');
    var icon = el('img', 'pwa-bar-icon');
    icon.src = root + '../assets/icons/icon-192.png';
    icon.alt = '';
    icon.width = 44; icon.height = 44;
    var text = el('div', 'pwa-bar-text');
    text.appendChild(el('b', null, 'Add to Home Screen'));
    text.appendChild(el('span', null, 'One tap to open, full screen, and the skill map works offline.'));
    var actions = el('div', 'pwa-bar-actions');
    var go = el('button', 'primary', isIOSSafari && !deferred ? 'Show me how' : 'Add');
    go.type = 'button';
    go.addEventListener('click', function () { if (deferred) promptInstall(); else openGuide(); });
    var no = el('button', null, 'Not now');
    no.type = 'button';
    no.addEventListener('click', function () { closeBar(true); refreshFooter(); });
    actions.appendChild(go);
    actions.appendChild(no);
    bar.appendChild(icon);
    bar.appendChild(text);
    bar.appendChild(actions);
    document.body.appendChild(bar);
    if (!shownTracked) { shownTracked = true; track('install_hint_shown', { platform: isIOSSafari && !deferred ? 'ios' : 'chrome' }); }
  }

  /* A footer link, so the option is still there after the prompt is closed. */
  function refreshFooter() {
    var p = document.querySelector('.site-footer p');
    if (!p) return;
    if (!footerLink) {
      footerLink = el('button', 'pwa-footer-link', 'Add to Home Screen');
      footerLink.type = 'button';
      footerLink.addEventListener('click', function () { if (deferred) promptInstall(); else openGuide(); });
      p.appendChild(document.createTextNode(' · '));
      p.appendChild(footerLink);
    }
    footerLink.hidden = !canInstall();
    if (footerLink.previousSibling && footerLink.previousSibling.nodeType === 3) {
      footerLink.previousSibling.textContent = footerLink.hidden ? '' : ' · ';
    }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    refreshFooter();
    setTimeout(showBar, 1200);
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    lsSet(INSTALLED_KEY, '1');
    closeBar(false);
    closeSheet(false);
    refreshFooter();
  });

  function init() {
    refreshFooter();
    if (isIOSSafari) setTimeout(showBar, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.AuPwa = { openGuide: openGuide };
})();
