#!/bin/sh
# Installs mumh5: the app, a "mumh5" command and a menu entry. Works from the unpacked .tar.gz,
# and from a source checkout (build/linux/install.sh), where it builds the app first.
# For you only by default; run with sudo (or --system) for everyone on this computer.
# Running it again over an installed version updates it. Your settings and identities stay.
set -eu

usage() {
  echo "Usage: install.sh [--user | --system]"
  echo "  --user    install for you only, in ~/.local (default unless run as root)"
  echo "  --system  install for everyone, in /opt (needs root)"
}

mode=user
[ "$(id -u)" -eq 0 ] && mode=system
for arg in "$@"; do
  case "$arg" in
    --user) mode=user ;;
    --system) mode=system ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

if [ "$mode" = system ] && [ "$(id -u)" -ne 0 ]; then
  echo "Installing for everyone needs root: sudo $0 --system" >&2
  exit 1
fi

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
if [ -x "$here/mumh5" ]; then
  src=$here
elif [ -f "$repo/Cargo.toml" ] && [ -f "$repo/crates/desktop/tauri.conf.json" ]; then
  src=$repo/target/portable/mumh5
  if [ "$(id -u)" -eq 0 ]; then
    [ -x "$src/mumh5" ] || { echo "Build as yourself first: tools/package-linux.sh" >&2; exit 1; }
  else
    (cd "$repo" && bash tools/package-linux.sh)
  fi
else
  echo "Run from the unpacked archive or the repository's build/linux folder." >&2
  exit 1
fi

if [ "$mode" = system ]; then
  app=/opt/mumh5
  bin=/usr/local/bin
  menu=/usr/share/applications
else
  data=${XDG_DATA_HOME:-$HOME/.local/share}
  app=$data/mumh5
  bin=$HOME/.local/bin
  menu=$data/applications
fi

if [ "$src" = "$app" ]; then
  echo "This is the installed copy; run install.sh from the .tar.gz folder or the repository." >&2
  exit 1
fi

# Only replace a folder this script made before
if [ -e "$app" ] && [ ! -f "$app/.mumh5-install" ]; then
  echo "$app exists and was not made by this installer; not touching it." >&2
  exit 1
fi

echo "Installing mumh5 to $app"
tmp="$app.new.$$"
rm -rf "$tmp"
mkdir -p "$(dirname "$app")"
cp -a "$src" "$tmp"
rm -f "$tmp/install.sh"
cp "$here/uninstall.sh" "$tmp/uninstall.sh"
[ -f "$tmp/mumh5.png" ] || cp "$repo/crates/desktop/icons/icon.png" "$tmp/mumh5.png" 2>/dev/null || true
echo "$mode" > "$tmp/.mumh5-install"
rm -rf "$app"
mv "$tmp" "$app"

mkdir -p "$bin" "$menu"

# Keep the launcher path stable across upgrades.
rm -f "$bin/mumh5"
{
  echo '#!/bin/sh'
  echo '# mumh5 launcher, made by install.sh'
  echo "exec \"$app/mumh5\" \"\$@\""
} > "$bin/mumh5"
chmod 755 "$bin/mumh5"

{
  echo '[Desktop Entry]'
  echo 'Type=Application'
  echo 'Name=mumh5'
  echo 'Comment=Modern Mumble client'
  echo "Exec=\"$bin/mumh5\" %U"
  echo "Icon=$app/mumh5.png"
  echo 'Terminal=false'
  echo 'Categories=Network;Chat;'
  echo 'Keywords=mumble;voice;chat;voip;'
  echo 'StartupWMClass=mumh5'
} > "$menu/mumh5.desktop"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$menu" 2>/dev/null || true

echo "Done. Start it from your app menu or with: mumh5"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "Note: $bin is not on your PATH, so the command needs its full path: $bin/mumh5" ;;
esac
echo "To remove it: $app/uninstall.sh"
