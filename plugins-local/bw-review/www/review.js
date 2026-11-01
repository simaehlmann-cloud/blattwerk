/* Fragt nach einer Bewertung. Ob das Fenster wirklich erscheint, entscheidet
   das Betriebssystem; das Ergebnis erfährt die App nicht. */
module.exports = {
  request: function (ok, fail) { cordova.exec(ok || function () {}, fail || function () {}, 'BWReview', 'request', []); }
};
