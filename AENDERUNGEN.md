# Änderungen

## 1.1.0 – Werkzeuge für Unterricht und Klassenarbeiten (Oktober 2026)

### Neu

- **Text**: Formatierung einzelner Wörter (fett, kursiv, unterstrichen,
  durchgestrichen, Farbe), Ausrichtung links/Mitte/rechts, Zeilenabstand 1,2/1,5/2,
  eigene Schriften (.ttf/.otf, werden auf dem Gerät gespeichert)
- **Formeln**: Brüche, Wurzeln (auch n-te), Potenzen, Indizes, Strecken,
  Vektoren, Sonderzeichen über Knöpfe
- **Tabellen/Wertetabellen**: leere Zellen im PDF ausfüllbar, Lösungen je Zelle,
  y-Werte auf Knopfdruck aus einem Funktionsterm
- **Funktionsgraphen** im Koordinatensystem (Schulschreibweise: 0,5x + 2, x², |x|,
  sqrt(x) …), Punkte „A(1|3)“, Graph wahlweise nur im Lösungsblatt
- **Formen**: Strecke, Pfeil, Doppelpfeil, Rechteck, Ellipse, Winkel mit
  Gradanzeige, Rechenkästchen; Endpunkte ziehbar
- **Einrasten** an Raster, Seitenrand, Seitenmitte und anderen Elementen (mit
  Hilfslinien; Alt-Taste schaltet es kurz ab)
- **Mehrfachauswahl** (Umschalt+Klick, Rahmen ziehen, „Weitere auswählen“ am
  Tablet), ausrichten, verteilen, kopieren und einfügen – auch auf andere
  Seiten und Blätter
- **Seiten**: aus weiteren PDFs einfügen (Vorschau, Auswahl), duplizieren,
  drehen; **Ausschnitt** aus einem PDF als Bild in Originalgröße
- **Ebenen** Grundblatt/Hilfe/Lösung; Export als Schülerfassung, mit Hilfen
  und als Lösungsblatt in einem Schritt
- **QR-Code zur Selbstkontrolle** mit den Lösungen der Seite (offline lesbar)
- **Rücklauf**: ausgefüllte Schüler-PDFs auswerten – je Aufgabe (Anteil richtig,
  häufigste falsche Antworten) und je Schüler, CSV-Export. Zahlen werden auch
  als Bruch oder mit Komma erkannt. Nichts wird gespeichert.
- **Klassenarbeit**: Punktekästchen mit AFB und Kompetenz (KC Niedersachsen),
  Summen, Notenschlüssel, Erwartungshorizont als Seite nur im Lösungsblatt
- **Lesefreundliche Kopie**: Schrift ≥ 13 pt, Zeilenabstand 1,5, Inhalte
  rutschen nach und laufen auf neue Seiten über

### Gefunden und behoben bei der Prüfung

| Problem | Folge | Behebung |
|---|---|---|
| Textbreiten über die Browser-Schrift gemessen | Kleine Abweichungen im Umbruch zwischen Bildschirm und PDF | Beide messen mit denselben fontkit-Schriften |
| Wörter einzeln ins PDF geschrieben | Kopierter Text ohne Leerzeichen, schlechteres Vorlesen | Gleich formatierte Wörter einer Zeile als ein Text |
| Winkel und Strecken über die ganze Hülle anfassbar | Ein Winkel verdeckte Elemente darunter | Nur die Linien selbst (breiter, unsichtbarer Streifen) |
| Einrasten an der gepolsterten Hülle von Strecken | Elemente rasteten 4 pt neben dem Endpunkt ein | Strecken rasten an ihren Punkten ein |
| Seite drehen: Elemente behielten Breite, Lage wurde gedreht | Breite Felder ragten über den Seitenrand | Mitte wandert mit, Lage wird auf die Seite begrenzt |
| Seiten neu aufgebaut (duplizieren, Rückgängig) | Ansicht sprang, „aktuelle Seite“ wechselte unbemerkt | Scrollposition bleibt, neue Seite wird gezeigt |
| Werkzeug gewählt, während ein Element ausgewählt war | Die Leiste zeigte das Element statt der Werkzeug-Optionen | Werkzeugwahl hebt die Auswahl auf |
| Einfügen am Seitenrand bei Strecken | Punkte und Hülle liefen auseinander | Einfügen verschiebt über `moveObj` |
| Tabelle an der Ecke ziehen | Zeilenhöhe sprang | Formel vereinfacht |
| Eigene Schriften im localStorage-Ersatz | Nach Neustart verloren | Werden mit Daten zurückgelesen |
| Wertetabelle aus Funktion bei nur einer Zeile | Skriptfehler | Hinweis statt Absturz |
| Lösung mit Alternativen auf dem Bildschirm | „2 \| m = 2“ roh angezeigt | „2 oder m = 2“ wie im Lösungsblatt |

### Übernahme älterer Daten

Blätter und Projektdateien aus 1.0 öffnen unverändert: Text wird zu
formatierten Läufen, das Original-PDF zur Quelle `main`, die alte Ablage der
PDF-Datei wird weiter gelesen. smoketest.js prüft beides.

### Prüfungen

