#!/usr/bin/env python3
"""Erzeugt die Rechtstexte der App und ihre Fassungen fuer GitHub Pages.

    python3 make-legal-pages.py

Quelle sind die Texte in diesem Skript. Es schreibt
    datenschutz.html, impressum.html, lizenzen.html      (in der App)
    docs/index.html, docs/blattwerk/*.html               (GitHub Pages)
Im Web zeigt "Zurueck zur App" auf die Uebersicht, weil es dort keine
index.html der App gibt. validate.js fuehrt das Skript im Pruefmodus aus
und schlaegt fehl, wenn eine Datei nicht mehr dem Stand hier entspricht –
damit die Datenschutzerklaerung im Store nie anders lautet als in der App.
"""
import html
import os
import sys

STAND = "Oktober 2026"

KOPF = """<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:">
<title>{titel} – Blattwerk</title>
<meta name="theme-color" content="#2440b3">
<style>
  :root {{ --bg:#e6e9f0; --card:#fff; --text:#1a2030; --accent:#2440b3; --muted:#566074; --line:#d2d7e2; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg:#13161d; --card:#1b1f28; --text:#e5e8ef; --accent:#8ea2ff; --muted:#9aa3b6; --line:#323949; }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin:0; padding:calc(24px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom));
    background:var(--bg); color:var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    line-height:1.6;
  }}
  main {{ max-width:760px; margin:0 auto; background:var(--card);
         border:1px solid var(--line); border-radius:14px; padding:24px; }}
  h1 {{ font-size:clamp(24px,5vw,32px); margin:0 0 4px; }}
  h2 {{ font-size:clamp(18px,4vw,21px); margin:30px 0 8px; }}
  .stand {{ color:var(--muted); font-size:14px; margin:0 0 24px; }}
  ul {{ padding-left:20px; }}
  a {{ color:var(--accent); }}
  address {{ font-style:normal; }}
  pre {{ white-space:pre-wrap; font-size:12px; background:var(--bg); padding:12px; border-radius:8px; overflow-x:auto; }}
  .links {{ margin-top:32px; display:flex; flex-wrap:wrap; gap:12px; }}
  .links a {{ display:inline-block; padding:12px 20px; background:var(--accent);
             color:#fff; border-radius:10px; text-decoration:none; font-weight:600; }}
  @media (prefers-color-scheme: dark) {{ .links a {{ color:#0c1022; }} }}
</style>
</head>
<body>
<main>
"""

ANSCHRIFT = """<address>
    Wisdompeak Apps<br>
    Inhaber: Simon Mählmann<br>
    Oderstraße 13<br>
    28844 Weyhe<br>
    Deutschland
  </address>"""

MAIL = '<a href="mailto:smaehlmann.appdev@gmail.com">smaehlmann.appdev@gmail.com</a>'


def links(*paare):
    return '  <div class="links">\n' + "\n".join(
        '    <a href="%s">%s</a>' % p for p in paare) + "\n  </div>\n</main>\n</body>\n</html>\n"


