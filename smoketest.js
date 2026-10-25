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
  return Object.assign(readPnm(b), { k: res / 72 });
}
/* PGM/PPM (P5/P6, 8 Bit) lesen – ohne Python oder Bildbibliotheken */
function readPnm(b) {
  let off = 0; const tok = [];
  while (tok.length < 4) { while (/\s/.test(String.fromCharCode(b[off]))) off++; let s = ''; while (!/\s/.test(String.fromCharCode(b[off]))) s += String.fromCharCode(b[off++]); tok.push(s); }
  off++;
  return { w: +tok[1], h: +tok[2], ch: tok[0] === 'P6' ? 3 : 1, data: b.subarray(off) };
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
  /* Die Abläufe unten tippen jedes Werkzeug direkt in der Leiste an: dafür
     „Alle Funktionen“. Die einfache Leiste prüft Abschnitt „Einfache Bedienung“. */
  await page.addInitScript(() => { try { if (!localStorage.getItem('bw:prefs')) localStorage.setItem('bw:prefs', JSON.stringify({ mode: 'all' })); } catch (e) {} });
  const errs = [];
  page.on('pageerror', e => errs.push('Seitenfehler: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('Konsole: ' + m.text()); });
  const S = expr => page.evaluate(`(() => { const S = window.__bw.S, B = window.__bw; return (${expr}); })()`);
  const toastText = () => page.evaluate(() => [...document.querySelectorAll('.tst span')].map(s => s.textContent).join(' | '));
  const sel = () => S('S.objs.find(o => o.id === S.sel)');
  /* Downloads einsammeln: Export ohne Dialog (eine Datei) oder mit Fassungswahl */
  const variantOf = n => / - Lösung\.pdf$/.test(n) ? 'solution' : / - mit Hilfen\.pdf$/.test(n) ? 'help' : 'student';
  async function exportFiles(prefix, want, pg = page) {
    const got = [], onDl = d => got.push(d);
    pg.on('download', onDl);
    await pg.click('#btnExport');
    const dlg = await pg.waitForSelector('.dlg input[data-v]', { timeout: 1500 }).catch(() => null);
    let n = 1;
    if (dlg) {
      n = 0;
      for (const v of ['student', 'help', 'solution']) {
        const cb = pg.locator(`.dlg input[data-v="${v}"]`);
        const on = want.includes(v) && await cb.isEnabled();
        if (await cb.isEnabled()) await cb.setChecked(on);
        if (on) n++;
      }
      await pg.click('.dlg [data-r="1"]');
    }
    const t0 = Date.now(); while (got.length < n && Date.now() - t0 < 40000) await pg.waitForTimeout(100);
    pg.off('download', onDl);
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
  check('Startbildschirm mit Neu, Öffnen, Beispiel, Meine Blätter, Einstellungen, Hilfe', await page.isVisible('#home') &&
    (await page.locator('#home [data-h="new"], #home [data-h="open"], #home [data-h="sample"], #home [data-h="lib"], #home [data-h="settings"], #home [data-h="about"]').count()) === 6);
  check('Erster Start: kein „Weiterarbeiten“', (await page.locator('#home [data-h="continue"]').count()) === 0);
  await page.click('#home [data-h="about"]');
  check('Über Blattwerk: Erklärungen zu allen Bereichen', (await page.locator('#home details').count()) >= 9 && /Ausgefüllte PDFs auswerten/.test(await page.textContent('#home')) && new RegExp('Version ' + require('./package.json').version.replace(/\./g, '\\.')).test(await page.textContent('#home')));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#home [data-h="sample"]', { timeout: 3000 }).catch(() => {});
  check('Escape führt zurück zum Startbildschirm', (await page.locator('#home [data-h="sample"]').count()) === 1);
  await page.click('#home [data-h="sample"]');
  await page.waitForSelector('#home', { state: 'hidden' });
  check('Beispielblatt vom Startbildschirm geöffnet', !(await page.isVisible('#home')));
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
  {
    const pdf = await PDFDocument.load(fs.readFileSync(ex.student)), an = pdf.getPage(0).node.Annots();
    const order = an.asArray().map(r => pdf.context.lookup(r)).filter(d => String(d.lookup(PDFName.of('Subtype'))) === '/Widget').map(d => { let x = d; while (!x.get(PDFName.of('T')) && x.lookup(PDFName.of('Parent'))) x = x.lookup(PDFName.of('Parent')); return x.lookup(PDFName.of('T')).decodeText(); });
    const want = ['Name', 'Datum', 'A1 a', 'A1 b', 'A1 c', 'A1 d', 'Aufgabe 2', 'Wertetabelle Z2S2'];
    check('Tab-Reihenfolge: Zeile für Zeile von oben nach unten', want.every((n, i) => order[i] === n) && String(pdf.getPage(0).node.get(PDFName.of('Tabs'))) === '/R', order.slice(0, 9).join(' > '));
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
  await page.click('#panel [data-fncol="0"][data-v="#c62828"]');
  await page.check('#panel [data-fn="0"][data-fk="dash"]');
  check('Funktionsgraph: Farbe wählbar und gestrichelt', (await sel()).funcs[0].color === '#c62828' && (await sel()).funcs[0].dash === true && (await page.locator('.obj.sel svg path[stroke="#c62828"][stroke-dasharray]').count()) >= 1);
  await page.click('#panel [data-fncol="0"][data-v="#2440b3"]');
  await page.uncheck('#panel [data-fn="0"][data-fk="dash"]');
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
  /* Kreis, Dreieck und Vierecke (auf Seite 2) */
  {
    const spots = { circle: [120, 120, 180, 120], triangle: [260, 160, 380, 160], trapez: [420, 160, 540, 160], parallel: [60, 330, 180, 330], raute: [240, 330, 380, 330], drachen: [420, 300, 540, 300] };
    for (const [k, [x1, y1, x2, y2]] of Object.entries(spots)) {
      await key('s'); await page.click(`#panel [data-act="shape-${k}"]`); await dragPt(x1, y1, x2, y2, 1);
    }
    const sh = await S(`Object.fromEntries(S.objs.filter(o => o.type === 'shape' && o.page === S.pages[1].id).map(o => [o.kind, o]))`);
    const pt = (o, i) => ({ x: o['x' + i], y: o['y' + i] }), d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    check('Kreis, Dreieck, Trapez, Parallelogramm, Raute, Drachen gezogen', Object.keys(spots).every(k => sh[k]), Object.keys(sh).join(','));
    check('Kreis: Mittelpunkt und Radius aus dem Ziehen', sh.circle && Math.abs(d(pt(sh.circle, 1), pt(sh.circle, 2)) - 60) < 8 && sh.circle.center === true);
    const tri = sh.triangle;
    check('Dreieck gleichseitig angelegt, Ecken beschriftet', tri && Math.abs(d(pt(tri, 1), pt(tri, 2)) - d(pt(tri, 2), pt(tri, 3))) < 3 && tri.labels === true);
    /* Ecke ziehen: Raute bleibt Raute, Trapez bleibt Trapez, Drachen bleibt Drachen */
    async function dragHandle(o, k, dx, dy) {
      await page.evaluate(id => window.__bw.selectIds([id]), o.id);
      await at(o['x' + k], o['y' + k], 1);
      const hb = await page.locator(`.obj[data-id="${o.id}"] .hdl.pt[data-d="p${k}"]`).boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2 + dy, { steps: 6 }); await page.mouse.up();
      return S(`B.find('${o.id}')`);
    }
    const ra = await dragHandle(sh.raute, 1, -30, -20);
    const rs = [1, 2, 3, 4].map(i => d(pt(ra, i), pt(ra, i % 4 + 1)));
    check('Raute: nach dem Ziehen einer Ecke alle Seiten gleich', Math.max(...rs) - Math.min(...rs) < 0.6 && ra.x1 < sh.raute.x1 - 10, rs.map(v => v.toFixed(1)).join('/'));
    const tz = await dragHandle(sh.trapez, 3, 25, -30);
    const cross = (a, b, c, e) => (b.x - a.x) * (e.y - c.y) - (b.y - a.y) * (e.x - c.x);
    check('Trapez: AB bleibt parallel zu CD', Math.abs(cross(pt(tz, 1), pt(tz, 2), pt(tz, 4), pt(tz, 3))) < 40 && tz.y3 < sh.trapez.y3 - 10, cross(pt(tz, 1), pt(tz, 2), pt(tz, 4), pt(tz, 3)).toFixed(1));
    const dr = await dragHandle(sh.drachen, 2, -25, 15);
    const axisDist = p => { const a = pt(dr, 1), c = pt(dr, 3); return ((c.x - a.x) * (p.y - a.y) - (c.y - a.y) * (p.x - a.x)) / d(a, c); };
    check('Drachen: B und D bleiben spiegelbildlich zur Achse AC', Math.abs(axisDist(pt(dr, 2)) + axisDist(pt(dr, 4))) < 0.6 && d(pt(dr, 1), pt(dr, 2)).toFixed(1) === d(pt(dr, 1), pt(dr, 4)).toFixed(1));
    const pa = await dragHandle(sh.parallel, 3, 20, -15);
    check('Parallelogramm bleibt Parallelogramm', Math.abs((pa.x1 + pa.x3) - (pa.x2 + pa.x4)) < 0.3 && Math.abs((pa.y1 + pa.y3) - (pa.y2 + pa.y4)) < 0.3);
    check('Panel zeigt Seitenlängen und Winkel', /Winkel: α = .*β = .*γ = .*δ = /.test(await page.textContent('#panel')) && /Seiten: AB = /.test(await page.textContent('#panel')));
    await page.click(`#panel button[data-set="fillc"][data-v='"#fff3b0"']`);
    check('Viereck gefüllt', (await S(`B.find('${sh.parallel.id}').fillc`)) === '#fff3b0');
    await key('Escape');
  }
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
  check('Verschieben auf ausgeblendete Ebene wechselt die Ansicht mit', (await S(`S.layer === 'help' && S.view.help`)) && (await page.locator(`.obj[data-id="${fid}"]`).count()) === 1);
  await key('Escape');
  await page.click('#viewSeg [data-vm="base"]');
  check('Ansicht „Arbeitsblatt“ versteckt die Hilfe', (await page.locator(`.obj[data-id="${fid}"]`).count()) === 0);
  await page.click('#viewSeg [data-vm="help"]');
  check('Ansicht „+ Hilfen“ zeigt sie wieder', (await page.locator(`.obj[data-id="${fid}"]`).count()) === 1);
  await page.click('#viewSeg [data-vm="base"]');

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
  await key('s');
  await page.click('#btnNew');
  await page.click('[data-bg="coord"]'); await page.click('[data-land="1"]'); await page.click('.dlg [data-r="1"]');
  await page.waitForTimeout(300);
  check('Neues Blatt: Querformat mit Koordinaten-Hintergrund', await S(`S.pages[0].w > S.pages[0].h && S.pages[0].bg.type === 'coord'`));
  check('Neues Blatt startet mit „Auswählen“', (await S('S.tool')) === 'select');
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
  check('Nach Neustart: Startbildschirm bietet „Weiterarbeiten“ mit dem letzten Blatt', await page.isVisible('#home') && (await page.textContent('#home [data-h="continue"]')).includes(nameBefore));
  check('Startbildschirm listet zuletzt bearbeitete Blätter', (await page.locator('#home .home-recent li').count()) >= 1);
  await page.click('#home [data-h="continue"]');
  check('Nach Neustart ist das letzte Blatt wieder da', !(await page.isVisible('#home')) && (await page.inputValue('#docName')) === nameBefore && (await S('S.objs.length')) === objsBefore);
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
    await page.fill('#cr-cap', 'Testbuch Mathe');
    await page.click('.dlg [data-r="1"]');
    await page.waitForFunction(n => window.__bw.S.objs.filter(o => o.type === 'image').length === n + 1, i0, { timeout: 10000 });
    await page.waitForFunction(() => { const S = window.__bw.S, o = S.objs.find(x => x.id === S.sel); return o && o.caption; }, null, { timeout: 5000 }).catch(() => {});
    const im = await sel();
    check('Ausschnitt als Bild in Originalgröße eingefügt', im.type === 'image' && Math.abs(im.w - 595 * 0.52) < 8, im.w);
    check('Ausschnitt: Quellenangabe mit Seitenzahl', im.caption === 'Testbuch Mathe, S. 1', im.caption);
    check('Quellenangabe steht im Bearbeitungsfeld und unter dem Bild', (await page.inputValue('#p-caption')) === im.caption && (await page.locator('.o-image .cap').first().textContent()) === im.caption);
  }
  await page.setInputFiles('#fileImg', path.join(ROOT, 'icon-192.png'));
  await page.waitForFunction(() => window.__bw.S.objs.filter(o => o.type === 'image').length === 2, null, { timeout: 10000 });
  ex = await exportFiles('mit-bild', ['student']);
  {
    const pdf = await PDFDocument.load(fs.readFileSync(ex.student));
    const xo = pdf.getPages().some(pg => { const r = pg.node.Resources(); const x = r && r.lookup(PDFName.of('XObject')); return x && x.keys().length > 0; });
    check('Bilder werden in das PDF eingebettet', xo);
    const tx = await pdfText(fs.readFileSync(ex.student));
    check('Quellenangabe steht als Text im PDF', tx.join(' ').includes('Testbuch Mathe, S. 1'), tx.join(' ').slice(0, 200));
  }
  /* Erneut ausschneiden: Quelle ist vorbelegt */
  await page.evaluate(() => { document.getElementById('filePdf').dataset.mode = 'crop'; });
  await page.setInputFiles('#filePdf', fix);
  await page.waitForSelector('#cr-wrap canvas', { timeout: 10000 });
  check('Ausschneiden: zuletzt benutzte Quelle ist vorbelegt', (await page.inputValue('#cr-cap')) === 'Testbuch Mathe');
  await page.click('.dlg [data-r="0"]');


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
    /* Korrigierte PDFs zurückgeben */
    await page.fill('.dlg [data-cmt="0"]', 'Super gemacht, weiter so!');
    await page.check('.dlg #ev-all');
    const got = [], onDl = d => got.push(d); page.on('download', onDl);
    await page.click('.dlg [data-correct]');
    const t0 = Date.now(); while (got.length < 4 && Date.now() - t0 < 30000) await page.waitForTimeout(100);
    page.off('download', onDl);
    const cf = {};
    for (const d of got) { const f = path.join(OUT, 'korr-' + d.suggestedFilename()); await d.saveAs(f); cf[d.suggestedFilename()] = f; }
    check('Korrigierte PDFs: je Schüler eine Datei plus Sammeldatei', got.length === 4 && cf['Ali - korrigiert.pdf'] && cf['Berta - korrigiert.pdf'] && Object.keys(cf).some(n => / - alle korrigiert\.pdf$/.test(n)), Object.keys(cf).join(', '));
    if (cf['Ali - korrigiert.pdf']) {
      const ta = (await pdfText(fs.readFileSync(cf['Ali - korrigiert.pdf'])))[0], tb = (await pdfText(fs.readFileSync(cf['Berta - korrigiert.pdf'])))[0];
      check('Korrigiert: Ergebnis und Kommentar oben auf dem Blatt', ta.includes('Ergebnis: 12 von 12 richtig (100 %)') && ta.includes('Super gemacht'), ta.slice(0, 120));
      check('Korrigiert: Lösung bei falschen Antworten eingetragen', tb.includes('Ergebnis: 8 von 12 richtig (67 %)') && tb.includes('-> -1') && tb.includes('-> 5'), tb.slice(-160));
      check('Korrigiert: Antworten eingefroren (keine Felder mehr), Antworten sichtbar – auch ohne gespeicherte Ansicht', (await fieldNamesOf(cf['Ali - korrigiert.pdf'])).length === 0 && ta.includes('m = 2') && tb.includes('Berta') && tb.includes('2,0'));
      const perr = f => String(require('child_process').spawnSync('pdftotext', [f, '-']).stderr).trim();
      const errsK = Object.values(cf).map(perr).filter(Boolean);
      check('Korrigierte PDFs fehlerfrei lesbar (poppler)', errsK.length === 0, errsK[0]);
      if (HAVE_PDFTOPPM) {
        const g = pixels(cf['Ali - korrigiert.pdf'], 1, { x: 300, y: 270, w: 260, h: 110 }, (r, gg, b) => gg > 100 && r < 90 && b < 90, false);
        const rd = redRatio(cf['Berta - korrigiert.pdf'], 1, { x: 60, y: 140, w: 480, h: 320 });
        const ra = redRatio(cf['Ali - korrigiert.pdf'], 1, { x: 60, y: 140, w: 480, h: 320 });
        check('Korrigiert: grüne Häkchen, rote Kreuze nur bei Fehlern', g > 0.0005 && rd > 0.0003 && ra < 0.00005, [g, rd, ra].map(v => v.toFixed(5)).join(' / '));
      }
      const all = Object.keys(cf).find(n => / - alle korrigiert\.pdf$/.test(n));
      check('Sammeldatei enthält alle drei Schüler', (await PDFDocument.load(fs.readFileSync(cf[all]))).getPageCount() === 3);
    }
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
  await page.click('#viewSeg [data-vm="base"]');
  check('Ansicht „Arbeitsblatt“: Seite nur fürs Lösungsblatt ist blass markiert', await page.evaluate(() => document.querySelectorAll('.pwrap')[1].classList.contains('off') && !document.querySelectorAll('.pwrap')[0].classList.contains('off')));
  await page.click('#viewSeg [data-vm="sol"]');
  check('Ansicht „+ Lösung“: dieselbe Seite normal', await page.evaluate(() => !document.querySelectorAll('.pwrap')[1].classList.contains('off')));
  await page.click('#viewSeg [data-vm="base"]');
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
  section('16. Vorlagen: Entfernen, Lösungen ausblenden, Lücken, Formularfelder');
  {
    /* Selbst erzeugte Vorlage mit Lösung, Bild und Unterstrichen */
    const d = await PDFDocument.create(), hv = await d.embedFont(StandardFonts.Helvetica);
    const pg1 = d.addPage([595, 842]);
    pg1.drawText('Aufgabe 1: Berechne 3x + 4 = 19.', { x: 60, y: 760, size: 13, font: hv });
    pg1.drawText('Loesung: x = 5', { x: 60, y: 735, size: 13, font: hv });
    pg1.drawText('Aufgabe 2: Antwort: ____________________', { x: 60, y: 690, size: 13, font: hv });
    pg1.drawText('Zwischenergebnis vorher GEHEIM42 nachher Ende.', { x: 60, y: 650, size: 13, font: hv });
    pg1.drawImage(await d.embedPng(fs.readFileSync(path.join(ROOT, 'icon-192.png'))), { x: 60, y: 500, width: 90, height: 90 });
    const ff = path.join(OUT, 'vorlage-loesung.pdf'); fs.writeFileSync(ff, await d.save());
    await page.setInputFiles('#fileOpen', ff);
    await page.waitForFunction(() => document.getElementById('docName').value === 'vorlage-loesung', null, { timeout: 15000 });
    await page.waitForTimeout(500);
    await key('r');
    await page.waitForSelector('.ebox', { timeout: 10000 });
    check('Entfernen: Textzeilen und Bild im PDF erkannt', (await page.locator('.ebox').count()) >= 5 && (await page.locator('.ebox[data-k^="I"]').count()) === 1, await page.locator('.ebox').count());
    await page.click(`#panel [data-eset][data-v='true']`);
    const kL = await S(`(() => { const L = S.lines[S.pages[0].id].list.find(l => /Loesung/.test(l.str)); return L && L.k; })()`);
    await page.locator(`.ebox[data-k="L${kL}"]`).scrollIntoViewIfNeeded(); await page.locator(`.ebox[data-k="L${kL}"]`).click();
    await page.click(`#panel [data-eset][data-v='false']`);
    await page.locator('.ebox[data-k^="I"]').scrollIntoViewIfNeeded(); await page.locator('.ebox[data-k^="I"]').click();
    const wo = await S(`S.objs.filter(o => o.type === 'whiteout').map(o => ({ solShow: !!o.solShow, color: o.color, w: o.w }))`);
    check('Antippen entfernt: Lösung nur für Schüler, Bild überall', wo.length === 2 && wo.filter(o => o.solShow).length === 1 && wo.every(o => o.color === '#ffffff'), JSON.stringify(wo));
    /* Rahmen über einen Teil einer Zeile: nur dieser Teil */
    const hvW = t => hv.widthOfTextAtSize(t, 13), gx = 60 + hvW('Zwischenergebnis vorher '), gw = hvW('GEHEIM42');
    await dragPt(gx - 1, 842 - 650 - 12, gx + gw + 1, 842 - 650 + 4);
    check('Rahmen über einen Teil der Zeile: Abdeckung nur dort', (await S(`S.objs.filter(o => o.type === 'whiteout').length`)) === 3);
    await key('v');
    ex = await exportFiles('vorlage-entfernt', ['student', 'solution']);
    const tS = (await pdfText(fs.readFileSync(ex.student)))[0], tL = (await pdfText(fs.readFileSync(ex.solution)))[0];
    check('Schülerfassung: Lösung und Wort wirklich gelöscht (nicht kopierbar), Rest der Zeile bleibt', !tS.includes('x = 5') && !tS.includes('GEHEIM42') && tS.includes('vorher') && tS.includes('nachher Ende') && tS.includes('Aufgabe 1'), tS);
    check('Lösungsblatt: Lösung aus der Vorlage bleibt sichtbar', tL.includes('Loesung: x = 5') && !tL.includes('GEHEIM42'), tL);
    const imgCount = async f => { const pdf = await PDFDocument.load(fs.readFileSync(f)); let n = 0; for (const [, o] of pdf.context.enumerateIndirectObjects()) if (o.dict && typeof o.dict.lookup === 'function' && String(o.dict.lookup(PDFName.of('Subtype'))) === '/Image') n++; return n; };
    const perr2 = String(require('child_process').spawnSync('pdftotext', [ex.student, '-']).stderr).trim();
    check('PDF mit entfernten Inhalten fehlerfrei lesbar (poppler)', !perr2, perr2);
    check('Entferntes Bild ist auch aus der Datei verschwunden', (await imgCount(ex.student)) === 0 && (await imgCount(ex.solution)) === 0);
    if (HAVE_PDFTOPPM) { const ink = inkRatio(ex.student, 1, { x: 60, y: 842 - 772, w: 200, h: 16 }); check('Übriger Text der Vorlage unverändert sichtbar', ink > 0.05, ink.toFixed(3)); }
    /* Bild nur teilweise abgedeckt: Seite als Bild, Abdeckung eingebrannt */
    if (HAVE_PDFTOPPM) {
      const res = await page.evaluate(async () => {
        const B = window.__bw, S = B.S, p = S.pages[0];
        const keep = S.objs.slice();
        S.objs = S.objs.filter(o => !(o.type === 'whiteout' && o.eraseKey && o.eraseKey.startsWith('I')));
        S.objs.unshift({ id: 'teil', page: p.id, type: 'whiteout', layer: 'base', x: 60, y: 842 - 590, w: 45, h: 45, color: '#ffffff' });
        try { const a = await B.buildPdf(); let s = ''; for (let i = 0; i < a.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, a.bytes.subarray(i, i + 0x8000)); return [btoa(s), a.rasterPages, a.warnings]; }
        finally { S.objs = keep; }
      });
      const rf = path.join(OUT, 'teilbild.pdf'); fs.writeFileSync(rf, Buffer.from(res[0], 'base64'));
      const dir = path.join(OUT, 'teilbild'); fs.mkdirSync(dir, { recursive: true });
      execFileSync('pdfimages', [rf, path.join(dir, 'b')]);
      const img = fs.readdirSync(dir).filter(f => /\.p[gp]m$/.test(f)).map(f => path.join(dir, f))[0];
      /* Das ausgegebene Seitenbild: Bereich unter der Abdeckung muss weiß sein */
      const im = readPnm(fs.readFileSync(img)), k = im.w / 595;
      let dark = 0, n = 0;
      for (let y = Math.floor(254 * k); y < Math.floor(295 * k); y++) for (let x = Math.floor(62 * k); x < Math.floor(103 * k); x++) {
        const i = (y * im.w + x) * im.ch, v = im.ch === 3 ? im.data[i] * 0.299 + im.data[i + 1] * 0.587 + im.data[i + 2] * 0.114 : im.data[i];
        n++; if (v < 200) dark++;
      }
      const py = (dark / n).toFixed(4);
      check('Bild nur teilweise abgedeckt: Seite als Bild, darunter wirklich weiß', res[1].length === 1 && +py < 0.01 && res[2].some(w => /als Bild/.test(w)), res[1] + ' / ' + py);
    }
    /* Lücken erkennen */
    await page.click('#panel [data-act="detect"]');
    await page.waitForTimeout(800);
    check('Lücken erkennen: Unterstrich-Lücke wird zum Feld', (await S(`S.objs.filter(o => o.type === 'field').length`)) === 1 && (await S(`S.objs.find(o => o.type === 'field').x`)) > 150);
    await page.keyboard.press('Control+z');
    check('Rückgängig nimmt erkannte Felder zurück', (await S(`S.objs.filter(o => o.type === 'field').length`)) === 0);
  }
  /* Echte PDFs aus anderen Programmen: GEHEIM42 löschen, Rest bleibt */
  {
    const VOR = path.join(ROOT, 'test', 'vorlagen');
    const words = file => { const x = execFileSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', file, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); return [...x.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] })); };
    const ok = [], bad = [];
    for (const f of ['libreoffice-blocksatz.pdf', 'latex.pdf', 'browserdruck.pdf', 'reportlab.pdf', 'matplotlib-type3.pdf', 'matplotlib-cid.pdf', 'formular-xobject-gedreht.pdf']) {
      const file = path.join(VOR, f);
      if (!HAVE_PDFTOPPM || !fs.existsSync(file)) { bad.push(f + ' fehlt'); continue; }
      const w = words(file).find(v => v.t.includes('GEHEIM42'));
      await page.setInputFiles('#fileOpen', file);
      await page.waitForFunction(n => document.getElementById('docName').value === n, f.replace(/\.pdf$/, ''), { timeout: 15000 });
      const res = await page.evaluate(async ([w, rotated]) => {
        const B = window.__bw, S = B.S, p = S.pages[0];
        /* pdftotext liefert Koordinaten der gedrehten Ansicht – wie Blattwerk */
        S.objs.push({ id: 'g42', page: p.id, type: 'whiteout', layer: 'base', x: w.x0 - 0.5, y: w.y0 - 0.5, w: w.x1 - w.x0 + 1, h: w.y1 - w.y0 + 1, color: '#ffffff' });
        const a = await B.buildPdf(); let s = ''; for (let i = 0; i < a.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, a.bytes.subarray(i, i + 0x8000));
        return [btoa(s), a.rasterPages.length];
      }, [w, false]);
      const of = path.join(OUT, 'geloescht-' + f); fs.writeFileSync(of, Buffer.from(res[0], 'base64'));
      const t = execFileSync('pdftotext', [of, '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      if (!t.includes('GEHEIM42') && t.includes('vorher') && t.includes('nachher') && res[1] === 0) ok.push(f); else bad.push(f + (res[1] ? ' (als Bild)' : '') + ': ' + t.replace(/\s+/g, ' ').slice(0, 80));
    }
    check('Echtes Löschen in PDFs aus LibreOffice, LaTeX, Browser, ReportLab, Matplotlib, Formular-XObject', bad.length === 0, bad.join(' | '));
  }
  /* Lücken in echten Vorlagen */
  {
    const VOR = path.join(ROOT, 'test', 'vorlagen');
    await page.setInputFiles('#fileOpen', path.join(VOR, 'luecken-text.pdf'));
    await page.waitForFunction(() => document.getElementById('docName').value === 'luecken-text', null, { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.click('#panel [data-act="detect"]'); await page.waitForTimeout(800);
    const a = await S(`[S.objs.filter(o => o.type === 'field').length, S.objs.filter(o => o.type === 'check').length]`);
    check('Lücken (LibreOffice): Unterstriche und Punktlinie → 3 Felder, ☐ → 2 Kästchen', a[0] === 3 && a[1] === 2, a.join('/'));
    await page.setInputFiles('#fileOpen', path.join(VOR, 'luecken-linien.pdf'));
    await page.waitForFunction(() => document.getElementById('docName').value === 'luecken-linien', null, { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.click('#panel [data-act="detect"]'); await page.waitForTimeout(800);
    const b = await S(`S.objs.filter(o => o.type === 'field' || o.type === 'check').map(o => o.type + (o.multi ? '+' : ''))`);
    check('Lücken (Linien): 3 Schreiblinien → 1 mehrzeiliges Feld, Einzellinie → Feld, Tabelle und Unterstreichung nicht, 3 Kästchen', b.filter(x => x === 'field+').length === 1 && b.filter(x => x === 'field').length === 1 && b.filter(x => x === 'check').length === 3, b.join(','));
  }
  /* Vorhandene Formularfelder übernehmen, Einfachauswahl und Auswahlliste auswerten */
  {
    const d = await PDFDocument.create(), hv = await d.embedFont(StandardFonts.Helvetica), pg1 = d.addPage([595, 842]), fm = d.getForm();
    pg1.drawText('Formular vom Verlag', { x: 60, y: 780, size: 16, font: hv });
    const t = fm.createTextField('Ergebnis'); t.addToPage(pg1, { x: 60, y: 700, width: 150, height: 20, font: hv });
    const rg = fm.createRadioGroup('Frage1'); rg.addOptionToPage('A', pg1, { x: 60, y: 650, width: 12, height: 12 }); rg.addOptionToPage('B', pg1, { x: 100, y: 650, width: 12, height: 12 }); rg.addOptionToPage('C', pg1, { x: 140, y: 650, width: 12, height: 12 });
    const dd = fm.createDropdown('Aussage'); dd.setOptions(['richtig', 'falsch']); dd.addToPage(pg1, { x: 60, y: 600, width: 120, height: 20, font: hv });
    const cb = fm.createCheckBox('Erledigt'); cb.addToPage(pg1, { x: 60, y: 560, width: 12, height: 12 });
    const ff = path.join(OUT, 'verlagsformular.pdf'); fs.writeFileSync(ff, await d.save());
    await page.setInputFiles('#fileOpen', ff);
    await page.waitForFunction(() => document.getElementById('docName').value === 'verlagsformular', null, { timeout: 15000 });
    const imp = await S(`S.objs.map(o => o.type + ':' + (o.ftype || '') + ':' + (o.group || ''))`);
    check('Formularfelder übernommen: Textfeld, Einfachauswahl (3), Auswahlliste, Kästchen', imp.filter(x => x === 'field:text:').length === 1 && imp.filter(x => x === 'check::Frage1').length === 3 && imp.includes('field:choice:') && imp.includes('check::'), imp.join(' '));
    await page.waitForFunction(() => /Formularfelder übernommen/.test(document.getElementById('toast').textContent), null, { timeout: 5000 }).catch(() => {});
    check('Hinweis nach dem Öffnen nennt die übernommenen Felder', /6 Formularfelder übernommen/.test(await toastText()), await toastText());
    await page.evaluate(() => { const S = window.__bw.S; S.objs.find(o => o.name === 'Ergebnis').solution = '42'; const r = S.objs.filter(o => o.group === 'Frage1'); r[1].correct = true; S.objs.find(o => o.ftype === 'choice').solution = 'falsch'; window.__bw.renderAll(); });
    ex = await exportFiles('verlag', ['student']);
    const pdf = await PDFDocument.load(fs.readFileSync(ex.student)), kinds = pdf.getForm().getFields().map(f => f.constructor.name + ':' + f.getName()).sort();
    const widgetsOnPage = pdf.getPage(0).node.Annots().asArray().map(r => pdf.context.lookup(r)).filter(d => String(d.lookup(PDFName.of('Subtype'))) === '/Widget').length;
    check('Export: alte Feld-Widgets entfernt (6 statt 12)', widgetsOnPage === 6, widgetsOnPage);
    check('Export: Felder ersetzt, nicht verdoppelt (Radio, Dropdown, Text, Kästchen)', kinds.join(',') === ['PDFCheckBox:Erledigt', 'PDFDropdown:Aussage', 'PDFRadioGroup:Frage1', 'PDFTextField:Ergebnis'].join(','), kinds.join(','));
    const fill = async (name, f) => { const x = await PDFDocument.load(fs.readFileSync(ex.student)), g = x.getForm(); f(g); const o = path.join(OUT, name); fs.writeFileSync(o, await x.save()); return o; };
    const opts = pdf.getForm().getRadioGroup('Frage1').getOptions();
    const s1 = await fill('verlag-a.pdf', g => { g.getTextField('Ergebnis').setText('42'); g.getRadioGroup('Frage1').select(opts[1]); g.getDropdown('Aussage').select('falsch'); });
    const s2 = await fill('verlag-b.pdf', g => { g.getTextField('Ergebnis').setText('41'); g.getRadioGroup('Frage1').select(opts[2]); g.getDropdown('Aussage').select('richtig'); });
    await page.setInputFiles('#fileEval', [s1, s2]);
    await page.waitForSelector('.dlg .evtable', { timeout: 15000 });
    const rows = await page.locator('.dlg .evtable').nth(1).locator('tr').allTextContents();
    check('Auswertung von Einfachauswahl und Auswahlliste', rows.some(r => r.startsWith('verlag-a3/3100 %')) && rows.some(r => r.startsWith('verlag-b0/30 %')), rows.slice(1).map(r => r.slice(0, 16)).join(' | '));
    await page.click('.dlg [data-r="1"]');
  }
  /* In Blattwerk angelegt: Einfachauswahl, Auswahlliste, Ziffernkästchen, automatische Schriftgröße, Prüfbericht */
  {
    await page.evaluate(() => { window.__bw.newSheet(false, { bg: 'white' }); document.getElementById('docName').value = 'Feldarten'; });
    await key('k'); await clickAt(80, 100); await key('k'); await clickAt(80, 130); await key('k'); await clickAt(80, 160);
    const ids = await S(`S.objs.filter(o => o.type === 'check').map(o => o.id)`);
    await page.evaluate(ids => window.__bw.selectIds(ids), ids);
    await page.click('#panel [data-act="radio-join"]');
    check('Als Einfachauswahl verbinden: runde Optionsfelder', (await S(`new Set(S.objs.filter(o => o.type === 'check').map(o => o.group)).size`)) === 1 && (await page.locator('.o-check .cb.round').count()) === 3);
    await key('Escape');
    await key('f'); await dragPt(80, 220, 280, 242);
    await page.click(`#panel button[data-set="ftype"][data-v='"choice"']`);
    check('Auswahlliste mit Vorgabe richtig/falsch', JSON.stringify((await sel()).choices) === '["richtig","falsch"]' && (await page.locator('.obj.sel .drop').count()) === 1);
    await key('Escape');
    await key('f'); await dragPt(80, 280, 200, 302);
    await page.click(`#panel button[data-set="ftype"][data-v='"comb"']`);
    check('Ziffernkästchen (4)', (await sel()).comb === 4);
    await key('Escape');
    await key('f'); await dragPt(80, 340, 280, 352);
    await page.check('#p-autoSize');
    await key('Escape');
    const chk = await page.evaluate(() => window.__bw.formCheck());
    check('Prüfbericht: niedriges Feld mit Auto-Schrift ist in Ordnung', !chk.warn.some(w => /zu niedrig/.test(w)), chk.warn.join(' | '));
    await page.evaluate(() => { const S = window.__bw.S; const f = S.objs.filter(o => o.type === 'field').pop(); f.autoSize = false; S.objs.push(Object.assign({}, f, { id: 'dupl', x: f.x + 20, autoSize: false })); window.__bw.renderAll(); });
    const chk2 = await page.evaluate(() => window.__bw.formCheck());
    check('Prüfbericht: zu niedrig, Überlappung, doppelter Name', chk2.warn.some(w => /zu niedrig/.test(w)) && chk2.warn.some(w => /überlappen/.test(w)) && chk2.warn.some(w => /heißen/.test(w)), chk2.warn.length);
    await page.click('#btnExport');
    check('Exportdialog zeigt die Hinweise', /Bitte prüfen/.test(await page.textContent('.dlg')));
    await page.click('.dlg [data-r="1"]');
    await page.waitForTimeout(2500);
    await page.evaluate(() => { const S = window.__bw.S; S.objs = S.objs.filter(o => o.id !== 'dupl'); S.objs.filter(o => o.type === 'field').pop().autoSize = true; window.__bw.renderAll(); });
    ex = await exportFiles('feldarten', ['student']);
    const pdf = await PDFDocument.load(fs.readFileSync(ex.student)), fo = pdf.getForm();
    const kinds = fo.getFields().map(f => f.constructor.name);
    const comb = fo.getFields().find(f => f.constructor.name === 'PDFTextField' && f.getMaxLength && f.getMaxLength() === 4);
    const auto = fo.getFields().filter(f => f.constructor.name === 'PDFTextField').some(f => / 0 Tf/.test(f.acroField.getDefaultAppearance() || ''));
    check('Export: Optionsfeld-Gruppe, Auswahlliste, Ziffernkästchen, automatische Schriftgröße', kinds.includes('PDFRadioGroup') && kinds.includes('PDFDropdown') && !!comb && comb.isCombed() && auto, kinds.join(','));
  }
  /* Platz schaffen auf einer PDF-Seite */
  {
    await page.setInputFiles('#fileOpen', fix);
    await page.waitForFunction(() => window.__bw.S.pages.length === 3 && document.getElementById('docName').value === 'vorlage', null, { timeout: 15000 });
    await page.click('#panel [data-act="split"]');
    await clickAt(300, 842 - 705, 0);
    check('Seite geteilt: eine Seite mehr, zwei Abdeckungen', (await S('S.pages.length')) === 4 && (await S(`S.objs.filter(o => o.type === 'whiteout' && o.split).length`)) === 2);
    ex = await exportFiles('geteilt', ['student']);
    const tx = await pdfText(fs.readFileSync(ex.student));
    check('Geteilte Seite: oberer Teil auf Seite 1, unterer Teil nur auf Seite 2', tx[0].includes('Aufgabe 1') && !tx[0].includes('Aufgabe 2') && tx[1].includes('Aufgabe 2') && !tx[1].includes('Aufgabe 1') && !tx[1].includes('Klassenarbeit'), tx.slice(0, 2).join(' || '));
  }

  /* ================================================================ */
  section('17. Fotografiertes Blatt aufbereiten');
  {
    await page.evaluate(() => window.__bw.newSheet(false));
    await page.setInputFiles('#fileImg', path.join(ROOT, 'test', 'vorlagen', 'foto-blatt.jpg'));
    const t = await page.waitForSelector('.tst button:has-text("Gerade ziehen")', { timeout: 10000 }).catch(() => null);
    check('Foto eines Blatts wird erkannt und Aufbereiten angeboten', !!t);
    if (t) await t.click(); else await page.click('#panel [data-act="scan"]');
    await page.waitForSelector('#sc-prev canvas', { timeout: 10000 });
    const q = await page.evaluate(() => [...document.querySelectorAll('.sch')].map(h => [parseFloat(h.style.left) / 100, parseFloat(h.style.top) / 100]));
    const want = [[0.2625, 0.0692], [0.7438, 0.1154], [0.7875, 0.9385], [0.2188, 0.9]];
    const dev = Math.max(...q.map((p, i) => Math.hypot(p[0] - want[i][0], p[1] - want[i][1])));
    check('Blattecken automatisch gefunden (auf 1,5 % genau)', dev < 0.015, dev.toFixed(4));
    await page.click('.dlg [data-mode="bw"]');
    await page.click('.dlg [data-r="1"]');
    await page.waitForFunction(() => !document.querySelector('.dlg') && !document.querySelector('.busy'), null, { timeout: 20000 });
    const im = await sel();
    check('Aufbereitet: Original bleibt erhalten, Format DIN A (√2)', im.orig && im.img !== im.orig && im.scan && im.scan.mode === 'bw' && Math.abs(im.h / im.w - Math.SQRT2) < 0.01, JSON.stringify({ w: im.w, h: im.h, s: im.scan }));
    /* Pixel prüfen: Marke oben links (10–20 % der Seite) schwarz, Rand weiß, nur Schwarz und Weiß */
    const px = await page.evaluate(async () => {
      const S = window.__bw.S, o = S.objs.find(x => x.id === S.sel), im = new Image();
      await new Promise(r => { im.onload = r; im.src = S.imgs[o.img].url; });
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const at = (fx, fy) => g.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data[0];
      const d = g.getImageData(0, 0, c.width, c.height).data; let mid = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 40 && d[i] < 215) mid++;
      return { mark: at(0.15, 0.15), corner: [at(0.03, 0.03), at(0.97, 0.03), at(0.03, 0.97), at(0.04, 0.5)], mid: mid / (d.length / 4), mime: S.imgs[o.img].mime };
    });
    check('Entzerrt: Marke an der richtigen Stelle, Ränder und Schattenseite weiß', px.mark < 60 && px.corner.every(v => v > 230), JSON.stringify(px));
    check('Schwarzweiß als PNG ohne Grautöne', px.mime === 'image/png' && px.mid < 0.01, JSON.stringify(px));
    await page.click('#panel [data-act="imgfill"]');
    const f = await sel();
    check('„Seite füllen“ setzt das Blatt formatfüllend auf die Seite', f.x >= 0 && f.y >= 0 && f.x + f.w <= 595.3 && f.y + f.h <= 841.9 && (f.w > 595.3 - 40 || f.h > 841.9 - 40), JSON.stringify(f));
    await page.fill('#p-caption', 'Foto: eigenes Blatt');
    ex = await exportFiles('foto', ['student']);
    const tx = await pdfText(fs.readFileSync(ex.student));
    check('Foto-PDF: Quellenangabe enthalten', tx[0].includes('Foto: eigenes Blatt'), tx[0].slice(0, 120));
    if (HAVE_PDFTOPPM) {
      const r = inkRatio(ex.student, 1, { x: f.x + f.w * 0.11, y: f.y + f.h * 0.11, w: f.w * 0.08, h: f.h * 0.08 });
      check('Foto-PDF: Marke sichtbar an der entzerrten Stelle', r > 0.9, r && r.toFixed(3));
    }
    /* Undo stellt das Original zurück; erneut bearbeiten beginnt mit den gespeicherten Ecken */
    await page.click('#panel [data-act="imgorig"]');
    await page.waitForFunction(() => { const S = window.__bw.S, o = S.objs.find(x => x.id === S.sel); return o && !o.orig && !o.scan; }, null, { timeout: 10000 });
    const o2 = await sel();
    check('„Original“ stellt das unbearbeitete Foto wieder her', Math.abs(o2.h / o2.w - 1300 / 1600) < 0.01, o2.w + 'x' + o2.h);
    await page.click('#btnUndo');
    const o3 = await sel();
    check('Rückgängig bringt die aufbereitete Fassung zurück', o3 && o3.scan && o3.scan.mode === 'bw');
    /* Speichern: nur gebrauchte Bilder */
    const kept = await page.evaluate(() => Object.keys(window.__bw.usedImgs()).length);
    check('Gespeichert werden nur Original und aktuelle Fassung', kept === 2, kept);
    const rt = await page.evaluate(() => { const B = window.__bw, r = B.cleanState(JSON.parse(B.projectJSON())), o = r.objs.find(x => x.type === 'image'); return { cap: o.caption, orig: !!r.imgs[o.orig], scan: o.scan, n: Object.keys(r.imgs).length }; });
    check('Projektdatei behält Quellenangabe, Original und Einstellungen', rt.cap === 'Foto: eigenes Blatt' && rt.orig && rt.scan && rt.scan.mode === 'bw' && rt.scan.q.length === 4 && rt.n === 2, JSON.stringify(rt));
  }

  section('18. Texterkennung (Scans und Fotos)');
  {
    const norm = t => t.replace(/\s+/g, ' ').trim();
    /* Foto aus Abschnitt 17: Text im Bild erkennen */
    await page.click('#panel [data-act="ocr-img"]');
    await page.waitForFunction(() => window.__bw.S.objs.some(o => o.type === 'image' && o.ocr), null, { timeout: 90000 });
    const fl = await page.evaluate(() => window.__bw.ocrLines(window.__bw.S.pages[0].id).map(l => l.str));
    check('Foto: Text erkannt (Überschrift und 14 Aufgaben)', fl.some(t => /Arbeitsblatt Brüche/.test(t)) && fl.filter(t => /^Aufgabe \d+: Kürze den Bruch 12\/18/.test(t)).length >= 13, fl.slice(0, 4).join(' | '));
    /* Eine Zeile auf dem Foto umschreiben: Abdeckung muss über dem Foto liegen */
    const fz = await page.evaluate(() => window.__bw.ocrLines(window.__bw.S.pages[0].id).find(l => /^Aufgabe 1:/.test(l.str)));
    await page.click('[data-tool="edittext"]');
    await page.click(`.lnbox[data-k="${fz.k}"]`); await page.waitForTimeout(300);
    await page.keyboard.press('Control+a'); await page.keyboard.type('Aufgabe 1: neu.');
    await page.click('[data-tool="select"]'); await page.waitForTimeout(200);
    await page.click(`[data-id="${(await page.evaluate(() => window.__bw.S.objs.find(o => o.type === 'image').id))}"]`);
    ex = await exportFiles('foto-ocr', ['student']);
    if (HAVE_PDFTOPPM) {
      const r = inkRatio(ex.student, 1, { x: fz.x + fz.w * 0.55, y: fz.base - fz.fs * 0.7, w: fz.w * 0.4, h: fz.fs * 0.6 });
      check('Foto: umgeschriebene Zeile – alter Text ist im PDF abgedeckt', r < 0.01, r && r.toFixed(3));
    }
    const ft = (await pdfText(fs.readFileSync(ex.student)))[0];
    check('Foto-PDF: erkannter Text durchsuchbar, umgeschriebene Zeile ersetzt', /Aufgabe 7: Kürze den Bruch 12\/18/.test(ft) && ft.includes('Foto: eigenes Blatt') && ft.includes('Aufgabe 1: neu.') && !/Aufgabe 1: Kürze/.test(ft), ft.slice(0, 160));
    await page.click('#panel [data-act="scan"]');
    await page.waitForSelector('#sc-prev canvas', { timeout: 10000 });
    await page.click('.dlg [data-mode="gray"]'); await page.click('.dlg [data-r="1"]');
    await page.waitForFunction(() => !document.querySelector('.dlg') && !document.querySelector('.busy'), null, { timeout: 20000 });
    check('Neu aufbereitetes Foto: alte Erkennung verfällt', !(await sel()).ocr);
    await page.evaluate(() => window.__bw.ocrRelease(true));

    /* Eingescanntes PDF */
    await page.setInputFiles('#fileOpen', path.join(ROOT, 'test', 'vorlagen', 'scan-bruchrechnung.pdf'));
    await page.waitForFunction(() => document.getElementById('docName').value === 'scan-bruchrechnung', null, { timeout: 15000 });
    const offer = await page.waitForSelector('#panel [data-act="ocr"]', { timeout: 10000 }).catch(() => null);
    check('Scan-Seite: „Text erkennen“ wird angeboten', !!offer);
    await page.click('[data-tool="edittext"]');
    const hint = await page.waitForSelector('.tst button:has-text("Text erkennen")', { timeout: 8000 }).catch(() => null);
    check('„Text ändern“ auf einem Scan bietet die Erkennung an', !!hint);
    const t0 = Date.now();
    if (hint) await hint.click(); else await page.click('#panel [data-act="ocr"]');
    await page.waitForFunction(() => window.__bw.S.pages[0].ocr, null, { timeout: 90000 });
    const secs = (Date.now() - t0) / 1000;
    const L = await page.evaluate(() => window.__bw.ocrLines(window.__bw.S.pages[0].id).map(l => ({ k: l.k, t: l.str, fs: l.fs, low: l.low.length })));
    const want = ['Aufgabe 1: Kürze die folgenden Brüche so weit wie möglich.', 'Ein Bruch ist vollständig gekürzt, wenn Zähler und Nenner', 'Von den 28 Schülerinnen und Schülern fahren drei Viertel mit', 'Kinder fahren mit dem Bus? Schreibe deinen Rechenweg auf.', 'Aufgabe 3: Welcher Anteil des Kreises ist grau gefärbt?'];
    check('Scan: Zeilen wortgenau erkannt (Umlaute, ß, Satzzeichen)', want.every(w => L.some(l => norm(l.t) === w)), L.map(l => l.t).join(' | '));
    check('Scan: Lückenlinien sind kein Text', !L.some(l => /_{2,}|ER$/.test(l.t)) && L.some(l => norm(l.t) === 'Name: Datum:'), L.map(l => l.t).join(' | '));
    const body = L.filter(l => /^(Ein|Von|dem|Kinder|keinen)/.test(l.t)).map(l => l.fs);
    check('Scan: Schriftgröße geschätzt (12 pt ± 1,5)', body.length >= 4 && body.every(f => Math.abs(f - 12) < 1.5), body.map(f => f.toFixed(1)).join(','));
    check('Scan: Erkennung dauert keine Ewigkeit (< 30 s)', secs < 30, secs.toFixed(1) + ' s');
    await page.waitForSelector('.lnbox.ocr', { timeout: 5000 });
    check('Erkannte Zeilen sind mit „Text ändern“ antippbar', (await page.locator('.lnbox.ocr').count()) === L.length, await page.locator('.lnbox.ocr').count());
    /* Eine Zeile umschreiben */
    const k2 = L.find(l => l.t.startsWith('Aufgabe 2')).k;
    await page.click(`.lnbox[data-k="${k2}"]`); await page.waitForTimeout(300);
    await page.keyboard.press('Control+a'); await page.keyboard.type('Aufgabe 2: Die Klasse 7a plant einen Ausflug ins Museum.');
    await page.click('[data-tool="select"]'); await page.waitForTimeout(200);
    /* Eine Zeile entfernen */
    await page.click('[data-tool="erase"]');
    const k3 = L.find(l => l.t.startsWith('Aufgabe 3')).k;
    await page.waitForSelector(`.ebox.ocr[data-k="L${k3}"]`, { timeout: 8000 });
    await page.click(`.ebox.ocr[data-k="L${k3}"]`);
    await page.click('[data-tool="select"]');
    ex = await exportFiles('scan-ocr', ['student']);
    const tx = (await pdfText(fs.readFileSync(ex.student)))[0];
    check('Scan-PDF: unsichtbare Textebene durchsuchbar', /Von den 28 Schülerinnen und Schülern fahren drei Viertel mit/.test(tx) && /Schreibe deinen Rechenweg auf\./.test(tx), tx.slice(0, 200));
    check('Scan-PDF: umgeschriebene Zeile nur in neuer Fassung', tx.includes('7a plant einen Ausflug ins Museum') && !tx.includes('6b plant') && !tx.includes('in den Zoo'), tx.slice(0, 300));
    check('Scan-PDF: entfernte Zeile auch unsichtbar nicht mehr enthalten', !tx.includes('Anteil des Kreises') && !tx.includes('grau gefärbt'), tx);
    {
      /* Wortbreiten im PDF passen zu den Wörtern im Scan (Markieren, Vorlesen mit Hervorhebung) */
      const doc = await pdfjsNode.getDocument({ data: new Uint8Array(fs.readFileSync(ex.student)), isEvalSupported: false, verbosity: 0 }).promise;
      const items = (await (await doc.getPage(1)).getTextContent()).items.filter(i => i.str.trim()); await doc.destroy();
      const ol = await page.evaluate(() => window.__bw.ocrLines(window.__bw.S.pages[0].id).map(l => ({ t: l.str, w: l.w })));
      const ratios = [];
      for (const l of ol) { const it = items.find(i => i.str.replace(/\s+/g, ' ').trim() === l.t); if (it) ratios.push(it.width / l.w); }
      ratios.sort((a, b) => a - b);
      const med = ratios[ratios.length >> 1], worst = Math.max(...ratios.map(r => Math.abs(r - 1)));
      check('Scan-PDF: unsichtbarer Text liegt genau über den Zeilen im Bild', ratios.length >= 6 && worst < 0.03, `${ratios.length} Zeilen, Median ${med && med.toFixed(3)}, max. Abweichung ${worst.toFixed(3)}`);
    }
    if (HAVE_PDFTOPPM) {
      const pt = execFileSync('pdftotext', ['-layout', ex.student, '-']).toString();
      check('Scan-PDF: Text auch für poppler lesbar (Wortabstände)', /Kinder fahren mit dem Bus\? Schreibe deinen Rechenweg auf\./.test(pt), pt.slice(0, 300));
      /* Unsichtbar heißt unsichtbar: gleiche Pixel wie ohne Textebene */
      const a = raster(ex.student, 1, 72);
      await page.evaluate(() => { const B = window.__bw; B.S.pages[0].ocr0 = B.S.pages[0].ocr; delete B.S.pages[0].ocr; });
      const ex2 = await exportFiles('scan-ohne-ocr', ['student']);
      await page.evaluate(() => { const B = window.__bw; B.S.pages[0].ocr = B.S.pages[0].ocr0; delete B.S.pages[0].ocr0; });
      const b2 = raster(ex2.student, 1, 72);
      let diff = 0; for (let i = 0; i < a.data.length; i++) diff = Math.max(diff, Math.abs(a.data[i] - b2.data[i]));
      check('Scan-PDF: Textebene verändert das Aussehen nicht', a.data.length === b2.data.length && diff <= 2, diff);
    }
    /* Speichern und Laden */
    const rt = await page.evaluate(() => { const B = window.__bw, r = B.cleanState(JSON.parse(B.projectJSON())); return r.pages[0].ocr && r.pages[0].ocr.lines.length; });
    check('Projektdatei behält die Erkennung', rt === L.length, rt);
    /* Lesefreundliche Kopie aus dem Scan */
    await page.evaluate(() => window.__bw.readableCopy());
    await page.waitForFunction(() => /lesefreundlich/.test(document.getElementById('docName').value), null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const rc = await page.evaluate(() => { const S = window.__bw.S; return { sid: S.pages[0].sid, n: S.pages.length, texts: S.objs.filter(o => o.type === 'text').map(o => ({ t: o.text, s: o.size })), imgs: S.objs.filter(o => o.type === 'image').map(o => ({ w: o.w, h: o.h })) }; });
    const all = rc.texts.map(t => t.t).join('\n');
    check('Lesefreundlich aus Scan: echte Seite statt Bild, Text übernommen', rc.sid === null && all.includes('Wie viele Kinder fahren mit dem Bus?') && all.includes('7a plant'), all.slice(0, 200));
    check('Lesefreundlich: Absätze zusammengeführt, Lücken als Unterstriche', /Ein Bruch ist vollständig gekürzt, wenn Zähler und Nenner keinen/.test(all) && /Name: _{5,} Datum: _{5,}/.test(all), all.slice(0, 300));
    check('Lesefreundlich: entfernte Zeile bleibt weg, keine Dopplung', !all.includes('Anteil des Kreises') && !all.includes('6b plant'), all);
    check('Lesefreundlich: Abbildung (Kreis) als Bild übernommen', rc.imgs.length === 1 && Math.abs(rc.imgs[0].w - 145) < 15 && Math.abs(rc.imgs[0].h - 145) < 15, JSON.stringify(rc.imgs));
    check('Lesefreundlich: Schrift mindestens 13 pt', rc.texts.every(t => t.s >= 13), rc.texts.map(t => t.s).join(','));
    await page.evaluate(() => window.__bw.ocrRelease(true));
    check('Texterkennung gibt den Speicher wieder frei', await page.evaluate(() => !window.__bw.OCR.worker));
  }

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
    /* Nachbau von cordova-plugin-purchase 13: nur, was Blattwerk aufruft */
    window.__kauf = { orders: 0, finished: 0, registered: null, platforms: null };
    const h = { productUpdated: [], approved: [], finished: [], receiptUpdated: [] };
    const product = { id: 'de.blattwerk.app.vollversion', owned: false, pricing: { price: '3,99 €' },
      getOffer: () => ({ order: async () => { window.__kauf.orders++; const t = { products: [{ id: product.id }], finish: () => { window.__kauf.finished++; } }; setTimeout(() => h.approved.forEach(f => f(t)), 20); } }) };
    const when = {};
    for (const k of Object.keys(h)) when[k] = f => { h[k].push(f); return when; };
    window.CdvPurchase = {
      ProductType: { NON_CONSUMABLE: 'non consumable' }, Platform: { APPLE_APPSTORE: 'ios-appstore', GOOGLE_PLAY: 'android-playstore' },
      LogLevel: { WARNING: 1 }, ErrorCode: { PAYMENT_CANCELLED: 6777006 },
      store: { verbosity: 0, register: p => { window.__kauf.registered = p; }, when: () => when, error: () => {},
        initialize: async pl => { window.__kauf.platforms = pl; setTimeout(() => h.productUpdated.forEach(f => f(product)), 10); return []; },
        get: id => id === product.id ? product : undefined, owned: () => false, update: async () => {}, restorePurchases: async () => undefined }
    };
  });
  await app.goto(base);
  await app.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await app.evaluate(() => window.__bw.newSheet(true));
  await app.waitForTimeout(100);
  const k0 = await app.evaluate(() => ({ reg: window.__kauf.registered, pl: window.__kauf.platforms, price: window.__bw.Voll.price, voll: window.__bw.hasVoll(), lk: !!document.querySelector('.tool.lk') }));
  check('App: Vollversion beim Store angemeldet (nicht verbrauchbar, App Store), Preis vom Store, gesperrt', k0.reg && k0.reg[0].id === 'de.blattwerk.app.vollversion' && k0.reg[0].type === 'non consumable' && k0.pl && k0.pl[0] === 'ios-appstore' && k0.price === '3,99 €' && !k0.voll && k0.lk, JSON.stringify(k0));
  await app.evaluate(() => window.__bw.vollDialog('loesung'));
  await app.click('.dlg [data-voll="buy"]');
  await app.waitForFunction(() => window.__bw.hasVoll(), null, { timeout: 3000 }).catch(() => {});
  const k1 = await app.evaluate(() => ({ voll: window.__bw.hasVoll(), o: window.__kauf.orders, f: window.__kauf.finished, saved: localStorage.getItem('bw:voll'), dlg: !!document.querySelector('.dlg .voll'), lk: !!document.querySelector('.lk') }));
  check('App: Kauf über den Store schaltet frei und schließt die Transaktion ab', k1.voll && k1.o === 1 && k1.f === 1 && k1.saved === '1' && !k1.dlg && !k1.lk, JSON.stringify(k1));
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
  await app.evaluate(() => document.dispatchEvent(new Event('backbutton')));
  check('Android-Zurücktaste im Editor führt zum Startbildschirm', await app.isVisible('#home'));
  await app.click('#home [data-h="settings"]');
  await app.evaluate(() => document.dispatchEvent(new Event('backbutton')));
  await app.waitForSelector('#home [data-h="sample"]', { timeout: 3000 }).catch(() => {});
  check('Zurücktaste in den Einstellungen führt zur Startseite', (await app.locator('#home [data-h="sample"]').count()) === 1);
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
  /* ================================================================ */
  section('Einfache Bedienung: wenige Werkzeuge, Text antippen, Ansicht = Fassung');
  await page.evaluate(() => { const B = window.__bw; B.P.mode = 'simple'; B.savePrefs(); B.buildTools(); B.setTool('select'); });
  const visTools = async () => page.evaluate(() => [...document.querySelectorAll('#tools [data-tool]')].filter(b => b.offsetParent).map(b => b.dataset.tool).join(','));
  check('Einfach: nur sechs Grundwerkzeuge plus „Mehr“', (await visTools()) === 'select,text,highlight,erase,image,field' && await page.isVisible('#toolsMore'), await visTools());
  await page.click('#toolsMore');
  check('„Mehr“ klappt alle übrigen Werkzeuge auf', (await visTools()).split(',').length === 17);
  await page.click('[data-tool="coord"]');
  check('Werkzeug aus „Mehr“ gewählt: Leiste klappt zu, gewähltes bleibt sichtbar', (await visTools()) === 'select,text,highlight,erase,image,field,coord' && (await S('S.tool')) === 'coord', await visTools());
  await key('v');
  await page.setInputFiles('#fileOpen', fix);
  await page.waitForFunction(() => window.__bw.S.pages.length === 3 && window.__bw.S.objs.length === 0, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  check('Einfach: Klassenarbeit, Formular-Werkzeuge und Tastenkürzel nicht im Seitenpanel', !/Tastenkürzel|Klassenarbeit|Formular prüfen/.test(await page.textContent('#panel')));
  await page.waitForFunction(() => window.__bw.S.pages.every(p => window.__bw.S.lines[p.id] && window.__bw.S.lines[p.id].list), null, { timeout: 5000 }).catch(() => {});
  check('Zeilen aller PDF-Seiten werden im Hintergrund gelesen', await S(`S.pages.every(p => S.lines[p.id] && S.lines[p.id].list) && S.lines[S.pages[2].id].list.length > 0`));
  const ln0 = await S(`(() => { const L = S.lines[S.pages[0].id].list.find(l => /Aufgabe 2/.test(l.str)); return { x: L.x + 20, y: L.base - L.fs * 0.3, k: L.k }; })()`);
  await clickAt(ln0.x, ln0.y);
  await page.waitForTimeout(200);
  check('Auswählen: Text im PDF antippen macht ihn bearbeitbar', (await S(`(() => { const o = S.objs.find(o => o.fromLine === '${ln0.k}'); return !!o && S.editing === o.id; })()`)));
  await page.keyboard.press('End'); await page.keyboard.type(' ok'); await key('Escape');
  check('Direkt geänderter Text übernommen', /ok$/.test(await S(`S.objs.find(o => o.fromLine === '${ln0.k}').text`)));
  /* Zeilen einer Seite noch nicht gelesen: Der Tipp wird nachgeholt */
  const ln2 = await S(`(() => { const p = S.pages[2], L = S.lines[p.id].list[0]; delete S.lines[p.id]; return { x: L.x + 10, y: L.base - L.fs * 0.3, k: L.k, pid: p.id }; })()`);
  await key('Escape'); await page.evaluate(() => window.__bw.selectIds([]));
  await clickAt(ln2.x, ln2.y, 2); await page.waitForTimeout(400);
  check('Tipp auf noch nicht gelesene Seite ändert den Text trotzdem', await S(`S.objs.some(o => o.page === '${ln2.pid}' && o.fromLine === '${ln2.k}')`));
  await key('Escape'); await page.evaluate(() => window.__bw.selectIds([]));
  /* Maus: Rahmen ziehen, der auf Text beginnt, wählt weiterhin aus */
  const before = await S('S.objs.length');
  await dragPt(ln0.x - 30, ln0.y - 40, ln0.x + 400, ln0.y + 10);
  check('Maus: Rahmenauswahl ab einer Textzeile wandelt nichts um', (await S('S.objs.length')) === before && (await S('S.multi.length || (S.sel ? 1 : 0)')) >= 1, await S('S.objs.length') + '/' + before);
  await key('Escape'); await page.evaluate(() => window.__bw.selectIds([]));
  await page.click('#viewSeg [data-vm="sol"]');
  check('Ansicht „+ Lösung“: Hilfen und Lösungen sichtbar, Neues auf Lösungsebene', (await S(`S.layer === 'sol' && S.view.help && S.view.sol`)));
  await key('t'); await clickAt(300, 400); await page.keyboard.type('Lösung 42'); await key('Escape');
  const solTxt = await S(`S.objs.find(o => o.text === 'Lösung 42')`);
  check('Text in „+ Lösung“ landet rot auf der Lösungsebene', solTxt && solTxt.layer === 'sol' && solTxt.color === '#c62828', JSON.stringify(solTxt && { l: solTxt.layer, c: solTxt.color }));
  await key('f'); await dragPt(300, 470, 420, 492);
  const fld = await sel();
  check('Textfeld in „+ Lösung“ gehört trotzdem zum Arbeitsblatt', fld && fld.type === 'field' && fld.layer === 'base', fld && fld.layer);
  await page.click('#viewSeg [data-vm="base"]');
  check('Ansicht „Arbeitsblatt“ blendet die Lösung aus', (await S(`!S.view.help && !S.view.sol && S.layer === 'base'`)) && (await page.locator(`.obj[data-id="${solTxt.id}"]`).count()) === 0);
  await page.evaluate(id => window.__bw.selectIds([id]), fld.id);
  check('Feld gewählt in „Arbeitsblatt“: Hinweis, wo die Lösung zu sehen ist', await page.isVisible('#panel [data-act="view-sol"]'));
  await page.click('#panel [data-act="view-sol"]');
  check('Hinweis-Knopf wechselt zu „+ Lösung“, Auswahl bleibt', (await S(`S.layer === 'sol' && S.sel === '${fld.id}'`)) && !(await page.isVisible('#panel [data-act="view-sol"]')));
  await key('Escape'); await page.click('#viewSeg [data-vm="base"]');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
  await page.selectOption('#viewSel', 'help');
  check('iPhone-Breite: Ansicht als Auswahlliste', (await page.isVisible('#viewSel')) && !(await page.isVisible('#viewSeg')) && (await S(`S.layer`)) === 'help');
  await page.selectOption('#viewSel', 'base');
  await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(250);
  await page.evaluate(() => { const B = window.__bw; B.P.mode = 'all'; B.savePrefs(); B.buildTools(); });

  /* Einstellungen und Farben der Werkzeuge */
  await page.evaluate(() => window.__bw.flushSave());
  await page.reload(); await page.waitForSelector('html[data-ready="1"]');
  check('Nach Neustart erscheint der Startbildschirm', await page.isVisible('#home'));
  await page.evaluate(() => window.__bw.hideHome());
  await page.click('#btnHome');
  await page.click('#home [data-h="settings"]');
  await page.click(`#home [data-pset="textColor"][data-v='"#c62828"']`);
  await page.click(`#home [data-pset="size"][data-v='14']`);
  await page.click(`#home [data-pset="theme"][data-v='"dark"']`);
  await page.click(`#home [data-pset="start"][data-v='"last"']`);
  check('Einstellungen: dunkle Darstellung sofort aktiv', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.reload(); await page.waitForSelector('html[data-ready="1"]');
  check('Einstellung „zuletzt bearbeitetes Blatt“: kein Startbildschirm, Einstellungen bleiben', !(await page.isVisible('#home')) && (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.evaluate(() => window.__bw.newSheet(false, { bg: 'white' }));
  await key('t'); await clickAt(80, 300); await page.keyboard.type('Rot'); await key('Escape');
  const tr = await S(`S.objs.find(o => o.type === 'text' && o.text === 'Rot')`);
  check('Neuer Text in Farbe und Größe aus den Einstellungen', tr && tr.color === '#c62828' && tr.size === 14, tr && tr.color + '/' + tr.size);
  await key('m');
  await page.click(`#panel [data-pref="markColor"][data-v='"#9ef07a"']`);
  await dragPt(80, 400, 300, 414);
  check('Werkzeug-Farbe vorab gewählt: Markierung grün', (await S(`S.objs.filter(o => o.type === 'highlight').pop().color`)) === '#9ef07a');
  await key('l');
  await page.click(`#panel [data-pref="linesColor"][data-v='"#8aa2e6"']`);
  await dragPt(80, 450, 400, 550);
  check('Schreiblinien in gewählter Farbe', (await S(`S.objs.filter(o => o.type === 'lines').pop().color`)) === '#8aa2e6');
  await page.click('#btnHome'); await page.click('#home [data-h="settings"]');
  await page.click('#home [data-h="reset"]'); await page.click('.dlg [data-r="1"]');
  check('Einstellungen zurücksetzen', (await page.evaluate(() => window.__bw.P.textColor === '#000000' && window.__bw.P.start === 'home' && !document.documentElement.dataset.theme)));
  check('Nach dem Zurücksetzen: einfache Werkzeugleiste sofort aktiv', await page.evaluate(() => window.__bw.P.mode === 'simple' && !!document.getElementById('toolsMore')));
  await page.evaluate(() => window.__bw.hideHome());
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

  /* ================================================================ */
  section('iPad mit Finger, Grundeinstellungen: die drei Aufgaben aus BEDIENTEST.md');
  {
    const tctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, acceptDownloads: true });
    const tp = await tctx.newPage();
    tp.on('pageerror', e => errs.push('iPad-Seitenfehler: ' + e.message));
    tp.on('console', m => { if (m.type() === 'error') errs.push('iPad-Konsole: ' + m.text()); });
    const TS = expr => tp.evaluate(`(() => { const S = window.__bw.S, B = window.__bw; return (${expr}); })()`);
    /* Finger auf einen Punkt der Seite (pt) */
    const tap = async (x, y, i = 0) => {
      await tp.evaluate(([y, i]) => { const st = document.getElementById('stage'), pg = document.querySelectorAll('.page')[i]; const r = pg.getBoundingClientRect(), sr = st.getBoundingClientRect(); st.scrollTop += r.top + y * window.__bw.S.zoom - (sr.top + sr.height / 2); }, [y, i]);
      await tp.waitForTimeout(80);
      const b = await tp.locator('.page').nth(i).boundingBox(), z = await TS('S.zoom');
      await tp.touchscreen.tap(b.x + x * z, b.y + y * z); await tp.waitForTimeout(300);
    };
    const tapEl = async sel => { await tp.locator(sel).tap(); await tp.waitForTimeout(150); };
    await tp.goto(base); await tp.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    check('iPad: neue Installation startet „Einfach“ und in Ansicht „Arbeitsblatt“', await TS(`B.P.mode === 'simple' && S.layer === 'base' && !!document.getElementById('toolsMore')`));
    await tp.evaluate(() => window.__bw.hideHome());
    check('iPad hochkant: Ansicht als Knopfreihe, Neu und Meine Blätter sichtbar', (await tp.isVisible('#viewSeg')) && (await tp.isVisible('#btnNew')) && (await tp.isVisible('#btnOpen')));
    check('iPad hochkant: kein seitliches Scrollen, alle Grundwerkzeuge und „Mehr“ sichtbar', (await tp.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) &&
      (await tp.evaluate(() => [...document.querySelectorAll('#tools .tool')].filter(b => b.offsetParent).every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }))) && (await tp.isVisible('#toolsMore')));

    /* Aufgabe 1: Zahl ändern, Aufgabe löschen, teilen */
    await tp.setInputFiles('#fileOpen', fix);
    await tp.waitForFunction(() => window.__bw.S.pages.length === 3, null, { timeout: 15000 });
    await tap(100, 148);   /* „Aufgabe 2: Loese die Gleichung 3x + 4 = 19.“ – sofort nach dem Öffnen */
    await tp.waitForTimeout(400);
    const ed = await TS(`(() => { const o = S.objs.find(o => o.fromLine && /Aufgabe 2/.test(o.text)); return o ? { id: o.id, editing: S.editing === o.id } : null; })()`);
    check('Aufgabe 1: Finger auf Textzeile (gleich nach dem Öffnen) → Zeile bearbeitbar', !!(ed && ed.editing), JSON.stringify(ed));
    await tp.keyboard.press('End'); for (let i = 0; i < 3; i++) await tp.keyboard.press('Backspace'); await tp.keyboard.type('25.');
    await tap(300, 700);
    check('Aufgabe 1: Tipp daneben beendet das Bearbeiten, nichts weiter umgewandelt', (await TS(`!S.editing && !S.sel && S.objs.filter(o => o.fromLine).length === 1`)) && /= 25\.$/.test(await TS(`B.find('${ed && ed.id}').text`)));
    await tapEl('[data-tool="erase"]');
    await tap(100, 118);   /* „Aufgabe 1: …“ entfernen */
    check('Aufgabe 1: „Entfernen“ mit dem Finger', await TS(`S.objs.some(o => o.type === 'whiteout' && o.erase)`));
    await tapEl('[data-tool="select"]');
    let tx = await exportFiles('ipad-aufgabe1', ['student'], tp);
    const t1 = tx.student ? (await pdfText(fs.readFileSync(tx.student)))[0] : '';
    check('Aufgabe 1: geteiltes PDF hat die neue Zahl, die alte und die gelöschte Aufgabe fehlen', !tx.dialog && /3x \+ 4 = 25/.test(t1) && !/= 19/.test(t1) && !/Aufgabe 1/.test(t1), t1.slice(0, 160));

    /* Aufgabe 2: ausfüllbar mit Lösung und Lösungsblatt */
    await tapEl('[data-tool="field"]');
    await tap(320, 200);
    const fid2 = await TS('S.sel');
    check('Aufgabe 2: Textfeld per Fingertipp gesetzt, auf dem Arbeitsblatt', await TS(`(B.find('${fid2}') || {}).type === 'field' && B.find('${fid2}').layer === 'base'`));
    check('Aufgabe 2: Panel erklärt, wo die Lösung erscheint', await tp.isVisible('#panel [data-act="view-sol"]'));
    await tp.fill('#p-solution', '7');
    await tp.waitForTimeout(150);
    await tapEl('[data-tool="select"]');
    tx = await exportFiles('ipad-aufgabe2', ['student', 'solution'], tp);
    check('Aufgabe 2: Dialog bietet Schülerfassung und Lösungsblatt', tx.dialog && !!tx.student && !!tx.solution);
    const nStud = tx.student ? (await fieldNamesOf(tx.student)).length : 0, tSol = tx.solution ? (await pdfText(fs.readFileSync(tx.solution)))[0] : '';
    check('Aufgabe 2: Schülerfassung hat das ausfüllbare Feld, Lösungsblatt zeigt „7“', nStud >= 1 && /(^|\s)7(\s|$)/.test(tSol), nStud + ' / ' + tSol.slice(0, 120));

    /* Aufgabe 3: Scan – Wort ändern, Hilfe nur für die Hilfen-Fassung */
    await tp.setInputFiles('#fileOpen', path.join(ROOT, 'test', 'vorlagen', 'scan-bruchrechnung.pdf'));
    await tp.waitForFunction(() => document.getElementById('docName').value === 'scan-bruchrechnung', null, { timeout: 15000 });
    await tp.waitForTimeout(300);
    await tap(150, 160);
    const offer = await tp.waitForSelector('.tst button:has-text("Text erkennen")', { timeout: 8000 }).catch(() => null);
    check('Aufgabe 3: Finger auf Scan → Texterkennung wird angeboten', !!offer);
    if (offer) {
      await offer.tap();
      await tp.waitForFunction(() => !!window.__bw.S.pages[0].ocr, null, { timeout: 120000 }).catch(() => {});
      const L = await TS(`(() => { const l = B.ocrLines(S.pages[0].id).find(l => l.str.length > 8); return l && { x: l.x + Math.min(20, l.w / 2), y: l.base - l.fs * 0.3, str: l.str }; })()`);
      check('Aufgabe 3: Text erkannt', !!L, L && L.str);
      if (L) {
        await tap(L.x, L.y);
        check('Aufgabe 3: erkannte Zeile mit dem Finger bearbeitbar', await TS(`!!S.editing && !!B.find(S.editing).fromLine`));
        await tp.keyboard.press('End'); await tp.keyboard.type(' geändert');
        await tap(40, 780);
      }
      await tapEl('#viewSeg [data-vm="help"]');
      await tapEl('[data-tool="text"]');
      await tap(60, 800); await tp.keyboard.type('Tipp: erst kürzen');
      await tap(500, 40);
      const hint3 = await TS(`S.objs.find(o => o.text === 'Tipp: erst kürzen')`);
      check('Aufgabe 3: Hilfe in Ansicht „+ Hilfen“ landet auf der Hilfe-Ebene', hint3 && hint3.layer === 'help', hint3 && hint3.layer);
      tx = await exportFiles('ipad-aufgabe3', ['student', 'help'], tp);
      const ts3 = tx.student ? (await pdfText(fs.readFileSync(tx.student))).join(' ') : '', th3 = tx.help ? (await pdfText(fs.readFileSync(tx.help))).join(' ') : '';
      check('Aufgabe 3: Hilfe nur in der Fassung „mit Hilfen“, Änderung in beiden', !/erst kürzen/.test(ts3) && /erst kürzen/.test(th3) && /geändert/.test(ts3) && /geändert/.test(th3), ts3.slice(0, 80) + ' || ' + th3.slice(0, 80));
    }
    await tp.setViewportSize({ width: 1180, height: 820 }); await tp.waitForTimeout(300);
    check('iPad quer: breite Leiste links, Ansicht-Knöpfe, kein seitliches Scrollen', (await tp.isVisible('#viewSeg')) && (await tp.evaluate(() => document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.getElementById('tools')).flexDirection === 'column')));
    await tp.screenshot({ path: path.join(OUT, 'ipad-quer.png') });
    await tp.setViewportSize({ width: 820, height: 1180 }); await tp.waitForTimeout(300);
    await tp.screenshot({ path: path.join(OUT, 'ipad-hochkant.png') });
    await tctx.close();
  }

  /* ================================================================ */
  section('Vollversion: In-App-Kauf (Store simuliert mit ?kauf=test)');
  check('Im Browser ohne Store ist alles frei', await S('B.hasVoll() && !document.querySelector(".tool.lk")'));
  {
    const vctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const vp = await vctx.newPage();
    const verrs = [];
    vp.on('pageerror', e => verrs.push('Seitenfehler: ' + e.message));
    vp.on('console', m => { if (m.type() === 'error') verrs.push('Konsole: ' + m.text()); });
    await vp.addInitScript(() => { try { if (!localStorage.getItem('bw:prefs')) localStorage.setItem('bw:prefs', JSON.stringify({ mode: 'all', start: 'last' })); } catch (e) {} });
    const VS = expr => vp.evaluate(`(() => { const S = window.__bw.S, B = window.__bw; return (${expr}); })()`);
    const paywall = () => vp.locator('.dlg .voll').count().then(n => n === 1);
    const closePay = async () => { if (await paywall()) await vp.click('.dlg [data-voll="close"]'); };
    const vtoast = () => vp.evaluate(() => [...document.querySelectorAll('.tst span')].map(s => s.textContent).join(' | '));
    const kauf = base + '?kauf=test';
    await vp.goto(kauf);
    await vp.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    check('Startbildschirm gratis: Knopf „Vollversion“', (await vp.locator('#home [data-h="voll"]').count()) === 1);
    await VS('B.hideHome()');
    check('Gratis: Vollversion nicht freigeschaltet, Preis 3,99 €', await VS('!B.hasVoll() && B.Voll.price === "3,99 €"'));
    check('Gratis: Formel, Koordinaten, QR-Code mit Schloss; Text, Textfeld, Tabelle, Punkte ohne', await VS(`['formula','coord','qr'].every(t => document.querySelector('[data-tool="' + t + '"]').classList.contains('lk')) && ['text','field','table','points','shape','check'].every(t => !document.querySelector('[data-tool="' + t + '"]').classList.contains('lk'))`));
    check('Gratis: „+ Hilfen“ und „+ Lösung“ mit Schloss', await VS(`['help','sol'].every(k => document.querySelector('#viewSeg [data-vm="' + k + '"]').classList.contains('lk')) && !document.querySelector('#viewSeg [data-vm="base"]').classList.contains('lk')`));

    await vp.click('[data-tool="formula"]');
    check('Formel antippen öffnet den Kauf-Hinweis, Werkzeug bleibt „Auswählen“', await paywall() && (await VS('S.tool')) === 'select');
    check('Kauf-Hinweis nennt die Funktion, alle vier Bereiche, Preis und Wiederherstellen', /Mathe-Werkzeuge/.test(await vp.textContent('.dlg .voll li.on')) && (await vp.locator('.dlg .voll li').count()) === 4 &&
      /3,99 €/.test(await vp.textContent('.dlg [data-voll="buy"]')) && (await vp.locator('.dlg [data-voll="restore"]').count()) === 1);
    await vp.screenshot({ path: path.join(OUT, 'vollversion-hinweis.png') });
    await vp.click('.dlg [data-voll="close"]');
    check('„Später“ schließt den Hinweis', !(await paywall()));
    await vp.click('.page'); await vp.keyboard.press('Escape');
    await vp.keyboard.press('y');
    check('Tastenkürzel für Formel führt ebenfalls zum Hinweis', await paywall() && (await VS('S.tool')) === 'select');
    await closePay();

    await vp.click('#viewSeg [data-vm="sol"]');
    check('„+ Lösung“ gesperrt: Hinweis, Ansicht bleibt Arbeitsblatt', await paywall() && (await VS('S.layer')) === 'base' && (await vp.getAttribute('#viewSeg [data-vm="base"]', 'aria-pressed')) === 'true');
    await closePay();
    await vp.selectOption('#viewSel', 'help').catch(() => {});
    check('Auswahlliste (schmal) gesperrt: bleibt beim Arbeitsblatt', (await VS('S.layer')) === 'base' && (await vp.inputValue('#viewSel')) === 'base');
    await closePay();

    await vp.click('[data-tool="shape"]');
    check('Formen: Strecke, Rechteck frei; Dreieck, Kreis, Winkel mit Schloss', await VS(`!document.querySelector('[data-act="shape-line"]').classList.contains('lk') && !document.querySelector('[data-act="shape-rect"]').classList.contains('lk') && ['triangle','circle','angle'].every(k => document.querySelector('[data-act="shape-' + k + '"]').classList.contains('lk'))`));
    await vp.click('[data-act="shape-triangle"]');
    check('Dreieck wählen führt zum Hinweis, Form bleibt Strecke', await paywall() && (await VS('S.shape')) === 'line');
    await closePay();
    await vp.click('[data-act="shape-rect"]');
    check('Rechteck bleibt frei wählbar', (await VS('S.shape')) === 'rect' && !(await paywall()));
    await vp.click('[data-tool="select"]');

    const tb = await VS(`(() => { const o = S.objs.find(o => o.type === 'text' && (o.layer || 'base') === 'base'); B.selectIds([o.id]); B.setLayer('sol'); return [o.layer || 'base', S.layer]; })()`);
    check('Element auf „Lösung“ legen gesperrt', tb[0] === 'base' && tb[1] === 'base' && await paywall(), tb);
    await closePay();
    await VS('B.selectIds([])');

    const files = await exportFiles('voll-gratis', ['student', 'help', 'solution'], vp);
    check('Export gratis: Schülerfassung ja, Hilfen und Lösungsblatt gesperrt', files.dialog && !!files.student && !files.help && !files.solution, Object.keys(files).join(','));

    let chooser = false; const onFc = () => { chooser = true; };
    vp.on('filechooser', onFc);
    await VS('B.hideHome()');
    const ev = vp.locator('#panel [data-act="evaluate"]');
    if (await ev.count()) { check('„Ausgefüllte PDFs auswerten“ mit Schloss', await ev.evaluate(b => b.classList.contains('lk'))); await ev.click(); }
    else await VS('document.querySelector("#panel") && B.needVoll("auswertung")');
    await vp.waitForTimeout(300);
    check('Auswerten gesperrt: Hinweis statt Dateiauswahl', await paywall() && !chooser && /Rücklauf/.test(await vp.textContent('.dlg .voll li.on')));
    vp.off('filechooser', onFc);
    await closePay();

    await VS(`B.ocrPages([S.cur])`);
    check('Texterkennung gesperrt', await paywall() && /Texterkennung/.test(await vp.textContent('.dlg .voll li.on')) && await VS('!S.pages.some(p => p.ocr)'));
    await closePay();
    const np = await VS('S.pages.length');
    await VS('B.addHorizon()');
    check('Erwartungshorizont gesperrt', await paywall() && (await VS('S.pages.length')) === np);
    await closePay();
    check('Vorhandenes Koordinatensystem bleibt sichtbar und wählbar', await VS(`(() => { const o = S.objs.find(o => ['coord', 'formula'].includes(o.type) && (o.layer || 'base') === 'base'); if (!o) return false; B.selectIds([o.id]); return !!document.querySelector('.obj[data-id="' + o.id + '"]') && S.sel === o.id; })()`));
    await VS('B.selectIds([])');

    await VS(`B.showHome('settings')`);
    check('Einstellungen: Abschnitt Vollversion mit Kaufen und Wiederherstellen', /Vollversion/.test(await vp.textContent('#home')) && (await vp.locator('#home [data-h="voll"], #home [data-h="voll-restore"]').count()) === 2);
    await vp.click('#home [data-h="voll-restore"]');
    await vp.waitForTimeout(300);
    check('Wiederherstellen ohne Kauf: Meldung, bleibt gesperrt', !(await VS('B.hasVoll()')) && /keine Vollversion gekauft/.test(await vtoast()), await vtoast());
    await vp.click('#home [data-h="voll"]');
    await vp.click('.dlg [data-voll="buy"]');
    await vp.click('.dlg [data-r="1"]');
    await vp.waitForTimeout(200);
    check('Kauf: freigeschaltet, Dank, Hinweis geschlossen, gespeichert', await VS('B.hasVoll()') && /Danke/.test(await vtoast()) && !(await paywall()) && (await vp.evaluate(() => localStorage.getItem('bw:voll'))) === '1');
    check('Nach dem Kauf: Einstellungen zeigen „Freigeschaltet“', /Freigeschaltet/.test(await vp.textContent('#home')));
    await VS('B.hideHome()');
    check('Nach dem Kauf: keine Schlösser mehr', await VS(`!document.querySelector('.lk')`));
    await vp.click('[data-tool="formula"]');
    check('Nach dem Kauf: Formel-Werkzeug wählbar', (await VS('S.tool')) === 'formula' && !(await paywall()));
    await vp.click('[data-tool="select"]');
    await vp.click('#viewSeg [data-vm="sol"]');
    check('Nach dem Kauf: „+ Lösung“ wählbar', (await VS('S.layer')) === 'sol');
    const f2 = await exportFiles('voll-gekauft', ['student', 'help', 'solution'], vp);
    check('Nach dem Kauf: alle drei Fassungen', !!(f2.student && f2.help && f2.solution), Object.keys(f2).join(','));

    await vp.reload(); await vp.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    check('Kauf bleibt nach Neustart erhalten', await VS('B.hasVoll()'));

    /* Gerätespeicher verloren: wieder gesperrt, Ansicht „+ Lösung“ aus den Einstellungen fällt still aufs Arbeitsblatt */
    await vp.evaluate(() => { localStorage.removeItem('bw:voll'); const p = JSON.parse(localStorage.getItem('bw:prefs') || '{}'); p.view = 'sol'; localStorage.setItem('bw:prefs', JSON.stringify(p)); });
    await vp.reload(); await vp.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    check('Ohne gespeicherten Kauf wieder gesperrt; Start ohne Hinweis im Arbeitsblatt', !(await VS('B.hasVoll()')) && (await VS('S.layer')) === 'base' && !(await paywall()));
    await VS(`B.showHome('settings')`);
    await vp.click('#home [data-h="voll-restore"]');
    await vp.waitForTimeout(300);
    check('Käufe wiederherstellen schaltet frei', await VS('B.hasVoll()') && /Danke/.test(await vtoast()));

    /* Schmales Gerät und dunkle Darstellung */
    await vp.evaluate(() => localStorage.removeItem('bw:voll'));
    await vp.setViewportSize({ width: 390, height: 844 });
    await vp.emulateMedia({ colorScheme: 'dark' });
    await vp.reload(); await vp.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    await VS('B.vollDialog("loesung")');
    check('iPhone: Kauf-Hinweis passt in die Breite, Knöpfe sichtbar', await vp.evaluate(() => { const b = document.querySelector('.dlg .voll').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }) && await vp.isVisible('.dlg [data-voll="buy"]'));
    await vp.screenshot({ path: path.join(OUT, 'vollversion-iphone-dunkel.png') });
    check('Keine Fehler im Kauf-Ablauf', verrs.length === 0, verrs.slice(0, 3).join(' / '));
    await vctx.close();
    /* Bild für die Prüfung des In-App-Kaufs in App Store Connect (iPhone, 3-fach) */
    const rctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'light' });
    const rp = await rctx.newPage();
    await rp.addInitScript(() => { try { localStorage.setItem('bw:prefs', JSON.stringify({ start: 'last' })); } catch (e) {} });
    await rp.goto(kauf); await rp.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    await rp.evaluate(() => { window.__bw.hideHome(); window.__bw.vollDialog(); });
    await rp.waitForTimeout(200);
    await rp.screenshot({ path: path.join(OUT, 'vollversion-review.png') });
    await rctx.close();
  }

  check('Keine Fehler während des ganzen Laufs', errs.length === 0, errs.slice(0, 3).join(' / '));
  await browser.close(); srv.close();
}

main().catch(e => { fail++; results.push('  ✗ Testlauf abgebrochen: ' + (e && e.stack || e)); })
  .finally(() => {
    console.log(results.join('\n'));
    console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
    process.exit(fail ? 1 : 0);
  });
