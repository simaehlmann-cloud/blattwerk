# Blattwerk – Projektwissen, Stand 1.2.0

PDF-Editor für Arbeitsblätter (Lehrkräfte), iOS und Android über Cordova,
gebaut wie FairMix. Repo: `simaehlmann-cloud/Blattwerk` (anzulegen).

## Grundsätze

- Eine Datei `index.html` mit genau einem Inline-Skript (validate.js prüft das)
- Läuft offline; strenge CSP, keine externen Quellen
- Bibliotheken unverändert in `lib/` (pdf.js 3.11.174, pdf-lib 1.17.1,
  @pdf-lib/fontkit 1.1.1, qrcode-generator 1.4.4), Schriften in `fonts/`
  (Noto, mit make-fonts.sh reduziert)
- Schriften **nicht** als Untermenge einbetten (`subset` aus): fontkit verliert
  bei Noto Serif/Math Glyphen. smoketest.js prüft jede Schriftzeile im
  gerenderten PDF.
- Bildschirm und Export messen Text mit denselben fontkit-Objekten
  (`textWidth`, `layoutText`): Zeilenumbrüche sind im PDF identisch
- Export über das Teilen-Menü (cordova-plugin-x-socialsharing), Dateiname über
  `df:<name>;data:…`, iPad-Popover-Anker; mehrere Dateien in einem Aufruf
- Speicher: IndexedDB `blattwerk` Version 2 (meta, docs, pdfs, fonts), Ersatz
  localStorage. PDFs unter `<docId>/<sid>`; 1.0 nutzte `<docId>` (wird noch gelesen)
- Koordinaten intern in PDF-Punkten (pt), Ursprung oben links der angezeigten
  (gedrehten) Seite; Umrechnung beim Export über `M()` mit Seitendrehung
  (`orot` aus dem PDF + `rot` vom Nutzer)

## Datenmodell 1.1

- Seite: `{id, sid, src, w, h, rot, orot, bg?, layer?: 'sol', horizon?}`;
  `sid` = Quell-PDF (`main` oder eingefügtes), `null` = leere Seite
- Text: `runs: [{t, b, i, u, s, c}]`, `text` = Klartext, `align`, `lh`, `font`
  (`sans|serif|mono|u:<id>` für eigene Schriften)
- Ebenen: `layer` = `base|help|sol`. Export-Fassungen `student` (base),
  `help` (base+help), `solution` (alles, Felder statisch mit roter Lösung)
- Feldnamen kommen aus `fieldNames()` – Export und Auswertung nutzen dieselbe
  Zuordnung; Tabellenzellen heißen `<Tabelle> Z<zeile>S<spalte>`
- Lösungen: Feld `solution` (Alternativen mit `|`), Kästchen `correct`,
  Tabelle `sol[][]`, Funktion `sol: true`, Elemente auf Ebene `sol`
- `cleanState()` bereinigt jede Eingabe und hebt 1.0-Daten an
- Formen mit Punkten (`isPointShape`): Strecke/Pfeil/Winkel/Kreis und Vielecke
  (`POLY`: triangle, trapez, parallel, raute, drachen) mit x1/y1 … x4/y4;
  `constrainPoly()` hält Trapez, Parallelogramm, Raute, Drachen beim Ziehen
- Echtes Entfernen (`6c-redact`: `redactPage`): liest den Inhaltsstrom, löscht
  Zeichen (Mitte unter Abdeckung → gleich breiter TJ-Abstand), Bilder/Pfade
  ganz unter Abdeckung, bearbeitet Formular-XObjects als Kopie; sonst
  `RedactUnsupported` → Seite als Bild mit eingebrannter Abdeckung.
  Danach `pruneUnreachable` und `fillXrefGaps` (sonst poppler-Fehler)
- Abdeckung `whiteout`: `erase` (aus „Entfernen“), `solShow` (nur Schüler-
  und Hilfen-Fassung), `split` (Platz schaffen)
- Felder: `ftype` text|choice|comb, `choices`, `comb`, `autoSize`;
  Kästchen `group` = Einfachauswahl (Radio, Wert aus `fieldNames()['opt:'+id]`)
- Beim Öffnen `importWidgets()`: Formularfelder werden Blattwerk-Felder,
  Seite bekommt `dropWidgets` (Original-Widgets fallen im Export weg)
- Einstellungen `P` in localStorage `bw:prefs` (nur Gerät), Vorgaben `PREF_DEF`,
  Prüfung je Schlüssel `PREF_OK`; Darstellung über `data-theme` am `<html>`
- Startbildschirm `#home` liegt über dem Editor; das letzte Blatt ist dahinter
  geladen. `resetDoc()` blendet ihn aus (außer beim Start, `S.booting`)

## Bedienkonzept (seit 1.2.0)

- `P.mode` = `simple|all` (Vorgabe `simple`). Einfach: Leiste zeigt nur
  `CORE_TOOLS` (Auswählen, Text, Markieren, Entfernen, Bild, Textfeld) und
  „Mehr“ (`#toolsMore`, `toggleMoreTools()`); übrige Werkzeuge haben die Klasse
  `extra`. Tastenkürzel gelten immer für alle Werkzeuge. Das Seitenpanel
  zeigt Klassenarbeit, Formular-Werkzeuge und Tastenkürzel nur bei `all` oder
  wenn sie gebraucht werden (Punkte bzw. Felder vorhanden)
