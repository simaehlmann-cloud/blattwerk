# Blattwerk – Projektwissen, Stand 1.1.0

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

## Kennungen

- Paket/Bundle: `de.blattwerk.app`
- Version 1.1.0, Code 10100 (Major*10000 + Minor*100 + Patch)
- Secrets wie FairMix; Zertifikat und ASC-Schlüssel wiederverwendbar,
  Profil und Android-Keystore neu

## Prüfkette

    node validate.js       (16 Prüfgruppen)
    node smoketest.js      (193 Prüfungen, Playwright + pdftoppm + qpdf + jsQR)

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
