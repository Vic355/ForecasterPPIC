// Rencana produksi as an Excel workbook in the planner's layout (the "CVT Mills TUB Planning" file):
// sheets TUB (summary per SKU), Hasil (actual production log), Machine (per machine with subtotals per area and weeks),
// JR, MT (tons per machine), SKU (daily plan per machine x SKU), Capacity, BOM, plus Info.
// Used by the Forecast Desk (Rencana produksi) and by Perencanaan Produksi (/produksi/).
// It writes the .xlsx itself (styles, merges, frozen panes, filters and live formulas with their values), so it needs no
// library and works offline. window.RencanaExcel.download(data, fileName) builds and downloads it; .build(data) returns
// a Promise of the Blob.
(function () {
  'use strict';

  // ---------- a small .xlsx writer ----------
  function colName(c) { var s = ''; c++; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
  function ref(r, c) { return colName(c) + (r + 1); }
  function xmlEsc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }
  function serial(iso) { var p = iso.split('-'); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 864e5); }

  function Sheet(name) { this.name = name; this.cells = {}; this.maxR = 0; this.maxC = 0; this.cols = {}; this.merges = []; this.freeze = null; this.filter = null; this.heights = {}; this.cf = []; this.tab = null; }
  // v: number | string | Date-like {date: iso} | null; o: { f: formula, s: style }
  Sheet.prototype.set = function (r, c, v, s, f) { this.cells[r + ',' + c] = { v: v, s: s || null, f: f || null }; if (r > this.maxR) this.maxR = r; if (c > this.maxC) this.maxC = c; return this; };
  Sheet.prototype.style = function (r, c, s) { var k = r + ',' + c, x = this.cells[k]; if (x) x.s = s; else this.set(r, c, null, s); };
  Sheet.prototype.box = function (r1, c1, r2, c2, s) { for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++) { var x = this.cells[r + ',' + c]; if (!x) this.set(r, c, null, s); else if (!x.s) x.s = s; } };
  Sheet.prototype.merge = function (r1, c1, r2, c2) { this.merges.push(ref(r1, c1) + ':' + ref(r2, c2)); };
  Sheet.prototype.width = function (c, w) { this.cols[c] = w; };

  function Styles() {
    this.fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    this.numFmts = []; this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']; this.dxfs = [];
    this.memo = {}; this.fmemo = {};
  }
  Styles.prototype.idx = function (list, xml) { var k = list === this.fonts ? 'f' : list === this.fills ? 'l' : 'b'; var key = k + xml; if (this.fmemo[key] === undefined) { list.push(xml); this.fmemo[key] = list.length - 1; } return this.fmemo[key]; };
  Styles.prototype.fontXml = function (s) { return '<font>' + (s.b ? '<b/>' : '') + (s.i ? '<i/>' : '') + '<sz val="' + (s.sz || 11) + '"/>' + (s.color ? '<color rgb="FF' + s.color + '"/>' : '') + '<name val="' + (s.font || 'Calibri') + '"/><family val="2"/></font>'; };
  Styles.prototype.nf = function (code) {
    var built = { 'General': 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };
    if (built[code] !== undefined) return built[code];
    for (var i = 0; i < this.numFmts.length; i++) if (this.numFmts[i] === code) return 164 + i;
    this.numFmts.push(code); return 163 + this.numFmts.length;
  };
  Styles.prototype.xf = function (s) {
    if (!s) return 0; var key = JSON.stringify(s); if (this.memo[key] !== undefined) return this.memo[key];
    var font = this.idx(this.fonts, this.fontXml(s));
    var fill = s.fill ? this.idx(this.fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + s.fill + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
    var bd = s.border ? this.idx(this.borders, (function (b) { var e = function (side) { return b.indexOf(side) >= 0 || b === 'all' ? '<' + side + ' style="thin"><color auto="1"/></' + side + '>' : '<' + side + '/>'; }; return '<border>' + e('left') + e('right') + e('top') + e('bottom') + '<diagonal/></border>'; })(s.border)) : 0;
    var nf = this.nf(s.nf || 'General');
    var al = s.h || s.v || s.wrap ? '<alignment' + (s.h ? ' horizontal="' + s.h + '"' : '') + ' vertical="' + (s.v || 'center') + '"' + (s.wrap ? ' wrapText="1"' : '') + '/>' : '';
    this.xfs.push('<xf numFmtId="' + nf + '" fontId="' + font + '" fillId="' + fill + '" borderId="' + bd + '" xfId="0"' + (nf ? ' applyNumberFormat="1"' : '') + (font ? ' applyFont="1"' : '') + (fill ? ' applyFill="1"' : '') + (bd ? ' applyBorder="1"' : '') + (al ? ' applyAlignment="1">' + al + '</xf>' : '/>'));
    this.memo[key] = this.xfs.length - 1; return this.memo[key];
  };
  Styles.prototype.dxf = function (s) { this.dxfs.push('<dxf>' + (s.color ? '<font><color rgb="FF' + s.color + '"/></font>' : '') + (s.fill ? '<fill><patternFill><bgColor rgb="FF' + s.fill + '"/></patternFill></fill>' : '') + '</dxf>'); return this.dxfs.length - 1; };
  Styles.prototype.xml = function () {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (this.numFmts.length ? '<numFmts count="' + this.numFmts.length + '">' + this.numFmts.map(function (f, i) { return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + xmlEsc(f) + '"/>'; }).join('') + '</numFmts>' : '') +
      '<fonts count="' + this.fonts.length + '">' + this.fonts.join('') + '</fonts><fills count="' + this.fills.length + '">' + this.fills.join('') + '</fills><borders count="' + this.borders.length + '">' + this.borders.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="' + this.dxfs.length + '">' + this.dxfs.join('') + '</dxfs></styleSheet>';
  };

  function sheetXml(sh, st) {
    var rows = [], cf = '';
    for (var r = 0; r <= sh.maxR; r++) {
      var cs = [];
      for (var c = 0; c <= sh.maxC; c++) {
        var x = sh.cells[r + ',' + c]; if (!x) continue;
        var a = ' r="' + ref(r, c) + '"' + (x.s ? ' s="' + st.xf(x.s) + '"' : ''), v = x.v;
        if (v && typeof v === 'object' && v.date) v = serial(v.date);
        if (x.f) {
          var fv = typeof v === 'number' && isFinite(v) ? '<v>' + v + '</v>' : typeof v === 'string' ? '<v>' + xmlEsc(v) + '</v>' : '';
          cs.push('<c' + a + (typeof v === 'string' ? ' t="str"' : '') + '><f>' + xmlEsc(x.f) + '</f>' + fv + '</c>');
        } else if (typeof v === 'number' && isFinite(v)) cs.push('<c' + a + '><v>' + v + '</v></c>');
        else if (typeof v === 'string' && v !== '') cs.push('<c' + a + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>');
        else cs.push('<c' + a + '/>');
      }
      if (cs.length || sh.heights[r]) rows.push('<row r="' + (r + 1) + '"' + (sh.heights[r] ? ' ht="' + sh.heights[r] + '" customHeight="1"' : '') + '>' + cs.join('') + '</row>');
    }
    var cols = Object.keys(sh.cols).map(Number).sort(function (a, b) { return a - b; }).map(function (c) { return '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + sh.cols[c] + '" customWidth="1"/>'; }).join('');
    var pane = '';
    if (sh.freeze) { var fr = sh.freeze[0], fc = sh.freeze[1], tl = ref(fr, fc), p = fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight'; pane = '<pane' + (fc ? ' xSplit="' + fc + '"' : '') + (fr ? ' ySplit="' + fr + '"' : '') + ' topLeftCell="' + tl + '" activePane="' + p + '" state="frozen"/><selection pane="' + p + '" activeCell="' + tl + '" sqref="' + tl + '"/>'; }
    sh.cf.forEach(function (x, i) { cf += '<conditionalFormatting sqref="' + x.sqref + '"><cfRule type="expression" dxfId="' + st.dxf(x.style) + '" priority="' + (i + 1) + '"><formula>' + xmlEsc(x.formula) + '</formula></cfRule></conditionalFormatting>'; });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      (sh.tab ? '<sheetPr><tabColor rgb="FF' + sh.tab + '"/></sheetPr>' : '') +
      '<dimension ref="A1:' + ref(sh.maxR, sh.maxC) + '"/><sheetViews><sheetView workbookViewId="0" zoomScale="85" zoomScaleNormal="85">' + pane + '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' + (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + rows.join('') + '</sheetData>' +
      (sh.filter ? '<autoFilter ref="' + sh.filter + '"/>' : '') + (sh.merges.length ? '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' : '') + cf +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  }

  function workbookFiles(sheets) {
    var st = new Styles(), files = [], enc = new TextEncoder();
    var sx = sheets.map(function (sh) { return sheetXml(sh, st); }); // styles first: sheet XML registers them
    var names = sheets.map(function (sh) { return sh.name; });
    var defs = []; sheets.forEach(function (sh, i) { if (sh.filter) defs.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + sh.name.replace(/'/g, "''") + '\'!' + sh.filter.split(':').map(function (p) { return p.replace(/([A-Z]+)(\d+)/, '$$$1$$$2'); }).join(':') + '</definedName>'); });
    files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + names.map(function (n, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>']);
    files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>']);
    files.push(['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>PPIC Decision Support System</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + 'Z</dcterms:created></cp:coreProperties>']);
    files.push(['docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PPIC Decision Support System</Application></Properties>']);
    files.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' + names.map(function (n, i) { return '<sheet name="' + xmlEsc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' + (defs.length ? '<definedNames>' + defs.join('') + '</definedNames>' : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>']);
    files.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map(function (n, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (names.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>']);
    sx.forEach(function (x, i) { files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', x]); });
    files.push(['xl/styles.xml', st.xml()]);
    return files.map(function (f) { return [f[0], enc.encode(f[1])]; });
  }

  // zip (deflate through CompressionStream when the browser has it, otherwise stored)
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function deflate(b) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try { return new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer().then(function (a) { return new Uint8Array(a); }, function () { return null; }); } catch (e) { return Promise.resolve(null); }
  }
  function zip(files) {
    return Promise.all(files.map(function (f) { return deflate(f[1]); })).then(function (zs) {
      var parts = [], central = [], off = 0, enc = new TextEncoder();
      var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; }, u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
      files.forEach(function (f, i) {
        var name = enc.encode(f[0]), raw = f[1], z = zs[i] && zs[i].length < raw.length ? zs[i] : null, data = z || raw, crc = crc32(raw), m = z ? 8 : 0;
        var head = [].concat(u16(20), u16(0x0800), u16(m), u16(0), u16(0x21), u32(crc), u32(data.length), u32(raw.length), u16(name.length), u16(0));
        parts.push(new Uint8Array([0x50, 0x4b, 0x03, 0x04].concat(head)), name, data);
        central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02].concat(u16(20), head, u16(0), u16(0), u16(0), u32(0), u32(off))), name);
        off += 30 + name.length + data.length;
      });
      var cl = central.reduce(function (a, b) { return a + b.length; }, 0);
      return new Blob(parts.concat(central, [new Uint8Array([0x50, 0x4b, 0x05, 0x06].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(cl), u32(off), u16(0)))]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    });
  }

  // ---------- the planner's layout ----------
  var BD = 'all', HEAD = { fill: '808080', color: 'FFFFFF', border: BD, h: 'center', wrap: true, sz: 12 }, HEAD2 = { fill: 'BFBFBF', border: BD, h: 'center', sz: 12 };
  var NF0 = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)', NF1 = '_(* #,##0.0_);_(* \\(#,##0.0\\);_(* "-"??_);_(@_)', NFBAL = '#,##0_ ;[Red]\\-#,##0\\ ', NFGAP = '#,##0.0;[Red]-#,##0.0';
  var NAVY = '002060', MON = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'], MON3 = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function matVal(m) { var s = String(m == null ? '' : m).trim(); return /^\d{1,15}$/.test(s) ? Number(s) : s; }
  function sum(a) { return a.reduce(function (x, y) { return x + (num(y) || 0); }, 0); }
  function r1(v) { return Math.round(v * 1000) / 1000; }
  function qs(name) { return "'" + name.replace(/'/g, "''") + "'"; }

  function build(data) {
    var mill = data.mill || 'TUB', P = data.period, mo = +P.slice(5, 7), monthName = MON[mo], days = data.days || [], sheets = [];
    var unpl = function (l) { return !l.mach || l.mach.charAt(0) === '(' ? 1 : 0; };
    var lines = (data.lines || []).slice().sort(function (a, b) { return unpl(a) - unpl(b) || (a.mach < b.mach ? -1 : a.mach > b.mach ? 1 : 0) || (a.first || 0) - (b.first || 0); });
    var skus = data.skus || [], acts = data.actuals || [], machines = data.machines || [];
    var actByMat = {}, actByMach = {}; acts.forEach(function (a) { var k = String(a.mat); actByMat[k] = (actByMat[k] || 0) + a.ct; actByMach[a.mach] = (actByMach[a.mach] || 0) + (a.net ? a.ct * a.net / 1000 : 0); });
    var mainName = data.summarySheet || mill;
    var machOf = {}; lines.forEach(function (l) { if (!l.mach || l.mach.charAt(0) === '(' || !Object.keys(l.plan || {}).length) return; var k = String(l.mat), a = machOf[k] = machOf[k] || []; if (a.indexOf(l.mach) < 0) a.push(l.mach); });

    // ----- TUB: summary per SKU -----
    var T = new Sheet(mainName); sheets.push(T);
    var tHead = ['Article code', 'Material', 'Description', 'Net Weight', 'Category', 'Machine Category', 'Opening Stok CT', 'Opening Stok MT', 'Splan CT', 'Splan MT', 'PP CT', 'PP MT', 'Buffer Stock CT', 'Buffer Stock MT', 'Actual produksi CT', 'Actual produksi MT', 'Balance', 'Balance MT', 'Nomat karton', 'Stok karton', 'nomat plastik', 'Stok plastik', 'Estimasi', 'Nomat plastik banded', 'Stok plastik banded', 'Estimasi'];
    var tW = [22.8, 10.8, 50, 8, 29, 20.3, 12.8, 11.3, 15.5, 10.3, 15.5, 10.3, 12.8, 15.5, 12.8, 11.3, 12.8, 11.3, 16.5, 11.8, 14.2, 11.7, 11.7, 15, 13.3, 11.7];
    T.width(0, 5); tW.forEach(function (w, i) { T.width(i + 1, w); });
    tHead.forEach(function (h, i) { T.set(3, i + 1, h, HEAD); T.set(4, i + 1, i ? i : 1, { border: BD, h: 'center', sz: 12 }); });
    T.heights[3] = 33;
    var r0 = 5, tot = { open: 0, openT: 0, sp: 0, spT: 0, pp: 0, ppT: 0, buf: 0, bufT: 0, act: 0, actT: 0, bal: 0, balT: 0 };
    var cell = { sz: 12, border: BD }, cNum = { sz: 12, border: BD, nf: NF0 }, cNum1 = { sz: 12, border: BD, nf: NF1 }, cBal = { sz: 12, border: BD, nf: NFBAL };
    skus.forEach(function (s, i) {
      var r = r0 + i, R = r + 1, nw = num(s.net), t = function (v) { return nw && num(v) !== null ? r1(v * nw / 1000) : null; }, act = actByMat[String(s.mat)] || 0;
      T.set(r, 1, s.art ? String(s.art) : '', { sz: 12, border: BD, h: 'left' });
      T.set(r, 2, matVal(s.mat), { sz: 12, border: BD, h: 'center' });
      T.set(r, 3, s.desc || '', { sz: 12, border: BD, h: 'left' });
      T.set(r, 4, nw, { sz: 12, border: BD, nf: '0.000' });
      T.set(r, 5, s.cat || '', cell); T.set(r, 6, (machOf[String(s.mat)] || []).join(' / ') || s.area || '', cell);
      [['open', 7], ['splan', 9], ['pp', 11], ['buf', 13]].forEach(function (p) { var v = num(s[p[0]]); T.set(r, p[1], v, cNum); T.set(r, p[1] + 1, t(v), cNum1, v === null ? null : ref(r, p[1]) + '*$E' + R + '/1000'); });
      T.set(r, 15, act, cNum, 'SUMIF(Hasil!$E:$E,$C' + R + ',Hasil!$I:$I)');
      T.set(r, 16, nw ? r1(act * nw / 1000) : 0, cNum1, 'P' + R + '*$E' + R + '/1000');
      var bal = (num(s.pp) || 0) - act; T.set(r, 17, bal, cBal, 'L' + R + '-P' + R); T.set(r, 18, nw ? r1(bal * nw / 1000) : 0, { sz: 12, border: BD, nf: '#,##0.0_ ;[Red]\\-#,##0.0\\ ' }, 'R' + R + '*$E' + R + '/1000');
      for (var c = 19; c <= 26; c++) T.set(r, c, null, cell);
      tot.open += num(s.open) || 0; tot.openT += t(s.open) || 0; tot.sp += num(s.splan) || 0; tot.spT += t(s.splan) || 0; tot.pp += num(s.pp) || 0; tot.ppT += t(s.pp) || 0; tot.buf += num(s.buf) || 0; tot.bufT += t(s.buf) || 0; tot.act += act; tot.actT += nw ? act * nw / 1000 : 0; tot.bal += bal; tot.balT += nw ? bal * nw / 1000 : 0;
    });
    var rLast = r0 + Math.max(skus.length, 1) - 1, rT = rLast + 2, rng = function (c) { return colName(c) + (r0 + 1) + ':' + colName(c) + (rLast + 1); };
    [['open', 7], ['openT', 8], ['sp', 9], ['spT', 10], ['pp', 11], ['ppT', 12], ['buf', 13], ['bufT', 14], ['act', 15], ['actT', 16], ['bal', 17], ['balT', 18]].forEach(function (p) { T.set(rT, p[1], r1(tot[p[0]]), { sz: 12, b: true, nf: p[1] % 2 ? NF0 : NF1, border: 'top' }, 'SUM(' + rng(p[1]) + ')'); });
    T.set(rT, 6, 'Total', { sz: 12, b: true, h: 'right', border: 'top' });
    // header block, rows 1-3 like the planner's
    var monLbl = MON3[mo];
    T.set(0, 7, 'Actual', { sz: 12, h: 'center', b: true }); T.set(0, 8, 'Balance', { sz: 12, h: 'center', b: true }); T.set(0, 9, 'Hari kerja', { sz: 12, h: 'center', b: true }); T.set(0, 10, 'Target per hari', { sz: 12, h: 'center', b: true });
    T.set(1, 1, data.title || 'Summary Planning', { sz: 12, b: true, h: 'left' });
    T.set(2, 1, { date: P + '-01' }, { sz: 12, b: true, h: 'left', nf: 'mmm-yy' });
    var wd = num(data.workDays) || 0, sumL = { sz: 12 }, sumN = { sz: 12, nf: '#,##0.0' };
    T.set(1, 5, 'Target All ' + monLbl + ' (MT)', sumL); T.set(1, 6, r1(tot.ppT), sumN, 'M' + (rT + 1)); T.set(1, 7, r1(tot.actT), sumN, 'Q' + (rT + 1)); T.set(1, 8, r1(tot.ppT - tot.actT), sumN, 'G2-H2'); T.set(1, 9, wd, { sz: 12 }); T.set(1, 10, wd ? r1((tot.ppT - tot.actT) / wd) : 0, sumN, 'IFERROR(I2/J2,0)');
    T.set(2, 5, 'Target Fc ' + monLbl + ' (MT)', sumL); T.set(2, 6, r1(tot.spT), sumN, 'K' + (rT + 1)); T.set(2, 7, r1(tot.actT), sumN, 'Q' + (rT + 1)); T.set(2, 8, r1(tot.spT - tot.actT), sumN, 'G3-H3'); T.set(2, 9, wd, { sz: 12 }); T.set(2, 10, wd ? r1((tot.spT - tot.actT) / wd) : 0, sumN, 'IFERROR(I3/J3,0)');
    T.freeze = [5, 4]; T.filter = 'B5:AA' + (rLast + 1);

    // ----- Hasil: actual production, one row per day x machine x SKU (TUB!P and Machine!I sum from it) -----
    var Hs = new Sheet('Hasil'); sheets.push(Hs);
    ['', 'Tanggal', 'Shift', 'Mesin', 'Material', 'Deskripsi', 'Kategori', 'Net Weight', 'Hasil CT', 'Hasil MT'].forEach(function (h, i) { if (i) Hs.set(0, i, h, HEAD); });
    [3, 12, 7, 14, 12, 46, 22, 10, 11, 10].forEach(function (w, i) { Hs.width(i, w); });
    acts.slice().sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : a.mach < b.mach ? -1 : 1; }).forEach(function (a, i) {
      var r = i + 1; Hs.set(r, 1, { date: a.iso }, { border: BD, nf: 'dd/mm/yyyy', h: 'center' }); Hs.set(r, 2, null, { border: BD }); Hs.set(r, 3, a.mach || '', { border: BD }); Hs.set(r, 4, matVal(a.mat), { border: BD, h: 'center' }); Hs.set(r, 5, a.desc || '', { border: BD }); Hs.set(r, 6, a.cat || '', { border: BD });
      Hs.set(r, 7, num(a.net), { border: BD, nf: '0.000' }); Hs.set(r, 8, a.ct, { border: BD, nf: NF0 }); Hs.set(r, 9, a.net ? r1(a.ct * a.net / 1000) : 0, { border: BD, nf: '0.000' }, 'I' + (r + 1) + '*H' + (r + 1) + '/1000');
    });
    if (!acts.length) Hs.set(1, 1, data.noActual || 'Belum ada aktual produksi untuk bulan ini.', { i: true, color: '7F7F7F' });
    Hs.freeze = [1, 0]; if (acts.length) Hs.filter = 'B1:J' + (acts.length + 1);

    // ----- SKU: daily plan, one row per machine x SKU -----
    var K = new Sheet('SKU'), D0 = 12; // day columns start at M
    var weekOf = function (iso) { if (iso.slice(0, 7) !== P) return iso < P ? 0 : 5; return Math.min(5, Math.ceil(+iso.slice(8, 10) / 7)); };
    var kHead = ['Machine', 'Nomat', 'Net ', 'Category', 'Description', 'Target/Day (CT)', 'PP', 'MT', 'CT', 'JR', 'Man power'];
    var kW = [3.8, 16.3, 14.5, 9, 23.7, 46, 14, 10.7, 11.2, 10.5, 22, 11.2];
    kW.forEach(function (w, i) { K.width(i, w); });
    kHead.forEach(function (h, i) { K.set(1, i + 1, h, HEAD2); });
    K.set(0, 1, data.title2 || (monthName + ' ' + P.slice(0, 4)), { sz: 12, b: true, h: 'center' }); K.merge(0, 1, 0, 2);
    days.forEach(function (d, j) { var c = D0 + j; K.width(c, 8.7); K.set(1, c, { date: d.iso }, d.off ? { fill: 'FF0000', color: 'FFFFFF', border: BD, h: 'center', nf: 'd', sz: 12 } : { fill: 'BFBFBF', border: BD, h: 'center', nf: 'd', sz: 12 }); });
    var dEnd = D0 + Math.max(days.length, 1) - 1;
    K.set(0, D0, monthName, { fill: 'BFBFBF', h: 'center', sz: 12, border: 'top' }); for (var c0 = D0 + 1; c0 <= dEnd; c0++) K.set(0, c0, null, { fill: 'BFBFBF', border: 'top' }); if (dEnd > D0) K.merge(0, D0, 0, dEnd);
    var dayTot = days.map(function () { return 0; }), kMT = 0, kCT = 0, plan = { mt: {}, wk: {}, fc: {} };
    lines.forEach(function (l, i) {
      var r = 2 + i, R = r + 1, nw = num(l.net), ct = 0, mid = { sz: 12, border: BD, h: 'center' };
      K.set(r, 1, l.mach || '', mid); K.set(r, 2, matVal(l.mat), mid); K.set(r, 3, nw, { sz: 12, border: BD, h: 'center', nf: NF1.replace(/0\.0/g, '0.000') });
      K.set(r, 4, l.cat || '', mid); K.set(r, 5, l.desc || '', { sz: 12, border: BD }); K.set(r, 6, num(l.target) !== null ? Math.round(l.target) : null, { sz: 12, border: BD, h: 'center', nf: '0' }); K.set(r, 7, num(l.pp), { sz: 12, border: BD, h: 'center', nf: '#,##0' });
      days.forEach(function (d, j) { var v = l.plan[d.iso]; v = num(v) && v ? v : null; K.set(r, D0 + j, v, { sz: 12, border: BD, h: 'center', nf: '#,##0' }); if (v) { ct += v; dayTot[j] += v; if (nw) { var w = weekOf(d.iso), mk = l.mach || ''; plan.wk[mk] = plan.wk[mk] || [0, 0, 0, 0, 0, 0]; plan.wk[mk][w] += v * nw / 1000; } } });
      var mt = nw ? ct * nw / 1000 : 0; kMT += mt; kCT += ct; plan.mt[l.mach || ''] = (plan.mt[l.mach || ''] || 0) + mt; if (num(l.fcT)) plan.fc[l.mach || ''] = (plan.fc[l.mach || ''] || 0) + l.fcT;
      K.set(r, 8, r1(mt), { sz: 12, border: BD, h: 'center', nf: '#,##0.0' }, 'J' + R + '*D' + R + '/1000');
      K.set(r, 9, ct, { sz: 12, border: BD, h: 'center', nf: '#,##0' }, days.length ? 'SUM(' + colName(D0) + R + ':' + colName(dEnd) + R + ')' : null);
      K.set(r, 10, l.jr || '', { sz: 12, border: BD }); K.set(r, 11, null, { sz: 12, border: BD });
    });
    var kLast = 2 + Math.max(lines.length, 1) - 1, kT = kLast + 2;
    K.set(kT, 5, 'Total', { sz: 12, b: true, h: 'right' });
    K.set(kT, 8, r1(kMT), { sz: 12, b: true, h: 'center', nf: '#,##0.0' }, 'SUM(I3:I' + (kLast + 1) + ')'); K.set(kT, 9, kCT, { sz: 12, b: true, h: 'center', nf: '#,##0' }, 'SUM(J3:J' + (kLast + 1) + ')');
    days.forEach(function (d, j) { var cl = colName(D0 + j); K.set(kT, D0 + j, dayTot[j] || 0, { sz: 11, b: true, h: 'center', nf: '#,##0;-#,##0;-' }, 'SUM(' + cl + '3:' + cl + (kLast + 1) + ')'); });
    K.freeze = [2, D0]; K.filter = 'B2:' + colName(dEnd) + (kLast + 1);
    
    // ----- Machine: per machine, grouped by area with subtotals, weeks W1-W5 -----
    var M = new Sheet('Machine'); sheets.push(M);
    var mf = { font: 'Calibri', sz: 10, color: NAVY, border: BD }, mh = { fill: '808080', color: 'FFFFFF', border: BD, h: 'center', v: 'center', wrap: true, sz: 11 }, sub = { font: 'Calibri', sz: 10, color: NAVY, border: BD, fill: 'A6A6A6' };
    [6.2, 6.5, 12, 32.8, 12.5, 12.5, 12.5, 12.5, 10, 9, 26.5, 2, 2, 2].forEach(function (w, i) { M.width(i, w); });
    var hasW5 = days.some(function (d) { return weekOf(d.iso) === 5; }), WK = hasW5 ? 5 : 4, W0 = 14;
    M.set(1, 1, 'Mill', mh); M.set(1, 2, monthName, mh); M.set(1, 3, null, mh); M.set(1, 4, null, mh); M.merge(1, 2, 1, 4);
    M.set(1, 5, 'Forecast (MT)', mh); M.set(1, 6, 'Planning (MT)', mh); M.set(1, 7, 'GAP (MT)', mh); M.set(1, 8, 'Realisasi', mh); M.set(1, 9, null, mh); M.set(1, 10, 'REMARKS', mh);
    M.set(2, 1, null, mh); M.set(2, 2, null, mh); M.set(2, 3, null, mh); M.set(2, 4, null, mh); M.set(2, 8, null, mh); M.set(2, 9, null, mh);
    M.set(3, 1, null, mh); M.set(3, 2, 'Machine', mh); M.set(3, 3, 'Name', mh); M.set(3, 4, 'Capacity (MT)', mh); M.set(3, 8, 'TOTAL (MT)', mh); M.set(3, 9, '%', mh);
    [5, 6, 7, 10].forEach(function (c) { M.set(2, c, null, mh); M.set(3, c, null, mh); M.merge(1, c, 3, c); }); M.merge(1, 8, 2, 9);
    for (var w = 1; w <= WK; w++) { var c1 = W0 + (w - 1) * 2; M.width(c1, 8); M.width(c1 + 1, 8); M.set(1, c1, 'W' + w, { fill: '808080', color: 'FFFFFF', b: true, border: BD, h: 'center', sz: 10 }); M.set(1, c1 + 1, null, { fill: '808080', border: BD }); M.merge(1, c1, 1, c1 + 1); M.set(2, c1, 'Plan', { fill: 'FF0000', color: 'FFFFFF', border: BD, h: 'center', sz: 10 }); M.set(2, c1 + 1, 'Actual', { fill: 'FF0000', color: 'FFFFFF', border: BD, h: 'center', sz: 10 }); M.set(3, c1, 'MT', { fill: 'FF0000', color: 'FFFFFF', border: BD, h: 'center', sz: 10 }); M.set(3, c1 + 1, 'MT', { fill: 'FF0000', color: 'FFFFFF', border: BD, h: 'center', sz: 10 }); }
    var WR = W0 + WK * 2; M.width(WR, 14); M.set(1, WR, 'Remarks', mh); M.set(2, WR, null, mh); M.set(3, WR, null, mh); M.merge(1, WR, 3, WR);
    M.heights[3] = 18;
    var actWk = {}; acts.forEach(function (a) { if (!a.net) return; var w = weekOf(a.iso); (actWk[a.mach] = actWk[a.mach] || [0, 0, 0, 0, 0, 0])[w] += a.ct * a.net / 1000; });
    var areas = [], byArea = {}; machines.forEach(function (m) { if (!byArea[m.area]) { byArea[m.area] = []; areas.push(m.area); } byArea[m.area].push(m); });
    var mr = 4, subRows = [], gt = { cap: 0, fc: 0, pl: 0, ac: 0, wp: [0, 0, 0, 0, 0, 0], wa: [0, 0, 0, 0, 0, 0] }, fnum = function (s, nf) { var o = {}; for (var k in s) o[k] = s[k]; o.nf = nf; return o; };
    areas.forEach(function (ar) {
      var first = mr, st2 = { cap: 0, fc: 0, pl: 0, ac: 0, wp: [0, 0, 0, 0, 0, 0], wa: [0, 0, 0, 0, 0, 0] };
      byArea[ar].forEach(function (m) {
        var R = mr + 1, pl = plan.mt[m.code] || 0, ac = actByMach[m.code] || 0, fc = num(m.fc) !== null ? m.fc : plan.fc[m.code] !== undefined ? plan.fc[m.code] : null, cap = num(m.cap) || 0;
        M.set(mr, 1, mill, fnum(mf, 'General')); M.set(mr, 2, m.code, mf); M.set(mr, 3, m.name || ar, mf); M.set(mr, 4, r1(cap), fnum(mf, NF1));
        M.set(mr, 5, fc === null ? null : r1(fc), fnum(mf, NF1)); M.set(mr, 6, r1(pl), fnum(mf, NF1), 'SUMIF(SKU!$B:$B,$C' + R + ',SKU!$I:$I)'); M.set(mr, 7, r1(cap - pl), fnum(mf, NFGAP), 'E' + R + '-G' + R);
        M.set(mr, 8, r1(ac), fnum(mf, NF1), 'SUMIF(Hasil!$D:$D,$C' + R + ',Hasil!$J:$J)'); M.set(mr, 9, pl ? ac / pl : 0, fnum(mf, '0.0%'), 'IFERROR(I' + R + '/G' + R + ',0)');
        var rem = [m.rem || '', pl > cap + 1e-6 && cap > 0 ? 'Lewat kapasitas' : ''].filter(Boolean).join(' · '); M.set(mr, 10, rem, { font: 'Calibri', sz: 10, color: 'FF0000', border: BD });
        var wp = plan.wk[m.code] || [0, 0, 0, 0, 0, 0], wa = actWk[m.code] || [0, 0, 0, 0, 0, 0];
        for (var w = 1; w <= WK; w++) { var c1 = W0 + (w - 1) * 2, pv = wp[w] + (w === 1 ? wp[0] : 0); M.set(mr, c1, pv ? r1(pv) : null, fnum(mf, NF1)); M.set(mr, c1 + 1, wa[w] ? r1(wa[w]) : null, fnum(mf, NF1)); st2.wp[w] += pv; st2.wa[w] += wa[w]; }
        M.set(mr, WR, wp[5] && !hasW5 ? 'W5: ' + r1(wp[5]) + ' MT' : '', mf);
        st2.cap += cap; st2.fc += fc || 0; st2.pl += pl; st2.ac += ac; mr++;
      });
      var R1 = first + 1, R2 = mr, S = function (c) { return 'SUM(' + colName(c) + R1 + ':' + colName(c) + R2 + ')'; };
      M.set(mr, 1, null, sub); M.set(mr, 2, null, sub); M.set(mr, 3, ar, fnum(sub, 'General'));
      M.set(mr, 4, r1(st2.cap), fnum(sub, NF1), S(4)); M.set(mr, 5, r1(st2.fc), fnum(sub, NF1), S(5)); M.set(mr, 6, r1(st2.pl), fnum(sub, NF1), S(6)); M.set(mr, 7, r1(st2.cap - st2.pl), fnum(sub, NFGAP), S(7)); M.set(mr, 8, r1(st2.ac), fnum(sub, NF1), S(8)); M.set(mr, 9, st2.pl ? st2.ac / st2.pl : 0, fnum(sub, '0.0%'), 'IFERROR(I' + (mr + 1) + '/G' + (mr + 1) + ',0)'); M.set(mr, 10, null, sub);
      for (var w = 1; w <= WK; w++) { var c1 = W0 + (w - 1) * 2; M.set(mr, c1, r1(st2.wp[w]), fnum(sub, NF1), S(c1)); M.set(mr, c1 + 1, r1(st2.wa[w]), fnum(sub, NF1), S(c1 + 1)); gt.wp[w] += st2.wp[w]; gt.wa[w] += st2.wa[w]; }
      M.set(mr, WR, null, sub);
      subRows.push(mr + 1); gt.cap += st2.cap; gt.fc += st2.fc; gt.pl += st2.pl; gt.ac += st2.ac; mr++;
    });
    var tot2 = { font: 'Calibri', sz: 11, b: true, color: 'FF0000', border: BD, fill: 'A6A6A6' }, G = function (c) { return subRows.length ? subRows.map(function (x) { return colName(c) + x; }).join('+') : '0'; };
    M.set(mr, 1, 'Total', fnum(tot2, 'General')); M.set(mr, 2, null, tot2); M.set(mr, 3, mill, fnum(tot2, 'General'));
    M.set(mr, 4, r1(gt.cap), fnum(tot2, NF1), G(4)); M.set(mr, 5, r1(gt.fc), fnum(tot2, NF1), G(5)); M.set(mr, 6, r1(gt.pl), fnum(tot2, NF1), G(6)); M.set(mr, 7, r1(gt.cap - gt.pl), fnum(tot2, NFGAP), G(7)); M.set(mr, 8, r1(gt.ac), fnum(tot2, NF1), G(8)); M.set(mr, 9, gt.pl ? gt.ac / gt.pl : 0, fnum(tot2, '0.0%'), 'IFERROR(I' + (mr + 1) + '/G' + (mr + 1) + ',0)'); M.set(mr, 10, null, tot2);
    for (var w2 = 1; w2 <= WK; w2++) { var c2 = W0 + (w2 - 1) * 2; M.set(mr, c2, r1(gt.wp[w2]), fnum(tot2, NF1), G(c2)); M.set(mr, c2 + 1, r1(gt.wa[w2]), fnum(tot2, NF1), G(c2 + 1)); }
    M.set(mr, WR, null, tot2);
    var unk = Object.keys(plan.mt).filter(function (k) { return !machines.some(function (m) { return m.code === k; }) && plan.mt[k] > 0; });
    if (unk.length) M.set(mr + 2, 1, 'Catatan: ' + unk.length + ' baris SKU memakai mesin di luar daftar mesin (' + unk.join(', ') + '); ton-nya ada di lembar SKU dan MT.', { sz: 10, color: 'FF0000' });
    M.freeze = [4, 4]; M.filter = 'B4:K' + mr;
    var wkNote = 'W1 = tgl 1-7, W2 = 8-14, W3 = 15-21, W4 = 22-28' + (hasW5 ? ', W5 = 29 s/d akhir bulan (dan hari sesudahnya)' : '') + '.';
    M.set(mr + (unk.length ? 3 : 2), 1, wkNote, { sz: 10, i: true, color: '7F7F7F' });

    // ----- JR -----
    var J = new Sheet('JR'); sheets.push(J); J.width(1, 40); J.width(2, 12);
    J.set(2, 1, 'JR', { b: true, fill: 'DDEBF7', border: 'bottom' }); J.set(2, 2, '  MT', { b: true, fill: 'DDEBF7', border: 'bottom' });
    var jr = {}, jrOrder = []; lines.forEach(function (l) { var k = l.jr || '(jenis JR belum dicatat)'; if (jr[k] === undefined) { jr[k] = 0; jrOrder.push(k); } jr[k] += l.net ? sum(Object.keys(l.plan).map(function (d) { return l.plan[d]; })) * l.net / 1000 : 0; });
    jrOrder.forEach(function (k, i) { J.set(3 + i, 1, k); J.set(3 + i, 2, r1(jr[k]), { nf: '#,##0.0' }, l2f(k)); });
    function l2f(k) { return k.charAt(0) === '(' ? null : 'SUMIF(SKU!$K:$K,B' + (4 + jrOrder.indexOf(k)) + ',SKU!$I:$I)'; }
    var jT = 3 + jrOrder.length; J.set(jT, 1, 'Grand Total', { b: true, fill: 'DDEBF7', border: 'top' }); J.set(jT, 2, r1(kMT), { b: true, fill: 'DDEBF7', border: 'top', nf: '#,##0.0' }, jrOrder.length ? 'SUM(C4:C' + jT + ')' : null);
    if (data.jrNote) J.set(jT + 2, 1, data.jrNote, { i: true, color: '7F7F7F', sz: 10 });

    // ----- MT: tons per machine -----
    var MT = new Sheet('MT'); sheets.push(MT); MT.width(0, 16); MT.width(1, 12);
    MT.set(2, 0, 'Row Labels', { b: true, fill: 'DDEBF7', border: 'bottom' }); MT.set(2, 1, 'Sum of MT', { b: true, fill: 'DDEBF7', border: 'bottom' });
    var mts = Object.keys(plan.mt).filter(function (k) { return plan.mt[k] > 0 || machines.some(function (m) { return m.code === k; }); }).sort(); mts.forEach(function (k, i) { MT.set(3 + i, 0, k); MT.set(3 + i, 1, r1(plan.mt[k]), { nf: '#,##0.0' }, 'SUMIF(SKU!$B:$B,A' + (4 + i) + ',SKU!$I:$I)'); });
    var mtT = 3 + mts.length; MT.set(mtT, 0, 'Grand Total', { b: true, fill: 'DDEBF7', border: 'top' }); MT.set(mtT, 1, r1(kMT), { b: true, fill: 'DDEBF7', border: 'top', nf: '#,##0.0' }, mts.length ? 'SUM(B4:B' + mtT + ')' : null);

    sheets.push(K); // SKU after MT, like the planner's file

    // ----- Capacity -----
    var C = new Sheet('Capacity'); sheets.push(C); [2, 12, 18, 20, 14, 30].forEach(function (w, i) { C.width(i, w); });
    ['Machine', 'Machine', 'Average of Capacity (MT/bulan)', 'Capacity/day (MT)', 'Category'].forEach(function (h, i) { C.set(1, i + 1, h, { b: true, border: 'bottom', fill: 'DDEBF7', wrap: true }); });
    machines.forEach(function (m, i) { C.set(2 + i, 1, m.code); C.set(2 + i, 2, mill + '_' + m.code); C.set(2 + i, 3, r1(num(m.cap) || 0), { nf: '#,##0.0' }); C.set(2 + i, 4, num(m.capDay) !== null ? r1(m.capDay) : null, { nf: '#,##0.00' }); C.set(2 + i, 5, m.area || ''); });
    C.filter = 'B2:F' + (2 + machines.length);

    // ----- BOM -----
    var B = new Sheet('BOM'); sheets.push(B); [2, 12, 12, 44, 12, 12, 12].forEach(function (w, i) { B.width(i, w); });
    ['Material', 'Nomat', 'Deskripsi', 'Karton (pcs/CT)', 'Plastik (kg/CT)', 'JR (kg/CT)'].forEach(function (h, i) { B.set(1, i + 1, h, { b: true, border: 'bottom', fill: 'DDEBF7', wrap: true }); });
    (data.bom || []).forEach(function (b, i) { B.set(2 + i, 1, matVal(b.mat)); B.set(2 + i, 2, b.nomat ? matVal(b.nomat) : null); B.set(2 + i, 3, b.desc || ''); B.set(2 + i, 4, num(b.ct), { nf: '#,##0.###' }); B.set(2 + i, 5, num(b.pl), { nf: '#,##0.###' }); B.set(2 + i, 6, num(b.jr), { nf: '#,##0.###' }); });
    if (!(data.bom || []).length) B.set(2, 1, data.bomNote || 'BOM belum diisi di Material master.', { i: true, color: '7F7F7F' });

    // ----- Info -----
    var I = new Sheet('Info'); sheets.push(I); I.width(0, 26); I.width(1, 100); I.tab = 'BFBFBF';
    I.set(0, 0, 'Rencana produksi ' + monthName + ' ' + P.slice(0, 4), { b: true, sz: 13 });
    (data.info || []).forEach(function (x, i) { I.set(2 + i, 0, x[0], { b: true }); I.set(2 + i, 1, x[1] == null ? '' : String(x[1]), { wrap: true }); });
    var ir = 3 + (data.info || []).length;
    I.set(ir, 0, 'Lembar', { b: true }); I.set(ir, 1, 'Seperti file TUB Planning planner: ' + mainName + ' (ringkasan per SKU), Hasil (aktual), Machine (per mesin, subtotal per area, W1-W' + WK + '), JR, MT (ton per mesin), SKU (rencana harian), Capacity, BOM.', { wrap: true });
    (data.missing || []).forEach(function (t, i) { I.set(ir + 1 + i, 0, i ? '' : 'Kolom yang kosong', { b: true }); I.set(ir + 1 + i, 1, t, { wrap: true }); });
    (data.extraSheets || []).forEach(function (x) { var s = new Sheet(x.name); sheets.push(s); x.aoa.forEach(function (row, r) { row.forEach(function (v, c) { if (v !== null && v !== undefined && v !== '') s.set(r, c, v, r === 0 ? { b: true, fill: 'DDEBF7' } : null); }); }); if (x.freeze) s.freeze = x.freeze; });

    return zip(workbookFiles(sheets));
  }

  function download(data, name) {
    return build(data).then(function (blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return blob; });
  }
  window.RencanaExcel = { build: build, download: download, MON: MON };
})();
