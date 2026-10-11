/* Blattwerk – statische Prüfungen. Läuft mit: node validate.js
 *
 * Fängt die Fehler ab, die erst im Store oder auf dem Gerät auffallen
 * würden: Versionen, die nicht zusammenpassen, fehlende Dateien im Paket,
 * fehlende iOS-Hinweistexte, Rechtstexte, die von der App abweichen.
 * Braucht keine installierten Pakete (nur Node und python3).
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

const errors = [], warns = [], ok = [];
const E = m => errors.push(m), W = m => warns.push(m), O = m => ok.push(m);
const read = f => fs.readFileSync(f, 'utf8');
const exists = f => fs.existsSync(f);

const html = read('index.html');
const config = read('config.xml');
const sw = read('sw.js');

/* ---------- 1. Skript ---------- */
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (inline.length !== 1) E(`Erwartet genau 1 Inline-Skript, gefunden: ${inline.length}`);
const js = inline.join('\n');
try { new vm.Script(js, { filename: 'index.html' }); O('JavaScript-Syntax gültig'); }
catch (e) { E(`Syntaxfehler im Skript: ${e.message}`); }
for (const bad of ['alert(', 'confirm(', 'prompt(', 'eval(', 'new Function(', 'document.write(']) {
  if (js.includes(bad)) E(`Unerwünschter Aufruf im Skript: ${bad} (in WebViews blockiert oder unsicher)`);
}
/* Nutzertexte duerfen in Vorlagen nur maskiert landen: ${esc(o.name)}, nie ${o.name}. */
const raw = [...js.matchAll(/\$\{\s*(?:o|m|obj)\.(?:name|label|value|text|xl|yl)\s*(?:\}|\|\|)/g)];
if (raw.length) E(`Unmaskierte Nutzereingabe in Vorlage: ${raw.map(m => m[0]).join(', ')}`);
else O('Nutzertexte in Vorlagen werden maskiert');

/* ---------- 2. Versionen ---------- */
const appV = (js.match(/const APP_VERSION = '([\d.]+)'/) || [])[1];
const cfgV = (config.match(/<widget[^>]*\sversion="([\d.]+)"/) || [])[1];
const code = (config.match(/android-versionCode="(\d+)"/) || [])[1];
const bundle = (config.match(/ios-CFBundleVersion="(\d+)"/) || [])[1];
const cache = (sw.match(/const CACHE = 'blattwerk-([\d.]+)'/) || [])[1];
const pkgV = JSON.parse(read('package.json')).version;
if (!appV) E('APP_VERSION fehlt in index.html');
else {
  const [a, b, c] = appV.split('.').map(Number);
  const want = String(a * 10000 + b * 100 + c);
  if (cfgV !== appV) E(`config.xml version ${cfgV} ≠ APP_VERSION ${appV}`);
  if (cache !== appV) E(`sw.js CACHE ${cache} ≠ APP_VERSION ${appV} – Rückkehrer bekämen die alte Fassung`);
  if (pkgV !== appV) E(`package.json version ${pkgV} ≠ APP_VERSION ${appV}`);
  if (code !== want) E(`android-versionCode ${code}, erwartet ${want}`);
  if (bundle !== want) E(`ios-CFBundleVersion ${bundle}, erwartet ${want}`);
  if (cfgV === appV && cache === appV && code === want && bundle === want && pkgV === appV) O(`Version ${appV} (${want}) überall gleich`);
}

