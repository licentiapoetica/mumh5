#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
cd "$DREAM_CORD_ROOT"
(cd frontend && bun install --frozen-lockfile && bun run check && bun run test && bun run build)
cargo fmt --all --check
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets -- -D warnings
