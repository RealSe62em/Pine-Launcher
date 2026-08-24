# Changelog

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
