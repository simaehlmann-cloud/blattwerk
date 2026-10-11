/* Blattwerk – Ablauftest im echten Browser (Chromium über Playwright).
 *
 *   npm ci && npx playwright install chromium
 *   node smoketest.js
 *
 * Spielt die Bedienwege einer Lehrkraft durch und prüft jedes exportierte
 * PDF von außen: mit pdf-lib (Formularfelder), mit pdf.js (Text), mit
 * pdftoppm (ist die Schrift wirklich sichtbar, stimmen Farben und Lage?)
 * und mit jsQR (lässt sich der QR-Code lesen?). Gerade das gerenderte Bild
 * ist wichtig: Ein Fehler beim Einbetten der Schrift lässt Text im PDF
 * durchsuchbar, aber unsichtbar.
 *
 * Optional, wenn vorhanden: pdftoppm (poppler-utils) und qpdf.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts, degrees, PDFName } = require('pdf-lib');
const jsQR = require('jsqr');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'test', 'ausgabe');
fs.mkdirSync(OUT, { recursive: true });
const have = cmd => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
const HAVE_PDFTOPPM = have('pdftoppm'), HAVE_QPDF = have('qpdf');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, info) {
  if (cond) { pass++; results.push('  ✓ ' + name); }
  else { fail++; results.push('  ✗ ' + name + (info !== undefined ? '  [' + info + ']' : '')); }
}
const section = t => results.push('\n' + t);

/* ---------- kleiner Webserver für das Repo ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.css': 'text/css' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      if (p === '/cordova.js') { rsp.writeHead(200, { 'Content-Type': 'text/javascript' }); rsp.end('/* im Browser leer */'); return; }
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

/* ---------- PDF-Prüfung von außen ---------- */
let pdfjsNode = null;
async function pdfText(bytes) {
  if (!pdfjsNode) {
    /* pdf.js meldet beim Laden in Node, dass es ohne "canvas" nicht rendern
       kann. Wir lesen hier nur Text; die Warnung wird deshalb ausgeblendet. */
    const warn = console.log; console.log = () => {};
    try { pdfjsNode = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = warn; }
  }
  const doc = await pdfjsNode.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) { const tc = await (await doc.getPage(i)).getTextContent(); pages.push(tc.items.map(t => t.str).join(' ').replace(/\s+/g, ' ')); }
  await doc.destroy();
  return pages;
}
/* Seite als Rasterbild (pdftoppm), Koordinaten in pt von oben links */
function raster(file, pageNo, res = 72, gray = true) {
  const base = path.join(OUT, 'probe');
  execFileSync('pdftoppm', [...(gray ? ['-gray'] : []), '-r', String(res), '-f', String(pageNo), '-l', String(pageNo), file, base]);
  const f = fs.readdirSync(OUT).filter(n => n.startsWith('probe') && /\.p[gp]m$/.test(n)).map(n => path.join(OUT, n))[0];
  const b = fs.readFileSync(f); fs.unlinkSync(f);
  let off = 0; const tok = [];
  while (tok.length < 4) { while (/\s/.test(String.fromCharCode(b[off]))) off++; let s = ''; while (!/\s/.test(String.fromCharCode(b[off]))) s += String.fromCharCode(b[off++]); tok.push(s); }
  off++;
  return { w: +tok[1], h: +tok[2], ch: tok[0] === 'P6' ? 3 : 1, data: b.subarray(off), k: res / 72 };
}
function pixels(file, pageNo, box, test, gray) {
  if (!HAVE_PDFTOPPM) return null;
  const r = raster(file, pageNo, 72, gray);
  let hit = 0, n = 0;
  for (let y = Math.max(0, Math.round(box.y)); y < Math.min(r.h, Math.round(box.y + box.h)); y++) for (let x = Math.max(0, Math.round(box.x)); x < Math.min(r.w, Math.round(box.x + box.w)); x++) {
    n++; const i = (y * r.w + x) * r.ch;
    if (gray ? test(r.data[i]) : test(r.data[i], r.data[i + 1], r.data[i + 2])) hit++;
  }
  return n ? hit / n : 0;
}
const inkRatio = (file, pageNo, box, limit = 128) => pixels(file, pageNo, box, v => v < limit, true);
const redRatio = (file, pageNo, box) => pixels(file, pageNo, box, (r, g, b) => r > 150 && g < 110 && b < 110, false);
function qrRead(file, pageNo, box) {
  if (!HAVE_PDFTOPPM) return null;
  const r = raster(file, pageNo, 200, false), k = r.k, m = 12;
  const x0 = Math.max(0, Math.round((box.x - m) * k)), y0 = Math.max(0, Math.round((box.y - m) * k));
  const w = Math.min(r.w - x0, Math.round((box.w + 2 * m) * k)), h = Math.min(r.h - y0, Math.round((box.h + 2 * m) * k));
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y0 + y) * r.w + x0 + x) * 3, d = (y * w + x) * 4; rgba[d] = r.data[s]; rgba[d + 1] = r.data[s + 1]; rgba[d + 2] = r.data[s + 2]; rgba[d + 3] = 255; }
  const code = jsQR(rgba, w, h);
  return code ? new TextDecoder('utf-8').decode(Uint8Array.from(code.binaryData)) : '';
}
const fieldNamesOf = async file => (await PDFDocument.load(fs.readFileSync(file))).getForm().getFields().map(x => x.getName());

async function fixturePdf() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman), b = await d.embedFont(StandardFonts.HelveticaBold);
  const p1 = d.addPage([595, 842]);
  p1.drawText('Klassenarbeit Nr. 2', { x: 60, y: 770, size: 20, font: b });
  p1.drawText('Aufgabe 1: Berechne den Flaecheninhalt des Dreiecks.', { x: 60, y: 720, size: 12, font: f });
  p1.drawText('Aufgabe 2: Loese die Gleichung 3x + 4 = 19.', { x: 60, y: 690, size: 12, font: f });
  const p2 = d.addPage([595, 842]); p2.setRotation(degrees(90));
  p2.drawText('Gedrehte Seite', { x: 60, y: 500, size: 14, font: f });
  const p3 = d.addPage([842, 595]);
  p3.drawText('Querformat', { x: 60, y: 500, size: 14, font: f });
  const file = path.join(OUT, 'vorlage.pdf');
  fs.writeFileSync(file, await d.save());
  return file;
}

