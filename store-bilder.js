/* store-bilder.js – erzeugt die App-Store-Screenshots automatisch.
 *
 *     npm ci && npx playwright install chromium
 *     node store-bilder.js
 *
 * Ergebnis: store-bilder/
 *
 *     iphone/  1..6.png   1206 x 2622   (iPhone 6,3″, „Dynamic Island, mittel“)
 *     ipad/    1..6.png   2048 x 2732   (iPad 13″)
 *
 * Die App wird über ihre eigenen Funktionen gesteuert; nichts wird
 * nachgebaut (Apple-Richtlinie 2.3: Screenshots zeigen die App im
 * Gebrauch). Sie läuft als „App“ (window.cordova), damit oben „Teilen“
 * steht, und mit freigeschalteter Vollversion, damit alles zu sehen ist.
 * Die Store-Texte weisen darauf hin, was zur Vollversion gehört.
 *
 * Entscheidend ist die CSS-Breite, nicht die Pixelzahl: iPhone 17 Pro hat
 * 402 x 874 CSS-Pixel bei dreifacher Dichte (= 1206 x 2622), das iPad Pro
 * 13″ 1024 x 1366 bei doppelter (= 2048 x 2732). Apple will PNG ohne
 * Alphakanal; die Bilder werden deshalb zum Schluss nach RGB gewandelt.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const ZIEL = path.join(ROOT, 'store-bilder');
const GERAETE = [
  { name: 'iphone', css: { width: 402, height: 874 }, dichte: 3, touch: true },
  { name: 'ipad', css: { width: 1024, height: 1366 }, dichte: 2, touch: true }
];

function serve() {
  return new Promise(res => {
    const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.css': 'text/css' };
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      if (p === '/cordova.js') { rsp.writeHead(200, { 'Content-Type': 'text/javascript' }); rsp.end(''); return; }
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

async function main() {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch({ env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) });
  const nur = process.argv[2];
  for (const g of GERAETE) {
    if (nur && nur !== g.name) continue;
    const dir = path.join(ZIEL, g.name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: g.css, deviceScaleFactor: g.dichte, hasTouch: g.touch, isMobile: g.name === 'iphone', colorScheme: 'light', locale: 'de-DE' });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => console.error('Seitenfehler:', e.message));
    await pg.addInitScript(() => {
      window.cordova = {};
      window.plugins = { socialsharing: { shareWithOptions: (o, ok) => ok && ok({ completed: true }) } };
      const add = document.addEventListener.bind(document);
      document.addEventListener = (type, fn, opt) => type === 'deviceready' ? setTimeout(fn, 30) : add(type, fn, opt);
      try {
        if (!sessionStorage.getItem('sb')) { localStorage.clear(); sessionStorage.setItem('sb', '1'); }
        localStorage.setItem('bw:voll', '1');
        localStorage.setItem('bw:prefs', JSON.stringify({ mode: 'simple', start: 'home' }));
      } catch (e) {}
    });
    await pg.goto(base);
    await pg.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await pg.evaluate(() => document.fonts.ready);
    const B = code => pg.evaluate(`(async () => { const B = window.__bw, S = B.S; ${code}; })()`);
    const ruhe = (ms = 700) => pg.waitForTimeout(ms);
    let n = 0;
    const bild = async was => { n++; await ruhe(); await pg.evaluate(() => document.getElementById('toast').replaceChildren()); const f = path.join(dir, n + '.png'); await pg.screenshot({ path: f }); console.log(`  ${g.name}/${n}.png  ${was}`); };

    for (const szene of require('./store-bilder-szenen.js')) {
      if (szene.nur && szene.nur !== g.name) continue;
      await szene.tu({ pg, B, g, ruhe });
      await bild(szene.was);
    }
    await ctx.close();
  }
  await browser.close(); srv.close();
  /* Ohne Alphakanal, genaue Maße prüfen */
  execFileSync('python3', ['-c', `
import sys, glob
from PIL import Image
soll = {'iphone': (1206, 2622), 'ipad': (2048, 2732)}
fehler = 0
for f in sorted(glob.glob(sys.argv[1] + '/*/*.png')):
    im = Image.open(f)
    w = soll[f.split('/')[-2]]
    if im.size != w: print('FALSCHE GROESSE', f, im.size); fehler += 1
    im.convert('RGB').save(f)
print('Bilder geprueft' if not fehler else 'FEHLER'); sys.exit(1 if fehler else 0)
`, ZIEL], { stdio: 'inherit' });
}
main().catch(e => { console.error(e); process.exit(1); });