- Ansicht = Fassung: `setView(base|help|sol)` setzt `S.view` **und** `S.layer`
  (neue Elemente landen auf der Ebene der Ansicht). Kopfzeile: `#viewSeg`
  (breit) bzw. `#viewSel` (schmal). `P.view` = Ansicht beim Öffnen (Vorgabe
  `base`); `P.help`/`P.sol` gibt es nicht mehr. `setLayer()` wechselt die
  Ansicht mit, wenn ein Element sonst unsichtbar würde (ebenso beim Einfügen).
  Ausnahme `BASE_TYPES` (Feld, Kästchen, Tabelle, Punkte, QR): entstehen immer
  auf `base`, die Lösung steckt im Element. Ist ein solches Element gewählt und
  die Lösung nicht sichtbar, zeigt das Panel einen Hinweis (`view-sol`)
- Text direkt antippen: Im Werkzeug „Auswählen“ wandelt ein Tipp auf PDF- oder
  erkannten Text (`lineAt()`) die Zeile um – nur wenn nichts ausgewählt ist,
  sonst hebt der erste Tipp die Auswahl auf. `buildPages()` liest die Zeilen
  aller PDF-Seiten nacheinander im Hintergrund; ist eine Seite noch nicht
  gelesen, wird der Tipp nachgeholt (`act: 'pending'`, nur bei echtem Tipp,
  nicht beim Wischen). Maus: Rahmenauswahl darf auf Text beginnen, ein kurzer
  Klick ändert den Text; Textcursor über Zeilen (`.page.over-text`).
  Text auf Bildern (Fotos) bleibt über „Text ändern“ erreichbar, weil ein Tipp
  dort das Bild wählt. „Text ändern“ steht unter „Mehr“
- Finger/Stift: Bei Tipp-Gesten auf der Seite ruft `pointerdown`
  `preventDefault()` auf (`noCompat`) – sonst landet das nachgeschobene
  mousedown im Panel, das sich schmal gerade unter dem Finger öffnet, und der
  neue Text verliert den Fokus. Fokus in Eingabefeldern außerhalb der Seite wird
  dabei selbst aufgehoben
- Tipp auf Scan ohne Text: `offerOcr()` bietet die Erkennung einmal je Seite an
- Seiten mit `layer: 'sol'` außerhalb von „+ Lösung“: `.pwrap.off` (blass)
- Kopfzeile: ≤ 1320 px nur Symbole bei Neu/Meine Blätter, ≤ 1060 px auch beim
  Export, ≤ 720 px Ansicht als `<select>`, ≤ 560 px ohne Neu/Meine Blätter
- Ein Knopf für die Ausgabe: `exportLabel()` – in der App „Teilen“, im Browser
  „PDF exportieren“; der doppelte Export-Knopf im Panel entfällt
- Startbildschirm: Datenschutz-Hinweis (`.home-priv`)
- Bedientest mit Referendaren: `BEDIENTEST.md`

## Kennungen

- Paket/Bundle: `de.blattwerk.app`
- Version 1.2.0, Code 10200 (Major*10000 + Minor*100 + Patch)
- Secrets wie FairMix; Zertifikat und ASC-Schlüssel wiederverwendbar,
  Profil und Android-Keystore neu

## Prüfkette

    node validate.js       (17 Prüfgruppen)
    node smoketest.js      (270 Prüfungen, Playwright + pdftoppm + qpdf + jsQR; Abschnitt „iPad mit Finger“
                            spielt die drei Aufgaben aus BEDIENTEST.md mit Touch durch)

Chromium braucht eine UTF-8-Locale, sonst heißen Downloads mit Umlaut
„download“ (smoketest.js setzt `LANG=C.UTF-8`).

## Offene Punkte

- „Öffnen in Blattwerk“ (Dokumenttypen + Plugin)
- iOS: Zweitkopie der Blätter als Datei (Schutz vor Speicherbereinigung)
- Test auf echten Geräten (iPad mit Stift, Android-Tablet), v. a. Formatieren
  einzelner Wörter mit der Bildschirmtastatur
- Ausfüllbare Felder nutzen Helvetica: Schüler-Eingaben außerhalb von
  WinAnsi (etwa π) zeigt der PDF-Betrachter selbst an
- Erledigt: Fotos entzerren/aufhellen (6d-scan.js: Otsu + größte helle Fläche → Ecken, Homographie, Hintergrund-Normalisierung; Original bleibt als `o.orig`, Einstellungen in `o.scan`), Quellenangabe `o.caption` (7 pt unter dem Bild, auch im Export)
- Erledigt: Texterkennung (6e-ocr.js, tesseract.js 7.0.0, Kern 6.1.2 LSTM, `deu` aus tessdata_best_int, lazy geladen, Worker nach 60 s beendet). Ergebnis normiert auf den Träger: `p.ocr` (Scan-Seite) bzw. `o.ocr` (Bild, mit `img` – verfällt bei neuem Bild). Zeilen fließen über `linesOf()` in „Text ändern“/„Entfernen“; Export: unsichtbare Textebene (Tr 3, Tz auf Wortbreite), Wörter unter Abdeckungen fallen weg; `ocrReadable()` macht aus Scans echten Text + Abbildungsausschnitte. Abdeckungen auf Bildern liegen über dem Bild (`coverOnImage`)
- Später: Handschrift-/Rechenbereich; Lücken auf Scans erkennen (Bildanalyse)
- Browser-Artifact (Prototyp) entspricht nicht mehr der App
