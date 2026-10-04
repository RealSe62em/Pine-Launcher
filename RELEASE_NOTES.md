# Pine Launcher 1.2.9

Pine 1.2.9 makes modded instances safer to maintain, gives Fabric users a complete loader-management workflow, and substantially improves Library organization, skins, capes, split view, and Linux distribution support.

## Make mod compatibility actionable

- The compatibility checker can now upgrade or downgrade supported mods with **Make compatible**.
- Pine previews version changes, validates dependencies, creates a restore point, applies verified files, and checks the instance again afterward.
- Conflicting requirements and repairs that cannot be made safely remain visible instead of being silently changed.
- Mod updates no longer leave duplicate disabled files, stale rows, or incorrect “already installed” errors.
- Mods copied with a normal file manager recover their embedded names and icons, with exact Modrinth hash lookup as a fallback.

## Manage Fabric Loader safely

- Change, update, reinstall, repair, or roll back Fabric Loader from Instance Settings.
- Pine scans installed mods before changing the loader and can find compatible upgrades or downgrades.
- Lightweight loader restore points protect the profile without unnecessarily copying worlds and content.
- Failed or incomplete loader changes are verified and rolled back automatically.
- Version migrations now install and validate Fabric Loader and a compatible Fabric API build in the migrated instance.

## A more useful Library

- Drag entire instance cards directly into groups, with a clear `+` drop target.
- Reorder instances inside groups to control their preview artwork.
- Move instances back out of groups without deleting anything.
- The Library destination now returns to the overview when a group is open.
- Split panes can show only uncommon mods, resource packs, shaders, or data packs and remember that choice independently.

## Better customization and presets

- Instance Settings now uses Pine’s current responsive popup design with clearer identity, artwork, and storage controls.
- Offline accounts can apply local skins on supported modded instances without changing Microsoft account behavior.
- Cape ownership survives unequipping and temporary Minecraft service failures, with a new refresh action for recently claimed capes.
- The Builder preset now includes Effortless Building and Axiom when compatible versions are available.

## Home, multiplayer, and Linux fixes

- Frequently visited servers and worlds no longer disappear when one instance scan is incomplete.
- Fixed the main-process JavaScript popup that could appear after successfully joining a multiplayer server.
- Pine ships native Debian/Ubuntu x64 and ARM64 packages plus an Arch-family x64 package.
- The website includes a searchable Linux distro picker that directs supported Debian-family and Arch-family systems to the correct installer.
- Improved Linux taskbar identity, desktop integration, secure credential storage, Java provisioning, and update handling.

## Reliability

- Content replacements and queued installs are transactional and recover cleanly after interruptions.
- Restore points finish before protected instance changes begin.
- Heavy screenshot, world, and synchronization work no longer blocks Electron’s main thread.
- Expanded automated coverage and release checks protect loader changes, backups, skins, capes, groups, mod updates, multiplayer tracking, and Linux packaging.

> **Windows installation:** Pine’s public GitHub Actions workflow builds separate x64 and ARM64 installers. If this release is unsigned, Windows SmartScreen may ask you to confirm. Verify the SHA-256 checksum published with the release before running an installer.
