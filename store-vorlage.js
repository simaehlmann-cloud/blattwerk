/* Erzeugt test/store/bruchrechnung.pdf: ein gewöhnliches Arbeitsblatt mit
   Lücken, wie es aus Word oder einem Verlag kommt – für store-bilder.js. */
const fs = require('fs'), path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
module.exports = async function vorlage() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold);
  const p = d.addPage([595.28, 841.89]);
  const T = (s, x, y, o = {}) => p.drawText(s, { x, y, size: o.size || 11.5, font: o.bold ? b : f, color: o.color || rgb(0.1, 0.1, 0.12) });
  T('Name: ____________________', 60, 790); T('Klasse: ______', 300, 790); T('Datum: ___________', 420, 790);
  T('Bruchrechnung: Addieren und Subtrahieren', 60, 745, { bold: true, size: 17 });
  p.drawLine({ start: { x: 60, y: 735 }, end: { x: 535, y: 735 }, thickness: 1.2, color: rgb(0.2, 0.3, 0.6) });
  T('1  Berechne. Kürze, wenn möglich.', 60, 705, { bold: true });
  const auf = [['a)  1/4 + 2/4 =', 'b)  3/8 + 1/4 ='], ['c)  5/6 - 1/3 =', 'd)  2/3 + 1/5 ='], ['e)  7/10 - 1/2 =', 'f)  1 1/2 - 3/4 =']];
  auf.forEach((r, i) => { T(r[0] + ' ________', 80, 678 - i * 26); T(r[1] + ' ________', 320, 678 - i * 26); });
  T('2  Richtig oder falsch? Kreuze an.', 60, 585, { bold: true });
  const st = ['1/2 + 1/3 = 2/5', '3/4 ist größer als 2/3.', 'Beim Addieren bleibt der Nenner immer gleich.'];
  st.forEach((s, i) => { const y = 558 - i * 24; T(s, 80, y); p.drawRectangle({ x: 400, y: y - 2, width: 10, height: 10, borderWidth: 0.9, borderColor: rgb(0.1, 0.1, 0.1) }); T('richtig', 415, y); p.drawRectangle({ x: 470, y: y - 2, width: 10, height: 10, borderWidth: 0.9, borderColor: rgb(0.1, 0.1, 0.1) }); T('falsch', 485, y); });
  T('3  Lea hat 3/4 einer Pizza, Tom hat 2/3. Wer hat mehr? Begründe.', 60, 470, { bold: true });
  for (let i = 0; i < 4; i++) p.drawLine({ start: { x: 80, y: 440 - i * 26 }, end: { x: 535, y: 440 - i * 26 }, thickness: 0.6, color: rgb(0.55, 0.55, 0.6) });
  T('4  Ergänze die fehlenden Zahlen.', 60, 310, { bold: true });
  T('3/5 + ____ = 1          ____ - 1/6 = 1/2          2/9 + 4/9 = ____', 80, 280);
  T('Seite 1', 280, 40, { size: 9, color: rgb(0.5, 0.5, 0.5) });
  const file = path.join(__dirname, 'test', 'store', 'bruchrechnung.pdf');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await d.save());
  return file;
};
