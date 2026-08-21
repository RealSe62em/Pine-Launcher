#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
npm run build:pacman:x64

echo "Arch Linux package created under dist-native/."
echo "Install it with: sudo pacman -U ./dist-native/PineLauncher-*-archlinux-x64.pacman"
