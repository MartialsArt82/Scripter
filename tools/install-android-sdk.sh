#!/usr/bin/env bash
set -euo pipefail

target=$(realpath -m "${1:?Android tools directory required}")
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

fetch() {
  local file=$1 hash=$2 url=$3
  curl --fail --location --silent --show-error --retry 3 --output "$scratch/$file" "$url"
  echo "$hash  $scratch/$file" | sha256sum --check
}

fetch platform.zip 0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0 https://dl.google.com/android/repository/platform-35_r02.zip
fetch tools.zip bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88 https://dl.google.com/android/repository/build-tools_r35_linux.zip
fetch jdk.tar.gz e70822e4b77a9ffd57015b55f4bb645bba97b8f5247a792eceb95dbc7a5a55ab https://cdn.azul.com/zulu/bin/zulu17.60.17-ca-jdk17.0.16-linux_x64.tar.gz

mkdir -p "$target/sdk/platforms" "$target/sdk/build-tools" "$target/jdk"
unzip -oq "$scratch/platform.zip" -d "$target/sdk/platforms"
unzip -oq "$scratch/tools.zip" -d "$scratch/build-tools"
mkdir -p "$target/sdk/build-tools/35.0.0"
cp -a "$scratch/build-tools/android-15/." "$target/sdk/build-tools/35.0.0/"
tar -xzf "$scratch/jdk.tar.gz" --strip-components=1 -C "$target/jdk"
test -x "$target/jdk/bin/javac"
test -x "$target/sdk/build-tools/35.0.0/aapt2"
test -r "$target/sdk/platforms/android-35/android.jar"
