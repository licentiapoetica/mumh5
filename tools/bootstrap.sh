#!/usr/bin/env bash
# Install tools into this checkout only; never modifies shell profiles or system packages.
set -euo pipefail
DREAM_CORD_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DREAM_CORD_ROOT/tools/env.sh"
mkdir -p "$CARGO_HOME/bin" "$BUN_INSTALL/bin"
if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o "$DREAM_CORD_ROOT/.tooling/rustup-init.sh"
  sh "$DREAM_CORD_ROOT/.tooling/rustup-init.sh" -y --no-modify-path --profile minimal --default-toolchain 1.100.0 --component rustfmt --component clippy
else
  rustup toolchain install 1.100.0 --profile minimal --component rustfmt --component clippy
fi
if [[ ! -x "$BUN_INSTALL/bin/bun" ]] || [[ "$(bun --version)" != 1.4.5 ]]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) dream_bun_platform=linux-x64 ;;
    Linux-aarch64) dream_bun_platform=linux-aarch64 ;;
    Darwin-x86_64) dream_bun_platform=darwin-x64 ;;
    Darwin-arm64) dream_bun_platform=darwin-aarch64 ;;
    *) echo 'Unsupported Bun platform; install Bun 1.4.5 into .tooling/bun/bin.' >&2; exit 1 ;;
  esac
  curl --proto '=https' --tlsv1.2 -fL "https://github.com/oven-sh/bun/releases/download/bun-v1.4.5/bun-${dream_bun_platform}.zip" -o "$DREAM_CORD_ROOT/.tooling/bun.zip"
  unzip -oq "$DREAM_CORD_ROOT/.tooling/bun.zip" -d "$DREAM_CORD_ROOT/.tooling/bun-unpack"
  mv "$DREAM_CORD_ROOT/.tooling/bun-unpack/bun-${dream_bun_platform}/bun" "$BUN_INSTALL/bin/bun"
fi
(cd "$DREAM_CORD_ROOT/frontend" && bun install --frozen-lockfile)
printf 'Tools are isolated in %s/.tooling\nRun: source tools/env.sh\n' "$DREAM_CORD_ROOT"
