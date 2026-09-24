# Pine Launcher 1.2.8

Pine 1.2.8 is the biggest Pine update so far, with more than 50 improvements focused on managing instances, finding content, tracking playtime, and making the launcher feel more complete.

## Move between versions without risking your original instance

- The new **Version migration** tool creates a separate copy of an instance on another Minecraft version.
- Your worlds, mods, settings, servers, resource packs, shaders, screenshots, and other files are carried across while the original instance stays untouched.
- Pine validates the selected Minecraft and loader versions, verifies the copied files, and checks the copied mods for obvious compatibility problems.
- Version migration is currently in beta because Minecraft worlds and modifications can still break when moved between versions.

## Work with multiple instances at once

- Open up to four Library or instance panes in a clean split workspace.
- Search, sort, resize, close, and rearrange panes independently.
- Drag mods, resource packs, shaders, data packs, worlds, and screenshots between instances to copy them.
- Split workspaces remain open while moving around Pine, while the regular Library stays fresh whenever you return to it.

## A much larger Discover page

- Browse public Minecraft servers directly inside Pine with live player counts, latency, icons, banners, supported versions, tags, and descriptions.
- Filter servers by directory provider, game mode, Minecraft version, client requirements, and online status.
- Load more servers progressively while Pine caches completed artwork and metadata for faster browsing.
- Add a discovered server directly to the multiplayer list of any chosen instance without replacing its existing servers.
- Browse community skins, search a Minecraft Java username, preview the real player skin in interactive 3D, and save it to your wardrobe.
- Find older mods more reliably through expanded version history, combined Modrinth and CurseForge results, and first-party OptiFine installation for compatible legacy Forge instances.

## Playtime and activity at a glance

- The new **Stats** page shows lifetime and weekly playtime, daily graphs, favorite instances, peak hours, streaks, servers, worlds, and recent sessions.
- Pine now tracks time spent in menus, singleplayer worlds, and multiplayer servers.
- The new activity center follows downloads, mod and pack installs, instance creation, imports, Java setup, launcher updates, and completed files in one place.

## Faster everyday instance management

- Drag local mod JARs straight into an instance’s Mods page to copy and install them.
- Use the new dual-handle memory control to set minimum and maximum RAM without typing values manually.
- The **Instance** destination is now always available and gives you a useful landing page when no instance is selected.
- The Home page’s **Your library** heading now opens the full Library directly.
- Modpack install dialogs close as soon as installation begins so you can keep using Pine while the activity center tracks progress.

## A cleaner Pine window

- Pine now uses integrated minimize, maximize, restore, and close controls instead of the operating-system title bar.
- The top navigation adjusts to long playing-instance names and includes a direct link to the Pine Discord server.
- The bottom navigation now fits Home, Discover, Library, Instance, Stats, and Settings.
- Pine has a new faceted tree logo, updated in-app branding, and proper Pine taskbar icons on Linux.
- Minecraft windows launched through Pine now use the Minecraft icon on Linux instead of the generic gear icon.

## Reliability improvements

- Server-list updates preserve every existing multiplayer entry and keep recovery copies before writing.
- Server status checks retain the most recent player count while refreshing instead of displaying a long “checking” state.
- Instance copies and migrations are transactional: Pine verifies the copy and removes incomplete destinations after cancellation or failure.
- Improved loader checks, mod compatibility warnings, shared-file handling, Linux integration, and launcher progress reporting.

Thank you to everyone who tested Pine and reported problems during development. Your reports shaped a large part of this release.

> **Windows installation:** The 1.2.8 Windows installers are built directly by Pine's public GitHub Actions workflow. They are currently unsigned, so Windows SmartScreen may ask you to confirm before running them.
