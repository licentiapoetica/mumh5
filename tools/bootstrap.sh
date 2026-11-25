#!/usr/bin/env bash
# Install tools into this checkout only; never modifies shell profiles or system packages.
set -euo pipefail
MUMH5_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$MUMH5_ROOT/tools/env.sh"
mkdir -p "$CARGO_HOME/bin" "$BUN_INSTALL/bin"
# In Git Bash rustup would pick the GNU host; the native libraries (vcpkg) are MSVC builds
mumh5_rust_host=""
case "$(uname -s)" in MINGW*|MSYS*) mumh5_rust_host="--default-host x86_64-pc-windows-msvc" ;; esac
if [[ ! -x "$CARGO_HOME/bin/rustup" && ! -x "$CARGO_HOME/bin/rustup.exe" ]]; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o "$MUMH5_ROOT/.tooling/rustup-init.sh"
  sh "$MUMH5_ROOT/.tooling/rustup-init.sh" -y --no-modify-path --profile minimal $mumh5_rust_host --default-toolchain 1.100.0 --component rustfmt --component clippy
else
  rustup toolchain install 1.100.0 --profile minimal --component rustfmt --component clippy
fi
if [[ ! -x "$BUN_INSTALL/bin/bun" && ! -x "$BUN_INSTALL/bin/bun.exe" ]] || [[ "$(bun --version)" != 1.4.5 ]]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) mumh5_bun_platform=linux-x64 ;;
    Linux-aarch64) mumh5_bun_platform=linux-aarch64 ;;
    Darwin-x86_64) mumh5_bun_platform=darwin-x64 ;;
    Darwin-arm64) mumh5_bun_platform=darwin-aarch64 ;;
    MINGW*-x86_64|MSYS*-x86_64) mumh5_bun_platform=windows-x64 ;;
    *) echo 'Unsupported Bun platform; install Bun 1.4.5 into .tooling/bun/bin.' >&2; exit 1 ;;
  esac
  curl --proto '=https' --tlsv1.2 -fL "https://github.com/oven-sh/bun/releases/download/bun-v1.4.5/bun-${mumh5_bun_platform}.zip" -o "$MUMH5_ROOT/.tooling/bun.zip"
  unzip -oq "$MUMH5_ROOT/.tooling/bun.zip" -d "$MUMH5_ROOT/.tooling/bun-unpack"
  if [[ "$mumh5_bun_platform" == windows-* ]]; then
    mv "$MUMH5_ROOT/.tooling/bun-unpack/bun-${mumh5_bun_platform}/bun.exe" "$BUN_INSTALL/bin/bun.exe"
  else
    mv "$MUMH5_ROOT/.tooling/bun-unpack/bun-${mumh5_bun_platform}/bun" "$BUN_INSTALL/bin/bun"
  fi
fi
if ! cargo tauri --version 2>/dev/null | grep -q '2.12.6'; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) mumh5_tauri_archive=cargo-tauri-x86_64-unknown-linux-gnu.tgz ;;
    Linux-aarch64) mumh5_tauri_archive=cargo-tauri-aarch64-unknown-linux-gnu.tgz ;;
    Darwin-x86_64) mumh5_tauri_archive=cargo-tauri-x86_64-apple-darwin.zip ;;
    Darwin-arm64) mumh5_tauri_archive=cargo-tauri-aarch64-apple-darwin.zip ;;
    MINGW*-x86_64|MSYS*-x86_64) mumh5_tauri_archive=cargo-tauri-x86_64-pc-windows-msvc.zip ;;
    *) echo 'Unsupported native Tauri CLI platform.' >&2; exit 1 ;;
  esac
  curl --proto '=https' --tlsv1.2 -fL "https://github.com/tauri-apps/tauri/releases/download/tauri-cli-v2.12.6/$mumh5_tauri_archive" -o "$MUMH5_ROOT/.tooling/$mumh5_tauri_archive"
  if [[ "$mumh5_tauri_archive" == *.tgz ]]; then tar -xzf "$MUMH5_ROOT/.tooling/$mumh5_tauri_archive" -C "$CARGO_HOME/bin"; else unzip -oq "$MUMH5_ROOT/.tooling/$mumh5_tauri_archive" -d "$CARGO_HOME/bin"; fi
fi
(cd "$MUMH5_ROOT/frontend" && bun install --frozen-lockfile)
printf 'Tools are isolated in %s/.tooling\nRun: source tools/env.sh\n' "$MUMH5_ROOT"
