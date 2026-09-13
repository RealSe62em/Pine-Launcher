# Changelog

## 1.2.7

### Instance creation and presets

- Added Beginner, Builder, and PvP presets, each combining a shared performance foundation with mods chosen for that play style.
- Refreshed the Performance preset with a maintained optimization stack including Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity Culling, More Culling, Dynamic FPS, Fabric API, and Mod Menu.
- Added version-aware lighting optimization: Phosphor for older supported releases and Starlight where appropriate.
- Removed obsolete, unrelated, and conflicting mods from the Performance preset.
- Check every preset mod and required dependency against the selected Minecraft version before creating the instance.
- Show compatible preset mods, skipped mods, and the reason for each skipped entry before creation.
- Expanded the profile chooser into a responsive six-card grid with clearer icons, descriptions, and preset guidance.
- Validate the instance name, Minecraft version, and loader version together, highlight every missing field, and scroll to the full validation summary instead of reporting one field at a time.

### Mod compatibility and content management

- Added a full **Check compatibility** tool to every instance's Mods section.
- Detect loader mismatches, unsupported Minecraft versions, duplicate mod IDs, missing dependencies, incompatible dependency versions, declared conflicts, and known broken releases.
- Parse Fabric, Quilt, Forge, and NeoForge metadata using loader-specific rules so dependency declarations are no longer misreported as duplicate mods.
- Inspect nested Fabric modules without blaming the containing mod for IDs supplied only by bundled libraries.
- Understand stable, beta, semantic, wildcard, interval, and prerelease version requirements when comparing installed mods.
- Suggest safe next steps for each finding, including installing dependencies, changing versions, disabling a file, or removing a conflicting mod.
- Revalidate provider metadata before applying a suggested repair and create a restore point before changing files.
- Fixed false duplicate-ID reports involving Forge, Minecraft, GeckoLib, and Yet Another Config Lib metadata.
- Improved Java runtime verification so a compatible selected runtime is not reported as an unknown version.
- Added **Versions** to Discover mod cards so users can browse and install compatible older releases.
- Added a themed version browser with release type, publication date, loader support, Minecraft versions, and the target instance's real icon.
- Added **Update all** for available mod updates.
- Added per-mod **Freeze** and **Unfreeze** controls to keep a chosen version out of automatic update checks.
- Preserve the current Mods scroll position when freezing or unfreezing a project.

### Skins and capes

- Added a **Skins & capes** studio to the account menu.
- Added a local skin wardrobe for Microsoft and offline accounts with PNG validation, classic/slim selection, import, preview, apply, and delete controls.
- Apply Microsoft-account skins directly through Minecraft Services while keeping offline skins local to Pine.
- Added a true Three.js Minecraft model with correct classic/slim geometry, outer skin layers, idle animation, lighting, automatic rotation, and full mouse drag rotation.
- Added a damage interaction with a red animated anger mark that grows with repeated hits.
- Added a hidden 15-hit end-crystal sequence using the installed Minecraft client's obsidian, end-crystal, and explosion textures.
- Paginate saved skins in four-item, 2×2 pages.
- Load, preview, equip, and unequip capes owned by the selected Microsoft account.
- Fixed legacy Minecraft cape texture URLs and crop cape atlases to one clean visible cape face.
- Display capes as full-width horizontal rows with four capes per page.

### Screenshots

- Added a dedicated Screenshots tab to every instance.
- Browse Minecraft screenshots as themed cards with filenames, dates, and file sizes.
- Open screenshots in a full themed viewer instead of selecting them automatically.
- Select screenshots using the corner control or right-click, then export the selected set as a ZIP.
- Delete screenshots with confirmation or open the instance screenshot folder directly.
- Added click-focused zoom at 200% and 350%, a third-click reset, and drag-to-pan while zoomed.

### Minecraft settings, sync, and automation

- Added a searchable visual editor for Minecraft's `options.txt`, including readable labels for common video, audio, control, and gameplay settings.
- Preserve unknown settings and values containing colons when saving.
- Create a restore point before writing edited Minecraft settings.
- Added selective cross-instance sync for game settings, multiplayer servers, resource packs, data packs, command history, and creative hotbars.
- Added a themed source-instance picker with real instance artwork and visible selection checkmarks.
- Create a full restore point of the destination before syncing anything.
- Added launch automation with optional pre-launch commands, post-exit commands, and environment variables.
- Run automation in the instance folder and persist environment-variable changes with the rest of the instance settings.
- Moved Minecraft settings and sync below Launch automation for a clearer settings flow.

