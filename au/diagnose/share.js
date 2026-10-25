/* Check-up share card: a 1080 x 1920 portrait canvas with system fonts. The QR code is drawn locally
 * with qrcode-generator (../../assets/vendor/qrcode.js). No child's name is ever drawn on the card. */
(function (global) {
  'use strict';
  var W = 1080;
  var H = 1920;
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  function defaultUrl() {
    try { return new URL('../?from=share', global.location.href).href; } catch (e) { return ''; }
  }

  function font(weight, size) { return weight + ' ' + size + 'px ' + FONT; }

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
  function fillRound(ctx, x, y, w, h, r, color) { ctx.fillStyle = color; roundRect(ctx, x, y, w, h, r); ctx.fill(); }
  function card(ctx, x, y, w, h, r) {
    fillRound(ctx, x, y, w, h, r, '#ffffff');
    ctx.strokeStyle = '#d5e0eb';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
  }

  function ellipsis(ctx, text, maxWidth) {
    var raw = String(text || '');
    if (ctx.measureText(raw).width <= maxWidth) return raw;
    var chars = Array.from(raw);
    var s = '';
    for (var i = 0; i < chars.length; i++) {
      if (ctx.measureText(s + chars[i] + '…').width > maxWidth) return s.trim() + '…';
      s += chars[i];
    }
    return s + '…';
  }

  /* Word wrap for English text, at most maxLines lines. */
  function wrap(ctx, text, maxWidth, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var next = cur ? cur + ' ' + words[i] : words[i];
      if (cur && ctx.measureText(next).width > maxWidth) {
        if (lines.length === maxLines - 1) { lines.push(ellipsis(ctx, words.slice(i - cur.split(' ').length).join(' '), maxWidth)); return lines; }
        lines.push(cur);
        cur = words[i];
      } else cur = next;
    }
    if (cur && lines.length < maxLines) lines.push(ellipsis(ctx, cur, maxWidth));
    return lines;
  }

  function drawLogo(ctx, x, y, s) {
    fillRound(ctx, x, y, s, s, s * 0.25, '#ffffff');
    ctx.fillStyle = '#0f766e';
    [[0.28, 0.66], [0.53, 0.34], [0.75, 0.62]].forEach(function (p) {
      ctx.beginPath();
      ctx.arc(x + s * p[0], y + s * p[1], s * 0.075, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = Math.max(2, s * 0.045);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.35, y + s * 0.60);
    ctx.lineTo(x + s * 0.47, y + s * 0.40);
    ctx.moveTo(x + s * 0.58, y + s * 0.40);
    ctx.lineTo(x + s * 0.70, y + s * 0.56);
    ctx.stroke();
  }

  function drawQr(ctx, text, x, y, size) {
    var make = global.qrcode;
    if (typeof make !== 'function') throw new Error('the QR code library did not load');
    var qr = make(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 4;
    var modules = n + quiet * 2;
    var cell = Math.max(2, Math.floor(size / modules));
    var drawn = cell * modules;
    var ox = Math.round(x + (size - drawn) / 2);
    var oy = Math.round(y + (size - drawn) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(x), Math.round(y), size, size);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(ox + (c + quiet) * cell, oy + (r + quiet) * cell, cell, cell);
      }
    }
  }

  function text(ctx, value, x, y, weight, size, color, maxWidth) {
    ctx.fillStyle = color;
    ctx.font = font(weight, size);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(maxWidth ? ellipsis(ctx, value, maxWidth) : String(value), x, y);
  }

  function draw(canvas, model) {
    var m = model || {};
    var url = m.url || defaultUrl();
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#e7f4f2');
    bg.addColorStop(0.45, '#f3f7fb');
    bg.addColorStop(1, '#e7eef6');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var accent = m.subject === 'English' ? '#4338ca' : '#0f766e';
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, 460);
    ctx.quadraticCurveTo(W, 500, W - 40, 500);
    ctx.lineTo(40, 500);
    ctx.quadraticCurveTo(0, 500, 0, 460);
    ctx.closePath();
    ctx.fill();

    drawLogo(ctx, 64, 56, 84);
    text(ctx, m.siteName || 'K–6 Learning Map', 168, 62, 800, 40, '#ffffff', 840);
    text(ctx, 'Check-up results · NSW Maths & English', 168, 112, 500, 26, 'rgba(255,255,255,0.88)', 840);

    ctx.fillStyle = '#ffffff';
    ctx.font = font(800, 56);
    var lines = wrap(ctx, ((m.subject || '') + ': ' + (m.scope || 'Check-up')).trim(), 950, 2);
    lines.forEach(function (line, i) { ctx.fillText(line, 64, 196 + i * 70); });
    text(ctx, m.date || '', 64, 196 + lines.length * 70 + 18, 500, 28, 'rgba(255,255,255,0.9)', 900);

    var cardX = 48;
    var cardW = W - 96;
    var statsY = 430;
    var statsH = 214;
    ctx.save();
    ctx.shadowColor = 'rgba(22, 40, 70, 0.12)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    fillRound(ctx, cardX, statsY, cardW, statsH, 28, '#ffffff');
    ctx.restore();

    var stats = [
      { n: m.mastered, label: 'Got it', fg: '#157a3a', bg: '#dcfce7' },
      { n: m.shaky, label: 'Shaky', fg: '#b45309', bg: '#fef3c7' },
      { n: m.weak, label: 'Needs work', fg: '#b91c1c', bg: '#fee2e2' },
      { n: m.untested, label: 'Not checked', fg: '#475569', bg: '#e8eef6' }
    ];
    var gap = 16;
    var chipW = (cardW - 40 - gap * 3) / 4;
    var chipH = 166;
    stats.forEach(function (s, i) {
      var x = cardX + 20 + i * (chipW + gap);
      var y = statsY + 24;
      fillRound(ctx, x, y, chipW, chipH, 18, s.bg);
      ctx.fillStyle = s.fg;
      ctx.font = font(800, 58);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(s.n == null ? 0 : s.n), x + chipW / 2, y + 32);
      ctx.font = font(700, 26);
      ctx.fillText(s.label, x + chipW / 2, y + 108);
    });
    ctx.textAlign = 'left';

    var y = statsY + statsH + 36;
    text(ctx, m.spotKind === 'chapter' ? 'Focus areas to work on' : 'Skills to work on', 64, y, 800, 34, '#162033');
    y += 52;
    var spots = Array.isArray(m.spots) ? m.spots.slice(0, 3) : [];
    if (!spots.length) {
      card(ctx, cardX, y, cardW, 88, 18);
      text(ctx, 'No clear gaps this time. Well done!', 80, y + 28, 500, 28, '#5c6d82', cardW - 64);
      y += 104;
    } else {
      spots.forEach(function (spot, i) {
        card(ctx, cardX, y, cardW, 112, 18);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cardX + 48, y + 56, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = font(800, 24);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), cardX + 48, y + 57);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        text(ctx, spot.title || '', cardX + 88, y + 24, 700, 30, '#162033', cardW - 120);
        text(ctx, spot.detail || '', cardX + 88, y + 64, 500, 24, '#5c6d82', cardW - 120);
        y += 126;
      });
    }

    y += 8;
    text(ctx, 'Where the gap starts', 64, y, 800, 34, '#162033');
    y += 52;
    var roots = Array.isArray(m.roots) ? m.roots.slice(0, 2) : [];
    if (!roots.length) {
      card(ctx, cardX, y, cardW, 88, 18);
      text(ctx, 'Nothing earlier needs fixing first.', 80, y + 28, 500, 28, '#5c6d82', cardW - 64);
    } else {
      roots.forEach(function (name) {
        card(ctx, cardX, y, cardW, 96, 18);
        fillRound(ctx, cardX + 24, y + 24, 8, 48, 4, '#b91c1c');
        text(ctx, name, cardX + 52, y + 30, 700, 30, '#162033', cardW - 90);
        y += 110;
      });
    }

    ctx.fillStyle = '#e7f3f1';
    ctx.fillRect(0, 1504, W, H - 1504);
    ctx.fillStyle = '#d5e0eb';
    ctx.fillRect(0, 1504, W, 2);

    var qrSize = 292;
    var qrX = 72;
    var qrY = 1540;
    ctx.save();
    ctx.shadowColor = 'rgba(22, 40, 70, 0.08)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    fillRound(ctx, qrX - 16, qrY - 16, qrSize + 32, qrSize + 32, 20, '#ffffff');
    ctx.restore();
    drawQr(ctx, url, qrX, qrY, qrSize);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent;
    ctx.font = font(800, 46);
    ctx.fillText('Scan to open', qrX + qrSize + 48, qrY + qrSize / 2 - 34);
    ctx.fillText('the K–6 Learning Map', qrX + qrSize + 48, qrY + qrSize / 2 + 26);
    return canvas;
  }

  global.ShareCard = { draw: draw, defaultUrl: defaultUrl, width: W, height: H };
})(typeof window !== 'undefined' ? window : globalThis);
