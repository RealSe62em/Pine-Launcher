# Pine Launcher

Pine Launcher is an Electron desktop launcher for Minecraft with isolated instances, Microsoft and offline accounts, Modrinth content management, shared game assets, and an iOS-inspired glass interface.

## Supported instances

- Vanilla
- Fabric
- Quilt
- Forge

NeoForge is intentionally not offered until its installer/profile flow is implemented and tested. Existing NeoForge entries show a clear launch error instead of silently starting Vanilla.

## Development

Requirements for development: Node.js 22.12 or newer. Release builds automatically download and verify the exact Eclipse Temurin Java runtime required by each Minecraft version.

```text
npm.cmd install
npm.cmd test
npm.cmd start
```

Use `npm run dev` to open Electron developer tools. Build the Windows installer with `npm run build:installer`.

## User data

Instances, encrypted account data, settings, caches, and diagnostic logs are stored in Electron's per-user application-data directory. Removing the application does not remove worlds or other user data.

## Accounts and privacy

Microsoft login uses OAuth with PKCE. Tokens are encrypted with the operating system when Electron secure storage is available and refreshed before launch. Offline accounts work only where offline authentication is accepted and do not grant ownership or access to online-mode servers.

## Modrinth

Discover supports mods, resource packs, shaders, data packs, and mod packs. Downloads use HTTPS, verify available hashes, reject unsafe filenames, resolve required dependencies, and roll back partial installations.

## Troubleshooting

- Java errors: Pine automatically installs the exact required Java runtime. A custom Java executable can still be selected in Settings.
- Launch failures: use the in-app log; persistent diagnostics are written under the user-data `logs` directory.
- Installer problems: rerun the newest architecture-matched `PineLauncherSetup-x64.exe` or `PineLauncherSetup-arm64.exe`. Installation and update detection are handled by the native Windows NSIS installer.
- Uninstall: use Windows Installed Apps/Control Panel. The native uninstaller removes application files without opening a terminal; worlds and other user data are retained.

## Release checklist

1. Run `npm test` and `npm audit`.
2. Smoke-test Vanilla, Fabric, Quilt, and Forge with fresh instances.
3. Test default and custom install paths, update, launch, and Control Panel uninstall.
4. Sign the executable and publish its checksum.

Built with Electron and `minecraft-launcher-core`. Licensed under MIT.

## Windows release signing

Public installers must be Authenticode-signed. Configure electron-builder with `CSC_LINK` and `CSC_KEY_PASSWORD` in the private release environment; never commit the certificate or password. Unsigned local builds are for testing only and may be blocked by Windows security policy.
