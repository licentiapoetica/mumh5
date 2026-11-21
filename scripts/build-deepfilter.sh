#!/bin/sh
# Rebuilds vendor/deepfilternet from upstream DeepFilterNet at a pinned commit, source unmodified.
# Needs git, cargo, the wasm32-unknown-unknown Rust target and wasm-opt (binaryen).
# Cargo.lock is kept here because the one upstream ships no longer resolves with --locked.
# DF_TOOLS: a directory that already has bin/wasm-bindgen 0.2.92, to skip installing it.
set -eu

COMMIT=7b14b895fe7fc42cab72b4a4c1e49c982bd6404b
BINDGEN=0.2.92

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out="$root/vendor/deepfilternet"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tools=${DF_TOOLS:-$work/tools}

git init -q "$work/src"
git -C "$work/src" fetch -q --depth 1 https://github.com/Rikorose/DeepFilterNet.git "$COMMIT"
git -C "$work/src" -c advice.detachedHead=false checkout -q FETCH_HEAD
cp "$out/Cargo.lock" "$work/src/Cargo.lock"

[ -x "$tools/bin/wasm-bindgen" ] || cargo install wasm-bindgen-cli --version "$BINDGEN" --locked --root "$tools"

# The path remapping keeps local directories out of the binary
cargo_home=${CARGO_HOME:-$HOME/.cargo}
(cd "$work/src" && CARGO_TARGET_DIR="$work/target" \
  RUSTFLAGS="-C target-feature=+simd128 --remap-path-prefix=$work/src=/deepfilternet --remap-path-prefix=$cargo_home=/cargo" \
  cargo build --locked -p deep_filter --lib --target wasm32-unknown-unknown --release --no-default-features --features wasm)

"$tools/bin/wasm-bindgen" "$work/target/wasm32-unknown-unknown/release/df.wasm" --out-dir "$work/pkg" --target web --no-typescript
wasm-opt "$work/pkg/df_bg.wasm" -O3 --enable-simd --enable-bulk-memory --enable-nontrapping-float-to-int \
  --enable-sign-ext --enable-mutable-globals --enable-reference-types --enable-multivalue -o "$out/df.wasm"
# Not named .gz: servers would mark it as compressed and browsers would unpack it
cp "$work/src/models/DeepFilterNet3_onnx.tar.gz" "$out/DeepFilterNet3_onnx.bin"
cp "$work/src/LICENSE-MIT" "$work/src/LICENSE-APACHE" "$out/"
sha256sum "$out/df.wasm" "$out/DeepFilterNet3_onnx.bin"