DATENSCHUTZ = KOPF.format(titel="Datenschutzerklärung") + """  <h1>Datenschutzerklärung</h1>
  <p class="stand">Blattwerk · Stand: """ + STAND + """</p>

  <h2>1. Verantwortlicher</h2>
  <p>Verantwortlich im Sinne von Art. 4 Nr. 7 DSGVO ist:</p>
  """ + ANSCHRIFT + """
  <p>E-Mail: """ + MAIL + """</p>
  <p>Ein Datenschutzbeauftragter ist nicht bestellt, da die Voraussetzungen des Art. 37 DSGVO
     und des § 38 BDSG nicht vorliegen.</p>

  <h2>2. Grundsatz: keine Datenerhebung</h2>
  <p>
    Blattwerk verarbeitet keine personenbezogenen Daten auf Servern des Anbieters.
    Die App arbeitet vollständig offline. Es gibt keine Benutzerkonten, keine Registrierung,
    keine Analyse- oder Trackingdienste, keine Werbung und keine Weitergabe von Daten an Dritte.
  </p>

  <h2>3. Welche Daten auf dem Gerät gespeichert werden</h2>
  <p>Damit Sie an Ihren Arbeitsblättern weiterarbeiten können, speichert die App auf dem Gerät:</p>
  <ul>
    <li>eine Kopie der PDF-Dateien, die Sie in der App öffnen</li>
    <li>Ihre Bearbeitungen: Texte, Formeln, Markierungen, Textfelder, Ankreuzkästchen, Tabellen,
        Formen, Linien, Koordinatensysteme, Hintergründe, hinterlegte Lösungen und Punkte</li>
    <li>Schriftdateien, die Sie selbst zur App hinzufügen</li>
    <li>Ihre Einstellungen, etwa Farben, Schriftgröße und Darstellung</li>
    <li>Bilder und Fotos, die Sie in ein Blatt einfügen</li>
    <li>den Namen jedes Blatts und den Zeitpunkt der letzten Änderung</li>
  </ul>
  <p>
    Diese Daten liegen im geschützten Speicher der App (IndexedDB) und werden zu keinem
    Zeitpunkt übertragen. Einzelne Blätter löschen Sie unter „Meine Blätter“. Beim
    Deinstallieren der App werden alle Daten vollständig entfernt.
  </p>

  <h2>4. Hinweis zu Daten von Schülerinnen und Schülern</h2>
  <p>
    Wenn Sie Arbeitsblätter mit Namen oder Antworten von Schülerinnen und Schülern öffnen,
    etwa zurückgegebene ausgefüllte PDFs, verarbeiten Sie personenbezogene Daten in eigener
    Verantwortung. Da diese Daten das Gerät nicht verlassen, findet keine Übermittlung an den
    Anbieter statt. Bitte beachten Sie dennoch die Vorgaben Ihrer Schule und die
    landesrechtlichen Regelungen zum Schuldatenschutz.
  </p>
  <p>
    Mit der Funktion „Ausgefüllte PDFs auswerten“ liest die App die Formularfelder der von
    Ihnen ausgewählten Schüler-PDFs ausschließlich im Arbeitsspeicher des Geräts, vergleicht sie
    mit den hinterlegten Lösungen und zeigt das Ergebnis an. Die Dateien und Ergebnisse werden
    dabei nicht gespeichert und nicht übertragen. Eine Auswertungstabelle (CSV) entsteht nur, wenn
    Sie sie ausdrücklich sichern; wohin Sie diese Datei weitergeben, entscheiden Sie.
  </p>
  <p>
    QR-Codes zur Selbstkontrolle enthalten nur den Text, der auf dem Blatt sichtbar hinterlegt ist
    (Lösungen der Seite oder Ihren eigenen Text). Sie verweisen auf keinen Server und funktionieren
    ohne Internet.
  </p>

  <h2>5. Berechtigungen</h2>
  <p>
    Die App fordert keine Berechtigungen für Mikrofon, Kontakte, Standort oder Telefonie an.
    Wenn Sie beim Einfügen eines Bildes „Foto aufnehmen“ wählen, fragt Ihr Gerät einmalig nach
    dem Zugriff auf die Kamera. Das Foto wird nur in das gerade bearbeitete Blatt übernommen.
    Bilder aus Ihrer Fotomediathek wählen Sie über die Auswahl des Betriebssystems aus; die App
    sieht dabei nur die Bilder, die Sie auswählen.
  </p>
  <p>
    Beim Export eines PDFs oder einer Projektdatei wird die Datei in einem temporären
    App-Verzeichnis abgelegt und über die Teilen-Funktion Ihres Geräts weitergegeben. Wohin die
    Datei anschließend gelangt, entscheiden allein Sie.
  </p>

  <h2>6. Verbindungen ins Internet</h2>
  <p>
    Die App baut von sich aus keine Netzwerkverbindungen auf. Alle verwendeten Bibliotheken
    (pdf.js, pdf-lib, fontkit, qrcode-generator) und Schriften (Noto) sind Teil der App und werden nicht von
    fremden Servern geladen. Die Lizenzen finden Sie in der App unter „Lizenzen“.
  </p>

  <h2>7. Bezug über einen App-Vertrieb</h2>
  <p>
    Beim Herunterladen der App über einen App-Vertrieb verarbeitet dessen Betreiber eigenständig
    Daten (etwa Konto, Gerät und Zeitpunkt des Downloads). Darauf hat der Anbieter dieser App
    keinen Einfluss. Es gelten die Datenschutzbestimmungen des jeweiligen Betreibers.
  </p>

  <h2>8. Ihre Rechte</h2>
  <p>
    Ihnen stehen die Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
    Datenübertragbarkeit und Widerspruch nach Art. 15 bis 21 DSGVO zu sowie ein Beschwerderecht
    bei einer Aufsichtsbehörde. Da beim Anbieter keine personenbezogenen Daten gespeichert werden,
    laufen Auskunfts- und Löschersuchen gegenüber dem Anbieter in der Regel ins Leere.
    Sie können alle Daten jederzeit selbst in der App löschen.
  </p>

  <h2>9. Änderungen dieser Erklärung</h2>
  <p>
    Diese Erklärung wird angepasst, sobald sich Funktionen der App ändern, die für den
    Datenschutz erheblich sind. Die jeweils gültige Fassung ist in der App und auf dieser Seite abrufbar.
  </p>

  <h2>10. Kontakt</h2>
  <p>Bei Fragen zum Datenschutz wenden Sie sich bitte an """ + MAIL + """.</p>

""" + links(("index.html", "Zurück zur App"), ("impressum.html", "Impressum"))

