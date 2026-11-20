# Scripter 1.1.0

Lokale Desktop-App für Romanprojekte unter Windows, macOS und Linux. Windows x64, macOS (Apple Silicon und Intel) sowie Fedora/Nobara x64 werden als portable Pakete angeboten.

## Starten aus dem Quellcode

Voraussetzungen sind Node.js 22 oder neuer und npm. Der Chromium-Download wird bei `npm ci` von Electron vorgenommen.

```sh
npm ci
npm start
```

Die Synonymdatenbank ist im Quellcodearchiv enthalten. Sie lässt sich mit `python3 tools/fetch-thesauri.py` aus den MyThes-Datenquellen neu erzeugen. Für Konvertierungen beim Start aus dem Quellcode muss Pandoc über PATH oder den absoluten Pfad in `ROMAN_PANDOC` verfügbar sein.

## Portable Pakete erstellen

`tools/pack.cjs` sammelt die App-Dateien und die installierten JavaScript-Laufzeitabhängigkeiten in einem Electron-ASAR. Browser- und Pandoc-Archive stammen aus den offiziellen Veröffentlichungen. Das Python-Skript entpackt die Plattformarchive, ergänzt die App und signiert die macOS-Variante lokal oder mit `RCODESIGN` ad hoc. Entpackte Arbeitsdateien bleiben im Build-Ordner.

```sh
npm run pack -- /absoluter/build-ordner
python3 tools/package.py linux-x64 /absoluter/build-ordner /absoluter/runtime-ordner /absoluter/ausgabeordner
```

Benötigt werden im Runtime-Ordner die Plattformarchive `<ziel>.zip` für Electron 40.10.6 und `<ziel>-pandoc.zip` beziehungsweise `linux-x64-pandoc.tar.gz` für Pandoc 3.14, außerdem `pandoc-COPYING.md`. Für macOS müssen `codesign` auf dem Mac oder `RCODESIGN=/pfad/zu/rcodesign` unter Linux verfügbar sein. Weitere Ziele sind `win32-x64`, `darwin-arm64` und `darwin-x64`.

## GitHub-Release

Der Workflow auf `codex/scripter-release-1.1.0` baut die vier portablen Pakete und das Fedora/Nobara-RPM und hängt sie mit Quellcode und Prüfsummen an den Release-Entwurf `v1.1.0`. Nach dem Abgleich der SHA-256-Prüfsummen veröffentlicht er das Release im privaten Repository.

`bash tools/release-build.sh /absoluter/ausgabeordner` führt denselben Build unter Linux x64 mit `rpmbuild`, `rpm` und `desktop-file-validate` aus. Das Skript lädt die geprüften Electron-, Pandoc- und Signierwerkzeuge bei Bedarf herunter.

## Projektdaten

Ein Projekt besteht aus einer JSON-Datei und dem Unterordner `Material`. Das Manuskript verwendet formatiertes HTML. Die App öffnet beim ersten Start ein fiktives Beispielprojekt. Dateien und Transkripte werden lokal abgelegt. Eine Projektsicherung schließt die Materialdateien ein.

Die Bedienung, Installation der Spracherkennung, optionalen Systemprogramme und Exportgrenzen stehen in `hilfe.html` und `STARTEN.txt`.

## Quellen und Lizenzen

Die Datenbank ist ein abgeleiteter SQLite-Suchindex aus LibreOffice MyThes. Die Datenquellen und Lizenzen liegen in `data/licenses`. Rechtschreibwörterbücher und Bibliotheken enthalten ihre eigenen Lizenztexte in ihren npm-Paketen. Schrift- und Icon-Lizenzen liegen in `fonts` und `icons`. Der mit den ausführbaren Paketen ausgelieferte Pandoc-Build ist GPL-lizenziert. Der vollständige zugehörige Quellcode ist im GitHub-Release verfügbar: https://github.com/jgm/pandoc/tree/3.14
