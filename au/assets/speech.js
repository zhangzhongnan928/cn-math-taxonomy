/* Read-aloud for young children, using the browser's speechSynthesis.
 * Voice preference: en-AU, then en-GB, then any English voice. If the browser has no speech
 * (or no English voice), status() becomes 'unavailable' and listeners are told, so pages can show a note.
 * Exposed as window.AuSpeech. */
(function () {
  'use strict';
  var synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
  var Utter = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null;
  var state = synth && Utter ? 'pending' : 'unavailable';
  var voice = null;
  var listeners = [];
  var speaking = false;
  var token = 0;

  function langOf(v) { return String(v && v.lang || '').replace('_', '-').toLowerCase(); }

  function pickVoice() {
    var all = [];
    try { all = synth.getVoices() || []; } catch (e) { all = []; }
    if (!all.length) return null;
    var tiers = [
      all.filter(function (v) { return langOf(v) === 'en-au'; }),
      all.filter(function (v) { return langOf(v) === 'en-gb'; }),
      all.filter(function (v) { return langOf(v).indexOf('en') === 0; })
    ];
    var list = tiers.filter(function (t) { return t.length; })[0];
    if (!list) return null;
    return list.filter(function (v) { return v.localService; })[0] || list[0];
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    listeners.slice().forEach(function (fn) { try { fn(state); } catch (e) { /* ignore */ } });
  }

  function refresh() {
    if (!synth) return;
    var v = pickVoice();
    if (v) { voice = v; setState('ok'); }
  }

  if (synth) {
    refresh();
    try {
      if (synth.addEventListener) synth.addEventListener('voiceschanged', refresh);
      else synth.onvoiceschanged = refresh;
    } catch (e) { /* ignore */ }
    setTimeout(function () {
      if (state !== 'pending') return;
      refresh();
      if (!voice) setState('unavailable');
    }, 1800);
  }

  /** Make text friendlier for a speech engine: blanks, maths signs, square units, degrees. */
  function speakable(text) {
    return String(text == null ? '' : text)
      .replace(/_{2,}/g, ' blank ')
      .replace(/×/g, ' times ')
      .replace(/÷/g, ' divided by ')
      .replace(/−/g, ' minus ')
      .replace(/(\d)\s*-\s*(\d)/g, '$1 minus $2')
      .replace(/=/g, ' equals ')
      .replace(/cm²/g, ' square centimetres').replace(/m²/g, ' square metres')
      .replace(/°C/g, ' degrees Celsius').replace(/°/g, ' degrees')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stop() {
    token++;
    speaking = false;
    if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
  }

  /** Speak a list of texts one after another. Returns false when speech is not available. */
  function speak(parts, opts) {
    var o = opts || {};
    if (!synth || state === 'unavailable') return false;
    stop();
    var my = ++token;
    var list = (Array.isArray(parts) ? parts : [parts]).map(speakable).filter(Boolean);
    if (!list.length) return true;
    speaking = true;
    list.forEach(function (text, i) {
      var u;
      try { u = new Utter(text); } catch (e) { setState('unavailable'); return; }
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-AU';
      u.rate = o.rate || 0.9;
      u.pitch = 1;
      if (i === list.length - 1) {
        u.onend = function () { if (my === token) { speaking = false; if (o.onend) o.onend(); } };
      }
      u.onerror = function (ev) {
        var err = ev && ev.error;
        if (my === token) { speaking = false; if (o.onend) o.onend(); }
        // 'not-allowed': the browser wants speech to start inside a tap (iPad Safari). Not a failure of speech itself.
        if (err === 'not-allowed') { if (my === token && o.onblocked) o.onblocked(); return; }
        if (err && ['synthesis-unavailable', 'synthesis-failed', 'audio-hardware', 'language-unavailable', 'voice-unavailable'].indexOf(err) >= 0) {
          setState('unavailable');
        }
      };
      try { synth.speak(u); } catch (e) { setState('unavailable'); }
    });
    return true;
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
  }

  window.AuSpeech = {
    status: function () { return state; },
    available: function () { return state !== 'unavailable'; },
    isSpeaking: function () { return speaking; },
    voiceName: function () { return voice ? voice.name + ' (' + voice.lang + ')' : ''; },
    speak: speak, stop: stop, onChange: onChange, speakable: speakable
  };
})();
