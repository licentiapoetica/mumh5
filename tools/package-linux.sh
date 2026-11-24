#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
cd "$MUMH5_ROOT"
if [[ "${1:-}" != --no-build ]]; then
  (cd frontend && bun run build)
  cargo build --locked --release -p mumh5-desktop
fi
mumh5_target="${CARGO_TARGET_DIR:-$MUMH5_ROOT/target}"
portable="$mumh5_target/portable/mumh5"
mkdir -p "$portable"
cp "$mumh5_target/release/mumh5-desktop" "$portable/mumh5"
cp build/linux/install.sh build/linux/uninstall.sh "$portable/"
cp crates/desktop/icons/icon.png "$portable/mumh5.png"
# Theme sizes for the installer (Wayland compositors look the window icon up by its themed name)
mkdir -p "$portable/icons"
cp crates/desktop/icons/32x32.png "$portable/icons/32.png"
cp crates/desktop/icons/64x64.png "$portable/icons/64.png"
cp crates/desktop/icons/128x128.png "$portable/icons/128.png"
cp crates/desktop/icons/128x128@2x.png "$portable/icons/256.png"
cp crates/desktop/icons/icon.png "$portable/icons/512.png"
cp LICENSE THIRD_PARTY_NOTICES.md "$portable/"
tar -czf "$mumh5_target/mumh5-linux-x64.tar.gz" -C "$mumh5_target/portable" mumh5
