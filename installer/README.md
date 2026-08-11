# Legacy installer (not shipped)

This directory contains the retired experimental Electron installer and exists only for historical reference and its core safety regression tests. It is excluded from every production build by `electron-builder.yml`.

The only supported Windows installer is the native NSIS build produced by `npm run build:installer` at `dist/PineLauncherSetup.exe`. Do not publish or run files from this directory.
