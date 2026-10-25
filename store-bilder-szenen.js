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
    was: 'Startbildschirm: alles bleibt auf dem Gerät',
    nur: 'iphone',
    tu: async ({ B }) => { await B(`B.selectIds([]); await B.showHome('main')`); }
  }
];
