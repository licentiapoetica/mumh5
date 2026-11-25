#!/usr/bin/env bash
# Source this file to use tools isolated to this checkout.
MUMH5_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export MUMH5_ROOT
export CARGO_HOME="$MUMH5_ROOT/.tooling/cargo"
export RUSTUP_HOME="$MUMH5_ROOT/.tooling/rustup"
export BUN_INSTALL="$MUMH5_ROOT/.tooling/bun"
export BUN_INSTALL_CACHE_DIR="$MUMH5_ROOT/.tooling/bun/cache"
export PATH="$CARGO_HOME/bin:$BUN_INSTALL/bin:$PATH"
