# Blattwerk

Arbeitsblätter als PDF bearbeiten und für Schülerinnen und Schüler ausfüllbar
machen. Für iPhone, iPad und Android, vollständig offline.

Aufgebaut wie FairMix: eine einzige `index.html` als App, Cordova verpackt sie,
GitHub Actions bauen iOS und Android.

## Was die App kann

- PDFs öffnen, vorhandenen Text ändern und verschieben (Original wird abgedeckt)
- Eigene Texte, Bilder (auch Kamera), Markierungen, Abdeckungen
- Ausfüllbare Textfelder und Ankreuzkästchen, die im exportierten PDF funktionieren
- Schreiblinien und Koordinatensysteme (einstellbar: Bereich, Einheit, Kästchen)
- Neue Blätter mit Hintergrund: weiß, Kästchen, liniert, Punktraster,
  Millimeterpapier, Koordinatensystem; optional ausfüllbare Kopfzeile
- „Meine Blätter“: alles wird automatisch auf dem Gerät gespeichert
- Export über das Teilen-Menü („In Dateien sichern“, Mail, AirDrop …)
- Mathe-Zeichen wie π, ≤, √, ∞ werden mit exportiert (eingebaute Noto-Schriften)

Neu in 1.1:

- Inhalte aus PDFs entfernen – beim Export wirklich gelöscht, nicht nur
  verdeckt; Lösungen in Vorlagen nur für die Schülerfassung ausblenden
- Lücken automatisch als Felder erkennen, vorhandene Formularfelder übernehmen
- Einfachauswahl, Auswahllisten, Ziffernkästchen; korrigierte PDFs zurückgeben;
  Formular prüfen; Platz schaffen durch Teilen einer Seite
- Startbildschirm, Einstellungen (Farben, Schrift, Darstellung, Vorgaben)
  und „Über Blattwerk“ mit Erklärungen
- Formatierung je Wort (fett, kursiv, unterstrichen, durchgestrichen, Farbe),
  Ausrichtung, Zeilenabstand, eigene Schriften (.ttf/.otf)
- Formeln (Brüche, Wurzeln, Potenzen, Indizes, Strecken, Vektoren),
  Wertetabellen mit ausfüllbaren Zellen, Funktionsgraphen im Koordinatensystem
- Formen: Strecke, Pfeil, Doppelpfeil, Rechteck, Ellipse, Kreis, Dreieck, Trapez,
  Parallelogramm, Raute, Drachen, Winkel, Rechenkästchen
- Einrasten an Raster, Seitenrändern und anderen Elementen; Mehrfachauswahl,
  Kopieren und Einfügen auch zwischen Seiten und Blättern
- Seiten aus weiteren PDFs einfügen, duplizieren, drehen; Ausschnitt aus einem
  PDF als Bild einfügen, mit Quellenangabe
- Fotografierte Arbeitsblätter entzerren, zuschneiden, aufhellen (offline)
- Texterkennung für Scans und Fotos (offline, Tesseract): Text ändern, durchsuchbare
  und vorlesbare PDFs, lesefreundliche Kopie aus Scans
- Ebenen Grundblatt / Hilfe / Lösung: ein Blatt, drei Exporte
  (Schülerfassung, mit Hilfen, Lösungsblatt); QR-Code zur Selbstkontrolle (offline)
- Rücklauf: ausgefüllte Schüler-PDFs auswerten, Übersicht je Aufgabe und
  je Schüler, CSV-Export
- Klassenarbeit: Punkte, Anforderungsbereiche, Kompetenzen, Notenschlüssel,
  Erwartungshorizont als Seite im Lösungsblatt
- Lesefreundliche Kopie: größere Schrift, mehr Zeilenabstand, Umbruch auf neue Seiten

## Dateien

    index.html            die gesamte App (Oberfläche und Logik)
    lib/                  pdf.js 3.11.174, pdf-lib 1.17.1, fontkit 1.1.1, qrcode-generator 1.4.4,
                          tesseract.js 7.0.0 mit Kern 6.1.2 und deutschem Modell (unverändert)
    fonts/                Noto-Schriften, mit make-fonts.sh reduziert
    manifest.json, sw.js  Browser-Fassung (PWA)
    config.xml            Cordova: Kennung, Version, Icons, iOS-Hinweistexte
    res/android/          Icons und Farbe für Android (aus make-icons.py)
    res/ios/              Privacy-Manifest; Icons entstehen im CI-Lauf
    datenschutz.html, impressum.html, lizenzen.html   aus make-legal-pages.py
    docs/                 dieselben Rechtstexte für GitHub Pages

    validate.js           statische Prüfungen (Versionen, Dateien, Store-Pflichtangaben)
    smoketest.js          Ablauftest im echten Browser, prüft jedes Export-PDF
    test/vorlagen/        echte Prüf-PDFs aus LibreOffice, LaTeX, Browser u. a.
    make-icons.py         zeichnet das Icon in allen Größen
    make-ios-icons.py     iOS-Icons ohne Alphakanal und Startbild (läuft im CI)
    make-fonts.sh         holt und reduziert die Schriften
    make-legal-pages.py   erzeugt die Rechtstexte

## Prüfkette

    npm ci
    npx playwright install chromium
    node validate.js
    node smoketest.js

Beide laufen in jedem Build vor dem eigentlichen Bauen. Für die volle Prüfung
des Exports braucht `smoketest.js` außerdem `pdftoppm` (poppler-utils) und
`qpdf`; fehlen sie, werden die betreffenden Prüfungen übersprungen.
QR-Codes liest der Test mit jsQR (Entwicklungsabhängigkeit).

## Version anheben

An vier Stellen gleichzeitig, `validate.js` prüft das:

    index.html     const APP_VERSION = '1.1.1';
    sw.js          const CACHE = 'blattwerk-1.1.1';
    package.json   "version": "1.1.1"
    config.xml     version="1.1.1" android-versionCode="10101" ios-CFBundleVersion="10101"

Danach `python3 make-legal-pages.py`, falls sich Rechtstexte geändert haben.

Einrichtung der Stores: siehe `EINRICHTUNG.md`. Store-Texte: `STORE-TEXTE.md`.