/* ---------- 3. config.xml: Store-relevante Einträge ---------- */
if (!/<widget id="de\.blattwerk\.app"/.test(config)) E('Paketkennung ist nicht de.blattwerk.app');
const plist = key => { const m = config.match(new RegExp(`target="${key}"[^>]*>\\s*<(string|false|true)\\s*/?>([^<]*)`)); return m ? (m[1] === 'string' ? m[2].trim() : m[1]) : null; };
const need = {
  ITSAppUsesNonExemptEncryption: v => v === 'false',
  NSCameraUsageDescription: v => v && v.length > 30,
  NSPhotoLibraryUsageDescription: v => v && v.length > 30,
  NSPhotoLibraryAddUsageDescription: v => v && v.length > 30
};
for (const [k, test] of Object.entries(need)) {
  const v = plist(k);
  if (!test(v)) E(`config.xml: ${k} fehlt oder ist ungültig`);
  else if (/This app requires|function properly/i.test(v)) E(`config.xml: ${k} enthält Cordovas Platzhaltertext`);
}
O('iOS-Hinweistexte (Kamera, Fotos, Verschlüsselung) vorhanden');
const tsdk = (config.match(/android-targetSdkVersion"\s+value="(\d+)"/) || [])[1];
const wfAndroid = read('.github/workflows/android.yml'), wfIos = read('.github/workflows/ios.yml');
const wfSdk = (wfAndroid.match(/TARGET_SDK: '(\d+)'/) || [])[1];
if (tsdk !== wfSdk) E(`targetSdk config.xml ${tsdk} ≠ Workflow ${wfSdk}`); else O(`Android-Ziel-SDK ${tsdk} in config.xml und Workflow gleich`);
for (const m of config.matchAll(/(?:src|foreground)="(res\/android\/[^"]+)"/g)) if (!exists(m[1])) E(`config.xml verweist auf fehlende Datei ${m[1]}`);
if (!/<plugin name="cordova-plugin-x-socialsharing"/.test(config)) E('Teilen-Plugin fehlt in config.xml');

/* ---------- 4. Dateien, auf die index.html verweist ---------- */
const refs = new Set();
for (const m of html.matchAll(/\b(?:src|href)="([^"#?]+)"/g)) refs.add(m[1]);
for (const m of html.matchAll(/url\("([^"]+)"\)/g)) refs.add(m[1]);
const external = [...refs].filter(r => /^(https?:)?\/\//.test(r));
if (external.length) E(`Externe Adressen in index.html: ${external.join(', ')}`); else O('Keine externen Quellen in index.html');
const missing = [...refs].filter(r => !/^(https?:|mailto:|data:)/.test(r) && r !== 'cordova.js' && !exists(r));
if (missing.length) E(`Fehlende Dateien: ${missing.join(', ')}`); else O(`Alle ${refs.size - 1} lokalen Verweise vorhanden`);
for (const f of ['lib/pdfjs/pdf.worker.min.js', 'lib/pdfjs/cmaps/UniJIS-UCS2-H.bcmap', 'lib/pdfjs/standard_fonts/LiberationSans-Regular.ttf']) if (!exists(f)) E(`Fehlt: ${f}`);
const fontNames = new Set([...js.matchAll(/'(Noto[A-Za-z]+-[A-Za-z]+)'/g)].map(m => m[1]));
const missingFonts = [...fontNames].filter(n => !exists(`fonts/${n}.ttf`));
if (missingFonts.length) E(`Schriften fehlen: ${missingFonts.join(', ')}`); else O(`${fontNames.size} Schriftdateien vorhanden`);
if (!read('lib/pdfjs/pdf.min.js').includes('3.11.174')) E('lib/pdfjs ist nicht Version 3.11.174 (package.json)');
const pkg = JSON.parse(read('package.json'));
if (pkg.devDependencies['pdfjs-dist'] !== '3.11.174' || pkg.devDependencies['pdf-lib'] !== '1.17.1') E('package.json pinnt andere Bibliotheksversionen als lib/');

/* ---------- 5. Sicherheitsrichtlinie ---------- */
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
if (!csp) E('Content-Security-Policy fehlt');
else {
  if (/unsafe-eval/.test(csp)) E('CSP erlaubt unsafe-eval');
  if (!/default-src 'self'/.test(csp)) E("CSP ohne default-src 'self'");
  if (/https?:/.test(csp)) E('CSP erlaubt fremde Server');
  if (!/isEvalSupported: false/.test(js)) E('pdf.js ohne isEvalSupported:false – die CSP würde Schriften blockieren');
  O('Sicherheitsrichtlinie streng (nur eigene Dateien)');
}

/* ---------- 6. IDs ---------- */
const ids = new Set([...html.matchAll(/\sid="([^"$]+)"/g)].map(m => m[1]));
/* Felder der Eigenschaften-Leiste entstehen ueber Hilfsfunktionen: id="p-<name>" */
for (const m of js.matchAll(/\b(?:tin|numIn|toggle|swatches)\('([\w.-]+)'/g)) ids.add('p-' + m[1]);
const usedIds = new Set([...js.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map(m => m[1]));
const deadIds = [...usedIds].filter(i => !ids.has(i));
if (deadIds.length) E(`Im Skript benutzte, aber fehlende IDs: ${deadIds.join(', ')}`); else O(`Alle ${usedIds.size} festen IDs vorhanden`);

/* ---------- 7. Service Worker und Manifest ---------- */
const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
const swMissing = assets.filter(a => !exists(a));
if (swMissing.length) E(`sw.js listet fehlende Dateien: ${swMissing.join(', ')}`); else O(`sw.js: ${assets.length} Dateien vorhanden`);
let manifest;
try { manifest = JSON.parse(read('manifest.json')); O('manifest.json gültig'); } catch (e) { E('manifest.json ist kein gültiges JSON'); }
if (manifest) for (const i of manifest.icons) if (!exists(i.src)) E(`Manifest-Icon fehlt: ${i.src}`);

/* ---------- 8. Icons ---------- */
function pngInfo(f) {
  const b = fs.readFileSync(f);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
}
const iconWant = { 'icon.png': 512, 'icon-192.png': 192, 'icon-1024.png': 1024, 'icon-maskable-512.png': 512 };
for (const [f, s] of Object.entries(iconWant)) {
  if (!exists(f)) { E(`Icon fehlt: ${f}`); continue; }
  const i = pngInfo(f);
  if (!i || i.w !== s || i.h !== s) E(`${f} ist nicht ${s}x${s}`);
  if (f === 'icon-1024.png' && i && i.alpha) E('icon-1024.png hat einen Alphakanal – App Store lehnt das ab');
}
const dens = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, s] of Object.entries(dens)) {
  const a = `res/android/icon_${d}.png`, b = `res/android/icon_fg_${d}.png`;
  if (!exists(a) || pngInfo(a).w !== s) E(`${a} fehlt oder ist nicht ${s}px`);
  if (!exists(b) || pngInfo(b).w !== Math.round(s * 108 / 48)) E(`${b} fehlt oder hat die falsche Größe`);
}
O('Icons in den erwarteten Größen');
if (!exists('res/android/colors.xml') || !read('res/android/colors.xml').includes('blattwerk_icon_background')) E('res/android/colors.xml ohne blattwerk_icon_background');

/* ---------- 9. iOS ---------- */
const priv = exists('res/ios/PrivacyInfo.xcprivacy') ? read('res/ios/PrivacyInfo.xcprivacy') : '';
if (!priv.includes('CA92.1')) E('PrivacyInfo.xcprivacy ohne Grund CA92.1');
if (!/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(priv)) E('PrivacyInfo.xcprivacy: NSPrivacyTracking nicht false');
if (priv.includes('CA92.1')) O('Privacy-Manifest vollständig');

/* ---------- 10. Workflows kopieren alles, was die App braucht ---------- */
for (const [name, wf] of [['android.yml', wfAndroid], ['ios.yml', wfIos]]) {
  for (const f of ['index.html', 'manifest.json', 'sw.js', 'datenschutz.html', 'impressum.html', 'lizenzen.html', 'icon.png']) {
    if (!new RegExp(`cp [^\\n]*\\b${f.replace('.', '\\.')}\\b`).test(wf)) E(`${name} kopiert ${f} nicht nach www`);
  }
  if (!/cp -R lib fonts build\/www\//.test(wf)) E(`${name} kopiert lib/ und fonts/ nicht nach www`);
  if (/lite/i.test(wf)) E(`${name} enthält noch Lite-Reste`);
}
O('Workflows kopieren alle App-Dateien');

/* ---------- 11. Rechtstexte ---------- */
try { execFileSync('python3', ['make-legal-pages.py', '--pruefen'], { stdio: 'pipe' }); O('Rechtstexte und docs/ aktuell'); }
catch (e) { E('Rechtstexte veraltet: ' + String(e.stdout || e.message).trim()); }
for (const f of ['datenschutz.html', 'impressum.html', 'lizenzen.html']) if (exists(f) && !read(f).includes('href="index.html"')) E(`${f} ohne Rückweg zur App`);

/* ---------- 12. Geheimnisse nicht im Repo ---------- */
const gi = exists('.gitignore') ? read('.gitignore') : '';
for (const p of ['*.p12', '*.keystore', '*.mobileprovision', 'ios-signierung/', 'res/ios/icon-*.png', 'node_modules/']) if (!gi.includes(p)) E(`.gitignore schützt ${p} nicht`);

/* ---------- Ergebnis ---------- */
ok.forEach(m => console.log('  ✓ ' + m));
warns.forEach(m => console.log('  ! ' + m));
errors.forEach(m => console.log('  ✗ ' + m));
console.log(`\n${ok.length} in Ordnung, ${warns.length} Hinweise, ${errors.length} Fehler`);
process.exit(errors.length ? 1 : 0);
