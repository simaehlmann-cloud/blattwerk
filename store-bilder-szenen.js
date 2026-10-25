/* Szenen für store-bilder.js – in dieser Reihenfolge erscheinen sie im Store. */
const path = require('path');
const dialogeZu = `document.querySelectorAll('.dlg').forEach(d => d.remove())`;
/* Seite auf Breite einpassen (mit schmalem Rand) und optional zu einem Element scrollen */
const breite = (faktor = 1) => `
  const st = document.getElementById('stage'), w = st.clientWidth;
  B.setZoom(Math.min(2.2, (w - (w < 600 ? 14 : 40)) / S.pages[0].w * ${faktor}));
  await new Promise(r => setTimeout(r, 250));`;
const zu = (sel, oben = 0.12) => `
  { const o = S.objs.find(${sel}); const el = o && document.querySelector('.obj[data-id="' + o.id + '"]');
    const st = document.getElementById('stage');
    if (el) { const r = el.getBoundingClientRect(), sr = st.getBoundingClientRect(); st.scrollTop += r.top - sr.top - sr.height * ${oben}; }
    else st.scrollTop = 0;
    const pr = document.querySelector('.page').getBoundingClientRect(), sr2 = st.getBoundingClientRect();
    st.scrollLeft += pr.left - sr2.left - 6; }`;

