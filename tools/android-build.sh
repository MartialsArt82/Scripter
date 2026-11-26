#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
output=$(realpath -m "${1:?APK output path required}")
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?Android SDK is required}}"
tools="${SCRIPTER_ANDROID_TOOLS:-$sdk/build-tools/35.0.0}"
platform="$sdk/platforms/android-35/android.jar"
jdk="${JAVA_HOME:+$JAVA_HOME/bin/}"
version=$(node -p "require('./package.json').version")
code=$(node -e 'const [major,minor,patch=0]=require("./package.json").version.split(".").map(Number); console.log(major*10000+minor*100+patch)')
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

assets="$scratch/assets"
mkdir -p "$assets"/{node_modules/dompurify/dist,spell} "$scratch"/{classes,dex,generated/de/scripter/mobile} "$(dirname "$output")"
cp app.js appearance.js appearance-ui.js i18n.js i18n-ui.js i18n-messages.js speech-ui.js storyboard.js project-validation.js style.css mobile.css "$assets/"
cp -r assets data fonts icons "$assets/"
cp android/mobile-desk.js "$assets/"
cp speech.cjs "$assets/speech-rules.js"
cp node_modules/dompurify/dist/purify.min.js "$assets/node_modules/dompurify/dist/"
cp node_modules/dompurify/LICENSE "$assets/node_modules/dompurify/"
for lang in de en es pt fr; do
  cp "node_modules/dictionary-$lang/index.aff" "$assets/spell/$lang.aff"
  cp "node_modules/dictionary-$lang/index.dic" "$assets/spell/$lang.dic"
  cp "node_modules/dictionary-$lang/license" "$assets/spell/$lang.txt"
done
mkdir "$assets/notices"
cp node_modules/hunspell-asm/LICENSE "$assets/notices/Hunspell-asm.txt"
cp node_modules/emscripten-wasm-loader/package.json "$assets/notices/Emscripten-wasm-loader.json"
cp node_modules/nanoid/LICENSE "$assets/notices/Nano-ID.txt"
node_modules/.bin/esbuild android/mobile-spell.js --bundle --platform=browser --target=chrome100 --outfile="$assets/mobile-spell.js"
python3 - "$assets/index.html" <<'PY'
from pathlib import Path
import sys
html = Path("index.html").read_text("utf-8")
html = html.replace("script-src 'self';", "script-src 'self' 'wasm-unsafe-eval';")
html = html.replace("connect-src 'none';", "connect-src 'self' data:;")
html = html.replace('<script defer src="app.js">', '<script defer src="speech-rules.js"></script><script defer src="project-validation.js"></script><script defer src="mobile-desk.js"></script><script defer src="mobile-spell.js"></script><script defer src="app.js">')
Path(sys.argv[1]).write_text(html, "utf-8")
PY

printf 'package de.scripter.mobile; final class BuildConfig { static final String VERSION = "%s"; }\n' "$version" > "$scratch/generated/de/scripter/mobile/BuildConfig.java"
"${jdk}javac" -encoding UTF-8 --release 8 -cp "$platform" -d "$scratch/classes"   android/src/de/scripter/mobile/*.java "$scratch/generated/de/scripter/mobile/BuildConfig.java"
"${jdk}jar" --create --file "$scratch/classes.jar" -C "$scratch/classes" .
"$tools/d8" --release --min-api 26 --lib "$platform" --output "$scratch/dex" "$scratch/classes.jar"
"$tools/aapt2" compile --dir android/res -o "$scratch/resources.zip"
"$tools/aapt2" link -I "$platform" --manifest android/AndroidManifest.xml -A "$assets"   --version-code "$code" --version-name "$version" -o "$scratch/resources.apk" "$scratch/resources.zip"
(cd "$scratch/dex" && zip -q -X "$scratch/resources.apk" classes.dex)
"$tools/zipalign" -f 4 "$scratch/resources.apk" "$output"
"$tools/zipalign" -c 4 "$output"
unzip -tq "$output"
