#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
output=$(realpath "${1:?Ausgabeordner fehlt}")
version=$(node -p "require('./package.json').version")
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

stage="$scratch/package"
install -d "$stage"/{DEBIAN,opt/scripter,usr/bin}
tar -xzf "$output/Scripter-$version-Fedora-Nobara-x64.tar.gz" --strip-components=1 -C "$stage/opt/scripter"
ln -s /opt/scripter/Scripter "$stage/usr/bin/scripter"
install -Dm644 packaging/linux/de.scripter.Scripter.desktop "$stage/usr/share/applications/de.scripter.Scripter.desktop"
install -Dm644 packaging/linux/de.scripter.Scripter.svg "$stage/usr/share/icons/hicolor/scalable/apps/de.scripter.Scripter.svg"
chmod -R a+rX "$stage"
chmod 4755 "$stage/opt/scripter/chrome-sandbox"
installed_size=$(du -sk "$stage" | cut -f1)
sed -e "s/@VERSION@/$version/g" -e "s/@SIZE@/$installed_size/g" packaging/linux/debian-control > "$stage/DEBIAN/control"

package="$output/scripter_${version}_amd64.deb"
dpkg-deb --root-owner-group -Zxz -z3 --build "$stage" "$package"
test "$(dpkg-deb -f "$package" Architecture)" = amd64
test "$(dpkg-deb -f "$package" Version)" = "$version"
test "$(dpkg-deb -f "$package" Package)" = scripter
