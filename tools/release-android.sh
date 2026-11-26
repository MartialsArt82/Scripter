#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
output=$(realpath -m "${1:?Output directory required}")
version=$(node -p "require('./package.json').version")
filename="Scripter-$version-Android.apk"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

bash tools/android-build.sh "$scratch/unsigned.apk"

if [[ -n "${SCRIPTER_ANDROID_KEYSTORE_B64:-}" && -n "${SCRIPTER_ANDROID_KEY_PASSWORD:-}" ]]; then
  umask 077
  export SCRIPTER_ANDROID_KEYSTORE="$scratch/scripter.p12"
  printf '%s' "$SCRIPTER_ANDROID_KEYSTORE_B64" | base64 --decode > "$SCRIPTER_ANDROID_KEYSTORE"
  bash tools/android-sign.sh "$scratch/unsigned.apk" "$scratch/$filename"
else
  # A signed public binary can be provided without giving the runner the private key.
  apk_ref="refs/heads/codex/scripter-apk-$version"
  git -c 'credential.helper=!gh auth git-credential' fetch --no-tags --depth=1 origin "$apk_ref"
  git show "FETCH_HEAD:$filename" > "$scratch/$filename"
fi

bash tools/android-verify.sh "$scratch/unsigned.apk" "$scratch/$filename"
install -Dm644 "$scratch/$filename" "$output/$filename"