IMPRESSUM = KOPF.format(titel="Impressum") + """  <h1>Impressum</h1>
  <p class="stand">Blattwerk · Stand: """ + STAND + """</p>

  <h2>Angaben gemäß § 5 DDG</h2>
  """ + ANSCHRIFT + """

  <h2>Kontakt</h2>
  <p>E-Mail: """ + MAIL + """</p>

  <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
  <p>Simon Mählmann, Anschrift wie oben.</p>

  <h2>Umsatzsteuer</h2>
  <p>Umsatzsteuer-Identifikationsnummer gemäß § 27 a UStG: DE430437820</p>
  <p>
    Kleinunternehmer gemäß § 19 UStG. Es wird keine Umsatzsteuer ausgewiesen
    und kein Vorsteuerabzug geltend gemacht.
  </p>

  <h2>Verbraucherstreitbeilegung</h2>
  <p>
    Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren
    vor einer Verbraucherschlichtungsstelle teilzunehmen.
  </p>

  <h2>Haftung für Inhalte</h2>
  <p>
    Die Inhalte dieser App wurden mit Sorgfalt erstellt. Für die Richtigkeit,
    Vollständigkeit und Aktualität der Inhalte kann jedoch keine Gewähr übernommen werden.
  </p>

  <h2>Urheberrecht</h2>
  <p>
    Die durch den Anbieter erstellten Inhalte und Werke in dieser App unterliegen dem
    deutschen Urheberrecht. Die von Nutzerinnen und Nutzern bearbeiteten Dokumente verbleiben
    ausschließlich auf deren Gerät und sind davon nicht berührt. Für die Rechte an den
    Dokumenten, die Sie in der App bearbeiten, sind Sie selbst verantwortlich.
  </p>

""" + links(("index.html", "Zurück zur App"), ("datenschutz.html", "Datenschutzerklärung"))


