/* Kolom tabel: kunci (freeze) dan sembunyikan kolom seperti di Excel, untuk semua tabel di aplikasi.
   Dipakai oleh Forecast Desk (/), Perencanaan Produksi (/produksi/) dan MRP (/mrp/).
   - Tombol "Kolom ▾" di atas tiap tabel lebar, atau klik kanan judul kolom.
   - 🔒 "Kunci sampai kolom ini": kolom di kiri tetap terlihat saat tabel digulir ke samping.
   - Centang = tampilkan. Pilihan disimpan per tabel di browser ini (localStorage ppic_tabel).
   Tabel digambar ulang lewat innerHTML; modul ini menerapkan pilihan lagi setiap kali isinya berubah.
   Tabel dengan data-tt="off" atau kelas ppg / pg (grid jadwal yang sudah punya kolom beku sendiri) dilewati.
   Bawaan per tabel: window.TT_DEF[id] = { f: jumlah kolom dikunci, hide: function (label) -> true bila disembunyikan }. */
(function () {
  'use strict';
  var LS = 'ppic_tabel', MIN_COLS = 5, P = {};
  try { P = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { P = {}; }
  function save() { try { localStorage.setItem(LS, JSON.stringify(P)); } catch (e) {} }
  var css = document.createElement('style');
  css.textContent =
    '.ttbar[hidden]{display:none!important}.ttbar{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin:0 0 4px;font-size:12px}' +
    '.ttbtn{border:1px solid var(--line,#ccc);background:var(--input,var(--paper,#fff));color:var(--ink,#222);border-radius:8px;padding:3px 10px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}' +
    '.ttbtn:hover{border-color:var(--acc,#1f6b5c)}' +
    '.ttsum{color:var(--mut,#666);font-size:11.5px}' +
    'table .tt-h{display:none!important}' +
    'table th.tt-fz,table td.tt-fz{position:sticky!important;z-index:2}' +
    'table thead th.tt-fz{z-index:6!important;background:var(--th,var(--head,#eee))}' +
    ':where(table tbody td.tt-fz){background:var(--paper,var(--panel,#fff))}' +
    'table .tt-fzl{box-shadow:inset -2px 0 0 var(--acc,#1f6b5c)}' +
    'table.tt-nofz tbody td:first-child,table.tt-nofz thead tr:first-child th:first-child{left:auto}' +
    'table.tt-nofz tbody td:first-child{position:static}' +
    '#ttMenu{position:fixed;z-index:9999;background:var(--paper,#fff);color:var(--ink,#222);border:1px solid var(--line,#ccc);border-radius:10px;box-shadow:0 8px 24px var(--shadow,rgba(0,0,0,.18));padding:10px 12px;width:300px;max-height:70vh;display:flex;flex-direction:column;gap:6px;font-size:12.5px}' +
    '#ttMenu[hidden]{display:none}' +
    '#ttMenu .tth{font-weight:700;font-size:13px;display:flex;justify-content:space-between;gap:8px}' +
    '#ttMenu .ttn{color:var(--mut,#666);font-size:11.5px;line-height:1.35}' +
    '#ttMenu .ttl{overflow:auto;display:flex;flex-direction:column;border-top:1px solid var(--line2,#eee);border-bottom:1px solid var(--line2,#eee);padding:4px 0}' +
    '#ttMenu .ttg{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut,#666);margin:6px 0 1px}' +
    '#ttMenu .ttr{display:flex;align-items:center;gap:6px;padding:1px 0}' +
    '#ttMenu .ttr label{display:flex;align-items:center;gap:6px;flex:1;cursor:pointer;min-width:0}' +
    '#ttMenu .ttr label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#ttMenu .ttk{border:1px solid transparent;background:none;border-radius:6px;cursor:pointer;padding:0 4px;opacity:.35;font-size:12px;line-height:20px}' +
    '#ttMenu .ttk:hover{opacity:.8;border-color:var(--line,#ccc)}' +
    '#ttMenu .ttk.on{opacity:1;background:var(--acc2,#e1f0ec)}' +
    '#ttMenu .ttf{display:flex;gap:6px;flex-wrap:wrap}' +
    '#ttMenu .ttf button,#ttMenu .ttc button{border:1px solid var(--line,#ccc);background:var(--input,var(--paper,#fff));color:var(--ink,#222);border-radius:7px;padding:3px 8px;font:inherit;font-size:12px;cursor:pointer}' +
    '#ttMenu .ttc{display:flex;flex-direction:column;gap:4px}#ttMenu .ttc button{text-align:left}';
  document.head.appendChild(css);

  // ---------- columns of a table ----------
  function cleanText(c) {
    var x = c.cloneNode(true);
    x.querySelectorAll('br').forEach(function (b) { b.replaceWith(' '); });
    x.querySelectorAll('.v10-q,button,select,datalist,script').forEach(function (b) { b.remove(); });
    var t = x.textContent.replace(/\s+/g, ' ').replace(/\s*\?\s*$/, '').trim();
    if (!t) { var i = c.querySelector('input,select'); t = c.getAttribute('title') || (i && (i.getAttribute('placeholder') || i.getAttribute('aria-label'))) || ''; t = t.replace(/\s+/g, ' ').trim().slice(0, 40); }
    return t;
  }
  function span(c) { var o = c.getAttribute('data-ttcs'); return o ? +o : c.colSpan || 1; }
  // place cells of a row group on a grid (rowspan / colspan aware): [{c, s: first column, n: columns}]
  function place(rows) {
    var occ = [], out = [];
    for (var r = 0; r < rows.length; r++) {
      occ[r] = occ[r] || []; var col = 0;
      for (var i = 0; i < rows[r].cells.length; i++) {
        var c = rows[r].cells[i]; while (occ[r][col]) col++;
        var n = span(c), rs = Math.max(1, c.rowSpan || 1);
        for (var dr = 0; dr < rs && r + dr < rows.length; dr++) { occ[r + dr] = occ[r + dr] || []; for (var dc = 0; dc < n; dc++) occ[r + dr][col + dc] = 1; }
        out.push({ c: c, s: col, n: n, r: r }); col += n;
      }
    }
    return out;
  }
  function columns(t) {
    var hr = t.tHead ? Array.prototype.slice.call(t.tHead.rows) : [];
    if (!hr.length) return null;
    var cells = place(hr), N = 0;
    cells.forEach(function (x) { N = Math.max(N, x.s + x.n); });
    var cols = [];
    for (var j = 0; j < N; j++) cols.push({ parts: [], cell: null, r: -1 });
    cells.forEach(function (x) {
      var tx = cleanText(x.c);
      for (var j = x.s; j < x.s + x.n; j++) {
        if (tx && x.n > 1) cols[j].group = cols[j].group ? cols[j].group + ' · ' + tx : tx;
        if (x.n === 1 && x.r >= cols[j].r) { cols[j].cell = x.c; cols[j].r = x.r; cols[j].own = tx; }
      }
    });
    cols.forEach(function (c, j) { c.label = (c.group ? c.group + ' · ' : '') + (c.own || '(kolom ' + (j + 1) + ')'); });
    return { cols: cols, head: cells };
  }

  // ---------- which tables, their key and their settings ----------
  function eligible(t) {
    if (!t.tHead || t.getAttribute('data-tt') === 'off' || t.classList.contains('ppg') || t.classList.contains('pg')) return false;
    if (t.closest('#aiPanel,#ttMenu,[data-tt="off"]')) return false;
    var hr = t.tHead.rows[t.tHead.rows.length - 1]; if (!hr) return false;
    var n = 0; Array.prototype.forEach.call(t.tHead.rows[0].cells, function (c) { n += span(c); });
    return n >= MIN_COLS;
  }
  function tkey(t) {
    if (t._ttk) return t._ttk;
    var base = location.pathname.replace(/index\.html$/, '');
    if (t.id) return (t._ttk = base + '#' + t.id);
    var box = t.closest('.card,.panel,section,details'), h = box && box.querySelector('h2,h3,summary');
    var nm = h ? h.textContent.replace(/[0-9]+|·.*$/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    return (t._ttk = base + '@' + (nm || 'tabel'));
  }
  function tname(t) {
    var box = t.closest('.card,.panel,section,details'), h = box && box.querySelector('h2,h3,summary');
    return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : 'Tabel';
  }
  function def(t) { return (window.TT_DEF && t.id && window.TT_DEF[t.id]) || {}; }
  function freezeOf(t) {
    var p = P[tkey(t)]; if (p && typeof p.f === 'number') return p.f;
    var d = def(t); if (typeof d.f === 'number') return d.f;
    return t.classList.contains('fct') ? 1 : 0;
  }
  function hiddenSet(t, cols) {
    var p = P[tkey(t)], H = {};
    if (p && p.h) p.h.forEach(function (l) { H[l] = 1; });
    else { var d = def(t); if (d.hide) cols.forEach(function (c) { if (d.hide(c.label, c)) H[c.label] = 1; }); }
    return H;
  }
  function setP(t, patch, cols) {
    var k = tkey(t), p = P[k] = P[k] || {};
    if (!p.h && cols) { var H = hiddenSet(t, cols); p.h = Object.keys(H); }
    Object.keys(patch).forEach(function (x) { p[x] = patch[x]; });
    save(); apply(t, true);
  }

  // ---------- apply ----------
  function bodyCells(t) {
    var out = [];
    Array.prototype.forEach.call(t.tBodies, function (b) { out = out.concat(place(Array.prototype.slice.call(b.rows))); });
    if (t.tFoot) out = out.concat(place(Array.prototype.slice.call(t.tFoot.rows)));
    return out;
  }
  function apply(t, force) {
    if (!t.isConnected) return;
    var ok = eligible(t);
    var bar = t._ttbar;
    if (!ok) { if (bar && bar.parentNode) bar.remove(); t._ttbar = null; return; }
    var C = columns(t); if (!C) return;
    var cols = C.cols, H = hiddenSet(t, cols), all = C.head.concat(bodyCells(t));
    var vis = cols.map(function (c) { return !H[c.label]; });
    if (!vis.some(Boolean)) vis = cols.map(function () { return true; });
    // hide: cells fully inside hidden columns disappear, wider cells lose the hidden part of their colspan
    all.forEach(function (x) {
      var c = x.c, nh = 0;
      for (var j = x.s; j < x.s + x.n && j < vis.length; j++) if (!vis[j]) nh++;
      if (x.n > 1 && !c.hasAttribute('data-ttcs')) c.setAttribute('data-ttcs', x.n);
      if (nh && nh >= Math.min(x.n, vis.length - x.s)) { c.classList.add('tt-h'); }
      else { c.classList.remove('tt-h'); if (x.n > 1) c.colSpan = x.n - nh; }
    });
    // freeze: the first f columns stick to the left
    var f = Math.min(freezeOf(t), cols.length);
    t.classList.toggle('tt-nofz', f === 0 && t.classList.contains('fct'));
    t.querySelectorAll('.tt-fz').forEach(function (c) { c.classList.remove('tt-fz', 'tt-fzl'); c.style.left = ''; });
    var left = [], acc = 0, lastV = -1;
    for (var j = 0; j < f; j++) {
      left[j] = acc;
      if (vis[j] && cols[j].cell) { acc += cols[j].cell.getBoundingClientRect().width; lastV = j; }
    }
    if (f > 0 && acc > 0) {
      all.forEach(function (x) {
        if (x.s + x.n > f || x.c.classList.contains('tt-h')) return;
        x.c.classList.add('tt-fz'); x.c.style.left = left[x.s] + 'px';
        var e = x.s + x.n - 1; if (e >= lastV) x.c.classList.add('tt-fzl');
      });
    }
    // bar with the Kolom button
    var nH = vis.filter(function (v) { return !v; }).length;
    var host = t.id && document.querySelector('[data-tt-for="' + t.id + '"]');
    if (!bar || !bar.isConnected || (host && bar.parentNode !== host)) {
      if (bar && bar.parentNode) bar.remove();
      bar = document.createElement(host ? 'span' : 'div'); bar.className = host ? 'ttbar ttin' : 'ttbar';
      bar.innerHTML = '<span class="ttsum"></span><button type="button" class="ttbtn" title="Kunci kolom kiri (seperti Freeze Panes di Excel) dan sembunyikan kolom. Bisa juga klik kanan judul kolom.">Kolom ▾</button>';
      bar._tt = t;
      if (host) { host.innerHTML = ''; host.appendChild(bar); }
      else { var w = t.closest('.scroll,.tbox,.gwrap,.ppscroll,.tscroll') || t; w.parentNode.insertBefore(bar, w); }
      t._ttbar = bar;
    }
    bar._tt = t;
    // only where it helps: the table is wider than its box, or columns are already locked / hidden by choice
    var wr = t.closest('.scroll,.tbox,.gwrap,.ppscroll,.tscroll'), wide = wr ? t.scrollWidth > wr.clientWidth + 4 : t.scrollWidth > (t.parentNode.clientWidth || 0) + 4;
    bar.hidden = !(host || wide || nH || P[tkey(t)]);
    bar.firstChild.textContent = (f ? '🔒 ' + f + ' kolom dikunci' : '') + (f && nH ? ' · ' : '') + (nH ? nH + ' kolom disembunyikan' : '');
    t._ttcols = cols;
    if (!t._ttro && window.ResizeObserver) { t._ttro = new ResizeObserver(function () { schedule(t); }); t._ttro.observe(t); }
    if (menu && !menu.hidden && menu._t === t && force) drawMenu(t);
  }

  // ---------- scheduling: after a re-render, after a resize ----------
  var dirty = new Set(), queued = false;
  function schedule(t) { dirty.add(t); if (!queued) { queued = true; requestAnimationFrame(flush); } }
  function flush() {
    queued = false; var L = Array.from(dirty); dirty.clear();
    mo.disconnect();
    L.forEach(function (t) { try { apply(t); } catch (e) { if (window.console) console.warn('tabel', e); } });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  var mo = new MutationObserver(function (recs) {
    recs.forEach(function (r) {
      var tg = r.target;
      if (tg.nodeType !== 1) tg = tg.parentNode;
      var t = tg && tg.closest ? tg.closest('table') : null;
      if (t) schedule(t);
      Array.prototype.forEach.call(r.addedNodes, function (nd) {
        if (nd.nodeType !== 1) return;
        if (nd.tagName === 'TABLE') schedule(nd); else if (nd.querySelectorAll) nd.querySelectorAll('table').forEach(schedule);
      });
    });
  });
  function start() {
    document.querySelectorAll('table').forEach(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { document.querySelectorAll('table').forEach(schedule); });
  }

  // ---------- menu ----------
  var menu = null;
  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement('div'); menu.id = 'ttMenu'; menu.hidden = true; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Kolom tabel');
    document.body.appendChild(menu);
    menu.addEventListener('click', function (e) {
      var t = menu._t; if (!t) return;
      var cols = t._ttcols || (columns(t) || {}).cols || [];
      var k = e.target.closest('[data-ttk]');
      if (k) { var j = +k.getAttribute('data-ttk'); setP(t, { f: freezeOf(t) === j + 1 ? 0 : j + 1 }, cols); return; }
      var a = e.target.closest('[data-tta]'); if (!a) return;
      var act = a.getAttribute('data-tta'), col = menu._col;
      if (act === 'close') hide();
      else if (act === 'all') setP(t, { h: [] }, cols);
      else if (act === 'unlock') setP(t, { f: 0 }, cols);
      else if (act === 'reset') { delete P[tkey(t)]; save(); apply(t, true); }
      else if (act === 'lockhere' && col !== undefined) { setP(t, { f: col + 1 }, cols); hide(); }
      else if (act === 'hidehere' && col !== undefined) { var H = hiddenSet(t, cols); H[cols[col].label] = 1; setP(t, { h: Object.keys(H) }, cols); hide(); }
      else if (act === 'more') { menu._col = undefined; drawMenu(t); }
    });
    menu.addEventListener('change', function (e) {
      var t = menu._t, c = e.target.getAttribute('data-ttv'); if (!t || c === null) return;
      var cols = t._ttcols || [], H = hiddenSet(t, cols), lab = cols[+c].label;
      if (e.target.checked) delete H[lab]; else H[lab] = 1;
      if (Object.keys(H).length >= cols.length) { e.target.checked = true; return; }
      setP(t, { h: Object.keys(H) }, cols);
    });
    document.addEventListener('mousedown', function (e) { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('.ttbtn')) hide(); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) hide(); });
    window.addEventListener('scroll', function (e) { if (!menu.hidden && !menu.contains(e.target) && Date.now() - (menu._at || 0) > 400) hide(); }, true);
    return menu;
  }
  function hide() { if (menu) { menu.hidden = true; menu._t = null; } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function drawMenu(t) {
    var cols = t._ttcols || (columns(t) || {}).cols || [], H = hiddenSet(t, cols), f = freezeOf(t), lastG = null, h = '';
    cols.forEach(function (c, j) {
      if ((c.group || '') !== lastG) { lastG = c.group || ''; if (lastG) h += '<div class="ttg">' + esc(lastG) + '</div>'; }
      h += '<div class="ttr"><button type="button" class="ttk' + (j < f ? ' on' : '') + '" data-ttk="' + j + '" title="' + (f === j + 1 ? 'Buka kunci' : 'Kunci sampai kolom ini') + '" aria-label="Kunci sampai ' + esc(c.own || c.label) + '">🔒</button>' +
        '<label><input type="checkbox" data-ttv="' + j + '"' + (H[c.label] ? '' : ' checked') + '><span title="' + esc(c.label) + '">' + esc(c.own || c.label) + '</span></label></div>';
    });
    menu.innerHTML = '<div class="tth"><span>Kolom · ' + esc(tname(t)) + '</span><button type="button" class="ttk on" data-tta="close" aria-label="Tutup" style="opacity:.7">✕</button></div>' +
      '<div class="ttn">🔒 kunci: kolom sampai yang dipilih tetap terlihat saat tabel digulir ke samping, seperti <i>Freeze Panes</i> di Excel. Centang = tampilkan. Klik kanan judul kolom untuk cara cepat.</div>' +
      '<div class="ttl">' + h + '</div>' +
      '<div class="ttf"><button type="button" data-tta="all">Tampilkan semua</button><button type="button" data-tta="unlock">Buka kunci</button><button type="button" data-tta="reset">Kembalikan bawaan</button></div>';
  }
  function place2(x, y) {
    menu.hidden = false; menu._at = Date.now();
    var r = menu.getBoundingClientRect(), W = window.innerWidth, Hh = window.innerHeight;
    menu.style.left = Math.max(8, Math.min(x, W - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, Hh - r.height - 8)) + 'px';
  }
  function openMenu(t, btn) {
    ensureMenu(); if (!menu.hidden && menu._t === t) { hide(); return; }
    menu._t = t; menu._col = undefined; t._ttcols = (columns(t) || {}).cols; drawMenu(t);
    var r = btn.getBoundingClientRect(); place2(r.right - 300, r.bottom + 4);
  }
  function openCtx(t, j, x, y) {
    ensureMenu(); menu._t = t; menu._col = j; t._ttcols = (columns(t) || {}).cols;
    var c = t._ttcols[j], f = freezeOf(t);
    menu.innerHTML = '<div class="tth"><span>' + esc(c.own || c.label) + '</span></div><div class="ttc">' +
      '<button type="button" data-tta="lockhere">🔒 Kunci sampai kolom ini</button>' +
      (f ? '<button type="button" data-tta="unlock">Buka kunci kolom (' + f + ')</button>' : '') +
      '<button type="button" data-tta="hidehere">Sembunyikan kolom ini</button>' +
      '<button type="button" data-tta="more">Semua kolom…</button></div>';
    place2(x, y);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.ttbtn'); if (!b) return;
    var bar = b.closest('.ttbar'); if (bar && bar._tt) { e.preventDefault(); e.stopPropagation(); openMenu(bar._tt, b); }
  }, true);
  document.addEventListener('contextmenu', function (e) {
    var th = e.target.closest('thead th'); if (!th || e.target.closest('input,select,textarea')) return;
    var t = th.closest('table'); if (!t || !eligible(t)) return;
    var C = columns(t); if (!C) return;
    var x = C.head.filter(function (y) { return y.c === th; })[0]; if (!x) return;
    e.preventDefault(); openCtx(t, x.s + x.n - 1, e.clientX, e.clientY);
  });
  window.TT = { apply: function (t) { schedule(t); }, reset: function () { P = {}; save(); document.querySelectorAll('table').forEach(schedule); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
