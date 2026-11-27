<p align="center">
  <a href="https://realse62em.github.io/Pine-Launcher/">
    <img src="icon.png" alt="Pine Launcher logo" width="96">
  </a>
</p>
<p align="center">
  <a href="https://realse62em.github.io/Pine-Launcher/"><strong>Visit the Pine Launcher website</strong></a>
</p>

# Pine Launcher

Pine Launcher is a Windows and Linux Minecraft launcher with isolated instances, Microsoft and offline accounts, Modrinth and optional CurseForge content discovery, verified shared caching, a live **Theme Studio**, and an iOS-inspired glass interface.

Windows 10/11 (x64 & ARM64), Debian/Ubuntu-family Linux (`.deb` x64 & ARM64), Fedora/Nobara-family Linux (`.rpm` x64 & ARM64), and Arch-family Linux (`.pacman` x64) are supported. The website’s Linux picker maps supported distributions directly to the matching native installer.

## Download and install

1. Download the newest package from the [Releases](https://github.com/RealSe62em/Pine-Launcher/releases) page (or via the [Pine Launcher website](https://realse62em.github.io/Pine-Launcher/)).
2. **Windows** — run the installer that matches your PC:
   - `PineLauncherSetup-x64.exe` — Intel or AMD 64-bit PCs.
   - `PineLauncherSetup-arm64.exe` — Windows on ARM PCs.
3. **Debian, Ubuntu, Linux Mint, Pop!_OS, Zorin OS, elementary OS** — install the native `.deb` package:

```bash
sudo apt install ./PineLauncher-*-linux-amd64.deb
# or for ARM64:
sudo apt install ./PineLauncher-*-linux-arm64.deb
```

4. **Fedora & Nobara** — install the native `.rpm` package:

```bash
sudo dnf install ./PineLauncher-*-fedora-x86_64.rpm
# or for ARM64:
sudo dnf install ./PineLauncher-*-fedora-aarch64.rpm
```

5. **Arch Linux, Manjaro, EndeavourOS, CachyOS** — install the native `.pacman` package:

```bash
sudo pacman -U ./PineLauncher-*-archlinux-x64.pacman
```

Then open Pine Launcher from the application menu or run `pine-launcher`.

Pine downloads and verifies the Java runtime required by the selected Minecraft version on both Windows and Linux, so manual Java installation should not normally be needed. Linux Java archives are verified and extracted with the system `tar` utility.

## Features

- **Isolated instances & five loaders:** Separate Vanilla, Fabric, Quilt, Forge, and NeoForge instances with independent mods, worlds, resource packs, shaders, data packs, and Java/memory settings.
- **Theme Studio, 7 built-in themes & 6 UI layouts (new in 1.3.0):**
  - Switch between **7 curated themes** (*Pine Dark*, *Evergreen Canopy*, *Nordic Frost*, *Obsidian Ember*, *Velvet Nebula*, *Kyoto Sakura*, *Cobalt Matrix*) and **6 structural UI layouts** (*Dynamic Island & Dock*, *Studio Sidebar*, *Zen Icon Rail*, *Panorama Top-Deck*, *Tactical Mecha HUD*, *Tactile 3D Bento*).
  - Customize every surface live in **Theme Studio** with click-to-inspect element styling, adaptive solid/gradient/wallpaper backgrounds (with gradient angle and automatic wallpaper compression), border & text-gradient presets, CSS snippets, Undo/Redo, and JSON theme preset import/export.
- **Modrinth & optional CurseForge discovery:** Browse and install mods, modpacks, resource packs, shaders, and data packs from Modrinth out of the box, or add your own CurseForge API key in **Settings → CurseForge** (stored encrypted in your OS keyring, with a built-in step-by-step setup guide and connection test).
- **Multiple accounts:** Manage multiple Microsoft and offline accounts with individual switching, deletion, skins, and capes.
- **Smart Home & Play Stats:** Frequently visited servers and worlds with one-click Play, plus Play Stats dashboards with accurate multi-day session tracking.
- **Shared verified caching:** Game assets, libraries, versions, and mods are cached and hash-verified so matching files are reused across instances instead of downloaded repeatedly.
- **Mojang security-manifest verification:** Validates cached vanilla manifests against Mojang’s `version_manifest_v2.json` SHA-1 checksums on launch, warning existing instances before refreshing stale official libraries (such as LWJGL / FreeType security fixes like Minecraft2Shell) while leaving worlds, mods, and configs untouched.
- **Backups, imports & exports:** Automatic restore points, transactional instance duplication/migration, Pine archives, lightweight Pine manifests, Modrinth `.mrpack` import/export, world management, managed-pack lifecycle controls, and privacy-safe crash diagnosis.

The **Settings → Storage** page shows how much space instances, shared game files, Java runtimes, backups, caches, and logs use. Its cache cleanup removes only replaceable downloads; it never removes instances, worlds, runtimes, or backups.

## Privacy and safety

Microsoft login uses OAuth with PKCE. Microsoft refresh tokens and optional CurseForge API keys are saved only when Electron's operating-system-backed secure storage is available; Pine refuses to persist them as plaintext. Content downloads use HTTPS, verify available hashes, reject unsafe filenames, resolve required dependencies, and roll back partial installations.

Pine also includes an optional anonymous active-player counter (enabled by default, with a one-click opt-out and a **What's shared?** live JSON payload viewer in **Settings → General**). It sends only a random per-launch in-memory `sessionId`, launcher/playing state, Pine version, and OS platform—never usernames, Microsoft accounts, UUIDs, IP addresses, server addresses, worlds, or mod lists.

Instances, encrypted account data, settings, caches, and diagnostic logs are stored in Electron's per-user application-data directory (`%APPDATA%` on Windows and `~/.config` on typical Linux desktops). Uninstalling Pine removes application files but keeps worlds and other user data.

On Linux, Microsoft account and CurseForge key persistence requires a working desktop Secret Service/keyring such as GNOME Keyring, KWallet, KeePassXC, or oo7. Pine will not save secrets as plaintext if secure storage is unavailable. Arch users whose desktop does not already provide one can install GNOME Keyring with `sudo pacman -S gnome-keyring`.

The current Windows installer is unsigned. Windows may therefore show an "Unknown publisher" notice. Verify the SHA-256 checksum published with each release and never disable antivirus protection globally.

## Troubleshooting

- **Java error:** Pine installs the Java runtime required by the Minecraft version. You can also choose a custom Java executable in Settings.
- **Launch failure:** Open the instance **Logs** tab and copy the selectable log text when asking for help.
- **Installer problem:** On Windows, choose x64 for Intel/AMD or ARM64 for Windows on ARM. On Debian/Ubuntu use `sudo apt install ./package.deb`, on Fedora use `sudo dnf install ./package.rpm`, and on Arch use `sudo pacman -U ./package.pacman`, so required desktop libraries are resolved automatically.
- **Uninstall:** Use **Installed apps** on Windows, `sudo apt remove pine-launcher` on Debian/Ubuntu, `sudo dnf remove pine-launcher` on Fedora, or `sudo pacman -R pine-launcher` on Arch. Worlds and other user data are retained.

## Building from source on Windows

Install Node.js 22.12 or newer, then run from Command Prompt or PowerShell:

```powershell
npm.cmd install
npm.cmd run check
npm.cmd start
```

Use `npm run dev` to open Electron developer tools. Build Windows installers with:

```powershell
npm run build:installer
```

## Building from source on Debian / Ubuntu

Install Node.js 22.12 or newer, `npm`, and the standard packaging tools (`libarchive-tools`, `rpm`, and `zstd` are needed if building Arch/Fedora packages too):

```bash
sudo apt install libarchive-tools rpm zstd
npm ci
npm run check
npm start
```

Build native packages into `dist-native/`:

```bash
npm run build:deb:x64
npm run build:deb:arm64
npm run build:rpm:x64
npm run build:rpm:arm64
```

## Building from source on Arch Linux

Install Node.js 22.12 or newer and npm, then run:

```bash
sudo pacman -S --needed nodejs npm base-devel
npm ci
npm run check
npm start
```

Build a native x64 Pacman package with:

```bash
npm run build:pacman:x64
```

The package is written to `dist-native/` and can be installed with `sudo pacman -U ./dist-native/PineLauncher-*-archlinux-x64.pacman`.

## Release checklist

1. Run `npm run check`, `node scripts/audit-production.cjs`, and `npm run test:smoke`.
2. Smoke-test Vanilla, Fabric, Quilt, Forge, and NeoForge instances.
3. Verify install, launch, and uninstall on Windows, Debian/Ubuntu, Fedora, and Arch Linux.
4. Verify managed Java, OS keyring storage, and updater feeds on each platform.
5. Publish all installers/packages and their SHA-256 checksums in a GitHub Release.

Built with Electron and `minecraft-launcher-core`. Licensed under MIT.

See [CONTRIBUTING.md](CONTRIBUTING.md) to work on Pine and [SECURITY.md](SECURITY.md) to report vulnerabilities privately.
