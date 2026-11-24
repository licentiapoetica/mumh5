#!/usr/bin/env bash
set -euo pipefail

: "${GH_REPO:?Set GH_REPO to owner/repository}"
: "${SNAPSHOT_SHA:?Set SNAPSHOT_SHA to the built commit}"
: "${SNAPSHOT_RUN_URL:?Set SNAPSHOT_RUN_URL to the successful workflow run}"
artifact_dir="$(cd "${1:?Pass the downloaded artifacts directory}" && pwd)"
publish_dir="$(mktemp -d)"
trap 'rm -rf -- "$publish_dir"' EXIT

# Stable filenames keep direct download links working across version changes.
extensions=(AppImage deb tar.gz exe)
filenames=(mumh5-linux-x64.AppImage mumh5-linux-x64.deb mumh5-linux-x64.tar.gz mumh5-win-x64.exe)
labels=('Linux AppImage' 'Debian / Ubuntu' 'Linux portable' 'Windows installer')
for i in "${!extensions[@]}"; do
  mapfile -d '' -t matches < <(find "$artifact_dir" -type f -name "*.${extensions[$i]}" ! -name "mumh5-cli*" -print0)
  if [[ ${#matches[@]} -ne 1 ]]; then
    echo "Expected one ${extensions[$i]} installer; found ${#matches[@]}" >&2
    exit 1
  fi
  cp -- "${matches[0]}" "$publish_dir/${filenames[$i]}"
done
for extra in mumh5-cli-linux-x64 mumh5-cli-win-x64.exe; do
  if [[ -f "$artifact_dir/$extra" ]]; then cp -- "$artifact_dir/$extra" "$publish_dir/$extra"; filenames+=("$extra"); labels+=("Headless client"); fi
done
mapfile -d '' -t apks < <(find "$artifact_dir" -type f -name '*.apk' -print0)
if [[ ${#apks[@]} -eq 1 ]]; then cp -- "${apks[0]}" "$publish_dir/mumh5-android-arm64.apk"; filenames+=(mumh5-android-arm64.apk); labels+=('Android arm64 (development APK)'); fi
(cd "$publish_dir" && sha256sum -- "${filenames[@]}" > SHA256SUMS)

notes="$publish_dir/notes.md"
{
  printf 'Automatically updated builds from `main`. Download an installer below.\n\n'
  printf '| System | Download |\n| --- | --- |\n'
  for i in "${!filenames[@]}"; do
    printf '| %s | [%s](https://github.com/%s/releases/download/snapshot/%s) |\n' \
      "${labels[$i]}" "${filenames[$i]}" "$GH_REPO" "${filenames[$i]}"
  done
  printf '\n[SHA256 checksums](https://github.com/%s/releases/download/snapshot/SHA256SUMS)\n\n' "$GH_REPO"
  printf 'Built from [%s](https://github.com/%s/commit/%s). [Build details](%s).\n' \
    "$SNAPSHOT_SHA" "$GH_REPO" "$SNAPSHOT_SHA" "$SNAPSHOT_RUN_URL"
} > "$notes"

if ! gh release view snapshot --repo "$GH_REPO" >/dev/null 2>&1; then
  gh release create snapshot --repo "$GH_REPO" --target "$SNAPSHOT_SHA" \
    --title 'Latest snapshot' --notes-file "$notes" --draft --prerelease --latest=false
fi

assets=()
for name in "${filenames[@]}" SHA256SUMS; do
  assets+=("$publish_dir/$name")
done
gh release upload snapshot --repo "$GH_REPO" "${assets[@]}" --clobber

# Updating a release's target does not move an existing tag; move it explicitly.
if gh api "repos/$GH_REPO/git/ref/tags/snapshot" >/dev/null 2>&1; then
  gh api --method PATCH "repos/$GH_REPO/git/refs/tags/snapshot" \
    -f sha="$SNAPSHOT_SHA" -F force=true --silent
else
  gh api --method POST "repos/$GH_REPO/git/refs" \
    -f ref=refs/tags/snapshot -f sha="$SNAPSHOT_SHA" --silent
fi

gh release edit snapshot --repo "$GH_REPO" --target "$SNAPSHOT_SHA" \
  --title 'Latest snapshot' --notes-file "$notes" --prerelease --latest=false --draft=false
