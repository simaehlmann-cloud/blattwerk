# Prüf-PDFs für smoketest.js

Echte Dateien aus verschiedenen Programmen, damit „Entfernen“ und „Lücken
erkennen“ nicht nur mit selbst erzeugten PDFs geprüft werden. Jede Datei mit
„GEHEIM42“ enthält das Wort mitten in einer Zeile zwischen „vorher“ und
„nachher“; der Test löscht es und prüft, dass der Rest der Zeile bleibt.

| Datei | erzeugt mit | Besonderheit |
|---|---|---|
| libreoffice-blocksatz.pdf | LibreOffice | Blocksatz, TrueType WinAnsi, Bild |
| latex.pdf | pdfLaTeX | Type-1- und Type-3-Schriften, Kerning (TJ), Bild |
| browserdruck.pdf | wkhtmltopdf | CID-TrueType (Identity-H), Bild |
| reportlab.pdf | ReportLab | Helvetica ohne eingebettete Schrift, Wortabstand |
| matplotlib-type3.pdf | Matplotlib | Type-3-Schrift |
| matplotlib-cid.pdf | Matplotlib | CID-Schrift (CFF) |
| formular-xobject-gedreht.pdf | pdf-lib | Text in einem Formular-XObject, Seite gedreht |
| luecken-text.pdf | LibreOffice | Unterstriche, Punktlinie, ☐-Zeichen |
| luecken-linien.pdf | ReportLab | Schreiblinien, Tabelle, Kästchen, Unterstreichung |
| scan-bruchrechnung.pdf | Python/PIL | Reiner Bild-Scan (200 dpi, Rauschen, leicht schräg), Kreisgrafik, Lückenlinien |
| foto-blatt.jpg | Python/PIL | Schräg „fotografiertes“ Blatt auf Holz, Schatten links; Ecken bekannt |
