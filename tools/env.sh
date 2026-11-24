#!/usr/bin/env bash
# Source this file to use tools isolated to this checkout.
DREAM_CORD_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export DREAM_CORD_ROOT
export CARGO_HOME="$DREAM_CORD_ROOT/.tooling/cargo"
export RUSTUP_HOME="$DREAM_CORD_ROOT/.tooling/rustup"
export BUN_INSTALL="$DREAM_CORD_ROOT/.tooling/bun"
export BUN_INSTALL_CACHE_DIR="$DREAM_CORD_ROOT/.tooling/bun/cache"
export PATH="$CARGO_HOME/bin:$BUN_INSTALL/bin:$PATH"