- smoketest.js: 130 Prüfungen (vorher 53), darunter Lesbarkeit des QR-Codes
  (jsQR), Farben und Lage im gerenderten PDF, Rundreise der Auswertung mit
  per pdf-lib ausgefüllten Schüler-PDFs, Formel-Einschleusung in der CSV
- Gegenprobe mit absichtlich eingebauten Fehlern (Untermengen-Schriften,
  falsche Fassungsfilter, keine ausfüllbaren Zellen, Zahlenvergleich, CSV-Schutz,
  QR-Inhalt, Umbruch der lesefreundlichen Kopie, Einrasten): jede wird erkannt

## 1.0.0 – erste App-Fassung (Oktober 2026)

Aus dem Browser-Prototyp entstanden. Vor dem Umbau wurde der gesamte Code
geprüft. Gefundene Fehler und was dagegen getan wurde:

### Fehler, die Nutzer getroffen hätten

| Problem | Folge | Behebung |
|---|---|---|
| Anzeige in Systemschrift (Arial/Roboto), Export in Helvetica | Auf Android brach der Text im PDF an anderer Stelle um als auf dem Bildschirm | Eigene Schriften (Noto) für Anzeige **und** Export; Grundlinie wird gemessen statt geschätzt |
| Sonderzeichen wie π, ≤, √ | Im PDF als „?“ | Noto-Schriften plus Noto Sans Math; Zeichen werden je Schrift aufgeteilt |
| Untermengen-Bildung der Schriften (pdf-lib/fontkit) | Text im PDF unsichtbar, aber durchsuchbar – nur am gerenderten Bild erkennbar | Abgeschaltet; Schriften vorab reduziert (make-fonts.sh); Test vergleicht jede Zeile im gerenderten PDF |
| Leeres neues Textfeld + „Rückgängig“-Knopf | Eine frühere Änderung verschwand mit | `endEdit()` meldet das Verwerfen, `undo()` nimmt dann keinen weiteren Schritt zurück |
| Seitenbilder ohne Größenbegrenzung | iPad/iPhone: ab einigen Seiten weiße Seiten (Canvas-Speichergrenze) | Höchstens 6 Megapixel je Seite, Seiten weit außerhalb geben ihren Speicher frei |
| Text-Werkzeug legte schon beim Aufsetzen des Fingers an | iOS öffnet die Tastatur nur zuverlässig nach einer abgeschlossenen Geste; Scrollen mit einem Finger war im Text-Werkzeug unmöglich | Anlegen erst beim Loslassen, Bewegung zählt als Scrollen |
| Zahlenfelder `type=number` | Deutsches Komma („2,5“) wurde ignoriert | Textfelder mit Kommaverarbeitung; Minuszeichen über Tastatur oder −/+ |
| Speichern in localStorage (inkl. PDF als Text) | Ab ~5 MB still verloren; bei jeder Änderung das ganze PDF neu kodiert | IndexedDB, PDF einmal als Binärdaten; Ersatz localStorage mit Fehlermeldung |
| Projektdatei ungeprüft übernommen | Manipulierte Datei konnte die Oberfläche stören | Alle Werte werden auf Typ und Bereich gebracht; Test mit feindlicher Datei |
| Altes PDF nach Öffnen eines neuen nicht freigegeben | Speicher wuchs mit jedem geöffneten PDF | `pdf.destroy()` beim Wechsel |
| Bildauswahl ohne Kamera-Hinweistext in iOS | Absturz bei „Foto aufnehmen“ | `NSCameraUsageDescription` gesetzt, Workflow und validate.js prüfen es |
| HEIC-Fotos vom iPhone | Nicht einbettbar | Werden beim Einfügen nach JPEG umgerechnet |
| Koordinaten-Beschriftung mit Gleitkomma-Schleife | Letzte Zahl fehlte bei manchen Bereichen | Schleife über ganze Zahlen |
| Panel-Klick auf „Fett“ während der Bearbeitung | Jeder Klick ein eigener Rückgängig-Schritt mit halbem Text | Schnappschuss gehört zur Bearbeitung |

### Neu für die App

- „Meine Blätter“: automatische Ablage auf dem Gerät, Liste mit Öffnen und Löschen
- Export über das Teilen-Menü wie in FairMix (Dateiname über `df:`, iPad-Popover-Anker)
- Zwei-Finger-Zoom
- Android-Zurücktaste: Dialog → Bearbeitung → Auswahl → Werkzeug → App
- Sofortiges Sichern beim Wechsel in den Hintergrund (iOS beendet ohne Vorwarnung)
- Strenge Content-Security-Policy: die App lädt nichts aus dem Netz
- Sichere Bereiche (Notch, Home-Indikator) berücksichtigt
- Rechtstexte, Lizenzseite, Privacy-Manifest

### Prüfkette

- `validate.js`: 16 Prüfgruppen (Versionen, Dateien im Paket, iOS-Hinweistexte,
  CSP, Icons ohne Alphakanal, Rechtstexte aktuell, Geheimnisse nicht im Repo)
- `smoketest.js`: 53 Prüfungen im echten Browser, jedes exportierte PDF wird
  mit pdf-lib, pdf.js und pdftoppm von außen kontrolliert
- Nachgewiesen per Mutation: Untermengen-Bildung an, Rückgängig-Fehler wieder
  eingebaut und unmaskierte Beschriftung werden jeweils erkannt