module.exports = [
  {
    was: 'Beispielblatt: ausfüllbar, mit Formeln und Graph',
    tu: async ({ pg, B }) => {
      await pg.click('#home [data-h="sample"]'); await pg.waitForSelector('#home', { state: 'hidden' });
      await B(`B.setView('base'); ${breite()} document.getElementById('stage').scrollTop = 0;`);
    }
  },
  {
    was: 'Ansicht „+ Lösung“: Lösungen rot, Graph eingezeichnet',
    tu: async ({ B, g }) => {
      await B(`B.setView('sol'); ${breite(g.name === 'iphone' ? 1.45 : 1)} ${zu("o => o.type === 'table'", 0.35)}`);
    }
  },
  {
    was: 'Eigenes PDF: Lücken werden zu ausfüllbaren Feldern',
    tu: async ({ pg, B }) => {
      const file = await require('./store-vorlage.js')();
      await B(`B.setView('base')`);
      await pg.setInputFiles('#fileOpen', file);
      await pg.waitForFunction(() => window.__bw.S.pages.length === 1 && window.__bw.S.pages[0].sid != null && !document.querySelector('.page.loading'), null, { timeout: 20000 });
      await pg.waitForTimeout(600);
      await B(`await B.detectFields(S.pages.map(p => p.id)); B.renderAll(); ${breite()} document.getElementById('stage').scrollTop = 0;`);
      /* Ein Feld gewählt: rechts bzw. unten steht, was man einstellen kann */
      await B(`const o = S.objs.filter(o => o.type === 'field')[1]; if (o) { o.solution = '1/2'; B.selectIds([o.id]); }`);
    }
  },
  {
    was: 'Vorhandenen Text im PDF antippen und ändern',
    tu: async ({ pg, B, g }) => {
      await B(`B.selectIds([]); B.setTool('edittext'); ${breite(g.name === 'iphone' ? 1.35 : 1.15)}`);
      await pg.waitForTimeout(500);
      await B(`const pid = S.pages[0].id; await B.ensureLines(pid);
        const L = S.lines[pid].list.find(l => /Pizza/.test(l.str)); B.convertLine(pid, L.k);
        ${zu("o => o.fromLine", g.name === 'iphone' ? 0.3 : 0.4)}`);
      await pg.waitForTimeout(300);
      await pg.keyboard.press('ControlOrMeta+a');
      await pg.keyboard.type('3  Mia hat 5/6 einer Pizza, Ben hat 3/4. Wer hat mehr? Begründe.');
    }
  },
  {
    was: 'Aufgaben entfernen und durch eigene ersetzen',
    tu: async ({ pg, B, g }) => {
      await B(`B.endEdit(); B.selectIds([]);
        const pid = S.pages[0].id; B.setTool('erase'); await B.prepareErase();
        B.eraseRect(pid, { x: 55, y: 540, w: 485, h: 32 });
        const L = S.lines[pid].list.find(l => /Ergänze/.test(l.str)); B.convertLine(pid, L.k);`);
      await pg.waitForTimeout(300);
      await pg.keyboard.press('ControlOrMeta+a');
      await pg.keyboard.type('4  Erfinde eine eigene Aufgabe mit den Nennern 3 und 4 und löse sie.');
      await B(`B.endEdit(); B.selectIds([]); B.setTool('erase'); await B.prepareErase();
        ${breite(g.name === 'iphone' ? 1.35 : 1.15)} ${zu("o => o.type === 'whiteout'", g.name === 'iphone' ? 0.45 : 0.55)}`);
    }
  },
  {
    was: 'Teilen: Schülerfassung, mit Hilfen, Lösungsblatt',
    tu: async ({ B }) => {
      await B(`${dialogeZu}; B.selectIds([]); B.newSheet(true); B.setView('base'); ${breite()} document.getElementById('stage').scrollTop = 0;`);
      await B(`B.exportDialog()`);
    }
  },
  {
    was: 'Koordinatensystem mit Funktionsgraph einstellen',
    tu: async ({ B, g }) => {
      await B(`${dialogeZu}; B.setView('sol'); ${breite(g.name === 'iphone' ? 1.45 : 1.3)} const o = S.objs.find(o => o.type === 'coord'); B.selectIds([o.id]);`);
      await new Promise(r => setTimeout(r, 400));
      await B(`${zu("o => o.type === 'coord'", 0.03)}`);
    }
  },
  {
    was: 'Texterkennung: gescannte Blätter wieder bearbeitbar',
    tu: async ({ pg, B, g }) => {
      await B(`${dialogeZu}; B.selectIds([]); B.setTool('select'); B.setView('base')`);
      await pg.setInputFiles('#fileOpen', path.join(__dirname, 'test', 'vorlagen', 'scan-bruchrechnung.pdf'));
      await pg.waitForFunction(() => window.__bw.S.pages.length >= 1 && window.__bw.S.pages[0].sid != null && !document.querySelector('.page.loading'), null, { timeout: 30000 });
      await pg.waitForTimeout(800);
      await B(`await B.ocrPages([S.pages[0].id])`);
      await pg.waitForFunction(() => !!window.__bw.S.pages[0].ocr, null, { timeout: 180000 });
      await pg.waitForTimeout(500);
      await B(`${dialogeZu}; B.setTool('edittext'); ${breite(g.name === 'iphone' ? 1.2 : 1)} document.getElementById('stage').scrollTop = 0;`);
    }
  },
  {
    was: 'Neues Blatt mit passendem Hintergrund',
    tu: async ({ B }) => {
      await B(`${dialogeZu}; B.setTool('select'); B.newSheet(true); B.setView('base'); ${breite()} document.getElementById('stage').scrollTop = 0; document.getElementById('btnNew').click();`);
    }
  },
  {
    was: 'Klassenarbeit: Erwartungshorizont auf Knopfdruck',
    nur: 'ipad',
    tu: async ({ B }) => {
      await B(`${dialogeZu}; B.setView('sol'); B.addHorizon(); B.selectIds([]); ${breite()}
        const pgs = document.querySelectorAll('.page'), st2 = document.getElementById('stage');
        st2.scrollTop += pgs[pgs.length - 1].getBoundingClientRect().top - st2.getBoundingClientRect().top - 12;`);
    }
  },
  {
    was: 'Startbildschirm: alles bleibt auf dem Gerät',
    nur: 'iphone',
    tu: async ({ B }) => { await B(`${dialogeZu}; B.selectIds([]); await B.showHome('main')`); }
  }
];
