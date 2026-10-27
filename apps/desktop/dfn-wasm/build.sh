#!/usr/bin/env bash
# Rebuilds the DeepFilterNet WebAssembly module used by Windows and macOS (Linux has its own native engine).
# Needs: rustup target add wasm32-unknown-unknown, cargo install wasm-bindgen-cli --version 0.2.100
# The result goes to apps/desktop/public/dfn and is committed, so normal builds do not need this.
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown --ignore-rust-version
wasm-bindgen target/wasm32-unknown-unknown/release/nexe_dfn_wasm.wasm --out-dir ../public/dfn --target web
rm -f ../public/dfn/*.d.ts
