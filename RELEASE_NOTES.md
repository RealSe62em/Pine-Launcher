# Pine Launcher 1.3.0

Pine 1.3.0 introduces **Theme Studio**, 7 curated built-in themes, 6 structural UI layouts, optional CurseForge discovery across all five content types, Mojang security-manifest verification (protecting against stale LWJGL/FreeType builds such as Minecraft2Shell), a transparent opt-out active-player counter, and a modularized main-process architecture.

## Theme Studio, Built-in Themes & UI Layouts

- **Live Theme Studio (new in 1.3.0):** Visually customize Pine Launcher in real time with a compact glass inspector dock, click-to-inspect element styling, collapsible property groups, border & text-gradient presets, CSS snippets, gesture-grouped Undo/Redo, unsaved-changes protection, and JSON preset import/export.
- **Adaptive Background Studio:** Choose solid colors, custom multi-stop gradients with adjustable angle, or uploaded wallpapers with automatic client-side compression for large images.
- **7 Curated Built-in Themes:** *Pine Dark*, *Evergreen Canopy*, *Nordic Frost*, *Obsidian Ember*, *Velvet Nebula*, *Kyoto Sakura*, and *Cobalt Matrix*.
- **6 Structural UI Layouts:** Switch the entire shell between *Dynamic Island & Dock*, *Studio Sidebar*, *Zen Icon Rail*, *Panorama Top-Deck*, *Tactical Mecha HUD*, and *Tactile 3D Bento*.

## CurseForge Discovery (Optional BYO API Key)

- Added **Settings → CurseForge** with OS-keyring encrypted API key storage (refusing plaintext fallback), a **Test Connection** check, and a built-in step-by-step beginner guide for creating a personal CurseForge API key.
- Added a Discover source filter (**All sources**, **Modrinth**, **CurseForge**) supporting Mods, Modpacks, Resource Packs, Shaders, and Data Packs, plus clear manual-download guidance whenever an author disables third-party downloads.

## Mojang Security-Manifest Protection (Minecraft2Shell Fix)

- Pine now validates cached vanilla `<version>.json` manifests against Mojang’s official `version_manifest_v2.json` SHA-1 checksums before launch.
- Existing instances with outdated cached metadata receive a clear pre-launch warning explaining the security update (including Mojang’s patched LWJGL / FreeType libraries addressing the Minecraft2Shell resource-pack RCE) before downloading anything—while keeping worlds, mods, resource packs, and configs completely untouched.
- Offline launches continue safely without blocking play.

## Privacy-First Active-Player Counter

- Added an optional, strictly anonymous active-player counter in **Settings → General** paired with a **What's shared?** button that displays the exact 4-field JSON payload for the current session (`sessionId`, `state`, `version`, `platform`) alongside a clear checklist of everything never collected or stored (usernames, Microsoft accounts, UUIDs, IP addresses, server addresses, worlds, or mods).
- Turning off the toggle immediately removes the temporary in-memory session and stops all heartbeats.

## Play Stats, Linux Packaging & Architecture

- **Play Stats Accuracy:** Fixed multi-day session splitting so overnight or long sessions distribute cleanly across local midnight boundaries and never exceed 24 hours in a single day.
- **Modularized Main-Process Services:** Decomposed core IPC handlers into dedicated `lib/` services (`ipc-servers.js`, `ipc-worlds.js`, `ipc-system.js`, `ipc-diagnostics.js`, `ipc-skins.js`, `modrinth-service.js`, `destination-catalog.js`) with improved single-instance lock handling and Wayland desktop integration.
- **Native Installers Across Platforms:** Ships Windows x64 & ARM64 installers, Debian/Ubuntu `.deb` (x64 & ARM64), Fedora/Nobara `.rpm` (x64 & ARM64), and Arch Linux `.pacman` (x64) packages.
- **Quality & Static Checking:** Added non-breaking TypeScript static type checking (`npm run typecheck`) and verified 100% pass rate across 325+ automated tests with >= 85% line/function and >= 60% branch coverage plus Electron UI smoke testing.

> **Windows installation:** Pine’s public GitHub Actions workflow builds separate x64 and ARM64 installers. Because this release is unsigned, Windows SmartScreen may ask you to confirm. Verify the SHA-256 checksum published with this release before running an installer.
