<p align="center">
  <a href="https://realse62em.github.io/Pine-Launcher/">
    <img src="icon.png" alt="Pine Launcher logo" width="96">
  </a>
</p>
<p align="center">
  <a href="https://realse62em.github.io/Pine-Launcher/"><strong>Visit the Pine Launcher website</strong></a>
</p>

# Pine Launcher

Pine Launcher is a Windows Minecraft launcher with isolated instances, Microsoft and offline accounts, Modrinth content management, verified shared caching, and an iOS-inspired glass interface.

> **Windows only for now.** Linux support is planned and coming soon.

## Download and install

1. Download the newest installer from the [Releases](https://github.com/RealSe62em/Pine-Launcher/releases) page.
2. Run the installer that matches your Windows PC:
   - `PineLauncherSetup-x64.exe` — Intel or AMD 64-bit PCs.
   - `PineLauncherSetup-arm64.exe` — Windows on ARM PCs.
3. Follow the installer prompts, then open Pine Launcher from the Start menu or desktop shortcut.

Pine supports Windows 10 and Windows 11. The launcher downloads and verifies the Java runtime required by the selected Minecraft version, so manual Java installation should not normally be needed.

## Features

- Separate Vanilla, Fabric, Quilt, Forge, and NeoForge instances.
- Multiple Microsoft and offline accounts with individual switching and deletion.
- Modrinth discovery plus optional CurseForge mods, packs, and data packs using an approved API key.
- A polished frequently visited grid with real server/world details and one-click Play.
- Shared verified caches for game assets, libraries, versions, and mods—so matching files are reused instead of downloaded again for every new instance.
- Clear launch stages and selectable, copyable logs for troubleshooting.
- Transactional instance copies and imports with cancellation, category selection, private-data exclusion, and rollback of partial work.
- Pine archives, lightweight Pine manifests, and standards-compatible Modrinth `.mrpack` import/export.
- Automatic restore points, world management, managed-pack lifecycle controls, and privacy-safe crash diagnosis.

CurseForge requires an approved third-party API key. Add it under **Settings → Integrations** or set `PINE_CURSEFORGE_API_KEY`; Pine does not ship a private developer key in source control.

## Privacy and safety

Microsoft login uses OAuth with PKCE. Microsoft refresh tokens are saved only when Electron's operating-system-backed secure storage is available; Pine refuses to persist them as plaintext. Content downloads use HTTPS, verify available hashes, reject unsafe filenames, resolve required dependencies, and roll back partial installations.

Instances, encrypted account data, settings, caches, and diagnostic logs are stored in Pine Launcher's per-user Windows application-data directory. Uninstalling Pine removes the application files but keeps worlds and other user data.

The current installer is unsigned. Windows may therefore show an "Unknown publisher" notice. Verify the installer checksum published with each release and never disable antivirus protection globally.

## Troubleshooting

- **Java error:** Pine installs the Java runtime required by the Minecraft version. You can also choose a custom Java executable in Settings.
- **Launch failure:** Open the instance **Logs** tab and copy the selectable log text when asking for help.
- **Installer problem:** Download the newest installer again and choose x64 for Intel/AMD PCs or ARM64 for Windows on ARM.
- **Uninstall:** Use **Installed apps** in Windows Settings or Control Panel. Worlds and other user data are retained.

## Building from source on Windows

Install Node.js 22.12 or newer, then run from Command Prompt or PowerShell:

```powershell
npm.cmd install
npm.cmd test
npm.cmd start
```

Use `npm run dev` to open Electron developer tools. Build Windows installers with:

```powershell
npm run build:installer
```

## Release checklist

1. Run `npm test` and `npm audit`.
2. Smoke-test Vanilla, Fabric, Quilt, and Forge with fresh instances.
3. Test install, update, launch, and uninstall on Windows.
4. Publish the installer files and their SHA-256 checksums in a GitHub Release.

Built with Electron and `minecraft-launcher-core`. Licensed under MIT.
