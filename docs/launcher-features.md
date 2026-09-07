# Launcher tools and first-run guide

Fresh installations automatically open an interactive spotlight tour across the
real launcher interface. It covers accounts, instance creation, loader and game
version choices, Discover, content management, instance settings, appearance,
updates, recent destinations, and shortcuts. Skip, Escape, closing Pine, and
completing the guide all prevent automatic replay. The marker lives
in `onboarding.json` in Electron's user-data directory, independently of settings.
Existing accounts or instances count as an existing installation. Help reopens
the guide manually. Fresh installations get a memory maximum of half physical
RAM, bounded to 1–6 GB, and a 1 GB minimum; users can change these defaults.

- **Downloads:** session transfer list, byte progress, pause/resume, retry and
  cancel. A failed transfer retains its owning installation until retry or cancel.
  Pausing applies backpressure; expired connections may restart. Generic content
  downloads resume partial files when the server supports ranges. Successfully
  downloaded files are distinct from installed content and next-launch queues.
  Active transfers are not restored across launcher restarts; verified queued
  content remains persisted separately.
- **Health:** the heart button in Logs opens checks for active duplicate mods,
  loader mismatches, known broken builds, missing Fabric dependencies (including
  nested providers), memory and configured Java. Findings link to Content or
  Settings without interrupting launch. These checks do not implement a complete
  dependency-version solver and cannot guarantee every mod combination will launch.
  Pending content is applied by the transactional launch path.
- **Recent servers:** existing Frequently visited cards query the Java status
  protocol and show player count, server version, latency, description, and icon.
  The same card launches the assigned instance or creates a desktop shortcut.
  Unreachable servers stay listed.
- **Pack previews:** downloads and compares the target pack, lists added, removed,
  changed and affected custom files, and fingerprints the compared content.
  Apply rejects a changed preview, then uses the existing restore-point and
  transactional update path. Rollback remains in pack controls.
- **Recipes:** reuses `.pine.json` export/import with pinned provider downloads,
  verified hashes, disabled file names, loader/version, and effective memory.
  Worlds and local configuration contents are not embedded; omitted files are
  reported. Use a complete export to share local files.
- **Support reports:** displays an allowlisted text report before local save or
  copy. Account stores are excluded, common tokens and identity/path patterns are
  redacted, and no upload occurs. Users should still review mod-generated text.

## Validation

`npm test` runs the regression suite. `npm run test:smoke` runs Electron with
throwaway user data and exercises the actual renderer, preload and IPC, including
spotlight interactions and skip/reload persistence, all five loader profiles,
health, recipes, and support-report redaction. On headless Linux use
`xvfb-run -a npm run test:smoke -- --no-sandbox`.

CI runs the suite and smoke test on Ubuntu and Windows. The tests do not perform
Microsoft authentication or real gameplay on every loader. Signed Windows release
verification remains in the release workflow; a trusted signing identity is still
required. This work does not publish a release or establish SmartScreen reputation.
