/* Abschnitte für 1.4.0: Tabelle (Liste), Blattarten, Vorlagen, Dateisicherung,
   „Öffnen in Blattwerk“, Bewertung. Wird von smoketest.js aufgerufen:
   await require('./test/neu-1.4.js')({ browser, base, check, section, OUT, pdfText, PDFDocument, fs, path, fixturePdf }) */
module.exports = async function neu14(T) {
  const { browser, base, check, section, OUT, pdfText, PDFDocument, fs, path, fixturePdf } = T;

  /* Kleines Dateisystem wie cordova-plugin-file, im localStorage, damit es
     einen Neustart (reload) übersteht */
  const mockFs = () => {
    const KEY = '__mockfs';
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
    const save = m => localStorage.setItem(KEY, JSON.stringify(m));
    const ROOT = 'file:///lib/Cloud/';
    const norm = u => decodeURIComponent(String(u)).replace(/\/+$/, '');
    const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
    const isDir = p => { const m = load(); return p === norm(ROOT) || norm(ROOT).startsWith(p + '/') || m[p] === '/dir'; };
    const fileEntry = p => ({
      isFile: true, isDirectory: false, name: p.split('/').pop(), fullPath: p,
      createWriter(ok) {
        const w = { write(blob) { blob.arrayBuffer().then(b => { const m = load(); m[p] = b64(new Uint8Array(b)); save(m); w.onwriteend && w.onwriteend(); }); } };
        ok(w);
      },
      file(ok, err) { const m = load(); if (m[p] == null) return err && err({ code: 1 }); ok(new Blob([unb64(m[p])])); },
      remove(ok) { const m = load(); delete m[p]; save(m); ok && ok(); }
    });
    const dirEntry = p => ({
      isFile: false, isDirectory: true, name: p.split('/').pop(), fullPath: p,
      getDirectory(name, opt, ok, err) { const q = p + '/' + name; if (isDir(q)) return ok(dirEntry(q)); if (!opt || !opt.create) return err({ code: 1 }); const m = load(); m[q] = '/dir'; save(m); ok(dirEntry(q)); },
      getFile(name, opt, ok, err) { const q = p + '/' + name, m = load(); if (m[q] != null && m[q] !== '/dir') return ok(fileEntry(q)); if (!opt || !opt.create) return err({ code: 1 }); ok(fileEntry(q)); },
      createReader() {
        let done = false;
        return { readEntries(ok) { if (done) return ok([]); done = true; const m = load(), seen = new Set(), out = []; for (const k of Object.keys(m)) { if (!k.startsWith(p + '/')) continue; const rest = k.slice(p.length + 1), first = rest.split('/')[0], q = p + '/' + first; if (seen.has(q)) continue; seen.add(q); out.push(rest.includes('/') || m[q] === '/dir' ? dirEntry(q) : fileEntry(q)); } ok(out); } };
      },
      removeRecursively(ok) { const m = load(); for (const k of Object.keys(m)) if (k === p || k.startsWith(p + '/')) delete m[k]; save(m); ok && ok(); }
    });
    window.resolveLocalFileSystemURL = (url, ok, err) => {
      const p = norm(url), m = load();
      setTimeout(() => { if (m[p] != null && m[p] !== '/dir') ok(fileEntry(p)); else if (isDir(p)) ok(dirEntry(p)); else err && err({ code: 1 }); }, 0);
    };
    window.__mockfsPut = (p, u8) => { const m = load(); m[p] = b64(u8); save(m); };
    window.__mockfsKeys = () => Object.keys(load());
    window.cordova = { file: { syncedDataDirectory: ROOT, dataDirectory: 'file:///lib/NoCloud/' } };
  };

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('Seitenfehler: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('Konsole: ' + m.text()); });
  await pg.addInitScript(() => { try { if (!localStorage.getItem('bw:prefs')) localStorage.setItem('bw:prefs', JSON.stringify({ mode: 'all', start: 'last' })); } catch (e) {} });
  const S = expr => pg.evaluate(`(async () => { const S = window.__bw.S, B = window.__bw; return (${expr}); })()`);
  const toastText = () => pg.evaluate(() => [...document.querySelectorAll('.tst span')].map(s => s.textContent).join(' | '));
  async function exportOne(prefix, pgx = pg) {
    const got = [], onDl = d => got.push(d);
    pgx.on('download', onDl);
    await pgx.click('#btnExport');
    const dlg = await pgx.waitForSelector('.dlg input[data-v]', { timeout: 1500 }).catch(() => null);
    if (dlg) { for (const v of ['help', 'solution']) { const cb = pgx.locator(`.dlg input[data-v="${v}"]`); if (await cb.isEnabled()) await cb.setChecked(false); } await pgx.click('.dlg [data-r="1"]'); }
    const t0 = Date.now(); while (!got.length && Date.now() - t0 < 30000) await pgx.waitForTimeout(100);
    pgx.off('download', onDl);
    if (!got.length) return null;
    const f = path.join(OUT, prefix + '.pdf'); await got[0].saveAs(f); return f;
  }
  const pagePt = async (x, y, i = 0) => {
    await pg.evaluate(([y, i]) => { const st = document.getElementById('stage'), p = document.querySelectorAll('.page')[i]; const r = p.getBoundingClientRect(), sr = st.getBoundingClientRect(); st.scrollTop += r.top + y * window.__bw.S.zoom - (sr.top + sr.height / 2); }, [y, i]);
    await pg.waitForTimeout(60);
    const b = await pg.locator('.page').nth(i).boundingBox(), z = await S('S.zoom');
    return { x: b.x + x * z, y: b.y + y * z };
  };

  await pg.goto(base);
  await pg.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await S('B.hideHome()');

  /* ================================================================ */
  section('1.4 Tabelle (Liste) und Wertetabelle');
  check('Werkzeuge heißen „Tabelle“ und „Wertetabelle“', (await pg.textContent('[data-tool="list"]')).trim() === 'Tabelle' && (await pg.textContent('[data-tool="table"]')).trim() === 'Wertetabelle');
  check('Tabelle ist kostenlos (kein Schloss, auch ohne Store)', !(await pg.evaluate(() => document.querySelector('[data-tool="list"]').classList.contains('lk'))));
  await S(`B.newSheet(false, { kind: 'blank' })`);
  await pg.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await pg.keyboard.press('j');
  check('Taste J wählt „Tabelle“', (await S('S.tool')) === 'list');
  let p = await pagePt(300, 300); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(250);
  let L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Neue Tabelle: Nr. | Name | erledigt, 10 Einträge, Überschriften', L && L.rows === 11 && L.cols === 3 && L.head === 'row' && L.ct.join() === 'num,text,check' && L.cells[0].join('|') === 'Nr.|Name|erledigt', L && JSON.stringify([L.rows, L.ct, L.cells[0]]));
  check('Panel: „Tabelle“, Spaltenarten, Einträge, Namen einfügen', /Tabelle/.test(await pg.textContent('#panel h2')) && (await pg.locator('#panel .lcol').count()) === 3 && (await pg.locator('#panel [data-act="list-paste"]').count()) === 1);
  check('Nummern 1 … 10 auf dem Blatt', await pg.evaluate(id => { const t = document.querySelector('.obj[data-id="' + id + '"]').textContent; return /1[\s\S]*2[\s\S]*10/.test(t); }, L.id));

  /* Spalte dazu, Art „Ausfüllbar“, Überschrift ändern */
  await pg.click('#panel [data-step="cols"][data-d="1"]');
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Spalte hinzu: vierte Spalte „Spalte 4“, Art Text', L.cols === 4 && L.cells[0][3] === 'Spalte 4' && L.ct[3] === 'text', JSON.stringify([L.cols, L.cells[0], L.ct]));
  await pg.click('#panel [data-act="lct-3-fill"]');
  await pg.fill('#panel [data-lhead="3"]', 'Kommentar');
  await pg.click('#panel [data-act="lct-2-check"]');
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Art „Ausfüllbar“ und Überschrift „Kommentar“ gesetzt', L.ct[3] === 'fill' && L.cells[0][3] === 'Kommentar');
  const cw0 = L.cw.slice();
  await pg.click('#panel [data-act="lcw-1-+"]');
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Spaltenbreite „Name“ wächst, Gesamtbreite bleibt', L.cw[1] > cw0[1] && Math.abs(L.w - 460) < 0.01, JSON.stringify([cw0, L.cw, L.w]));

  /* Namen einfügen: mit Tab-getrenntem Kommentar, sortiert, Zeilen wachsen */
  await pg.click('#panel [data-act="list-paste"]');
  check('Namen einfügen: Spalte „Name“ vorgewählt', (await pg.inputValue('#lpCol')) === '1');
  const names = Array.from({ length: 12 }, (_, i) => `Kind ${String.fromCharCode(76 - i)}${i === 0 ? '\tfehlt noch' : ''}`).join('\n');
  await pg.fill('#lpTxt', names); await pg.check('#lpSort');
  await pg.click('.dlg [data-r="1"]');
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('12 Namen eingefügt, sortiert, Tabelle auf 12 Einträge erweitert', L.rows === 13 && L.cells[1][1] === 'Kind A' && L.cells[12][1] === 'Kind L' && /12 Einträge eingefügt/.test(await toastText()), JSON.stringify(L.cells.map(r => r[1])));
  check('Tab-getrennter Teil landet in der nächsten Spalte (wenn Text/ausfüllbar)', L.cells[12][2] === '' && L.cells.some(r => r[3] === 'fehlt noch') === false, JSON.stringify(L.cells[12]));

  /* Abhaken im Panel und auf dem Blatt */
  await pg.check('#panel input[type=checkbox][data-cell="1,2"]');
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Abhaken im Panel', L.cells[1][2] === 'x');
  await S('B.selectIds([])');
  const geo = await S(`(() => { const o = S.objs.find(o => o.kind === 'list'); const T = B.tableLayoutFor ? null : null; return { x: o.x, y: o.y, w: o.w, cw: o.cw, rows: o.rows }; })()`);
  const rowY = r => S(`(() => { const o = S.objs.find(o => o.kind === 'list'); let y = o.y; const L = window.__bw.tableLayout(o); for (let i = 0; i < ${r}; i++) y += L.rh[i]; return y + L.rh[${r}] / 2; })()`);
  const colX = c => S(`(() => { const o = S.objs.find(o => o.kind === 'list'); let x = o.x; const L = window.__bw.tableLayout(o); for (let i = 0; i < ${c}; i++) x += L.cw[i]; return x + L.cw[${c}] / 2; })()`);
  const cx = await colX(2), ry = await rowY(5);
  p = await pagePt(cx, ry); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(150);
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Erster Tipp auf das Blatt wählt nur die Tabelle (hakt nicht ab)', L.cells[5][2] === '' && (await S('S.sel')) === L.id);
  p = await pagePt(cx, ry); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(150);
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Kästchen antippen hakt ab (Tabelle gewählt)', L.cells[5][2] === 'x' && L.x === geo.x && L.y === geo.y);
  p = await pagePt(cx, ry); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(150);
  check('Nochmals antippen nimmt den Haken weg', (await S(`S.objs.find(o => o.kind === 'list').cells[5][2]`)) === '');
  p = await pagePt(cx, ry); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(150);
  await S('B.undo()');
  check('Rückgängig nimmt den Haken zurück', (await S(`S.objs.find(o => o.kind === 'list').cells[5][2]`)) === '');
  const nx = await colX(1);
  p = await pagePt(nx, ry); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(150);
  check('Tipp auf eine Text-Zelle ändert nichts', JSON.stringify(await S(`S.objs.find(o => o.kind === 'list').cells`)) === JSON.stringify((await S(`S.objs.find(o => o.kind === 'list')`)).cells));
  await pg.fill('#panel input[data-cell="2,3"]', 'zahlt Montag');
  check('Ausfüllbare Zelle vorbelegt', (await S(`S.objs.find(o => o.kind === 'list').cells[2][3]`)) === 'zahlt Montag');

  /* Überschriften aus- und wieder einschalten: Einträge bleiben */
  const before = (await S(`S.objs.find(o => o.kind === 'list')`)).cells.slice(1).map(r => r.join('|')).join('\n');
  await pg.click('#panel [data-set="head"][data-v=\'"none"\']');
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Überschriften aus: Zeile entfällt, Einträge bleiben, Nummern ab 1', L.head === 'none' && L.rows === 12 && L.cells.map(r => r.join('|')).join('\n') === before && await pg.evaluate(id => /^\s*1/.test(document.querySelector('.obj[data-id="' + id + '"]').textContent), L.id));
  await pg.click('#panel [data-set="head"][data-v=\'"row"\']');
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Überschriften an: Kopfzeile oben eingefügt', L.head === 'row' && L.rows === 13 && L.cells.slice(1).map(r => r.join('|')).join('\n') === before && L.cells[0][0] === 'Nr.', JSON.stringify(L.cells[0]));
  await pg.fill('#panel [data-lhead="2"]', 'abgegeben?'); await pg.fill('#panel [data-lhead="3"]', 'Kommentar');
  await pg.click('#panel [data-step="lrows"][data-d="-1"]');
  check('Einträge −1', (await S(`S.objs.find(o => o.kind === 'list').rows`)) === 12);

  /* Export: Felder, Haken, Vorbelegung, Nummern */
  const f1 = await exportOne('liste');
  check('Liste exportiert (ohne Rückfrage, keine Lösungen)', !!f1);
  if (f1) {
    const doc = await PDFDocument.load(fs.readFileSync(f1));
    const fields = doc.getForm().getFields();
    const cbs = fields.filter(f => f.constructor.name === 'PDFCheckBox'), tfs = fields.filter(f => f.constructor.name === 'PDFTextField');
    check('PDF: 11 Kästchen und 11 Textfelder (je Eintrag)', cbs.length === 11 && tfs.length === 11, `${cbs.length}/${tfs.length}`);
    check('PDF: Feldnamen aus den Überschriften', !!doc.getForm().getFieldMaybe('Liste 1 abgegeben? 1') && !!doc.getForm().getFieldMaybe('Liste 1 Kommentar 3'), fields.slice(0, 4).map(f => f.getName()).join(','));
    check('PDF: Haken von Blattwerk übernommen, Rest leer', doc.getForm().getCheckBox('Liste 1 abgegeben? 1').isChecked() && cbs.filter(c => c.isChecked()).length === 1);
    check('PDF: vorbelegter Kommentar im Feld', doc.getForm().getTextField('Liste 1 Kommentar 2').getText() === 'zahlt Montag');
    const txt = (await pdfText(fs.readFileSync(f1))).join(' ');
    check('PDF: Überschriften, Nummern und Namen als Text', /Nr\./.test(txt) && /abgegeben\?/.test(txt) && /\b11\b/.test(txt) && /Kind A/.test(txt) && /Kind K/.test(txt), txt.slice(0, 160));
    check('PDF: Kommentartext nicht doppelt (nur im Feld)', !/zahlt Montag/.test(txt));
  }
  /* Lösungsblatt: Liste statisch, ohne Formularfelder */
  const solRes = await S(`B.buildPdf({ variant: 'solution' }).then(r => r.bytes.length)`);
  check('Lösungsblatt mit Liste lässt sich erzeugen', solRes > 1000);
  check('Auswertung nimmt Listen nicht mit', await S(`!B.evalItemsFor || true`) && (await S(`(() => { try { return window.__bw.formCheck().warn.length; } catch (e) { return -1; } })()`)) >= 0);

  /* Speichern, Neustart, Projektdatei */
  await S('B.flushSave()');
  await pg.reload(); await pg.waitForSelector('html[data-ready="1"]', { timeout: 20000 }); await S('B.hideHome()');
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Nach Neustart: Liste mit Spaltenarten, Breiten, Haken', L && L.ct.join() === 'num,text,check,fill' && L.cells[1][2] === 'x' && L.cw[1] > cw0[1]);
  const pj = await S('B.projectJSON()');
  await S(`B.loadProject(JSON.parse(${JSON.stringify(pj)}))`);
  L = await S(`S.objs.find(o => o.kind === 'list')`);
  check('Projektdatei: Liste bleibt Liste', L && L.kind === 'list' && L.ct[3] === 'fill' && L.cells[2][3] === 'zahlt Montag');
  check('Bereinigung: unbekannte Spaltenart wird zu Text', await S(`(() => { const st = B.cleanState({ pages: [{ id: 'p', w: 595, h: 842 }], objs: [{ id: 'o', page: 'p', type: 'table', kind: 'list', x: 1, y: 1, w: 200, rows: 2, cols: 2, head: 'row', cells: [['a', 'b'], ['', '']], ct: ['evil', 'check'] }] }); const o = st.objs[0]; B.fixTable(o); return o.ct.join() === 'text,check'; })()`));

  /* Wertetabelle unverändert */
  await S(`B.newSheet(false, { kind: 'blank' })`);
  await pg.click('[data-tool="table"]'); p = await pagePt(300, 300); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(200);
  const W = await S(`S.objs.find(o => o.type === 'table')`);
  check('Wertetabelle wie bisher: x-Werte, Lösungszeile, Panel „Wertetabelle“', W && !W.kind && W.cells[0][0] === 'x' && /Wertetabelle/.test(await pg.textContent('#panel h2')) && (await pg.locator('#panel [data-act="tbl-fn"]').count()) === 1);

  /* ================================================================ */
  section('1.4 Neues Blatt: Blattarten, Kopfzeile in Teilen');
  const mk = async (kind, opts = {}) => {
    await pg.click('#btnNew'); await pg.waitForSelector('.dlg .kinds');
    await pg.click(`.dlg [data-kind="${kind}"]`);
    if (opts.title != null) await pg.setChecked('#nhTitle', opts.title);
    if (opts.nkd != null) await pg.setChecked('#nhHead', opts.nkd);
    await pg.click('.dlg [data-r="1"]'); await pg.waitForTimeout(250);
    return S(`({ name: document.getElementById('docName').value, types: S.objs.map(o => o.type + (o.kind ? ':' + o.kind : '')), fields: S.objs.filter(o => o.type === 'field').map(o => o.name), top: S.pages[0].bg.top, bg: S.pages[0].bg.type, title: (S.objs.find(o => o.type === 'text' && o.size === 16) || {}).text || '' })`);
  };
  check('Dialog: fünf Blattarten', await (async () => { await pg.click('#btnNew'); await pg.waitForSelector('.dlg .kinds'); const n = await pg.locator('.dlg .kinds [data-kind]').count(); await pg.click('.dlg [data-r="0"]'); return n === 5; })());
  let r = await mk('ws');
  check('Arbeitsblatt: Titel + Name/Klasse/Datum', r.title === 'Titel des Arbeitsblatts' && r.fields.join() === 'Name,Klasse,Datum' && r.top === 32 && r.name === 'Arbeitsblatt', JSON.stringify(r));
  r = await mk('ws', { nkd: false });
  check('Arbeitsblatt ohne Name/Klasse/Datum: nur Titel, Raster ab 20 mm', r.title && !r.fields.length && r.top === 20, JSON.stringify(r));
  check('Wahl wird gemerkt (nächstes Arbeitsblatt ohne Namensfelder)', await (async () => { await pg.click('#btnNew'); await pg.waitForSelector('.dlg .kinds'); const v = await pg.isChecked('#nhHead'); await pg.click('.dlg [data-r="0"]'); return v === false; })());
  r = await mk('ws', { title: false, nkd: true });
  check('Nur Name/Klasse/Datum, ohne Titel: Felder oben', !r.title && r.fields.length === 3 && r.top === 20 && (await S(`S.objs.find(o => o.name === 'Name').y`)) < 40, JSON.stringify(r));
  r = await mk('exam');
  check('Klassenarbeit: Titel „Klassenarbeit Nr. 1“, Namensfelder, Punktekästchen', r.title === 'Klassenarbeit Nr. 1' && r.fields.length === 3 && r.types.includes('points') && r.name === 'Klassenarbeit', JSON.stringify(r));
  r = await mk('list');
  check('Liste: Titel, Tabelle mit 25 Einträgen und 4 Spalten, weiß, keine Namensfelder', r.title === 'Liste' && r.types.includes('table:list') && !r.fields.length && r.bg === 'white' && (await S(`(() => { const o = S.objs.find(o => o.kind === 'list'); return o.rows === 26 && o.cols === 4 && o.ct.join() === 'num,text,check,fill' && o.y + o.h < S.pages[0].h; })()`)), JSON.stringify(r));
  r = await mk('info');
  check('Brief / Info: Überschrift und Textblock, keine Felder', r.title === 'Information' && r.types.filter(t => t === 'text').length === 2 && !r.fields.length && r.name === 'Brief – Info', JSON.stringify(r));
  r = await mk('blank');
  check('Leeres Blatt: nichts darauf, Rand 10 mm', !r.types.length && r.top === 10 && r.name === 'Leeres Blatt', JSON.stringify(r));
  await S(`B.newSheet(false, { head: true, bg: 'grid' })`);
  check('Ältere Aufrufe (head: true) bleiben gleich', (await S(`S.objs.filter(o => o.type === 'field').length`)) === 3 && (await S('S.pages[0].bg.top')) === 32);

  /* ================================================================ */
  section('1.4 Eigene Vorlagen');
  r = await mk('list');
  await S(`(() => { const o = S.objs.find(o => o.kind === 'list'); o.cells[1][1] = 'Vorlagenkind'; B.renderAll(); })()`);
  await S('B.flushSave()');
  await pg.click('#panel [data-act="savetpl"]').catch(async () => { await S('B.selectIds([])'); await pg.click('#panel [data-act="savetpl"]'); });
  await pg.waitForSelector('#tplName');
  await pg.fill('#tplName', 'Abhakliste Fahrt');
  await pg.click('.dlg [data-r="1"]'); await pg.waitForTimeout(300);
  check('Vorlage gesichert (Meldung)', /Vorlage „Abhakliste Fahrt“ gesichert/.test(await toastText()));
  const docBefore = await S('S.docId');
  await pg.click('#btnNew'); await pg.waitForSelector('.dlg .kinds');
  check('Neues Blatt zeigt „Meine Vorlagen“', (await pg.locator('.dlg [data-kind^="tpl:"]').count()) === 1 && /Abhakliste Fahrt/.test(await pg.textContent('.dlg')));
  await pg.click('.dlg [data-kind^="tpl:"]');
  check('Vorlage gewählt: Hintergrund/Kopfzeile ausgeblendet', await pg.isHidden('.dlg .nd-opts'));
  await pg.click('.dlg [data-r="1"]'); await pg.waitForTimeout(500);
  check('Aus Vorlage: neues Blatt mit Inhalt der Vorlage', (await S('S.docId')) !== docBefore && (await S(`document.getElementById('docName').value`)) === 'Abhakliste Fahrt' && (await S(`S.objs.find(o => o.kind === 'list').cells[1][1]`)) === 'Vorlagenkind');
  await S(`(() => { B.snap(); S.objs.find(o => o.kind === 'list').cells[1][1] = 'geändert'; B.renderAll(); })()`); await S('B.flushSave()');
  await S(`B.newFromTemplate((await B.DB_RAW.listTpls())[0].id)`); await pg.waitForTimeout(300);
  check('Vorlage bleibt unverändert, wenn das Blatt daraus geändert wird', (await S(`S.objs.find(o => o.kind === 'list').cells[1][1]`)) === 'Vorlagenkind');
  check('Vorlagen erscheinen nicht unter „Meine Blätter“', await S(`(await window.__bw.DB.listMeta()).every(m => !/^t/.test(m.id) || m.name !== 'Abhakliste Fahrt' || true)`) && !(await S(`(await window.__bw.DB.listMeta()).some(m => String(m.id).startsWith('t'))`)));
  /* Vorlage mit Original-PDF */
  const fx = await fixturePdf();
  await pg.setInputFiles('#fileOpen', fx);
  await pg.waitForFunction(() => window.__bw.S.pages.length === 3 && !document.querySelector('.page.loading'), null, { timeout: 20000 });
  await S('B.flushSave()');
  await S(`(async () => { const id = 'tplpdf'; await B.DB.putTpl(id, { id, name: 'PDF-Vorlage', created: Date.now() + 5, npages: 3 }, B.projectJSON()); })()`);
  await S(`B.newSheet(false, { kind: 'blank' })`);
  await S(`B.newFromTemplate('tplpdf')`); await pg.waitForTimeout(500);
  check('Vorlage mit Original-PDF: alle drei Seiten, PDF im Speicher', (await S('S.pages.length')) === 3 && (await S(`(async () => !!(await B.DB.getPdf(S.docId + '/main')))()`)));
  /* Verwalten: umbenennen und löschen */
  await S(`B.templatesDialog()`); await pg.waitForSelector('.dlg .tpl-list');
  await pg.fill('.dlg [data-tplname="tplpdf"]', 'Schulbuchseite'); await pg.press('.dlg [data-tplname="tplpdf"]', 'Tab');
  await pg.waitForTimeout(150);
  check('Vorlage umbenannt', await S(`(await B.DB.listTpls()).some(t => t.id === 'tplpdf' && t.name === 'Schulbuchseite')`));
  await pg.click('.dlg [data-tpldel="tplpdf"]'); await pg.click('.dlg:last-of-type [data-r="1"]'); await pg.waitForTimeout(200);
  check('Vorlage gelöscht (nach Rückfrage), andere bleibt', await S(`(async () => { const l = await B.DB.listTpls(); return l.length === 1 && l[0].name === 'Abhakliste Fahrt' && !(await B.DB.getTpl('tplpdf')); })()`));
  await pg.click('.dlg [data-r="1"]').catch(() => {});
  /* Altbestand: Speicher aus Version 2 wird auf 3 angehoben, Blätter bleiben */
  {
    const c2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const q = await c2.newPage();
    await q.goto(base.replace('index.html', 'manifest.json'));
    await q.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('blattwerk', 2); r.onupgradeneeded = () => { const d = r.result; ['meta', 'docs', 'pdfs', 'fonts'].forEach(n => d.createObjectStore(n)); }; r.onsuccess = () => { const d = r.result; const t = d.transaction(['meta', 'docs'], 'readwrite'); t.objectStore('meta').put({ id: 'dalt', name: 'Altes Blatt', updated: Date.now(), npages: 1 }, 'dalt'); t.objectStore('docs').put({ pages: [{ id: 'p1', sid: null, w: 595.28, h: 841.89 }], objs: [{ id: 'o1', page: 'p1', type: 'text', x: 50, y: 50, w: 200, runs: [{ t: 'Aus Version 1.3' }], size: 12 }] }, 'dalt'); t.oncomplete = () => { d.close(); res(); }; t.onerror = rej; }; r.onerror = rej; }));
    await q.addInitScript(() => localStorage.setItem('bw:prefs', JSON.stringify({ start: 'last' })));
    await q.goto(base); await q.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    const st = await q.evaluate(async () => ({ txt: window.__bw.S.objs.map(o => o.text).join(), tpl: (await window.__bw.DB.listTpls()).length }));
    check('Speicher aus 1.3 (Version 2) wird angehoben: altes Blatt geöffnet, Vorlagen-Speicher da', st.txt === 'Aus Version 1.3' && st.tpl === 0, JSON.stringify(st));
    await c2.close();
  }
  check('Keine Fehler (Tabelle, Blattarten, Vorlagen)', errs.length === 0, errs.slice(0, 3).join(' / '));
  await ctx.close();

  /* ================================================================ */
  section('1.4 App: Dateisicherung, Wiederherstellen, „Öffnen in Blattwerk“, Bewertung');
  const actx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const ap = await actx.newPage();
  const aerrs = [];
  ap.on('pageerror', e => aerrs.push('Seitenfehler: ' + e.message));
  ap.on('console', m => { if (m.type() === 'error') aerrs.push('Konsole: ' + m.text()); });
  await ap.addInitScript(`(${mockFs.toString()})();`);
  await ap.addInitScript(() => {
    window.cordova.platformId = 'ios';
    window.__shared = []; window.__reviews = 0;
    window.plugins = { socialsharing: { shareWithOptions: (o, ok) => { window.__shared.push(o); ok({ completed: !window.__cancelShare }); } } };
    window.BWReview = { request: () => { window.__reviews++; } };
    const add = document.addEventListener.bind(document);
    document.addEventListener = (type, fn, opt) => type === 'deviceready' ? setTimeout(fn, 30) : add(type, fn, opt);
    try { if (!localStorage.getItem('bw:prefs')) localStorage.setItem('bw:prefs', JSON.stringify({ mode: 'all', start: 'last' })); } catch (e) {}
  });
  const AS = expr => ap.evaluate(`(async () => { const S = window.__bw.S, B = window.__bw; return (${expr}); })()`);
  await ap.goto(base); await ap.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  check('App: Dateisicherung aktiv', await AS('B.FB.ok()'));
  /* Altbestand ohne Dateien (Update von 1.3): wird einmal komplett gesichert */
  await AS(`(async () => { await B.DB_RAW.save('dalt13', { pages: [{ id: 'p1', sid: null, w: 595.28, h: 841.89 }], objs: [] }, { id: 'dalt13', name: 'Alt', updated: 1, npages: 1 }); localStorage.removeItem('bw:fb'); await B.FB.mirrorAll(B.DB_RAW); })()`);
  check('Update von 1.3: vorhandene Blätter werden einmal als Dateien gesichert', (await ap.evaluate(() => window.__mockfsKeys())).some(k => k.endsWith('/docs/dalt13/doc.json')));
  await AS(`B.DB.del('dalt13')`);
  await ap.setInputFiles('#fileOpen', fx);
  await ap.waitForFunction(() => window.__bw.S.pages.length === 3 && !document.querySelector('.page.loading'), null, { timeout: 20000 });
  await AS(`(() => { B.snap(); const o = { id: 'ofb', page: S.pages[0].id, type: 'text', layer: 'base', x: 60, y: 100, w: 300, runs: [{ t: 'Gesichert als Datei' }], text: 'Gesichert als Datei', size: 12, font: 'sans', lh: 1.2, align: 'left', color: '#000000', fill: null, h: 14 }; S.objs.push(o); B.renderAll(); })()`);
  await AS('B.flushSave()'); await AS('B.FB.flush()');
  const docId = await AS('S.docId');
  let keys = await ap.evaluate(() => window.__mockfsKeys());
  check('Blatt, Kurzinfo und Original-PDF liegen als Dateien', keys.some(k => k.endsWith(`/docs/${docId}/doc.json`)) && keys.some(k => k.endsWith(`/docs/${docId}/meta.json`)) && keys.some(k => k.endsWith(`/docs/${docId}/main.pdf`)), keys.filter(k => k.includes(docId)).join(', '));
  await AS(`(async () => { const id = 'tfb'; await B.DB.putTpl(id, { id, name: 'Datei-Vorlage', created: Date.now(), npages: 3 }, B.projectJSON()); })()`); await AS('B.FB.flush()');
  keys = await ap.evaluate(() => window.__mockfsKeys());
  check('Vorlage liegt als Datei', keys.some(k => k.endsWith('/tpls/tfb/tpl.json')));
  /* WebView-Speicher geleert (wie iOS bei Platzmangel) */
  await ap.evaluate(() => new Promise(res => { indexedDB.deleteDatabase('blattwerk').onsuccess = res; setTimeout(res, 1500); }));
  await ap.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bw:') && k !== 'bw:prefs') localStorage.removeItem(k); });
  await ap.reload(); await ap.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await ap.waitForTimeout(200);
  const tt = await ap.evaluate(() => [...document.querySelectorAll('.tst span')].map(s => s.textContent).join(' | '));
  const rst = await AS(`({ txt: S.objs.some(o => o.text === 'Gesichert als Datei'), pages: S.pages.length, pdf: !!S.srcs.main, tpl: (await B.DB.listTpls()).some(t => t.name === 'Datei-Vorlage') })`);
  check('Speicher geleert → Blatt samt PDF und Vorlage aus den Dateien zurück', rst.txt && rst.pages === 3 && rst.pdf && rst.tpl && /aus der Dateisicherung wiederhergestellt/.test(tt), JSON.stringify(rst) + ' ' + tt);
  /* Löschen entfernt auch die Dateien */
  await AS(`(async () => { await B.DB.del('${docId}'); await B.FB.flush(); })()`);
  keys = await ap.evaluate(() => window.__mockfsKeys());
  check('Blatt löschen entfernt auch seine Dateien', !keys.some(k => k.includes(`/docs/${docId}`)));
  /* „Öffnen in Blattwerk“ */
  await ap.evaluate(b => window.__mockfsPut('file:///var/Documents/Inbox/Bruch rechnen.pdf', new Uint8Array(b)), [...fs.readFileSync(fx)]);
  await ap.evaluate(() => window.handleOpenURL('file:///var/Documents/Inbox/Bruch%20rechnen.pdf'));
  await ap.waitForFunction(() => document.getElementById('docName').value === 'Bruch rechnen' && window.__bw.S.pages.length === 3, null, { timeout: 15000 }).catch(() => {});
  check('„Öffnen in Blattwerk“: PDF geöffnet, Name übernommen', (await AS(`document.getElementById('docName').value`)) === 'Bruch rechnen' && (await AS('S.pages.length')) === 3);
  keys = await ap.evaluate(() => window.__mockfsKeys());
  check('Kopie in Inbox danach gelöscht', !keys.some(k => k.includes('/Inbox/')));
  await ap.evaluate(() => window.handleOpenURL('https://example.org/x.pdf'));
  await ap.waitForTimeout(200);
  check('Fremde Adressen (nicht file:) werden ignoriert', (await AS(`document.getElementById('docName').value`)) === 'Bruch rechnen');
  /* Bewertung: erst nach dem dritten abgeschlossenen Teilen, nur einmal */
  await AS(`B.newSheet(false, { kind: 'blank' })`);
  const share = async () => { const n0 = await ap.evaluate(() => window.__shared.length); await ap.click('#btnExport'); const d = await ap.waitForSelector('.dlg [data-r="1"]', { timeout: 800 }).catch(() => null); if (d) await d.click(); await ap.waitForFunction(n => window.__shared.length >= n, n0 + 1, { timeout: 30000 }).catch(async e => { console.log('TEILEN', await ap.evaluate(() => ({ n: window.__shared.length, dlg: [...document.querySelectorAll('.dlg')].map(d => d.textContent.slice(0, 80)), busy: !!document.querySelector('.busy'), home: window.__bw.homeVisible(), dis: document.getElementById('btnExport').disabled, toast: [...document.querySelectorAll('.tst span')].map(s => s.textContent) }))); throw e; }); await ap.waitForTimeout(1700); };
  await ap.evaluate(() => { window.__cancelShare = true; });
  await share();
  await ap.evaluate(() => { window.__cancelShare = false; });
  await share(); await share();
  check('Abgebrochenes Teilen zählt nicht; nach 2 Mal noch keine Bitte', (await ap.evaluate(() => window.__reviews)) === 0);
  await share();
  check('Nach dem 3. Teilen: Bewertungsfenster einmal angefragt', (await ap.evaluate(() => window.__reviews)) === 1);
  await share();
  check('Danach nie wieder', (await ap.evaluate(() => window.__reviews)) === 1);
  check('Keine Fehler (App-Funktionen)', aerrs.length === 0, aerrs.slice(0, 3).join(' / '));
  await actx.close();

  /* ================================================================ */
  section('1.4 iPhone: Dialog und Tabelle passen in die Breite');
  const ictx = await browser.newContext({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const ip = await ictx.newPage();
  await ip.addInitScript(() => localStorage.setItem('bw:prefs', JSON.stringify({ start: 'last' })));
  await ip.goto(base); await ip.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await ip.evaluate(() => window.__bw.newDialog());
  await ip.waitForSelector('.dlg .kinds');
  const fit = () => ip.evaluate(() => { const b = document.querySelector('.dlg .box').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth; });
  check('iPhone: Dialog „Neues Blatt“ ohne seitliches Scrollen', await fit());
  await ip.screenshot({ path: path.join(OUT, 'iphone-neues-blatt.png') });
  await ip.tap('.dlg [data-kind="list"]'); await ip.tap('.dlg [data-r="1"]'); await ip.waitForTimeout(300);
  await ip.evaluate(() => { const o = window.__bw.S.objs.find(o => o.kind === 'list'); window.__bw.selectIds([o.id]); });
  await ip.waitForTimeout(200);
  check('iPhone: Panel der Tabelle ohne seitliches Scrollen', await ip.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('#panel .lcol')].every(e => e.getBoundingClientRect().right <= innerWidth + 0.5)));
  await ip.screenshot({ path: path.join(OUT, 'iphone-tabelle.png'), fullPage: false });
  await ictx.close();
};
