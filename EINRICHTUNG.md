# Blattwerk einrichten – Schritt für Schritt

Vieles kennst du von FairMix. Hier steht nur, was für Blattwerk **neu** oder
**anders** ist.

## 1. Repository anlegen

1. Auf GitHub ein neues Repository `Blattwerk` anlegen (leer, ohne README).
2. Den Inhalt dieses Ordners hochladen (ZIP entpacken, alles inklusive
   `.github/` und `.gitignore`).
3. **Öffentlich oder privat?** Bei öffentlichen Repos sind die Actions-Minuten
   kostenlos, auch auf dem Mac-Läufer. Bei privaten Repos zählt jede
   macOS-Minute zehnfach gegen dein Freikontingent (2000 Minuten im Monat);
   ein iOS-Build braucht etwa 15 Minuten, also rund 150 Freiminuten.

Nach dem ersten Hochladen laufen beide Workflows los. Ohne Secrets bauen sie
unsigniert und liefern eine Debug-APK für Android – das beweist schon, dass
alles übersetzt.

## 2. Android

Wichtig: **eigener Keystore für Blattwerk**, nicht der von FairMix. Play
verknüpft Schlüssel und Paketkennung dauerhaft.

    keytool -genkeypair -v -keystore blattwerk.keystore -storetype PKCS12 \
      -alias blattwerk -keyalg RSA -keysize 4096 -validity 10000

Den Keystore an einem zweiten Ort sichern (nicht im Repo). Dann die Secrets:

    ANDROID_KEYSTORE_BASE64     base64 -w0 blattwerk.keystore   (Mac: base64 -i … )
    ANDROID_KEYSTORE_PASSWORD   Passwort des Keystores
    ANDROID_KEY_ALIAS           blattwerk
    ANDROID_KEY_PASSWORD        Passwort des Schlüssels (bei PKCS12 meist dasselbe)

In der Play Console eine neue App „Blattwerk“ anlegen, Paketname
`de.blattwerk.app`. Die erste AAB aus dem Workflow-Artefakt
`Blattwerk-release-aab` hochladen.

## 3. iOS

### Was du von FairMix weiterverwenden kannst
- Das **Distribution-Zertifikat** (`dist.p12`) gilt für alle deine Apps.
  `IOS_CERTIFICATE_P12_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_TEAM_ID`,
  `IOS_SIGNING_IDENTITY` kannst du mit denselben Werten im neuen Repo anlegen.
- Die **App-Store-Connect-Schlüssel** (`ASC_KEY_ID`, `ASC_ISSUER_ID`,
  `ASC_KEY_P8`) gelten ebenfalls für alle Apps.

### Was neu ist
1. developer.apple.com → Identifiers → **App-ID `de.blattwerk.app`** anlegen.
   Keine besonderen Fähigkeiten (Capabilities) nötig.
2. Profiles → **App Store**-Profil für diese App-ID, `.mobileprovision` laden.
3. `base64` der Datei als Secret `IOS_PROVISIONING_PROFILE` eintragen.
   (Mit `ios-secrets.sh ende` aus FairMix geht das wie gewohnt: Profil in den
   Ordner `ios-signierung/` legen, Skript ausführen, `secret-profil.txt`.)
4. App Store Connect → neue App „Blattwerk“, Bundle-ID `de.blattwerk.app`.
   Falls der Name vergeben ist: „Blattwerk – Arbeitsblätter“.

Der Upload startet nur bei manuellem Start des Workflows (Actions → Build
Blattwerk (iOS) → Run workflow), genau wie bei FairMix.

## 4. Rechtstexte im Netz

Die Stores verlangen eine Datenschutz-URL. Zwei Wege:

- **Eigene Seite:** Im Blattwerk-Repo Settings → Pages → Branch `main`,
  Ordner `/docs`. Adresse dann
  `https://simaehlmann-cloud.github.io/Blattwerk/blattwerk/datenschutz.html`.
- **Gemeinsame Seite mit FairMix:** Den Ordner `docs/blattwerk/` ins
  FairMix-Repo nach `docs/blattwerk/` kopieren und in dessen
  `make-legal-pages.js` einen Abschnitt „Blattwerk“ in der Übersicht
  ergänzen. Dann gibt es eine Seite „Wisdompeak Apps“ für alle Apps.

## 5. Vor der ersten Einreichung auf echten Geräten prüfen

Diese Punkte kann kein automatischer Test abdecken:

- [ ] iPhone und **iPad**: PDF exportieren → Teilen-Menü → „In Dateien sichern“
      (auf dem iPad ist das Menü ein Popover, eigener Codepfad)
- [ ] Bild einfügen → „Foto aufnehmen“ (Kamera-Abfrage erscheint mit deutschem Text)
- [ ] Ein PDF aus der Dateien-App öffnen, Text ändern, exportieren, das
      Ergebnis in der Dateien-App öffnen und ein Feld ausfüllen
- [ ] App schließen, wieder öffnen: Das letzte Blatt ist noch da
- [ ] Zwei-Finger-Zoom auf dem Blatt
- [ ] Android: Zurück-Taste schließt Dialoge, beendet die Bearbeitung, dann die App
- [ ] Datenschutz-Link in der App → „Zurück zur App“ führt zurück zum Blatt

## 6. Bekannte offene Punkte (bewusst nach 1.0)

- **Datensicherheit auf iOS:** Wie bei FairMix kann iOS den WebView-Speicher
  unter Speicherdruck leeren. Blattwerk speichert in IndexedDB (deutlich mehr
  Platz als localStorage), aber nicht in einer echten Datei. Die App weist
  darauf hin, wichtige Blätter zusätzlich als PDF oder Projektdatei zu sichern.
  Sauberer wäre eine Zweitkopie über ein Dateisystem-Plugin – derselbe Weg 2,
  den du für FairMix notiert hast.
- **„Öffnen in Blattwerk“** aus Mail oder Dateien-App: braucht Dokumenttypen
  in der Info.plist und ein Plugin, das die Datei entgegennimmt. Bis dahin
  öffnet man PDFs über „Meine Blätter“ → „Vom Gerät öffnen“.
- Die Punkte auf der ToDo-Liste: Unterstreichen, Ausrichtung, Formatierung
  einzelner Wörter, Rücklauf-Auswertung, Lösungsblatt.