### Instance recipes and exports

- Rebuilt recipe previews with readable included-download and unavailable-download cards instead of raw JSON blocks.
- Resolve resource packs through their recorded provider metadata when available.
- Search unresolved resource packs by name and let the user confirm the correct downloadable match.
- Preserve verified provider hashes and download information in generated recipes.
- Improved export-choice icon alignment, selection indicators, descriptions, and action spacing.

### Accounts

- Paginate the account switcher at six accounts per page so large account lists no longer compress or overflow.
- Keep the active account visible and preserve the account menu while switching accounts.
- Replaced the tiny account arrow with a themed SVG chevron positioned beside the username.
- Rotate the account chevron when the menu opens and truncate long account names cleanly.

### Discord Rich Presence

- Added a **Join Pine Discord** Rich Presence button using Pine's Discord invite.
- Added secure Rich Presence button and activity URL handling.
- Expanded Linux Discord IPC discovery to native Discord, Snap, Flatpak, Vesktop, Vencord, WebCord, ArmCord, and Equibop locations.
- Fixed Pine activity failing to appear for many Linux Discord installations.

### Appearance and library

- Fixed custom accent colors being lost after restarting Pine.
- Added more accent-color presets and a full custom color picker.
- Recalculate the launcher gradient, glow, dim, hover, and text colors from the selected accent.
- Added a persistent **Compact library** option for denser instance cards.
- Improved instance artwork handling in custom pickers so saved images appear instead of letter placeholders.

### Interface consistency and accessibility

- Standardized primary, secondary, ghost, icon, and destructive buttons across Home, Library, Discover, Settings, backups, imports, exports, and instance tools.
- Fixed button labels sitting too low on Linux and aligned text and icons consistently.
- Restyled confirmation dialogs, creation sheets, backup controls, empty states, filters, and action bars to match Pine's glass design.
- Restored bottom-sheet entry motion for dialogs while retaining the updated visual styling.
- Fixed card edges being clipped inside horizontally scrolling server and world containers.
- Fixed export icons and selection marks sitting above their visual center.
- Fixed uneven spacing in Instance Settings.
- Added semantic tab roles, selected states, clearer labels, and keyboard-focus behavior to instance navigation.
- Fixed the first-letter focus rectangle flash in Discover search on Linux without changing Windows behavior.
- Kept the bottom navigation glass effect active during optimized scrolling.

### Performance and reliability

- Reduced frame-by-frame compositing when scrolling through frequently visited servers and worlds.
- Cache expensive glass surfaces during active scrolling without making unrelated buttons lose their glass appearance.
- Keep destination cards on reusable compositor layers and batch scroll-driven updates to one animation frame.
- Bound the number of live Discover cards during long browsing sessions.
- Move expensive filesystem inspection, backup copying, restore, pruning, and deletion work away from Electron's main thread.
- Cache unchanged mod archive inspections and deduplicate concurrent scans.
- Batch game-log disk writes and renderer updates instead of processing every log line separately.
- Added regression coverage for presets, Linux rendering, recipes, account pagination, compatibility checks, older versions, appearance persistence, wardrobe interactions, screenshot controls, sync controls, and backend performance.

## 1.2.6

### Updates

- Download, install, and restart launcher updates from inside Pine on Windows, Debian, Ubuntu, and Arch Linux instead of opening the GitHub Releases page.
- Select the correct native Linux package for the current distribution and CPU architecture automatically.
- Verify Linux update packages against GitHub's published SHA-256 digest before installation.
- Keep Minecraft shutdown protection in place before restarting Pine to install an update.

## 1.2.5

### Launching and content

- Fixed Forge 1.21.11 and other modern Forge profiles by installing and launching their official native bootstrap instead of relying on the legacy wrapper path.
- Queue mods added while Minecraft is running and apply them transactionally on the next launch from Pine.
- Prevent Forge bootstrap messages about duplicate Java modules from being misreported as duplicate mod IDs.
- Added a detailed instance health report in the Logs tab without interrupting every launch.