def lizenzen():
    def datei(pfad):
        with open(pfad, encoding="utf-8", errors="replace") as f:
            return html.escape(f.read().strip())
    teile = [
        ("pdf.js 3.11.174", "Mozilla Foundation, Apache License 2.0", "lib/licenses/pdfjs-LICENSE.txt"),
        ("pdf-lib 1.17.1", "Andrew Dillon, MIT-Lizenz", "lib/licenses/pdf-lib-LICENSE.md"),
        ("@pdf-lib/fontkit 1.1.1", "Devon Govett, Andrew Dillon, MIT-Lizenz", "lib/licenses/fontkit-LICENSE.txt"),
        ("qrcode-generator 1.4.4", "Kazuhiko Arase, MIT-Lizenz. Das Wort „QR Code“ ist eine eingetragene Marke der DENSO WAVE INCORPORATED.", "lib/licenses/qrcode-generator-LICENSE.txt"),
        ("Noto Sans, Noto Serif, Noto Sans Mono, Noto Sans Math", "The Noto Project Authors, SIL Open Font License 1.1 (auf die benötigten Schriftzeichen reduziert)", "fonts/OFL.txt"),
        ("Liberation Sans (mit pdf.js ausgeliefert)", "SIL Open Font License 1.1", "lib/pdfjs/standard_fonts/LICENSE_LIBERATION"),
        ("Foxit-Schriften (mit pdf.js ausgeliefert)", "Foxit Software Inc., BSD-Lizenz", "lib/pdfjs/standard_fonts/LICENSE_FOXIT"),
    ]
    body = KOPF.format(titel="Lizenzen") + """  <h1>Lizenzen</h1>
  <p class="stand">Blattwerk · Stand: """ + STAND + """</p>
  <p>Blattwerk enthält die folgenden freien Bibliotheken und Schriften. Vielen Dank an ihre Autorinnen und Autoren.</p>
"""
    for name, wer, pfad in teile:
        body += "\n  <h2>%s</h2>\n  <p>%s</p>\n  <pre>%s</pre>\n" % (html.escape(name), html.escape(wer), datei(pfad))
    return body + "\n" + links(("index.html", "Zurück zur App"), ("datenschutz.html", "Datenschutzerklärung"))


UEBERSICHT = KOPF.format(titel="Rechtliches") + """  <h1>Blattwerk</h1>
  <p class="stand">Wisdompeak Apps · Simon Mählmann</p>
  <ul>
    <li><a href="blattwerk/datenschutz.html">Datenschutzerklärung</a></li>
    <li><a href="blattwerk/impressum.html">Impressum</a></li>
    <li><a href="blattwerk/lizenzen.html">Lizenzen</a></li>
  </ul>
  <p>Kontakt: """ + MAIL + """</p>
</main>
</body>
</html>
"""


def fuer_web(text):
    return (text.replace('href="index.html">Zurück zur App<', 'href="../">Zur Übersicht<')
                .replace("<title>", '<meta name="robots" content="index, follow">\n<title>', 1))


def erwartet():
    app = {"datenschutz.html": DATENSCHUTZ, "impressum.html": IMPRESSUM, "lizenzen.html": lizenzen()}
    alles = dict(app)
    alles[os.path.join("docs", "index.html")] = UEBERSICHT
    # Nicht leer: Beim Hochladen über github.com fallen leere Dateien weg.
    # GitHub Pages wertet nur aus, dass die Datei existiert.
    alles[os.path.join("docs", ".nojekyll")] = "GitHub Pages: Seiten ohne Jekyll ausliefern.\n"
    for name, text in app.items():
        alles[os.path.join("docs", "blattwerk", name)] = fuer_web(text)
    return alles


def main():
    pruefen = "--pruefen" in sys.argv
    abweichend = []
    for pfad, text in erwartet().items():
        if pruefen:
            try:
                with open(pfad, encoding="utf-8") as f:
                    if f.read() != text:
                        abweichend.append(pfad)
            except FileNotFoundError:
                abweichend.append(pfad)
        else:
            os.makedirs(os.path.dirname(pfad) or ".", exist_ok=True)
            with open(pfad, "w", encoding="utf-8") as f:
                f.write(text)
            print("  " + pfad)
    if pruefen:
        if abweichend:
            print("Nicht aktuell (python3 make-legal-pages.py ausfuehren): " + ", ".join(abweichend))
            sys.exit(1)
        print("Rechtstexte aktuell.")


if __name__ == "__main__":
    main()
