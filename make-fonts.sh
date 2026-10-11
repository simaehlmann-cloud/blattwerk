#!/usr/bin/env bash
#
# make-fonts.sh – holt die Noto-Schriften und reduziert sie auf die Zeichen,
# die auf deutschen Arbeitsblaettern vorkommen (Latein mit Erweiterungen,
# Griechisch, Kyrillisch fuer DaZ-Material, Satzzeichen, Mathe-Zeichen).
#
#   ./make-fonts.sh
#
# Braucht: npm (zum Herunterladen) und fonttools (python3 -m pip install fonttools)
# Ergebnis: fonts/*.ttf, je etwa 160–300 KB statt 400–1000 KB.
# Nur noetig, wenn die Schriften erneuert oder Zeichen ergaenzt werden sollen;
# die fertigen Dateien liegen im Repo.
set -e
cd "$(dirname "$0")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
( cd "$TMP"
  npm pack --silent @expo-google-fonts/noto-sans@0.4.2 @expo-google-fonts/noto-serif@0.4.2 \
                    @expo-google-fonts/noto-sans-mono@0.4.2 @expo-google-fonts/noto-sans-math@0.4.2 >/dev/null
  for f in *.tgz; do mkdir -p "${f%.tgz}"; tar xzf "$f" -C "${f%.tgz}"; done )
Q() { find "$TMP" -name "$1" | head -1; }

TEXT="U+0000-024F,U+0259,U+0300-036F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+25A0-25FF,U+2713-2717,U+FB00-FB06,U+FFFD"
MATHE="U+0020-007E,U+00A0-00FF,U+0370-03FF,U+2000-206F,U+2070-209F,U+2100-214F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+25A0-25FF,U+27C0-27FF,U+2900-29FF,U+2A00-2AFF"

reduziere() { # Quelle Ziel Zeichen
  pyftsubset "$1" --unicodes="$3" --layout-features='kern,liga,clig,calt,ccmp,locl,mark,mkmk' \
    --no-hinting --desubroutinize --output-file="fonts/$2"
  echo "  fonts/$2  $(wc -c < "fonts/$2") Bytes"
}
reduziere "$(Q NotoSans_400Regular.ttf)"            NotoSans-Regular.ttf        "$TEXT"
reduziere "$(Q NotoSans_700Bold.ttf)"               NotoSans-Bold.ttf           "$TEXT"
reduziere "$(Q NotoSans_400Regular_Italic.ttf)"     NotoSans-Italic.ttf         "$TEXT"
reduziere "$(Q NotoSans_700Bold_Italic.ttf)"        NotoSans-BoldItalic.ttf     "$TEXT"
reduziere "$(Q NotoSerif_400Regular.ttf)"           NotoSerif-Regular.ttf       "$TEXT"
reduziere "$(Q NotoSerif_700Bold.ttf)"              NotoSerif-Bold.ttf          "$TEXT"
reduziere "$(Q NotoSerif_400Regular_Italic.ttf)"    NotoSerif-Italic.ttf        "$TEXT"
reduziere "$(Q NotoSerif_700Bold_Italic.ttf)"       NotoSerif-BoldItalic.ttf    "$TEXT"
reduziere "$(Q NotoSansMono_400Regular.ttf)"        NotoSansMono-Regular.ttf    "$TEXT"
reduziere "$(Q NotoSansMono_700Bold.ttf)"           NotoSansMono-Bold.ttf       "$TEXT"
reduziere "$(Q NotoSansMath_400Regular.ttf)"        NotoSansMath-Regular.ttf    "$MATHE"
cp "$(Q LICENSE_FONT)" fonts/OFL.txt
echo "Fertig. Danach: node smoketest.js (prueft, dass jedes Zeichen im PDF sichtbar ist)."