### Launcher experience

- Added a first-run spotlight tour covering accounts, instance creation, content, settings, appearance, updates, and launcher navigation.
- Added server status, player count, version, and ping to recently visited server cards.
- Added desktop shortcuts for recently visited servers and worlds, including server artwork when available.
- Added resumable download controls, managed-pack update previews, instance recipes, and privacy-reviewed support reports.

### Release quality

- Added Windows Authenticode signing and timestamp verification when release signing credentials are configured.
- Added renderer and IPC smoke tests on Windows and Linux CI.

## 1.2.4

### Instance creation and content

- Preflight the Performance preset as soon as a Minecraft version is selected, including required dependencies.
- Show which optimization mods are compatible and which will be skipped, with a reason for every skipped mod.
- Repair interrupted or incomplete mod installations instead of treating an existing filename as successfully installed.
- Clearly report that mods added while Minecraft is running become available after the game fully restarts.

### Accounts and launching

- Restore and select the last-used account automatically when Pine starts.
- Preserve the launch-validation cache across launcher updates and ordinary download-cache cleanup, avoiding unnecessary revalidation after upgrades.
- Keep nonfatal mod compatibility and duplicate-ID findings in diagnostics and launch logs without showing alarming user-facing warnings when the game can continue.

### Memory defaults

- Set new instances to an equal 4 GB minimum and 4 GB maximum by default across all creation routes.
- Preserve the effective memory allocation of every existing instance during migration, including custom global and per-instance values.

## 1.2.3

### Instance importing

- Fixed Prism Launcher imports that previously created an instance with only its name.
- Import the complete safe Minecraft game directory, including mods, mod configuration, keybinds, video and game options, servers, worlds, resource packs, shader packs, screenshots, saves, default configs, and other compatible instance data.
- Preserve per-mod settings so imported mods keep the user's existing configuration.
- Added launcher-specific metadata handling for Prism Launcher and other supported instance layouts.
- Added archive, selected-folder, and installed-launcher discovery flows with a shared inspection pipeline.
- Added an import preview with detected source, Minecraft version, loader, categories, size, warnings, and destination details.
- Added visible import progress, cancellation, background inspection, source fingerprinting, and SHA-256 copy verification.
- Added transactional imports with rollback so failed or cancelled transfers do not leave partial instances behind.
- Ignore private launcher data such as account sessions, authentication files, logs, caches, crash reports, and transient runtime files.
- Skip unsafe symbolic links and prevent imported files from escaping the selected source or destination.

### Reliability and data safety

- Added atomic JSON persistence, backup recovery, and serialized registry updates to reduce the risk of corrupted launcher data.
- Added recoverable instance deletion staging and safer backup restoration with strict path validation.
- Added an offline Minecraft version cache so the launcher remains usable when Mojang services are temporarily unavailable.
- Improved storage accounting and safe cache cleanup controls.

### Java and launching

- Fixed misleading red Java compatibility warnings when Pine can provide a compatible managed runtime automatically.
- Added clearer managed Java status and runtime selection information.
- Improved Java compatibility handling for newer Minecraft versions.

### Accounts and interface

- Added a smooth **Show all accounts** control in the top navigation account menu instead of limiting the list to three entries.
- Fixed vertically misaligned icons in the Library import panel.
- Improved keyboard focus, native window controls, accessibility labels, and reduced-motion behavior.
- Improved loading, empty, error, and offline states across launcher surfaces.

### Linux

- Enabled update checks on supported Linux packages instead of leaving the update button disabled.
- Added Debian packages for x64 and ARM64 and an Arch Linux x64 package to the release pipeline.
- Added Linux secure-storage integration and clearer update installation guidance.

### Security

- Tightened IPC sender validation, OAuth redirect checks, external URL handling, permission defaults, and file-system containment.
- Enabled Electron security fuses and added security, contribution, and licensing documentation.

### Development and release quality

- Expanded automated coverage for imports, transfer safety, persistence recovery, updater behavior, storage, Linux packaging, and UI regressions.
- Added continuous integration checks for tests, security auditing, and release packaging readiness.
