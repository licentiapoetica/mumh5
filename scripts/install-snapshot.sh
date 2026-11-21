#!/usr/bin/env bash
# Installs the latest Linux build of mumh5 from GitHub for the current user: the app in
# ~/.local/share/mumh5, a "mumh5" command and an app menu entry. Run it again to update.
#
# This uses the .tar.gz build and the install.sh inside it rather than the AppImage: an AppImage
# runs from a mount point with a new random name on each start, so firewalls that allow programs
# by path (OpenSnitch and the like) ask again after every restart.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install-snapshot.sh [--wait | --uninstall]

  (no option)   install, or update when a newer build is out
  --wait        if there is no newer build yet, check every minute until there is
  --uninstall   remove the app, the command and the menu entry (settings stay)
EOF
}

repo="${MUMH5_REPO:-licentiapoetica/mumh5}"
asset=mumh5-linux-x64.tar.gz
base="https://github.com/$repo/releases/download/snapshot"
app="${XDG_DATA_HOME:-$HOME/.local/share}/mumh5"
# Checksum of the archive the installed copy came from, to tell whether there is a newer one
stamp="$app/.snapshot-sha256"

mode=install
for arg in "$@"; do
  case "$arg" in
    --wait) mode=wait ;;
    --uninstall) mode=uninstall ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this as yourself, not as root; it installs for your user only." >&2
  exit 1
fi

if [[ "$mode" == uninstall ]]; then
  if [[ ! -x "$app/uninstall.sh" ]]; then
    echo "mumh5 is not installed in $app." >&2
    exit 1
  fi
  exec "$app/uninstall.sh" --user
fi

remote_sum() {
  curl -fsSL "$base/SHA256SUMS" | awk -v f="$asset" '$2 == f { print $1 }'
}

built_from() {
  # Best effort: the release notes name the commit the build came from
  local c
  c="$(curl -fsSL "https://api.github.com/repos/$repo/releases/tags/snapshot" 2>/dev/null \
    | grep -o 'Built from \[[0-9a-f]\{7\}' | head -n 1 | tail -c 8)" || true
  [[ -n "$c" ]] && echo " (commit $c)"
}

want="$(remote_sum)"
[[ -n "$want" ]] || { echo "No $asset listed in $base/SHA256SUMS" >&2; exit 1; }

have=""
[[ -f "$stamp" && -x "$app/mumh5" ]] && have="$(cat -- "$stamp")"
while [[ "$want" == "$have" && "$mode" == wait ]]; do
  echo "No newer build yet, checking again in a minute."
  sleep 60
  want="$(remote_sum)" || want="$have"
done
if [[ "$want" == "$have" ]]; then
  echo "mumh5 is up to date$(built_from)."
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
echo "Downloading $asset"
curl -fL --progress-bar -o "$work/$asset" "$base/$asset"
got="$(sha256sum -- "$work/$asset" | awk '{ print $1 }')"
if [[ "$got" != "$want" ]]; then
  # The release may have been replaced mid-download; running again picks up the new one
  echo "Checksum mismatch (expected $want, got $got); nothing changed." >&2
  exit 1
fi

mkdir "$work/unpacked"
tar -xzf "$work/$asset" -C "$work/unpacked"
installer="$(find "$work/unpacked" -mindepth 2 -maxdepth 2 -name install.sh -type f | head -n 1)"
[[ -n "$installer" ]] || { echo "No install.sh in $asset" >&2; exit 1; }

# A running mumh5 keeps working on the old files; the new build starts with the next launch
sh "$installer" --user
echo "$want" > "$stamp"
echo "Installed build$(built_from). Run this script again to update."
