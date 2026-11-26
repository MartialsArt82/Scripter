#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
output=$(realpath -m "${1:?Ausgabeordner fehlt}")
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
runtime="${SCRIPTER_RUNTIME_DIR:-$scratch/runtime}"
mkdir -p "$runtime" "$output"

fetch() {
  local filename=$1 checksum=$2 url=$3
  local destination="$runtime/$filename"
  if [[ ! -f "$destination" ]]; then
    curl --fail --location --silent --show-error --retry 3 --output "$destination.part" "$url"
    mv -- "$destination.part" "$destination"
  fi
  echo "$checksum  $destination" | sha256sum --check
}

electron=https://github.com/electron/electron/releases/download/v40.10.6
pandoc=https://github.com/jgm/pandoc/releases/download/3.14
signer=https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0
fetch linux-x64.zip da36f45ca25374ada825997c0bbdeb6a2cea31de4d9326d348529f137d3c3069 "$electron/electron-v40.10.6-linux-x64.zip"
fetch win32-x64.zip 072480360a5d5e3ec0d4173b1f9d7d0bca435098567d7e6bb5829638072febfd "$electron/electron-v40.10.6-win32-x64.zip"
fetch darwin-arm64.zip 24e3b1a13ff7243f6b9036ebb743b6f62b19e4a925242d27eaa2be90de90a691 "$electron/electron-v40.10.6-darwin-arm64.zip"
fetch darwin-x64.zip f5f0ea7d8392645241c584646ffa94ccf0646919ba254cafbb747690acc32ad5 "$electron/electron-v40.10.6-darwin-x64.zip"
fetch linux-x64-pandoc.tar.gz c5f4720cdefb3f7bdc5d07202ef579feef0d1370773c873804dd8fdaa8c4f1b8 "$pandoc/pandoc-3.14-linux-amd64.tar.gz"
fetch win32-x64-pandoc.zip 0144b96e8c7b023fd382ec5ef5bdc475e873f1019d6fa72502492df2c9a94a3b "$pandoc/pandoc-3.14-windows-x86_64.zip"
fetch darwin-arm64-pandoc.zip 58d6593884fec9d4424b641b92503c316d9c36decb2891ff8d73ae74dd3b6304 "$pandoc/pandoc-3.14-arm64-macOS.zip"
fetch darwin-x64-pandoc.zip 891708579061e7b1c1a6ce0df30ebb3cb2b6d0ca045ed3c8554ab830c1e0c270 "$pandoc/pandoc-3.14-x86_64-macOS.zip"
fetch pandoc-COPYING.md 3ebfbf9235b049d384cdba5a66a1a3434bb544391e720b76faa8e1b3ee61a4e5 https://raw.githubusercontent.com/jgm/pandoc/3.14/COPYING.md
fetch rcodesign.tar.gz dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002 "$signer/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz"

tar -xzf "$runtime/rcodesign.tar.gz" -C "$scratch"
export RCODESIGN="$scratch/apple-codesign-0.29.0-x86_64-unknown-linux-musl/rcodesign"
test -x "$RCODESIGN"

ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
node --check main.cjs
node --check app.js
npm run pack -- "$scratch/build"

pids=()
for target in linux-x64 win32-x64 darwin-arm64 darwin-x64; do
  python3 tools/package.py "$target" "$scratch/build" "$runtime" "$output" &
  pids+=("$!")
done
failed=0
for pid in "${pids[@]}"; do
  wait "$pid" || failed=1
done
if ((failed)); then
  exit 1
fi

bash tools/release-rpm.sh "$output"
bash tools/release-deb.sh "$output"
bash tools/release-android.sh "$output"

version=$(node -p "require('./package.json').version")
git archive --format=zip --prefix="Scripter-$version-Quellcode/" --output="$output/Scripter-$version-Quellcode.zip" HEAD
cp STARTEN.txt "$output/"
(
  cd "$output"
  for archive in "Scripter-$version-"*.zip; do
    unzip -tq "$archive"
  done
  tar -tzf "Scripter-$version-Fedora-Nobara-x64.tar.gz" > /dev/null
  sha256sum "Scripter-$version-"*.zip "Scripter-$version-Fedora-Nobara-x64.tar.gz" "scripter-$version-1.x86_64.rpm" "scripter_${version}_amd64.deb" "Scripter-$version-Android.apk" STARTEN.txt > SHA256SUMS.txt
)
