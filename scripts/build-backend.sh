#!/usr/bin/env bash
# Build the backend canister reproducibly and print its SHA-256.
#
# Anyone can run this on a checkout of a release tag and compare the result with
# the module hash the Internet Computer reports for the live canister:
#
#   dfx canister info 7d7lc-byaaa-aaaah-qusjq-cai --network ic
#
# Identical hashes mean the deployed code is exactly this source.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf artifacts
DOCKER_BUILDKIT=1 docker build -f Dockerfile.build --target artifact --output type=local,dest=artifacts .
hash=$(sha256sum artifacts/backend.wasm | cut -d' ' -f1)
echo
echo "artifacts/backend.wasm  sha256: $hash"
echo "compare with:           dfx canister info 7d7lc-byaaa-aaaah-qusjq-cai --network ic"
