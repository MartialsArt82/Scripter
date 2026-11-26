# Scripter 1.4

Lokale Schreib-App für Romanprojekte unter Windows, macOS, Linux und Android. Installationspakete für Debian/Ubuntu (DEB), Fedora/Nobara (RPM) und Android (APK) sowie portable Desktop-Pakete stehen unter [Releases](https://github.com/MartialsArt82/Scripter/releases).

Die Oberflächensprache lässt sich in den Einstellungen auf Deutsch, Englisch, Französisch, Spanisch oder Portugiesisch umstellen. Rechtschreibprüfung und Wortschatz verwenden weiterhin ihre eigenen Sprachauswahlen.

**English below**

Scripter is a local writing app for Windows, macOS, Linux and Android. [Releases](https://github.com/MartialsArt82/Scripter/releases) provide the Debian/Ubuntu DEB, Fedora/Nobara RPM, Android APK and portable desktop downloads. The interface language is available in German, English, French, Spanish and Portuguese.

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

Der Workflow auf `codex/scripter-release-1.4` baut vier portable Pakete, das Fedora/Nobara-RPM, das Debian-Paket und die Android-App. Nach der APK-Signaturprüfung und dem Abgleich der SHA-256-Prüfsummen veröffentlicht er die Dateien unter **Assets**.

`bash tools/release-build.sh /absoluter/ausgabeordner` führt denselben Build unter Linux x64 mit `rpmbuild`, `rpm`, `desktop-file-validate`, `dpkg-deb`, JDK 17 und Android SDK 35 aus. Das Skript lädt die geprüften Electron-, Pandoc- und Signierwerkzeuge bei Bedarf herunter.

## Android-Paket bauen

Benötigt werden Node.js, JDK 17, die SDK-Plattform `android-35` und die Build-Tools `35.0.0`. Setze `ANDROID_HOME` auf den SDK-Ordner.

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
bash tools/android-build.sh /pfad/zu/Scripter-unsigned.apk
```

Zum Signieren dient `tools/android-sign.sh` mit einem PKCS#12-Keystore (Alias `scripter`) und den Umgebungsvariablen `SCRIPTER_ANDROID_KEYSTORE` und `SCRIPTER_ANDROID_KEY_PASSWORD`. Der Release-Workflow akzeptiert die Actions-Secrets `SCRIPTER_ANDROID_KEYSTORE_B64` und `SCRIPTER_ANDROID_KEY_PASSWORD` oder eine bereits lokal signierte APK aus `codex/scripter-apk-<version>`. Vor Veröffentlichung prüft er das Zertifikat und vergleicht den APK-Inhalt mit dem frischen Quellcode-Build. Für Updates muss dasselbe Zertifikat verwendet werden.

Android verwendet den System-Dateidialog für Material, Projekt-ZIPs und Exporte. PDF läuft über den Android-Druckdialog. Buchsatz mit animierter Doppelseite, Transkripte aus Audio- und Videodateien und die erweiterten Exportformate sind Desktop-Funktionen.

## Projektdaten

Ein Projekt besteht aus einer JSON-Datei und dem Unterordner `Material`. Das Manuskript verwendet formatiertes HTML. Die Desktop-App öffnet beim ersten Start ein fiktives Beispielprojekt. Android legt ein leeres Projekt an. Dateien und Transkripte werden lokal abgelegt. Eine Projektsicherung schließt die Materialdateien ein. Android sichert als ZIP mit `roman.json` und `Material`. Für den Wechsel von Desktop zu Android kann derselbe Aufbau als ZIP gepackt werden. Die Datei `roman.json` kann auch einzeln geöffnet werden.

Die Bedienung, Installation der Spracherkennung, optionalen Systemprogramme und Exportgrenzen stehen in `hilfe.html` und `STARTEN.txt`.

## Quellen und Lizenzen

Die Grafiken für die Unterstützungsschaltfläche stammen aus den [offiziellen Ko-fi-Markenressourcen](https://more.ko-fi.com/brand-assets).

Die Datenbank ist ein abgeleiteter SQLite-Suchindex aus LibreOffice MyThes. Die Datenquellen und Lizenzen liegen in `data/licenses`. Rechtschreibwörterbücher und Bibliotheken enthalten ihre eigenen Lizenztexte in ihren npm-Paketen. Schrift- und Icon-Lizenzen liegen in `fonts` und `icons`. Der mit den ausführbaren Paketen ausgelieferte Pandoc-Build ist GPL-lizenziert. Der vollständige zugehörige Quellcode ist im GitHub-Release verfügbar: https://github.com/jgm/pandoc/tree/3.14
