#!/usr/bin/env bash
set -euo pipefail

repo=${GITHUB_REPOSITORY:?}
commit=${GITHUB_SHA:?}
output=${1:?Ausgabeordner fehlt}
version=$(node -p "require('./package.json').version")
tag="v$version"

if [[ $(gh api "repos/$repo" --jq '.private') != true ]]; then
  echo 'Die Freigabe gilt für ein privates Repository.' >&2
  exit 1
fi
release_url=$(gh release view "$tag" --repo "$repo" --json apiUrl --jq .apiUrl)
release_id=${release_url##*/}
[[ "$release_id" =~ ^[0-9]+$ ]]
if [[ $(gh api "repos/$repo/releases/$release_id" --jq '.draft') != true ]]; then
  echo "Das Release $tag ist bereits veröffentlicht." >&2
  exit 1
fi

cd "$output"
sha256sum --check SHA256SUMS.txt
gh release upload "$tag" --repo "$repo" --clobber "Scripter-$version-"*.zip "Scripter-$version-Fedora-Nobara-x64.tar.gz" STARTEN.txt SHA256SUMS.txt

local_assets=$(mktemp)
trap 'rm -f -- "$local_assets"' EXIT
sha256sum "Scripter-$version-"*.zip "Scripter-$version-Fedora-Nobara-x64.tar.gz" STARTEN.txt SHA256SUMS.txt | sort > "$local_assets"
remote_assets=$(gh api "repos/$repo/releases/$release_id/assets" --paginate --jq '.[] | select(.state == "uploaded") | "\(.digest | sub("^sha256:"; ""))  \(.name)"' | sort)
diff -u "$local_assets" <(printf '%s\n' "$remote_assets")

gh release edit "$tag" --repo "$repo" --target "$commit" --draft=false
test "$(gh api "repos/$repo/releases/$release_id" --jq '.draft')" = false
