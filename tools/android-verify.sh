#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?Android SDK is required}}"
tools="${SCRIPTER_ANDROID_TOOLS:-$sdk/build-tools/35.0.0}"
unsigned=${1:?Unsigned APK path required}
signed=${2:?Signed APK path required}
fingerprint=$("$tools/apksigner" verify --min-sdk-version 26 --print-certs "$signed" |
  sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
test "$fingerprint" = "$(cat "$root/android/signing-certificate.sha256")"
"$tools/zipalign" -c 4 "$signed"

python3 - "$unsigned" "$signed" <<'PY'
from sys import argv
from hashlib import file_digest
from zipfile import ZipFile

def contents(path):
    with ZipFile(path) as archive:
        names = archive.namelist()
        if len(set(names)) != len(names):
            raise SystemExit(f"Duplicate entry in {path}")
        return {name: file_digest(archive.open(name), "sha256").hexdigest() for name in names}

expected, actual = (contents(path) for path in argv[1:])
changed = [name for name in expected.keys() | actual.keys() if expected.get(name) != actual.get(name)]
if changed:
    raise SystemExit("APK entries differ from the source build: " + ", ".join(sorted(changed)))
PY
