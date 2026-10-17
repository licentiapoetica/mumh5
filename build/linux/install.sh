#!/bin/sh
# Installs mumh5 from this folder (the unpacked .tar.gz): the app, a "mumh5" command and a
# menu entry. For you only by default; run with sudo (or --system) for everyone on this computer.
# Running it again over an installed version updates it. Your settings and identities stay.
set -eu

usage() {
  echo "Usage: ./install.sh [--user | --system]"
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

src=$(cd "$(dirname "$0")" && pwd)
if [ ! -x "$src/mumh5" ] || [ ! -d "$src/resources" ]; then
  echo "Run this script from the unpacked mumh5 folder (it needs the mumh5 program next to it)." >&2
  exit 1
fi

if [ "$mode" = system ]; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "Installing for everyone needs root: sudo ./install.sh --system" >&2
    exit 1
  fi
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
  echo "mumh5 is already installed here." >&2
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
echo "$mode" > "$tmp/.mumh5-install"
rm -rf "$app"
mv "$tmp" "$app"

# Chromium's sandbox helper must belong to root with the setuid bit. Installed for you only,
# that is not possible; the app then relies on user namespaces, which most systems allow.
if [ "$mode" = system ] && [ -f "$app/chrome-sandbox" ]; then
  chown root:root "$app/chrome-sandbox"
  chmod 4755 "$app/chrome-sandbox"
fi

mkdir -p "$bin" "$menu"
ln -sf "$app/mumh5" "$bin/mumh5"

cat > "$menu/mumh5.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=mumh5
Comment=Modern Mumble client
Exec="$app/mumh5" %U
Icon=$app/mumh5.png
Terminal=false
Categories=Network;Chat;
Keywords=mumble;voice;chat;voip;
StartupWMClass=mumh5
EOF

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$menu" 2>/dev/null || true

echo "Done. Start it from your app menu or with: mumh5"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "Note: $bin is not on your PATH, so the mumh5 command only works with its full path: $bin/mumh5" ;;
esac
echo "To remove it: $app/uninstall.sh"