async function main() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/index.html`;
  /* Mit UTF-8-Locale: Sonst ersetzt Chromium Dateinamen mit Umlauten
     (etwa „… - Lösung.pdf“) durch „download“. */
  const browser = await chromium.launch({ env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('Seitenfehler: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('Konsole: ' + m.text()); });
  const S = expr => page.evaluate(`(() => { const S = window.__bw.S, B = window.__bw; return (${expr}); })()`);
  const toastText = () => page.evaluate(() => [...document.querySelectorAll('.tst span')].map(s => s.textContent).join(' | '));
  const sel = () => S('S.objs.find(o => o.id === S.sel)');
  /* Downloads einsammeln: Export ohne Dialog (eine Datei) oder mit Fassungswahl */
  const variantOf = n => / - Lösung\.pdf$/.test(n) ? 'solution' : / - mit Hilfen\.pdf$/.test(n) ? 'help' : 'student';
  async function exportFiles(prefix, want) {
    const got = [], onDl = d => got.push(d);
    page.on('download', onDl);
    await page.click('#btnExport');
    const dlg = await page.waitForSelector('.dlg input[data-v]', { timeout: 1500 }).catch(() => null);
    let n = 1;
    if (dlg) {
      n = 0;
      for (const v of ['student', 'help', 'solution']) {
        const cb = page.locator(`.dlg input[data-v="${v}"]`);
        const on = want.includes(v) && await cb.isEnabled();
        if (await cb.isEnabled()) await cb.setChecked(on);
        if (on) n++;
      }
      await page.click('.dlg [data-r="1"]');
    }
    const t0 = Date.now(); while (got.length < n && Date.now() - t0 < 40000) await page.waitForTimeout(100);
    page.off('download', onDl);
    const files = { dialog: !!dlg };
    if (process.env.BW_DEBUG) console.log(got.map(d => JSON.stringify(d.suggestedFilename())));
    for (const d of got) { const f = path.join(OUT, prefix + '-' + variantOf(d.suggestedFilename()) + '.pdf'); await d.saveAs(f); files[variantOf(d.suggestedFilename())] = f; }
    return files;
  }
  /* Punkt auf einer Seite (pt) -> Bildschirm; scrollt die Stelle in die Mitte */
  async function at(x, y, i = 0) {
    await page.evaluate(([y, i]) => {
      const st = document.getElementById('stage'), pg = document.querySelectorAll('.page')[i];
      const r = pg.getBoundingClientRect(), sr = st.getBoundingClientRect();
      st.scrollTop += r.top + y * window.__bw.S.zoom - (sr.top + sr.height / 2);
    }, [y, i]);
    await page.waitForTimeout(60);
    const b = await page.locator('.page').nth(i).boundingBox(), z = await S('S.zoom');
    return { x: b.x + x * z, y: b.y + y * z };
  }
  async function clickAt(x, y, i = 0, mod) { const p = await at(x, y, i); if (mod) await page.keyboard.down(mod); await page.mouse.click(p.x, p.y); if (mod) await page.keyboard.up(mod); }
  async function dragPt(x1, y1, x2, y2, i = 0) {
    const ym = (y1 + y2) / 2, a = await at(x1, ym, i), z = await S('S.zoom');
    await page.mouse.move(a.x, a.y + (y1 - ym) * z); await page.mouse.down();
    await page.mouse.move(a.x + (x2 - x1) * z, a.y + (y2 - ym) * z, { steps: 8 }); await page.mouse.up();
  }
  const key = async k => { await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await page.keyboard.press(k); };
  const freshSample = async () => { await page.evaluate(() => window.__bw.newSheet(true)); await page.waitForTimeout(150); };

  /* ================================================================ */
  section('1. Start');
  await page.goto(base);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  check('App startet ohne Fehler', errs.length === 0, errs.join(' / '));
  check('Eingebaute Schriften geladen', await page.evaluate(() => document.fonts.check('12px "BW Sans"') && document.fonts.check('12px "BW Math"')));
  check('Vermessung über fontkit (wie im PDF)', await S(`(() => { const w = B.textWidth('Hallo Welt', 'NotoSans-Regular', 10); return w > 40 && w < 60; })()`));
  check('Beispielblatt mit 26 Elementen', (await S('S.objs.length')) === 26, await S('S.objs.length'));
  check('Beispielblatt nutzt Hilfe-Ebene, Lösungen, Punkte, Formel, Tabelle, QR', await S(`['formula','table','points','qr','coord'].every(t => S.objs.some(o => o.type === t)) && S.objs.some(o => o.layer === 'help')`));
  check('Klassenarbeit: Summe 10 Punkte im Panel', /10\s*Punkte/.test(await page.textContent('#panel')));

  /* ================================================================ */
  section('2. Export des Beispielblatts in drei Fassungen');
  let ex = await exportFiles('beispiel', ['student', 'help', 'solution']);
  check('Fassungswahl erscheint, drei Dateien', ex.dialog && ex.student && ex.help && ex.solution, Object.keys(ex).join(','));
  const wantFields = ['Name', 'Datum', 'A1 a', 'A1 b', 'A1 c', 'A1 d', 'Aufgabe 2'].concat([2, 3, 4, 5, 6, 7, 8].map(c => 'Wertetabelle Z2S' + c));
  let names = await fieldNamesOf(ex.student);
  check('Schülerfassung: 14 ausfüllbare Felder inkl. Tabellenzellen', names.length === 14 && wantFields.every(n => names.includes(n)), names.join(','));
  check('Mit Hilfen: ebenfalls ausfüllbar', (await fieldNamesOf(ex.help)).length === 14);
  check('Lösungsblatt: keine Formularfelder', (await fieldNamesOf(ex.solution)).length === 0);
  let tS = (await pdfText(fs.readFileSync(ex.student)))[0], tH = (await pdfText(fs.readFileSync(ex.help)))[0], tL = (await pdfText(fs.readFileSync(ex.solution)))[0];
  check('Schülerfassung: Text, Minuszeichen, ohne Hilfen und Lösungen', tS.includes('Lineare Funktionen') && tS.includes('−x + 2') && !tS.includes('Hilfe: Formel') && !tS.includes('−7') && !tS.includes('2 oder m'), tS.slice(0, 100));
  check('Mit Hilfen: Hilfe-Text enthalten, keine Lösungen', tH.includes('Hilfe: Formel') && !tH.includes('−7'));
  check('Lösungsblatt: Lösungen, Hilfen und Kennzeichnung', tL.includes('2 oder m = 2') && tL.includes('−7') && tL.includes('Hilfe: Formel') && tL.includes('Lösung'), tL.slice(-160));
  if (HAVE_PDFTOPPM) {
    const ink = inkRatio(ex.student, 1, { x: 56, y: 56, w: 380, h: 20 });
    check('Überschrift ist sichtbar (Schrift korrekt eingebettet)', ink > 0.08, ink.toFixed(3));
    const gS = redRatio(ex.student, 1, { x: 74, y: 500, w: 147, h: 181 }), gL = redRatio(ex.solution, 1, { x: 74, y: 500, w: 147, h: 181 });
    check('Funktionsgraph nur im Lösungsblatt (rot)', gS < 0.0005 && gL > 0.004, gS.toFixed(4) + ' / ' + gL.toFixed(4));
    const cL = redRatio(ex.solution, 1, { x: 74, y: 172, w: 11, h: 11 }), cX = redRatio(ex.solution, 1, { x: 298, y: 172, w: 11, h: 11 });
    check('Lösungsblatt: richtige Kästchen rot angekreuzt, falsche leer', cL > 0.05 && cX < 0.01, cL.toFixed(3) + ' / ' + cX.toFixed(3));
    const fm = inkRatio(ex.help, 1, { x: 74, y: 236, w: 90, h: 38 }, 200), fmS = inkRatio(ex.student, 1, { x: 74, y: 236, w: 90, h: 38 }, 200);
    check('Formel (Hilfe) sichtbar im Hilfe-PDF, nicht in der Schülerfassung', fm > 0.03 && fmS < 0.005, fm.toFixed(3) + ' / ' + fmS.toFixed(3));
    const q = qrRead(ex.student, 1, { x: 330, y: 576, w: 80, h: 80 });
    check('QR-Code lesbar und enthält die Lösungen der Seite', /Aufgabe 2: 2 oder m = 2/.test(q) && /✓ y = 2x \+ 2/.test(q) && /Wertetabelle: −7; −5/.test(q) && !/y = 3x − 2/.test(q), JSON.stringify(q).slice(0, 160));
  }
  check('Beispielblatt-PDF unter 1 MB', fs.statSync(ex.student).size < 1e6, fs.statSync(ex.student).size + ' Bytes');

  /* 2b. Jede Schrift und jeder Schnitt muss im PDF sichtbar sein. */
  {
    const probe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz ÄÖÜäöüß 0123456789 .,;:!?()[]{}+-*/=<>%&§€"„“–— αβγδΔπΣ √∞≤≥≠≈∠∈⊂∩∪→⇒ ½ ² ³ · × ÷ ° ±';
    const res = await page.evaluate(async probe => {
      const { S, buildPdf } = window.__bw;
      const keep = S.objs; let y = 20; S.objs = [];
      const T = (x, y, runs, font, size, extra) => Object.assign({ id: 'p' + y + x, page: S.pages[0].id, type: 'text', layer: 'base', x, y, w: 560, h: 40, runs, text: runs.map(r => r.t).join(''), size, font, lh: 1.2, align: 'left', color: '#000000', fill: null }, extra || {});
      for (const font of ['sans', 'serif', 'mono']) for (const [b, i] of [[false, false], [true, false], [false, true], [true, true]]) { S.objs.push(T(20, y, [{ t: probe, b, i }], font, 9)); y += 64; }
      S.objs.push(T(20, 790, [{ t: 'Unterstrichen', u: true }], 'sans', 20, { w: 200 }), T(300, 790, [{ t: 'Unterstrichen' }], 'sans', 20, { w: 200 }));
      S.objs.push(T(20, 768, [{ t: 'Mitte' }], 'sans', 12, { w: 200, align: 'center' }), T(300, 768, [{ t: 'Rechts' }], 'sans', 12, { w: 200, align: 'right' }));
      const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
      try { const a = await buildPdf(); return [toB64(a.bytes), a.replaced]; } finally { S.objs = keep; }
    }, probe);
    const fz = path.join(OUT, 'alle-zeichen.pdf'); fs.writeFileSync(fz, Buffer.from(res[0], 'base64'));
    check('Alle Prüfzeichen sind in den eingebauten Schriften vorhanden', res[1] === 0, res[1] + ' ersetzt');
    if (HAVE_PDFTOPPM) {
      const leer = [];
      for (let i = 0; i < 12; i++) {
        const a = inkRatio(fz, 1, { x: 20, y: 20 + i * 64, w: 540, h: 13 });
        const b = inkRatio(fz, 1, { x: 20, y: 20 + i * 64 + 11, w: 300, h: 13 });
        if (a < 0.04 || b < 0.02) leer.push(i + ':' + a.toFixed(3) + '/' + b.toFixed(3));
      }
      check('Jede Schrift und jeder Schnitt ist im PDF sichtbar (12 Zeilen)', leer.length === 0, leer.join(' '));
      const u1 = inkRatio(fz, 1, { x: 22, y: 811, w: 120, h: 3 }), u0 = inkRatio(fz, 1, { x: 302, y: 811, w: 120, h: 3 });
      check('Unterstreichen erscheint im PDF', u1 > 0.3 && u0 < 0.05, u1.toFixed(2) + ' / ' + u0.toFixed(2));
      const left = inkRatio(fz, 1, { x: 20, y: 768, w: 60, h: 14 }), mid = inkRatio(fz, 1, { x: 95, y: 768, w: 50, h: 14 }), right = inkRatio(fz, 1, { x: 440, y: 768, w: 60, h: 14 });
      check('Ausrichtung Mitte und rechts im PDF', left < 0.01 && mid > 0.05 && right > 0.05, [left, mid, right].map(v => v.toFixed(3)).join(' '));
    }
  }

  /* ================================================================ */
  section('3. Text: Sonderzeichen, Rückgängig, Formatierung je Wort');
  const n0 = await S('S.objs.length');
  await page.keyboard.press('t');
  await clickAt(120, 720);
  await page.keyboard.type('Test π ≤ 5 und √2');
  await clickAt(500, 820);
  check('Text-Werkzeug legt Text an', (await S('S.objs.length')) === n0 + 1 && (await S('S.objs[S.objs.length-1].text')) === 'Test π ≤ 5 und √2', await S('S.objs[S.objs.length-1].text'));
  await page.keyboard.press('Control+z');
  check('Rückgängig entfernt den Text', (await S('S.objs.length')) === n0);
  await page.keyboard.press('Control+Shift+z');
  check('Wiederholen stellt ihn wieder her', (await S('S.objs.length')) === n0 + 1);
  await page.keyboard.press('t');
  await clickAt(300, 790);
  check('Neues Textfeld ist im Bearbeitungsmodus', !!(await S('S.editing')));
  await page.click('#btnUndo');
  check('Leeres Textfeld verwerfen kostet keinen Rückgängig-Schritt', (await S('S.objs.length')) === n0 + 1);
  const tid = await S('S.objs[S.objs.length-1].id');
  {
    const before = await S('S.undo.length');
    await at(120, 720);
    await page.dblclick(`.obj[data-id="${tid}"]`);
    await page.keyboard.press('End'); await page.keyboard.type('!');
    await page.click('#panel button[data-run="b"]');
    await page.click('#panel button[data-run="i"]');
    await page.keyboard.press('Escape');
    const o = await S(`B.find('${tid}')`);
    check('Fett/Kursiv während der Bearbeitung übernommen', o.runs.every(r => r.b && r.i) && o.text.endsWith('!'), JSON.stringify(o.runs));
    check('Tippen und Formatieren ergeben genau einen Rückgängig-Schritt', (await S('S.undo.length')) === before + 1, (await S('S.undo.length')) - before + ' Schritte');
    await page.keyboard.press('Control+z');
    const u = await S(`B.find('${tid}')`);
    check('Rückgängig stellt Text und Format zusammen zurück', u.runs.every(r => !r.b && !r.i) && !u.text.endsWith('!'));
  }
  {
    await at(120, 720);
    await page.dblclick(`.obj[data-id="${tid}"]`);
    await page.evaluate(id => {
      const t = document.querySelector(`.obj[data-id="${id}"] .tx`), w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())) { const i = n.nodeValue.indexOf('und'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 3); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; } }
    }, tid);
    await page.click('#panel button[data-run="u"]');
    await page.click('#panel button[data-runc="#c62828"]');
    await page.keyboard.press('Escape');
    const o = await S(`B.find('${tid}')`);
    const und = o.runs.find(r => r.t.includes('und')), first = o.runs[0];
    check('Ein einzelnes Wort unterstrichen und rot', und && und.t.trim() === 'und' && und.u && und.c === '#c62828' && !first.u && !first.c, JSON.stringify(o.runs));
    check('Text bleibt dabei vollständig', o.text === 'Test π ≤ 5 und √2', o.text);
  }
  ex = await exportFiles('sonderzeichen', ['student']);
  {
    const t = (await pdfText(fs.readFileSync(ex.student)))[0];
    check('Export: π, ≤ und √ bleiben erhalten', t.includes('π') && t.includes('≤') && t.includes('√'), t.slice(-80));
    if (HAVE_PDFTOPPM) {
      const o = await S(`B.find('${tid}')`);
      const red = redRatio(ex.student, 1, { x: o.x, y: o.y, w: o.w, h: o.h });
      check('Export: rotes Wort erscheint rot', red > 0.01, red.toFixed(3));
    }
  }

  /* ================================================================ */
  section('4. Werkzeuge auf einem leeren Blatt');
  await page.evaluate(() => { window.__bw.newSheet(false, { bg: 'grid' }); document.getElementById('docName').value = 'Werkzeuge'; });
  await page.waitForTimeout(200);
  const count = t => S(`S.objs.filter(o => o.type === '${t}').length`);
  /* Einrasten an Elementen (vor dem Raster) */
  {
    const ids = await page.evaluate(() => {
      const { S, snap, renderAll } = window.__bw; snap();
      const mk = (x, y, name) => { const o = { id: 'snap' + name, page: S.pages[0].id, type: 'field', layer: 'base', x, y, w: 100, h: 20, name, multi: false, size: 11, border: true, bg: true, value: '', solution: '' }; S.objs.push(o); return o.id; };
      const r = [mk(101.3, 760, 'SnapA'), mk(250, 790, 'SnapB')]; renderAll(); return r;
    });
    const b0 = await S(`B.find('${ids[1]}')`), z = await S('S.zoom');
    const p = await at(b0.x + 30, b0.y + 10);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + (101.3 + 1.6 - 250) * z, p.y, { steps: 10 }); await page.mouse.up();
    check('Einrasten an der Kante eines anderen Elements', (await S(`B.find('${ids[1]}').x`)) === 101.3, await S(`B.find('${ids[1]}').x`));
    await page.keyboard.press('Control+z');
    await page.evaluate(() => { window.__bw.S.snap = false; });
    const p2 = await at(b0.x + 30, b0.y + 10);
    await page.mouse.move(p2.x, p2.y); await page.mouse.down();
    await page.mouse.move(p2.x + (101.3 + 1.6 - 250) * z, p2.y, { steps: 10 }); await page.mouse.up();
    const xNo = await S(`B.find('${ids[1]}').x`);
    check('Ohne Einrasten bleibt die Position frei', Math.abs(xNo - 102.9) < 0.8, xNo);
    await page.evaluate(() => { window.__bw.S.snap = true; });

    /* Mehrfachauswahl: Umschalt+Klick, gemeinsam ziehen, kopieren auf neue Seite */
    await key('Escape');
    const A = await S(`B.find('${ids[0]}')`), Bo = await S(`B.find('${ids[1]}')`);
    await clickAt(A.x + 50, A.y + 10);
    await clickAt(Bo.x + 50, Bo.y + 10, 0, 'Shift');
    check('Umschalt+Klick wählt zwei Elemente', (await S('S.multi.length')) === 2);
    const q = await at(A.x + 50, A.y + 10);
    await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.move(q.x + 37 * z, q.y - 23 * z, { steps: 8 }); await page.mouse.up();
    const A2 = await S(`B.find('${ids[0]}')`), B2 = await S(`B.find('${ids[1]}')`);
    check('Mehrfachauswahl wird gemeinsam verschoben', Math.abs((A2.x - A.x) - (B2.x - Bo.x)) < 0.05 && Math.abs((A2.y - A.y) - (B2.y - Bo.y)) < 0.05 && Math.abs(A2.x - A.x) > 20, JSON.stringify([A2.x - A.x, B2.x - Bo.x, A2.y - A.y, B2.y - Bo.y]));
    await page.keyboard.press('Control+c');
    await key('Escape');
    await page.click('#panel [data-act="addpage"]');
    await page.waitForTimeout(900);
    await page.evaluate(() => { const S = window.__bw.S; S.cur = S.pages[1].id; });
    await page.keyboard.press('Control+v');
    check('Kopieren und auf neuer Seite einfügen', (await S(`S.objs.filter(o => o.page === S.pages[1].id).length`)) === 2 && (await S(`S.objs.filter(o => o.page === S.pages[1].id).every(o => o.type === 'field')`)), await S(`JSON.stringify({ n: S.pages.length, clip: !!S.clip, per: S.pages.map(p => S.objs.filter(o => o.page === p.id).length), act: document.activeElement.tagName + '#' + document.activeElement.id })`));
  }
  await page.evaluate(() => { const S = window.__bw.S; S.cur = S.pages[0].id; });
  const c0 = { field: await count('field'), highlight: await count('highlight'), coord: await count('coord') };
  await key('f'); await dragPt(80, 90, 300, 120);
  await key('m'); await dragPt(320, 90, 500, 104);
  await key('g'); await clickAt(150, 260);
  check('Textfeld, Markierung und Koordinatensystem angelegt', (await count('field')) === c0.field + 1 && (await count('highlight')) === c0.highlight + 1 && (await count('coord')) === c0.coord + 1);
  await page.fill('#p-unit', '7,5'); await page.locator('#p-unit').dispatchEvent('change');
  check('Zahleneingabe mit Komma (Einheit 7,5 mm)', (await sel()).unit === 7.5);
  await page.fill('#p-xmin', '-3');
  check('Negative Achsenwerte eingeben', (await sel()).xmin === -3);
  await page.click('#panel [data-act="fn-add"]');
  await page.fill('#panel [data-fn="0"][data-fk="src"]', '2x +');
  check('Fehlerhafter Term: verständliche Meldung', /unvollständig/i.test(await page.textContent('#panel')));
  await page.fill('#panel [data-fn="0"][data-fk="src"]', '0,5x + 2');
  check('Funktionsgraph wird gezeichnet', (await sel()).funcs[0].src === '0,5x + 2' && (await page.locator('.obj.sel svg path[stroke="#2440b3"]').count()) >= 1);
  const terms = await page.evaluate(() => { const c = s => window.__bw.compileExpr(s); return [c('0,5x+2')(2), c('2x^2-3')(2), c('3(x-1)^2')(3), c('|x|')(-4), c('sqrt(x)')(9), c('x²')(3), c('f(x) = 2x')(4), c('1/x')(4), c('2sin(x)')(0), c('-x^2')(3)]; });
  check('Funktionsterme in Schulschreibweise', JSON.stringify(terms) === JSON.stringify([3, 5, 12, 4, 3, 9, 8, 0.25, 0, -9]), JSON.stringify(terms));

  await key('y'); await clickAt(400, 300);
  check('Formel-Werkzeug legt Formel an', (await count('formula')) === 1);
  await page.fill('#p-src', '\\frac{3}{4} + \\sqrt{2} + x^{2} + a_{1}');
  const fo = await sel();
  check('Formel: Bruch, Wurzel, Potenz, Index gesetzt', fo.src.includes('\\frac') && (await page.locator('.obj.sel svg text').count()) >= 7 && fo.h > 30, fo.h);
  check('Formel als Klartext für QR', (await page.evaluate(() => window.__bw.mathPlain('\\frac{3}{4} + \\sqrt{2} + x^{2} + a_{1}'))) === '3/4 + √2 + x² + a_1');

  await key('z'); await clickAt(300, 420);
  check('Tabelle (Wertetabelle) angelegt', (await count('table')) === 1);
  await page.fill('#p-tfn', '2x - 1'); await page.click('#panel [data-act="tbl-fn"]');
  check('Wertetabelle: y-Werte als Lösung berechnet', JSON.stringify((await sel()).sol[1]) === JSON.stringify(['', '−7', '−5', '−3', '−1', '1', '3', '5']), JSON.stringify((await sel()).sol[1]));

  await key('s');
  await page.click('#panel [data-act="shape-arrow"]'); await dragPt(60, 500, 200, 500);
  const arrow = await S(`S.objs.find(o => o.type === 'shape' && o.kind === 'arrow')`);
  check('Pfeil gezogen', arrow && Math.abs(arrow.x2 - arrow.x1 - 140) < 15, arrow && JSON.stringify([arrow.x1, arrow.x2]));
  await key('s');
  await page.click('#panel [data-act="shape-angle"]'); await dragPt(60, 600, 200, 600);
  const ang = await S(`S.objs.find(o => o.type === 'shape' && o.kind === 'angle')`);
  check('Winkel mit drei Punkten, 60°', ang && ang.x3 != null && Math.abs((await page.evaluate(id => { const o = window.__bw.find(id); const a1 = Math.atan2(-(o.y2 - o.y1), o.x2 - o.x1), a2 = Math.atan2(-(o.y3 - o.y1), o.x3 - o.x1); return Math.abs((a2 - a1) * 180 / Math.PI); }, ang.id)) - 60) < 1.5);
  await key('s');
  await page.click('#panel [data-act="shape-grid"]'); await dragPt(300, 500, 420, 570);
  const grid = await S(`S.objs.find(o => o.type === 'shape' && o.kind === 'grid')`);
  check('Rechenkästchen gezogen', grid && grid.cols >= 7 && grid.rows >= 4, grid && grid.cols + 'x' + grid.rows);
  /* Endpunkt des Pfeils ziehen */
  await key('v');
  await clickAt((arrow.x1 + arrow.x2) / 2, arrow.y1);
  if (process.env.BW_DEBUG) console.log('DBG', await S('S.sel'), arrow.id, await S('S.tool'), await page.evaluate(id => document.querySelector(`.obj[data-id="${id}"]`).outerHTML.slice(0, 300), arrow.id), await S(`JSON.stringify(B.find('${arrow.id}'))`));
  const hp = await page.locator(`.obj[data-id="${arrow.id}"] .hdl.pt[data-d="p2"]`).boundingBox();
  await page.mouse.move(hp.x + hp.width / 2, hp.y + hp.height / 2); await page.mouse.down();
  await page.mouse.move(hp.x + hp.width / 2, hp.y + hp.height / 2 + 60, { steps: 6 }); await page.mouse.up();
  const arrow2 = await S(`B.find('${arrow.id}')`);
  check('Pfeil-Endpunkt verschoben, Hülle angepasst', arrow2.y2 > arrow.y2 + 20 && Math.abs(arrow2.y + arrow2.h - arrow2.y2 - 4) < 1, JSON.stringify([arrow2.y2, arrow2.y, arrow2.h]));

  await key('k'); await clickAt(60, 700);
  await key('p'); await clickAt(500, 300);
  await key('q'); await clickAt(500, 700);
  check('Ankreuzkästchen, Punktekästchen und QR-Code angelegt', (await count('check')) === 1 && (await count('points')) === 1 && (await count('qr')) === 1);
  check('QR-Code enthält die Tabellen-Lösungen der Seite', /Tabelle 1: −7; −5/.test(await S(`B.qrText(S.objs.find(o => o.type === 'qr'))`)));

  /* Ebenen */
  const fid = await S(`S.objs.find(o => o.type === 'formula').id`);
  await clickAt(400, 300);
  await page.click(`#panel button[data-layer="layer"][data-v='"help"']`);
  check('Formel auf Hilfe-Ebene verschoben', (await S(`B.find('${fid}').layer`)) === 'help');
  await key('Escape');
  await page.uncheck('#p-view\\.help');
  check('Hilfen ausblenden versteckt die Formel', (await page.locator(`.obj[data-id="${fid}"]`).count()) === 0);
  await page.check('#p-view\\.help');
  check('Hilfen einblenden zeigt sie wieder', (await page.locator(`.obj[data-id="${fid}"]`).count()) === 1);

  /* Seite drehen: Elemente wandern mit und bleiben auf der Seite */
  await key('Escape');
  await page.evaluate(() => { window.__bw.S.cur = window.__bw.S.pages[0].id; });
  await page.evaluate(() => window.__bw.rotatePage(1));
  check('Leere Seite gedreht: Querformat, alle Elemente auf der Seite', await S(`S.pages[0].w > S.pages[0].h && S.objs.filter(o => o.page === S.pages[0].id).every(o => o.x >= -1 && o.y >= -1 && o.x + o.w <= S.pages[0].w + 1 && o.y + o.h <= S.pages[0].h + 1)`), await S(`JSON.stringify(S.objs.filter(o => o.page === S.pages[0].id && !(o.x >= -1 && o.y >= -1 && o.x + o.w <= S.pages[0].w + 1 && o.y + o.h <= S.pages[0].h + 1)).map(o => [o.type, Math.round(o.x), Math.round(o.y), Math.round(o.w), Math.round(o.h)]))`));
  ex = await exportFiles('werkzeuge', ['student', 'solution']);
  {
    const ns = await fieldNamesOf(ex.student);
    check('Werkzeug-Blatt: Tabellenzellen, Kästchen und Felder ausfüllbar', ns.includes('Tabelle 1 Z2S2') && ns.includes('Kästchen 1') && ns.includes('Feld 1') && ns.includes('SnapA'), ns.join(','));
    const pdf = await PDFDocument.load(fs.readFileSync(ex.student));
    const sz = pdf.getPage(0).getSize();
    check('Gedrehte leere Seite im Querformat exportiert, zweite Seite hochkant', sz.width > sz.height && pdf.getPage(1).getSize().height > pdf.getPage(1).getSize().width);
    const tl = (await pdfText(fs.readFileSync(ex.solution)))[0];
    check('Lösungsblatt enthält die berechneten Tabellenwerte', tl.includes('−7') && tl.includes('5'));
  }

  /* ================================================================ */
  section('5. Neues Blatt: Querformat mit Koordinaten-Hintergrund');
  await page.click('#btnNew');
  await page.click('[data-bg="coord"]'); await page.click('[data-land="1"]'); await page.click('.dlg [data-r="1"]');
  await page.waitForTimeout(300);
  check('Neues Blatt: Querformat mit Koordinaten-Hintergrund', await S(`S.pages[0].w > S.pages[0].h && S.pages[0].bg.type === 'coord'`));
  check('Neues Blatt: Kopfzeile mit drei Feldern', (await S(`S.objs.filter(o => o.type === 'field').length`)) === 3);
  ex = await exportFiles('vorlage-koordinaten', ['student']);
  check('Ohne Hilfen und Lösungen: Export ohne Rückfrage', !ex.dialog && !!ex.student);
  {
    const pdf = await PDFDocument.load(fs.readFileSync(ex.student));
    check('Vorlage: Felder Name, Klasse, Datum ausfüllbar', pdf.getForm().getFields().map(x => x.getName()).join(',') === 'Name,Klasse,Datum');
    const sz = pdf.getPage(0).getSize();
    check('Vorlage: Seite im Querformat exportiert', sz.width > sz.height);
    const inkGrid = inkRatio(ex.student, 1, { x: 100, y: 200, w: 600, h: 300 }, 225);
    if (inkGrid !== null) check('Vorlage: Gitter und Achsen sichtbar', inkGrid > 0.01, inkGrid.toFixed(3));
  }

  /* ================================================================ */
  section('6. Speicher');
  const nameBefore = await page.inputValue('#docName'), objsBefore = await S('S.objs.length');
  await page.evaluate(() => window.__bw.flushSave());
  await page.reload(); await page.waitForSelector('html[data-ready="1"]');
  check('Nach Neustart ist das letzte Blatt wieder da', (await page.inputValue('#docName')) === nameBefore && (await S('S.objs.length')) === objsBefore);
  await page.click('#btnOpen');
  await page.waitForSelector('.lib li', { timeout: 10000 });
  const libCount = await page.locator('.lib li').count();
  check('Meine Blätter listet die Blätter', libCount >= 3, String(libCount));
  await page.locator('.lib li', { hasText: 'Werkzeuge' }).locator('[data-open]').click();
  await page.waitForTimeout(600);
  check('Früheres Blatt lässt sich öffnen (2 Seiten)', (await S('S.pages.length')) === 2 && (await page.inputValue('#docName')) === 'Werkzeuge');

  /* ================================================================ */
  section('7. PDF bearbeiten, Seiten einfügen, duplizieren, drehen');
  const fix = await fixturePdf();
  await page.setInputFiles('#fileOpen', fix);
  await page.waitForFunction(() => window.__bw.S.pages.length === 3, null, { timeout: 15000 });
  check('PDF mit 3 Seiten geöffnet', true);
  await page.keyboard.press('e');
  await page.waitForSelector('.lnbox', { timeout: 10000 });
  const lnCount = await page.locator('.lnbox').count();
  check('Textzeilen im PDF erkannt', lnCount >= 4, String(lnCount));
  await page.locator('.lnbox').nth(1).click();
  await page.keyboard.press('End'); await page.keyboard.type(' (neu)'); await page.keyboard.press('Escape');
  const conv = await S(`S.objs.find(o => o.fromLine)`);
  check('Zeile umgewandelt, Original abgedeckt', conv && conv.text.endsWith('(neu)') && conv.cover && conv.font === 'serif', JSON.stringify(conv && { t: conv.text, f: conv.font }));
  await page.keyboard.press('t');
  await clickAt(60, 60, 1); await page.keyboard.type('Aufrecht'); await page.keyboard.press('Escape');
  await page.setInputFiles('#filePdf', fix);
  await page.waitForSelector('.dlg .thumb', { timeout: 10000 });
  check('Seiten einfügen: Vorschau aller Seiten', (await page.locator('.dlg .thumb').count()) === 3);
  await page.locator('.dlg .thumb').nth(1).click();
  await page.click('.dlg [data-r="1"]');
  await page.waitForFunction(() => window.__bw.S.pages.length === 5, null, { timeout: 10000 });
  check('Zwei Seiten aus zweitem PDF hinter der aktuellen Seite eingefügt', (await S(`S.pages.map(p => (p.sid === 'main' ? 'A' : 'B') + (p.src + 1)).join(',')`)) === 'A1,A2,B1,B3,A3', await S(`S.pages.map(p => (p.sid === 'main' ? 'A' : 'B') + (p.src + 1)).join(',')`));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const S = window.__bw.S; S.cur = S.pages[2].id; });
  await page.click('#panel [data-act="duppage"]');
  await page.waitForTimeout(400);
  check('Nach dem Duplizieren ist das Duplikat die aktuelle Seite', (await S('S.cur === S.pages[3].id')));
  await page.click('#panel [data-act="rotr"]');
  check('Seite dupliziert und gedreht', (await S('S.pages.length')) === 6 && (await S('S.pages[3].rot')) === 90 && (await S('S.pages[3].w > S.pages[3].h')), await S(`S.pages.map(p => p.sid + p.src + '/' + p.rot).join()`));
  ex = await exportFiles('bearbeitet', ['student']);
  {
    const bytes = fs.readFileSync(ex.student), txt = await pdfText(bytes), pdf = await PDFDocument.load(bytes);
    check('Export: 6 Seiten', pdf.getPageCount() === 6);
    check('Export: geänderte Zeile im PDF', txt[0].includes('(neu)'), txt[0].slice(0, 120));
    check('Export: Text auf gedrehter Seite', txt[1].includes('Aufrecht'));
    check('Export: Drehung der Originalseite bleibt erhalten', pdf.getPage(1).getRotation().angle === 90);
    check('Export: eingefügte und duplizierte Seiten mit Inhalt', txt[2].includes('Klassenarbeit') && txt[3].includes('Klassenarbeit') && txt[4].includes('Querformat') && txt[5].includes('Querformat'));
    check('Export: Duplikat ist eine eigene, gedrehte Seite', pdf.getPage(3).getRotation().angle === 90 && pdf.getPage(2).getRotation().angle === 0 && pdf.getPage(2).ref !== pdf.getPage(3).ref);
    if (HAVE_PDFTOPPM) {
      const r = inkRatio(ex.student, 2, { x: 58, y: 50, w: 90, h: 24 });
      check('Gedrehte Seite: Text an der richtigen Stelle', r > 0.03, r.toFixed(3));
    }
  }
  /* Ausschnitt aus einem PDF als Bild */
  await page.evaluate(() => { document.getElementById('filePdf').dataset.mode = 'crop'; });
  await page.setInputFiles('#filePdf', fix);
  await page.waitForSelector('#cr-wrap canvas', { timeout: 10000 });
  await page.waitForTimeout(300);
  {
    const cb = await page.locator('#cr-wrap canvas').boundingBox();
    await page.mouse.move(cb.x + cb.width * 0.08, cb.y + cb.height * 0.06); await page.mouse.down();
    await page.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.12, { steps: 6 }); await page.mouse.up();
    const i0 = await count('image');
    await page.click('.dlg [data-r="1"]');
    await page.waitForFunction(n => window.__bw.S.objs.filter(o => o.type === 'image').length === n + 1, i0, { timeout: 10000 });
    const im = await sel();
    check('Ausschnitt als Bild in Originalgröße eingefügt', im.type === 'image' && Math.abs(im.w - 595 * 0.52) < 8, im.w);
  }
  await page.setInputFiles('#fileImg', path.join(ROOT, 'icon-192.png'));
  await page.waitForFunction(() => window.__bw.S.objs.filter(o => o.type === 'image').length === 2, null, { timeout: 10000 });
  ex = await exportFiles('mit-bild', ['student']);
  {
    const pdf = await PDFDocument.load(fs.readFileSync(ex.student));
    const xo = pdf.getPages().some(pg => { const r = pg.node.Resources(); const x = r && r.lookup(PDFName.of('XObject')); return x && x.keys().length > 0; });
    check('Bilder werden in das PDF eingebettet', xo);
  }

  /* ================================================================ */
  section('8. Projektdatei');
  const [dlp] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const projFile = path.join(OUT, 'projekt.blattwerk.json'); await dlp.saveAs(projFile);
  const objCount = await S('S.objs.length');
  const docBefore = await S('S.docId');
  await page.setInputFiles('#fileOpen', projFile);
  await page.waitForFunction(id => window.__bw.S.docId !== id, docBefore, { timeout: 15000 }).catch(() => {});
  check('Projektdatei: Rundreise erhält Elemente, 6 Seiten und beide PDFs', (await S('S.objs.length')) === objCount && (await S('S.pages.length')) === 6 && (await S('Object.keys(S.srcs).length')) === 2);
  const evil = { app: 'blattwerk', v: 2, name: '<img src=x onerror="window.__pwned=1">', pages: [{ id: 'p1', src: null, w: 595, h: 842 }],
    objs: [{ id: 'o1', page: 'p1', type: 'field', x: 50, y: 50, w: 100, h: 20, name: '<img src=x onerror="window.__pwned=1">', solution: '<b onmouseover=1>', color: 'red;background:url(x)' },
      { id: 'o2', page: 'p1', type: 'check', x: 50, y: 90, w: 50, h: 12, label: '<svg onload="window.__pwned=1">' },
      { id: 'o3', page: 'p1', type: 'points', x: 50, y: 130, w: 62, h: 22, label: '<img src=x onerror="window.__pwned=1">', max: 2, afb: '<x>', comp: 'K9', expect: '<script>window.__pwned=1</script>' },
      { id: 'o4', page: 'p1', type: 'qr', x: 50, y: 200, w: 60, h: 60, mode: 'text', text: '"><img src=x onerror="window.__pwned=1">' },
      { id: 'o5', page: 'p1', type: 'table', x: 50, y: 300, w: 200, rows: 2, cols: 2, cells: [['<img src=x onerror="window.__pwned=1">', 1], [{}, null]], name: '<i>' },
      { id: 'o6', page: 'p1', type: 'text', x: 50, y: 400, w: 200, runs: [{ t: '<img src=x onerror="window.__pwned=1">', c: 'red;x:url(y)' }] },
      { id: 'o7', page: 'p1', type: 'bogus' }], imgs: { a: { url: 'javascript:alert(1)' } }, fonts: { x: { name: 'böse', b64: 'AAAA' } } };
  const evilFile = path.join(OUT, 'boese.json'); fs.writeFileSync(evilFile, JSON.stringify(evil));
  await page.setInputFiles('#fileOpen', evilFile);
  await page.waitForFunction(() => document.getElementById('docName').value.startsWith('<img'), null, { timeout: 10000 }).catch(() => {});
  for (const t of ['field', 'check', 'points', 'qr', 'table']) { await page.click('.o-' + t).catch(() => {}); await page.waitForTimeout(80); }
  check('Feindliche Projektdatei führt keinen Code aus', !(await page.evaluate(() => window.__pwned)));
  check('Unbekannte Elementtypen werden verworfen, der Rest bereinigt', (await S('S.objs.length')) === 6 && (await S(`S.objs.find(o => o.type === 'table').cells.flat().every(v => typeof v === 'string')`)));
  fs.writeFileSync(path.join(OUT, 'kaputt.json'), '{ das ist kein json');
  await page.setInputFiles('#fileOpen', path.join(OUT, 'kaputt.json'));
  await page.waitForTimeout(300);
  check('Kaputte Datei: verständliche Meldung', /kein lesbares Blattwerk-Projekt/.test(await toastText()));

  /* ================================================================ */
  section('9. Geschützte PDFs');
  if (HAVE_QPDF) {
    const prot = path.join(OUT, 'geschuetzt.pdf'), pw = path.join(OUT, 'passwort.pdf');
    execFileSync('qpdf', ['--encrypt', '', 'besitzer', '256', '--print=full', '--modify=none', '--', fix, prot]);
    execFileSync('qpdf', ['--encrypt', 'geheim', 'besitzer', '256', '--', fix, pw]);
    await page.setInputFiles('#fileOpen', prot);
    await page.waitForFunction(() => window.__bw.S.pages.length === 3, null, { timeout: 15000 });
    ex = await exportFiles('aus-geschuetzt', ['student']);
    await page.waitForTimeout(300);
    const t = await toastText();
    check('Geschütztes PDF: Export gelingt, Hinweis erscheint', /geschützt/.test(t) && fs.statSync(ex.student).size > 10000, t);
    const pdf = await PDFDocument.load(fs.readFileSync(ex.student));
    check('Geschütztes PDF: gedrehte Seite als Bild im Querformat', pdf.getPage(1).getSize().width > pdf.getPage(1).getSize().height && pdf.getPage(1).getRotation().angle === 0);
    await page.setInputFiles('#fileOpen', pw);
    await page.waitForFunction(() => /Passwort/.test(document.getElementById('toast').textContent), null, { timeout: 10000 }).catch(() => {});
    check('Passwort-PDF: klare Meldung statt Absturz', /Passwort/.test(await toastText()));
  } else results.push('  - qpdf fehlt, Prüfung geschützter PDFs übersprungen');

  /* ================================================================ */
  section('10. Rücklauf: ausgefüllte Schüler-PDFs auswerten');
  await freshSample();
  await page.evaluate(() => window.__bw.S.undo.push('{}'));
  ex = await exportFiles('rueckgabe', ['student']);
  {
    const blank = fs.readFileSync(ex.student);
    async function fill(file, vals, appearances = true) {
      const d = await PDFDocument.load(blank), form = d.getForm();
      for (const [k, v] of Object.entries(vals)) { if (typeof v === 'boolean') { if (v) form.getCheckBox(k).check(); } else form.getTextField(k).setText(v); }
      const f = path.join(OUT, file); fs.writeFileSync(f, await d.save({ updateFieldAppearances: appearances })); return f;
    }
    const tab = vs => Object.fromEntries(vs.map((v, i) => ['Wertetabelle Z2S' + (i + 2), v]));
    const fa = await fill('schueler-a.pdf', Object.assign({ Name: 'Ali', 'A1 a': true, 'A1 b': true, 'A1 d': true, 'Aufgabe 2': 'm = 2' }, tab(['-7', '-5', '-3', '-1', '1', '3', '5'])));
    const fb = await fill('schueler-b.pdf', Object.assign({ Name: 'Berta', Datum: '=HYPERLINK("x")', 'A1 a': true, 'Aufgabe 2': '2,0' }, tab(['−7', '-5', ' -3 ', '1', '1', '3', ''])), false);
    const fc = await fill('Schueler-C.pdf', Object.assign({ 'Aufgabe 2': '5/2' }));
    await page.setInputFiles('#fileEval', [fa, fb, fc, fix]);
    await page.waitForSelector('.dlg .evtable', { timeout: 15000 });
    const stat = await page.locator('.dlg .stat b').allTextContents();
    check('Auswertung: 3 Schüler-PDFs, 12 bewertete Antworten, 58 % im Mittel', stat[0] === '3' && stat[1] === '12' && stat[2] === '58 %', stat.join(' | '));
    check('Auswertung: unpassende Datei wird gemeldet', /vorlage\.pdf/.test(await page.textContent('.dlg .warn')));
    const rows = await page.locator('.dlg .evtable').nth(1).locator('tr').allTextContents();
    check('Je Schüler: Ali 12/12, Berta 8/12, Dateiname als Ersatz', rows.some(r => r.startsWith('Ali12/12100 %')) && rows.some(r => r.startsWith('Berta8/1267 %')) && rows.some(r => r.startsWith('Schueler-C1/128 %')), rows.slice(1).map(r => r.slice(0, 18)).join(' | '));
    const per = await page.locator('.dlg .evtable').first().locator('tr', { hasText: 'Aufgabe 2' }).textContent();
    check('Je Aufgabe: Anteil richtig und häufige falsche Antwort', /67 %/.test(per) && /5\/2 \(1×\)/.test(per), per);
    const [dlc] = await Promise.all([page.waitForEvent('download'), page.click('.dlg [data-csv]')]);
    const csvFile = path.join(OUT, 'auswertung.csv'); await dlc.saveAs(csvFile);
    const csv = fs.readFileSync(csvFile, 'utf8');
    check('CSV: UTF-8 mit BOM, Semikolon, alle Schüler', csv.charCodeAt(0) === 0xfeff && csv.split('\r\n')[0].startsWith('\ufeffName;Datei;Richtig') && /\r\nAli;/.test(csv) && /\r\nBerta;/.test(csv));
    check('CSV: Formel-Einschleusung entschärft', csv.includes(`"'=HYPERLINK(""x"")"`), csv.split('\r\n')[2].slice(0, 120));
    check('Auswertung speichert nichts', (await S('S.objs.length')) === 26);
    await page.click('.dlg [data-r="1"]');
  }

  /* ================================================================ */
  section('11. Klassenarbeit: Erwartungshorizont');
  await page.keyboard.press('Escape');
  await page.click('#panel [data-act="horizon"]');
  check('Erwartungshorizont als eigene Seite (nur Lösungsblatt)', (await S('S.pages.length')) === 2 && (await S(`S.pages[1].layer === 'sol' && S.pages[1].horizon`)));
  await page.keyboard.press('Escape');
  await page.click('#panel [data-act="horizon"]');
  check('Erneut erzeugen ersetzt die alte Seite', (await S('S.pages.length')) === 2);
  ex = await exportFiles('klassenarbeit', ['student', 'solution']);
  {
    const ps = await PDFDocument.load(fs.readFileSync(ex.student)), pl = await PDFDocument.load(fs.readFileSync(ex.solution));
    check('Schülerfassung ohne Erwartungshorizont, Lösungsblatt mit', ps.getPageCount() === 1 && pl.getPageCount() === 2);
    const t = (await pdfText(fs.readFileSync(ex.solution)))[1];
    check('Erwartungshorizont: Aufgaben, Erwartung, AFB, Summe, Notenschlüssel', t.includes('Erwartungshorizont') && t.includes('Steigungsformel') && t.includes('II') && t.includes('Summe') && t.includes('Notenschlüssel') && t.includes('Kompetenz') && t.includes('ab 87,5 %') && /ab Punkte 9 7,5/.test(t), t.slice(0, 200));
  }

  /* ================================================================ */
  section('12. Lesefreundliche Kopie');
  await freshSample();
  await page.evaluate(() => window.__bw.S.undo.push('{}'));
  await page.evaluate(() => window.__bw.flushSave());
  const origId = await S('S.docId');
  await page.keyboard.press('Escape');
  await page.click('#panel [data-act="readable"]');
  await page.waitForTimeout(500);
  {
    const st = await S(`({ id: S.docId, name: document.getElementById('docName').value, pages: S.pages.map(p => ({ id: p.id, w: p.w, h: p.h })), objs: S.objs.map(o => ({ type: o.type, page: o.page, x: o.x, y: o.y, w: o.w, h: o.h, size: o.size, lh: o.lh, name: o.name, text: o.text })) })`);
    check('Neues Blatt „(lesefreundlich)“, Original bleibt', st.id !== origId && st.name.endsWith('(lesefreundlich)'));
    check('Schrift mindestens 13 pt, Zeilenabstand 1,5', st.objs.filter(o => o.type === 'text').every(o => o.size >= 13 && o.lh >= 1.5));
    check('Inhalte bleiben innerhalb der Seiten, Überlauf auf neue Seite', st.pages.length >= 2 && st.objs.every(o => { const p = st.pages.find(q => q.id === o.page); return o.y >= 0 && o.y + o.h <= p.h + 0.5; }), st.pages.length + JSON.stringify(st.objs.map(o => [o.type, Math.round(o.y), Math.round(o.h)])));
    const t2 = st.objs.find(o => o.type === 'text' && o.text.startsWith('2 ')), f2 = st.objs.find(o => o.name === 'Aufgabe 2');
    const t3 = st.objs.find(o => o.type === 'text' && o.text.startsWith('3 ')), tb = st.objs.find(o => o.type === 'table');
    check('Reihenfolge bleibt: Feld unter Aufgabe 2, Tabelle unter Aufgabe 3', f2.page !== t2.page || f2.y >= t2.y + t2.h - 0.5, JSON.stringify([t2.y + t2.h, f2.y]));
    check('Tabelle unter ihrer Aufgabe', tb.page !== t3.page || tb.y >= t3.y + t3.h - 0.5);
    const lab = st.objs.find(o => o.type === 'text' && o.text === 'Name:'), nf = st.objs.find(o => o.name === 'Name'), df = st.objs.find(o => o.name === 'Datum');
    check('Beschriftung „Name:“ bricht nicht um, Feld rückt nach', lab.h < 25 && nf.x >= lab.x + lab.w - 0.5 && df.x + df.w <= 595.3 - 28 + 0.5, JSON.stringify([lab.w, lab.h, nf.x, df.x + df.w]));
    check('Markierung über Text entfernt (Hinweis)', !st.objs.some(o => o.type === 'highlight') && /Markierung/.test(await toastText()));
    const ex2 = await exportFiles('lesefreundlich', ['student']);
    check('Lesefreundliche Kopie exportierbar', !!ex2.student && (await PDFDocument.load(fs.readFileSync(ex2.student))).getPageCount() === st.pages.length);
  }

  /* ================================================================ */
  section('13. Daten aus Version 1.0');
  {
    const fixB64 = fs.readFileSync(fix).toString('base64');
    const v1 = { app: 'blattwerk', v: 1, version: '1.0.0', name: 'Altes Projekt', src: fixB64,
      pages: [{ id: 'p1', src: 0, w: 595, h: 842, rot: 0 }, { id: 'p2', src: null, w: 595, h: 842, rot: 0, bg: { type: 'grid', size: 5, margin: 10, top: 10, tone: 'mittel', rand: false, unit: 10, sub: 2 } }],
      objs: [{ id: 'a', page: 'p1', type: 'text', x: 60, y: 300, w: 300, h: 14, text: 'Alt fett', size: 12, font: 'serif', bold: true, italic: false, color: '#000000', fill: null },
        { id: 'b', page: 'p2', type: 'field', x: 60, y: 100, w: 200, h: 20, name: 'Antwort', multi: false, size: 11, border: true, bg: true, value: '' },
        { id: 'c', page: 'p2', type: 'check', x: 60, y: 150, w: 80, h: 11, label: 'ja', fs: 11, name: 'K1', checked: false }], imgs: {} };
    const f1 = path.join(OUT, 'alt-1.0.blattwerk.json'); fs.writeFileSync(f1, JSON.stringify(v1));
    await page.setInputFiles('#fileOpen', f1);
    await page.waitForFunction(() => document.getElementById('docName').value === 'Altes Projekt', null, { timeout: 10000 });
    check('1.0-Projekt: Text wird zu formatierten Läufen, PDF-Seite zur Quelle „main“', (await S(`S.objs[0].runs[0].b === true && S.objs[0].text === 'Alt fett' && S.pages[0].sid === 'main' && S.pages[1].sid === null`)));
    ex = await exportFiles('alt', ['student']);
    const t = await pdfText(fs.readFileSync(ex.student));
    check('1.0-Projekt: Export mit Original und Feldern', t[0].includes('Alt fett') && t[0].includes('Klassenarbeit') && (await fieldNamesOf(ex.student)).join(',') === 'Antwort,K1');
    const ok = await page.evaluate(async b64 => {
      const { DB, openStored, S } = window.__bw;
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      await DB.putPdf('dAlt10', u);
      await DB.save('dAlt10', { name: 'Gespeichert in 1.0', pages: [{ id: 'q1', src: 1, w: 842, h: 595, rot: 90 }], objs: [{ id: 'x', page: 'q1', type: 'text', x: 50, y: 50, w: 200, h: 14, text: 'Hallo', size: 12, font: 'sans', bold: false, italic: true, color: '#000000' }], imgs: {} }, { id: 'dAlt10', name: 'Gespeichert in 1.0', updated: 1, npages: 1, nfields: 0 });
      const r = await openStored('dAlt10');
      return r && S.pages[0].sid === 'main' && S.pages[0].orot === 90 && S.objs[0].runs[0].i === true;
    }, fixB64);
    check('1.0-Speicherstand (PDF unter alter Kennung) lässt sich öffnen', ok);
  }

  /* ================================================================ */
  section('14. Eigene Schrift');
  await page.evaluate(() => { window.__bw.newSheet(false, { bg: 'white' }); document.getElementById('docName').value = 'Schrift'; });
  await page.keyboard.press('t'); await clickAt(80, 200); await page.keyboard.type('Eigene Schrift'); await page.keyboard.press('Escape');
  await page.setInputFiles('#fileFont', path.join(ROOT, 'fonts', 'NotoSerif-Bold.ttf'));
  await page.waitForFunction(() => { const S = window.__bw.S, o = S.objs.find(x => x.id === S.sel); return Object.keys(S.fonts).length === 1 && o && /^u:/.test(o.font); }, null, { timeout: 10000 }).catch(() => {});
  check('Eigene Schrift hinzugefügt und dem Text zugewiesen', /^u:/.test((await sel()).font));
  ex = await exportFiles('eigene-schrift', ['student']);
  {
    const bytes = fs.readFileSync(ex.student);
    const pdf = await PDFDocument.load(bytes), fonts = pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'));
    const baseFonts = fonts.keys().map(k => String(fonts.lookup(k).get(PDFName.of('BaseFont'))));
    check('Eigene Schrift im PDF eingebettet und Text lesbar', baseFonts.some(n => /NotoSerif-Bold/.test(n)) && (await pdfText(bytes))[0].includes('Eigene Schrift'), baseFonts.join(','));
  }
  await page.evaluate(() => window.__bw.flushSave());
  await page.reload(); await page.waitForSelector('html[data-ready="1"]');
  check('Eigene Schrift nach Neustart noch da', (await S('Object.keys(S.fonts).length')) === 1 && /^u:/.test(await S('S.objs[0].font')));

  /* ================================================================ */
  section('15. App-Pfad, Speicher-Ersatz, Gesten, schmale Geräte');
  const app = await ctx.newPage();
  app.on('pageerror', e => errs.push('App-Seitenfehler: ' + e.message));
  await app.addInitScript(() => {
    window.cordova = {};
    window.__shared = [];
    window.plugins = { socialsharing: { shareWithOptions: (o, ok) => { window.__shared.push(o); ok({ completed: true }); } } };
    /* Wie Cordova: deviceready ist "klebrig" – wer sich spaeter anmeldet,
       wird trotzdem sofort aufgerufen. */
    const add = document.addEventListener.bind(document);
    document.addEventListener = (type, fn, opt) => type === 'deviceready' ? setTimeout(fn, 30) : add(type, fn, opt);
  });
  await app.goto(base);
  await app.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await app.evaluate(() => window.__bw.newSheet(true));
  await app.click('#btnExport');
  await app.click('.dlg [data-r="1"]');
  await app.waitForFunction(() => window.__shared.length === 1, null, { timeout: 40000 });
  const sh = await app.evaluate(() => { const o = window.__shared[0]; return { n: o.files.length, f: o.files.map(f => f.slice(0, 90)), anchor: o.iPadPopupCoordinates }; });
  check('App: drei PDFs gehen in einem Schritt ans Teilen-Menü', sh.n === 3 && sh.f.every(f => /^df:[^;]+\.pdf;data:application\/pdf;base64,/.test(f)) && sh.f.some(f => / - Lösung\.pdf;/.test(f)), sh.f.join(' | '));
  check('App: iPad-Ankerpunkt gesetzt', /^\d+,\d+,0,0$/.test(sh.anchor), sh.anchor);
  await app.click('#btnNew');
  await app.waitForSelector('.dlg');
  await app.evaluate(() => document.dispatchEvent(new Event('backbutton')));
  check('Android-Zurücktaste schließt zuerst den Dialog', (await app.locator('.dlg').count()) === 0);
  await app.close();
  {
    const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const lp = await ctx2.newPage();
    lp.on('pageerror', e => errs.push('LS-Seitenfehler: ' + e.message));
    await lp.addInitScript(() => { try { Object.defineProperty(window, 'indexedDB', { value: undefined }); } catch (e) {} });
    await lp.goto(base); await lp.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    await lp.evaluate(() => { const o = window.__bw.S.objs[1]; o.runs = [{ t: 'Gespeichert ohne IndexedDB' }]; o.text = o.runs[0].t; window.__bw.S.undo.push('{}'); return window.__bw.flushSave(); });
    await lp.reload(); await lp.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    check('Ohne IndexedDB: Speichern über localStorage', (await lp.evaluate(() => window.__bw.DB.kind())) === 'localStorage' &&
      (await lp.evaluate(() => window.__bw.S.objs[1].text)) === 'Gespeichert ohne IndexedDB');
    await ctx2.close();
  }
  const z0 = await S('S.zoom');
  await page.evaluate(() => {
    const st = document.getElementById('stage'), r = st.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (type, id, x) => st.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: cy, bubbles: true, cancelable: true, isPrimary: id === 1 }));
    ev('pointerdown', 1, cx - 50); ev('pointerdown', 2, cx + 50);
    ev('pointermove', 1, cx - 100); ev('pointermove', 2, cx + 100);
    ev('pointerup', 1, cx - 100); ev('pointerup', 2, cx + 100);
  });
  await page.waitForTimeout(200);
  const z1 = await S('S.zoom');
  check('Zwei-Finger-Zoom vergrößert', z1 > z0 * 1.5, `${z0} -> ${z1}`);
  await page.evaluate(() => window.__bw.newSheet(true));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  check('iPhone-Breite: kein seitliches Scrollen der Seite', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check('iPhone-Breite: Werkzeugleiste unten sichtbar', await page.locator('#tools').isVisible());
  await page.click('#btnExport');
  const dbox = await page.locator('.dlg .box').boundingBox();
  check('iPhone-Breite: Exportdialog passt auf den Bildschirm', dbox && dbox.x >= 0 && dbox.x + dbox.width <= 390);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(OUT, 'iphone-dunkel.png') });

  check('Keine Fehler während des ganzen Laufs', errs.length === 0, errs.slice(0, 3).join(' / '));
  await browser.close(); srv.close();
}

main().catch(e => { fail++; results.push('  ✗ Testlauf abgebrochen: ' + (e && e.stack || e)); })
  .finally(() => {
    console.log(results.join('\n'));
    console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
    process.exit(fail ? 1 : 0);
  });
