#!/usr/bin/env bash
set -euo pipefail

# Compatibility wrapper for contributors who used the original Debian build
# script. electron-builder now creates a self-contained package and never runs
# npm as root during installation.
cd "$(dirname "$0")"
npm run build:deb:x64

echo "Debian package created under dist-native/."
echo "Install it with: sudo apt install ./dist-native/PineLauncher-*-linux-*.deb"
