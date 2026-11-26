#!/usr/bin/env bash
set -euo pipefail

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?Android SDK is required}}"
tools="${SCRIPTER_ANDROID_TOOLS:-$sdk/build-tools/35.0.0}"
: "${SCRIPTER_ANDROID_KEYSTORE:?Keystore path required}"
: "${SCRIPTER_ANDROID_KEY_PASSWORD:?Keystore password required}"
export SCRIPTER_ANDROID_KEY_PASSWORD

"$tools/apksigner" sign --v1-signing-enabled false --ks "$SCRIPTER_ANDROID_KEYSTORE"   --ks-key-alias scripter --ks-pass env:SCRIPTER_ANDROID_KEY_PASSWORD   --out "${2:?Signed APK path required}" "${1:?Unsigned APK path required}"
"$tools/apksigner" verify --verbose --print-certs "$2"
