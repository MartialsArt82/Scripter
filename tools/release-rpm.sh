#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
output=$(realpath "${1:?Ausgabeordner fehlt}")
version=$(node -p "require('./package.json').version")
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/SOURCES"
cp "$output/Scripter-$version-Fedora-Nobara-x64.tar.gz" "$scratch/SOURCES/"
cp packaging/linux/de.scripter.Scripter.{desktop,svg} "$scratch/SOURCES/"

desktop-file-validate "$scratch/SOURCES/de.scripter.Scripter.desktop"
rpmbuild --define "_topdir $scratch" --define "scripter_version $version" \
  --define "_binary_payload w7.xzdio" -bb packaging/linux/scripter.spec

rpmfile="$scratch/RPMS/x86_64/scripter-$version-1.x86_64.rpm"
rpm -K --nosignature "$rpmfile"
files=$(rpm -qpl "$rpmfile")
for expected in /opt/scripter/Scripter /usr/bin/scripter /usr/share/applications/de.scripter.Scripter.desktop /usr/share/icons/hicolor/scalable/apps/de.scripter.Scripter.svg; do
  grep -Fxq "$expected" <<< "$files"
done
cp "$rpmfile" "$output/"
