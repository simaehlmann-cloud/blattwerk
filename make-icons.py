#!/usr/bin/env python3
"""Zeichnet das Blattwerk-Icon und legt alle Groessen an.

    python3 make-icons.py

Erzeugt im Wurzelverzeichnis:
    icon-1024.png          Quelle fuer iOS (make-ios-icons.py) und Store
    icon.png               512x512, PWA und Play-Store-Eintrag
    icon-192.png           192x192
    icon-maskable-512.png  512x512, purpose "maskable" (Inhalt in der Schutzzone)
und in res/android/:
    icon_{ldpi..xxxhdpi}.png      klassisches Icon (vor Android 8)
    icon_fg_{ldpi..xxxhdpi}.png   Vordergrund des adaptiven Icons
                                  (Hintergrundfarbe kommt aus colors.xml)

Das Icon wird als Vektor mit vierfacher Aufloesung gezeichnet und dann
verkleinert, damit Kanten auch ohne Zeichenprogramm sauber werden.

Voraussetzung: Pillow  (python3 -m pip install Pillow)
"""
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow fehlt.  Abhilfe:  python3 -m pip install Pillow")

BLAU = (0x24, 0x40, 0xB3)
WEISS = (0xFF, 0xFF, 0xFF)
GELB = (0xFF, 0xE1, 0x4D)
TINTE = (0x1A, 0x20, 0x30)
SS = 4  # Ueberabtastung


def motiv(d, s, ox, oy):
    """Blatt mit drei Zeilen und angekreuztem Kaestchen, Bezugsgroesse s."""
    k = lambda v: v * s / 1024.0
    # Blatt
    d.rounded_rectangle([ox + k(272), oy + k(150), ox + k(752), oy + k(874)],
                        radius=k(40), fill=WEISS)
    # Zeilen
    for y, x2 in ((330, 672), (440, 672), (550, 560)):
        d.rounded_rectangle([ox + k(352), oy + k(y - 18), ox + k(x2), oy + k(y + 18)],
                            radius=k(18), fill=BLAU)
    # Kaestchen
    d.rounded_rectangle([ox + k(548), oy + k(600), ox + k(828), oy + k(880)],
                        radius=k(34), fill=GELB, outline=TINTE, width=int(k(26)))
    d.line([(ox + k(608), oy + k(742)), (ox + k(670), oy + k(806)), (ox + k(772), oy + k(680))],
           fill=TINTE, width=int(k(34)), joint="curve")
    r = k(17)
    for (x, y) in ((608, 742), (772, 680)):
        d.ellipse([ox + k(x) - r, oy + k(y) - r, ox + k(x) + r, oy + k(y) + r], fill=TINTE)


def voll(kante):
    """Volles Quadrat mit blauer Flaeche, ohne Transparenz."""
    g = kante * SS
    img = Image.new("RGB", (g, g), BLAU)
    motiv(ImageDraw.Draw(img), g, 0, 0)
    return img.resize((kante, kante), Image.LANCZOS)


def vordergrund(kante, anteil):
    """Transparenter Vordergrund; das Motiv nimmt `anteil` der Kante ein."""
    g = kante * SS
    img = Image.new("RGBA", (g, g), (0, 0, 0, 0))
    m = g * anteil
    motiv(ImageDraw.Draw(img), m, (g - m) / 2, (g - m) / 2)
    return img.resize((kante, kante), Image.LANCZOS)


def maskable(kante):
    """Blaue Flaeche, Motiv innerhalb der runden Schutzzone (80 %)."""
    g = kante * SS
    img = Image.new("RGB", (g, g), BLAU)
    m = g * 0.72
    motiv(ImageDraw.Draw(img), m, (g - m) / 2, (g - m) / 2)
    return img.resize((kante, kante), Image.LANCZOS)


def main():
    os.makedirs(os.path.join("res", "android"), exist_ok=True)
    voll(1024).save("icon-1024.png")
    voll(512).save("icon.png")
    voll(192).save("icon-192.png")
    maskable(512).save("icon-maskable-512.png")
    # Android: klassisch 48dp, adaptiv 108dp (sichtbar sind die inneren 72dp)
    dichte = {"ldpi": 0.75, "mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, f in dichte.items():
        voll(int(round(48 * f))).save(os.path.join("res", "android", "icon_%s.png" % name))
        vordergrund(int(round(108 * f)), 0.62).save(os.path.join("res", "android", "icon_fg_%s.png" % name))
    print("Icons geschrieben: 4 im Wurzelverzeichnis, 12 in res/android/")


if __name__ == "__main__":
    main()
