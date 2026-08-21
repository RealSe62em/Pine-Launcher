# 🌲 Pine Launcher 1.2.0 — The Instance Update

Pine 1.2.0 expands importing, exporting, instances, worlds, modpacks, crash recovery, NeoForge, and the Library experience.

## Message 1/5 — Instances and importing

### 🔁 Complete instance duplication

- Added **Duplicate instance** with a full one-click copy of worlds, datapacks, mods, configurations, settings, saved servers, resource packs, shaders, screenshots, loader files, artwork, memory settings, JVM settings, tags, and other instance content.
- Every duplicate becomes a completely independent instance with a new identity and fresh Pine play history.
- Added an optional selective-copy mode for choosing individual content categories.
- Copies can use a different storage location and can be cancelled safely.
- Pine now stages and validates copies before they appear in the Library, preventing broken or half-created instances.

### 📥 Much broader launcher importing

- Added automatic discovery and manual importing for the Official Minecraft Launcher, Prism Launcher, MultiMC, PolyMC, Modrinth App, CurseForge, GDLauncher, ATLauncher, Technic Launcher, FTB App, Lunar Client, Badlion Client, Feather/Dawn, LabyMod, Fast Client, TLauncher, and Legacy Launcher locations.
- Discovery is opt-in and shows the folders Pine intends to inspect first.
- Source detection now uses real launcher metadata and reports its confidence instead of accepting arbitrary folders blindly.
- Added a detailed import preview with the detected Minecraft version, loader, worlds, mods, packs, configurations, file totals, required space, warnings, and skipped content.
- Import categories can be selected individually. Mods and configurations can remain excluded when they do not belong in the destination setup.
- Account tokens, cookies, sessions, passwords, browser data, and launcher credentials are always excluded.
- Source folders remain untouched during import.

---

## Message 2/5 — Packs and lifecycle management

### 📦 Proper pack import and export

- Added validated importing for Pine archives, Modrinth `.mrpack` files, CurseForge modpacks, and lightweight Pine manifests.
- Added exports for complete Pine instances, privacy-safe shareable packs, standards-shaped Modrinth `.mrpack` files, and lightweight Pine download manifests.
- Shareable exports exclude personal worlds, screenshots, logs, crash reports, saved servers, account data, and Pine activity history.
- Files that cannot be redistributed safely are represented using verified provider download references or listed clearly as omitted.
- Downloads and staged files are checked using available hashes, size limits, safe paths, and HTTPS-only URLs.

### 🧩 Managed modpack lifecycle

- Imported Modrinth and CurseForge packs can now remain connected to their original pack and version.
- Added **Locked**, **Unlocked**, and **Unpaired** states for curated packs.
- Added pack update checks, version switching, downgrades, repair, and unpairing.
- Pine tracks managed files separately from files added or changed by the user.
- Pack repairs restore missing or damaged managed files without deleting valid user-added content.
- Updates and repairs create automatic restore points and roll back safely if something fails.
- CurseForge support uses the user’s own optional API key; Modrinth functionality does not require one.

---

## Message 3/5 — Worlds and the Library

### 🌍 Full world management

- Worlds now have polished Pine cards showing their real icon, name, Minecraft version, game mode, last-played time, and size.
- Added Play, Rename, Duplicate, Export, Open folder, Screenshots, Add datapack, and Delete actions.
- Buttons remain usable after actions such as opening a folder or exporting a world.
- World duplication and deletion use recoverable operations instead of exposing incomplete data.
- Added downgrade warnings when a world was last opened in a newer Minecraft version.
- Datapack ZIPs are validated before installation and can be installed directly into a selected world.

### 🗂️ Groups, tags, search, and bulk actions

- Added **Make a group** beside New instance.
- Groups appear as rounded mosaic cards using instance artwork: up to four images, or three images plus a remaining-instance count for larger groups.
- Clicking a group opens all instances inside it.
- Instances can be assigned to an optional group while being created or later through Instance Settings.
- Deleting a group **never deletes its instances**; they return to the main Library.
- Tags now participate in the global launcher search beside instance names and group names.
- Added favorites/pinning, total playtime, last-session duration, creation and last-played metadata.
- Added bulk grouping, favorite changes, and guarded bulk deletion.
- Reworked Library sorting and Recently Played cards to match Discover’s borders, motion, and visual language.
- Rebuilt Instance Settings navigation to feel like Pine’s main bottom navigation instead of an unrelated settings layout.

---

## Message 4/5 — Recovery and NeoForge

### 🩺 Crash assistant and safe recovery

- Added deterministic crash explanations for missing dependencies, duplicate mod IDs, wrong loaders or game versions, incompatible Java, out-of-memory failures, mixin errors, suspected crashing mods, graphics/OpenGL problems, corrupted files, and frozen launches.
- Pine can examine launch output, the latest/debug logs, crash reports, and JVM fatal-error logs within strict size and path limits.
- Results include confidence, evidence, a plain-language explanation, and safe suggested actions.
- Disabling a suspected mod or repairing files creates a restore point first.
- Added guarded memory increases, instance repair, snapshot restore, retry launch, and frozen-game termination.
- Logs shared through mclo.gs are anonymized first and require explicit confirmation. Personal paths, tokens, account details, emails, server addresses, and identifying values are redacted.

### ⚒️ Complete NeoForge lifecycle

- NeoForge is now handled as its own loader provider instead of being treated as Forge.
- Added exact Minecraft-to-NeoForge version matching, stable-version sorting, installer checksum verification, Java selection, profile validation, library health checks, repair, forced reinstall, upgrades, and version history.
- Invalid profiles, missing libraries, damaged JARs, and mismatched loader versions are detected before launch.
- Added compatibility coverage for representative modern Minecraft and NeoForge release lines.

---

## Message 5/5 — Experience, reliability, and release checks

### ✨ Launcher experience and reliability

- **Close on launch** now hides Pine instead of destroying it. When Minecraft exits or crashes, the exact same Pine window returns with its navigation and state preserved—no duplicate launcher window.
- Reworked instance and world actions so temporary busy states do not permanently grey out reusable buttons.
- Added transactional staging, cancellation cleanup, path validation, collision protection, private-data filtering, and rollback across critical operations.
- Added automatic and manual instance restore points with retention controls and interrupted-restore recovery.
- Improved compatibility with spaces, Unicode characters, custom storage locations, and different Windows user folders.
- Removed developer-specific paths from packaged code.
- Added separate native **Windows x64** and **Windows ARM64** installers and architecture-specific update feeds.
- Updated the website’s install buttons, release information, sizes, checksum display, and download links for Pine Launcher 1.2.0.

### ✅ Release verification

- **131 automated tests passing**
- **0 known production dependency vulnerabilities**
- Both packaged applications verified as **Pine Launcher 1.2.0**
- Both x64 and ARM64 executable architectures verified independently

Thank you to everyone testing Pine and helping shape it. If you find an issue, include the instance’s Minecraft version, loader, and the anonymized support summary from Pine’s crash assistant. 💚
