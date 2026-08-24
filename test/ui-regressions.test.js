'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const renderer = read('renderer/script.js');
const html = read('renderer/index.html');
const styles = read('renderer/style.css');
const components = read('renderer/styles/components.css');
const preload = read('preload.js');
const main = read('main.js');
const website = read('website/index.html');

test('custom install location keeps browse controls visually separate from the path field', () => {
  assert.match(html, /class="instance-location-actions"/);
  assert.match(styles, /\.instance-location-row\s*\{[^}]*gap:\s*14px/s);
});

test('loader selection retries failures and requests versions when a profile changes', () => {
  assert.match(renderer, /Could not load — click to retry/);
  assert.match(renderer, /function selectProfile[\s\S]*?loadLoaderVersions\(\);\s*\n\}/);
  assert.match(renderer, /selectedIdx = stableIdx >= 0 \? stableIdx : 0/);
  assert.match(main, /const loaderVersionCache = new Map\(\)/);
});

test('performance preset excludes SmoothBoot and Indium', () => {
  const preset = renderer.match(/const PERFORMANCE_MODS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(preset, /smoothboot/i);
  assert.doesNotMatch(preset, /indium/i);
});

test('missing account errors reopen the account chooser with a detailed fallback', () => {
  assert.match(renderer, /isAccountRequiredError/);
  assert.match(renderer, /openAccountRequiredModal\(name\)/);
  assert.match(renderer, /toast\('Launch failed: ' \+ message/);
  assert.match(renderer, /data-saved-account/);
  assert.match(main, /Microsoft session expired or was revoked/);
});

test('instance folder provides themed open and verified copy actions', () => {
  assert.match(html, /id="edit-open-folder"[\s\S]*?<svg/);
  assert.match(components, /#edit-open-folder\s*\{\s*margin-left:\s*auto/);
  assert.match(preload, /openInstanceFolder/);
  assert.match(main, /ipcMain\.handle\('open-instance-folder'/);
  assert.match(main, /clipboard\.readText\('clipboard'\)/);
});

test('settings use one working header save action without sticky pane buttons', () => {
  const settingsSource = renderer.match(/function renderSettingsLayout\(\)[\s\S]*?\n}\n\nfunction syncSettingsHeaderSave/)?.[0] || '';
  assert.match(renderer, /syncSettingsHeaderSave\(btn\.dataset\.cat\)/);
  assert.match(renderer, /headerSave\.onclick = \(event\) => saveAllSettings\(event\.currentTarget\)/);
  assert.match(renderer, /headerSave\.hidden = false/);
  assert.doesNotMatch(settingsSource, /set-save-btn/);
  assert.equal((html.match(/>Save settings</g) || []).length, 1);
});

test('the import hub remains scrollable in short launcher windows', () => {
  assert.match(renderer, /duplicate-instance-modal import-hub-modal/);
  assert.match(renderer, /export-choice-grid import-hub-body/);
  assert.match(components, /\.modal-body\s*\{\s*min-height:\s*0/);
  assert.match(components, /\.import-hub-modal\s*\{[^}]*100dvh/);
});

test('the import hub uses aligned action icons and a folder glyph', () => {
  assert.match(renderer, /data-import-kind="folder"[^\n]*href="#i-folder"/);
  assert.equal((renderer.match(/class="export-choice-chevron"/g) || []).length, 3);
  assert.match(components, /\.import-hub-body \.export-choice-chevron\s*\{[^}]*margin-left:\s*auto/s);
  assert.match(components, /\.import-hub-body \.export-choice-icon\s*\{[^}]*display:\s*grid !important[^}]*place-items:\s*center/s);
});

test('launcher folder imports preserve complete gameplay state with progress and cancellation', () => {
  assert.match(renderer, /Complete safe copy is selected by default/);
  assert.match(renderer, /sourceFingerprint:\s*transfer\.fingerprint/);
  assert.match(renderer, /operationId/);
  assert.match(preload, /onImportProgress/);
  assert.match(main, /skipSymlinks:\s*true/);
  assert.match(main, /verifyContents:\s*true/);
  assert.match(main, /inspectTransferPlanInWorker/);
  assert.doesNotMatch(main, /createTransferInclude\(options\.selection, \{ mods: false, configuration: false \}\)/);
});

test('managed Java provisioning does not produce a frightening install warning', () => {
  assert.match(main, /managedJavaRequired/);
  assert.doesNotMatch(main, /detected Java versions/);
  assert.doesNotMatch(main, /Install a compatible Java version or select it in Settings/);
});

test('account menu expands every saved account without rebuilding the menu', () => {
  assert.match(renderer, /Show all \$\{state\.accounts\.length\} accounts/);
  assert.match(renderer, /menu\.classList\.toggle\('accounts-expanded'/);
  assert.match(components, /account-menu\.accounts-expanded \.account-switch-row\.account-extra/);
});

test('async mod update checks immediately re-render the visible list', () => {
  assert.match(renderer, /async function checkForModUpdates[\s\S]*?renderContentList\(\);/);
});

test('pride account matching is case-insensitive', () => {
  assert.match(renderer, /profile\?\.name \|\| ''\)\.toLowerCase\(\)/);
  assert.match(renderer, /new Set\(\['undrrwrldd', 'se62em', 'shemes', 'exobeast'\]\)/);
});

test('Discover bounds its live card count during long sessions', () => {
  assert.match(renderer, /const DISCOVER_DOM_LIMIT = 120/);
  assert.match(renderer, /cards\.slice\(0, Math\.max\(0, cards\.length - DISCOVER_DOM_LIMIT\)\)/);
});

test('frequently visited cards use real metadata and bottom-nav actions', () => {
  assert.doesNotMatch(renderer, /Auto-Connect/);
  assert.match(renderer, /data-action="play"/);
  assert.match(renderer, /data-action="remove"/);
  assert.match(renderer, /destination-action-indicator/);
  assert.match(renderer, /api\.getServerMetadata/);
  assert.match(renderer, /api\.removeRecentDestination/);
  assert.match(main, /normalizeServerIcon\(saved\.icon\)/);
  assert.match(main, /listWorlds\(path\.join\(instanceDir, 'saves'\)\)/);
  assert.match(components, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
});

test('destination cards support deleted instances, copy, rename, and smooth detail reveal', () => {
  assert.match(renderer, /From a deleted instance/);
  assert.match(renderer, /data-title-action="copy"/);
  assert.match(renderer, /data-title-action="edit"/);
  assert.match(renderer, /api\.renameRecentDestination/);
  assert.match(preload, /renameRecentDestination/);
  assert.match(main, /ipcMain\.handle\('rename-recent-destination'/);
  assert.match(main, /archiveDeletedInstance\(instance\)/);
  assert.match(main, /finishPendingDeletion\(pending\)/);
  assert.match(main, /PENDING_DELETIONS_FILE/);
  assert.match(components, /destination-card\.has-detail \.destination-address/);
  assert.match(components, /@keyframes destination-name-set/);
  assert.match(components, /\.destination-card\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(components, /\.destination-card\s*\{[\s\S]*?content-visibility:\s*auto/);
  assert.match(components, /destination-card::after/);
});

test('quick play uses an absolute per-launch log and global search spans requested sources', () => {
  assert.match(main, /path:\s*path\.join\(instanceDir, 'quickPlay', `java-\$\{Date\.now\(\)\}\.json`\)/);
  assert.match(main, /identifier:\s*quickDestination\.identifier/);
  assert.match(renderer, /account\.profile\?\.name/);
  assert.match(renderer, /state\.recentDestinations/);
  assert.match(renderer, /api\.searchMods\(q, \[\], 0, 8, 'relevance'\)/);
  assert.match(renderer, /class="cmdk-play"/);
});

test('switching accounts leaves the account section open', () => {
  assert.match(renderer, /await chooseAccount\(key\);\s*menu\.remove\(\);\s*toggleAccountMenu\(\);\s*return;/);
});

test('authored UI source remains valid UTF-8 without mojibake markers', () => {
  const files = ['main.js', 'preload.js', 'renderer/script.js', 'renderer/index.html', 'website/index.html', 'website/script.js'];
  for (const file of files) {
    const value = read(file);
    assert.equal(value.includes('\uFFFD'), false, `${file} contains replacement characters`);
    assert.doesNotMatch(value, /(?:\u00C2\u00B7|\u00E2\u2020\u2019|\u00E2\u20AC\u00A6|\u00E2\u201D\u20AC)/, `${file} contains mojibake punctuation`);
  }
});

test('website removes the dummy Creative Forge entry and links VirusTotal by exact hash', () => {
  assert.doesNotMatch(website, /Creative\s*<i>Forge<\/i>/);
  assert.match(website, /data-virustotal/);
  assert.match(read('website/script.js'), /virustotal\.com\/gui\/file\/\$\{digest\.toLowerCase\(\)\}/);
  assert.match(website, /releases\/download\/v1\.2\.2\/PineLauncherSetup-x64\.exe/);
  assert.match(website, /releases\/download\/v1\.2\.2\/PineLauncherSetup-arm64\.exe/);
  assert.match(website, /releases\/download\/v1\.2\.2\/PineLauncher-1\.2\.2-linux-amd64\.deb/);
  assert.match(website, /releases\/download\/v1\.2\.2\/PineLauncher-1\.2\.2-linux-arm64\.deb/);
  assert.match(website, /releases\/download\/v1\.2\.2\/PineLauncher-1\.2\.2-archlinux-x64\.pacman/);
  assert.doesNotMatch(website, /data-build="universal"|Download universal installer/);
});

test('CurseForge credentials use an explicit encrypted integration surface', () => {
  assert.match(renderer, /data-cat="integrations"/);
  assert.match(renderer, /api\.saveCurseForgeKey/);
  assert.match(preload, /saveCurseForgeKey/);
  assert.match(main, /INTEGRATION_SECRETS_FILE/);
  assert.match(main, /secureSecretsAvailable\(safeStorage\)/);
  assert.doesNotMatch(renderer, /curseForgeApiKey\s*:/);
  assert.doesNotMatch(website, /CurseForge/i);
  assert.match(renderer, /api\.searchMods\(query, facets, state\.searchOffset, SEARCH_LIMIT, sort\)/);
});

test('high-density home and performance surfaces avoid live scrolling blur', () => {
  assert.match(read('renderer/styles/shell.css'), /\.main\s*\{[\s\S]*?scroll-behavior:\s*auto/);
  assert.match(components, /#modal-overlay\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(components, /#modal-overlay \.modal\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(components, /\.perf-mods-list\s*\{[^}]*contain:\s*layout paint style/);
  assert.match(components, /\.destination-actions\s*\{[\s\S]*?backdrop-filter:\s*none/);
});

test('Microsoft account addition forces a chooser and saved accounts can re-authenticate safely', () => {
  assert.match(main, /prompt=select_account/);
  assert.match(main, /authData\.profile\.uuid\.toLowerCase\(\) !== expectedAccount\.profile\.uuid\.toLowerCase\(\)/);
  assert.match(preload, /microsoftLogin:\s*\(options\)/);
  assert.match(renderer, /data-act="reauth-account"/);
  assert.match(renderer, /api\.microsoftLogin\(\{ mode: 'reauth', accountKey: key \}\)/);
  assert.match(components, /\.account-reauth:hover/);
});

test('installing Discover content without an instance gives guidance and a create action', () => {
  assert.match(renderer, /function showInstallNeedsInstanceWarning\(\)/);
  assert.match(renderer, /Create an instance first, then return to Discover and select the mod you want to install/);
  assert.match(renderer, /data-create-instance/);
  assert.match(renderer, /event\.target\.closest\('\[data-create-instance\]'\)[\s\S]*?openCreateModal\(\)/);
});

test('managed Java installation starts with instance creation and safely retries interrupted downloads', () => {
  assert.match(main, /void prepareJavaForInstance\(entry\.gameVersion\)/);
  assert.match(main, /managedJavaInstallPromises\.get\(javaMajor\)/);
  assert.match(main, /await pipeline\(Readable\.fromWeb\(res\.body\)/);
  assert.match(main, /Java \$\{javaMajor\} automatic installation failed after 3 attempts/);
  assert.match(main, /Launch preparation failed for \$\{instance\.name\}/);
  assert.match(main, /Launcher logs: \$\{LOG_FILE\}/);
  assert.match(preload, /onJavaInstallProgress/);
  assert.match(renderer, /api\.onJavaInstallProgress/);
});

test('instance backups stay inside the instance header experience with safe update hooks', () => {
  assert.match(html, /id="instance-backups-btn"[\s\S]*?href="#i-backup"/);
  assert.match(renderer, /function openBackupPanel\(\)/);
  assert.match(renderer, /Entire instance/);
  assert.match(renderer, /Worlds only/);
  assert.match(renderer, /Contains worlds from a newer Minecraft version/);
  assert.match(renderer, /setInstanceBackupRetention/);
  assert.match(preload, /createInstanceBackup/);
  assert.match(main, /beginProtectedInstanceUpdate\(instance, `Before updating/);
  assert.match(main, /recoverInterruptedRestores\(BACKUPS_DIR, \{ allowedRoots: recoveryRoots \}\)/);
  assert.match(main, /recoverInterruptedInstanceUpdates\(\)/);
  assert.match(components, /\.backup-item-actions/);
});

test('complete duplication is branded, transactional, and independently registered', () => {
  assert.match(html, /id="edit-sheet-duplicate"/);
  assert.match(renderer, /function openDuplicateDialog\(\)/);
  assert.match(renderer, /same worlds, mods, settings, servers, and custom files/);
  assert.match(preload, /duplicateInstance/);
  assert.match(main, /copyInstanceTransactional/);
  assert.match(main, /duplicatedFrom/);
});

test('close-on-launch preserves and restores the same launcher window', () => {
  assert.match(main, /function hideLauncherForGame\(\)/);
  assert.match(main, /mainWindow\.hide\(\)/);
  assert.match(main, /function restoreLauncherAfterGame\(\)/);
  assert.match(main, /mainWindow\.show\(\);[\s\S]*?mainWindow\.focus\(\)/);
  assert.doesNotMatch(main, /settings\.launchBehavior === 'Close on launch'[\s\S]{0,180}mainWindow\?\.close\(\)/);
});

test('world management and crash explanations use Pine-native surfaces', () => {
  assert.match(renderer, /async function explainCrash\(/);
  assert.match(renderer, /function loadWorlds\(\)[\s\S]*?getInstanceWorldDetails/);
  assert.match(renderer, /data-world-action="duplicate"/);
  assert.match(renderer, /data-world-action="export"/);
  assert.match(renderer, /Nothing is uploaded unless/);
  assert.match(components, /\.crash-assistant-modal/);
  assert.match(components, /\.world-card/);
});

test('animated instance art stays animated and banner blur uses live image layers', () => {
  assert.match(html, /id="modal-icon"[^>]*image\/gif/);
  assert.match(html, /id="modal-banner"[^>]*image\/gif/);
  assert.match(renderer, /showAnimatedImagePreview/);
  assert.match(renderer, /<img class="instance-banner-blur"/);
  assert.match(renderer, /<img class="instance-banner-sharp"/);
  assert.doesNotMatch(renderer, /instance-banner-blur" style="background-image/);
  assert.match(components, /\.instance-banner-blur[\s\S]*?filter:\s*blur\(10px\)/);
});

test('Linux update checks stay enabled and open the verified GitHub release', () => {
  assert.match(preload, /openUpdateDownload/);
  assert.match(main, /ipcMain\.handle\('open-update-download'/);
  assert.match(renderer, /update\.manualDownloadUrl/);
  assert.match(renderer, /Open GitHub release/);
  assert.match(renderer, /btn btn-primary" id="update-check-btn"/);
  assert.match(read('lib/updater.js'), /platform === 'linux' \|\| \(isPackaged && platform === 'win32'\)/);
});

test('crash assistant offers guarded recovery, private sharing, and frozen-game control', () => {
  assert.match(preload, /uploadCrashLog/);
  assert.match(preload, /repairInstanceFiles/);
  assert.match(preload, /terminateGame/);
  assert.match(main, /ipcMain\.handle\('upload-crash-log'/);
  assert.match(main, /collectInstanceDiagnostics\(getInstanceDir\(instance\), log\)/);
  assert.match(main, /redactSensitiveLog\(diagnostics\.log\)/);
  assert.match(main, /confirmed !== true/);
  assert.match(main, /ipcMain\.handle\('repair-instance-files'/);
  assert.match(main, /createAutomaticInstanceBackup\(instance, 'Before repairing instance files'\)/);
  assert.match(main, /ipcMain\.handle\('terminate-game'/);
  assert.match(main, /taskkill[\s\S]*?'\/T'[\s\S]*?'\/F'/);
  assert.match(renderer, /data-disable-suspect/);
  assert.match(renderer, /Before disabling suspected mod/);
  assert.match(renderer, /data-increase-memory/);
  assert.match(renderer, /data-restore-point/);
  assert.match(renderer, /Share anonymized log/);
  assert.match(renderer, /Anyone with the resulting link may view it/);
  assert.match(html, /id="dp-stop-game"/);
  assert.match(components, /\.crash-recovery-grid/);
});

test('Pine and Modrinth archives expose validated branded import flows', () => {
  assert.match(html, /id="library-import-btn"/);
  assert.match(renderer, /function openPineImport\(\)/);
  assert.match(preload, /importModrinthArchive/);
  assert.match(main, /modrinth\.index\.json/);
  assert.match(main, /Hash verification failed/);
  assert.match(main, /The archive contains an unsafe path/);
  assert.match(components, /\.export-choice\.selected/);
});

test('launcher discovery covers major launchers and clients without duplicate imports', () => {
  for (const label of ['Lunar Client', 'Badlion Client', 'Feather / Dawn Client', 'Fast Client', 'TLauncher', 'SKlauncher', 'Technic Launcher', 'FTB App', 'PolyMC', 'LabyMod']) {
    assert.match(main, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(main, /function discoverLauncherCandidates/);
  assert.match(main, /const seen = new Set\(\)/);
});

test('Library sorting and instance actions use Pine navigation surfaces', () => {
  assert.match(html, /id="library-sort-indicator"/);
  assert.match(html, /class="library-sort-option active"/);
  assert.doesNotMatch(html, /<select id="library-sort"/);
  assert.match(renderer, /function moveLibrarySortIndicator\(\)/);
  assert.match(html, /class="sheet-action-dock"/);
  assert.match(components, /\.library-sort-indicator/);
  assert.match(components, /\.sheet-action-indicator/);
});

test('Library groups persist independently and render as four-tile mosaics', () => {
  assert.match(html, /id="library-make-group-btn"/);
  assert.match(html, /id="library-groups-grid"/);
  assert.match(html, /id="modal-group"/);
  assert.match(html, /<select id="edit-group"/);
  assert.match(preload, /listGroups/);
  assert.match(preload, /createGroup/);
  assert.match(main, /const GROUPS_FILE/);
  assert.match(main, /ipcMain\.handle\('create-group'/);
  assert.match(renderer, /members\.length > 4[\s\S]*?members\.length - 3/);
  assert.match(renderer, /Array\.from\(\{ length: 4 \}/);
  assert.match(components, /\.group-card\s*\{[\s\S]*?aspect-ratio:\s*1/);
  assert.match(components, /\.group-mosaic\s*\{[\s\S]*?grid-template-columns:\s*1fr 1fr/);
});

test('deleting a group keeps its instances and returns them to the main Library', () => {
  assert.match(preload, /deleteGroup/);
  assert.match(main, /ipcMain\.handle\('delete-group'/);
  assert.match(main, /instance\.group = ''/);
  assert.match(main, /return \{ deleted: true, name, ungrouped \}/);
  assert.match(renderer, /function openDeleteGroupModal/);
  assert.match(renderer, /The group will be removed, not its instances/);
  assert.match(renderer, /data-delete-group/);
  assert.match(components, /\.group-card-delete/);
  assert.match(components, /\.library-group-delete/);
});

test('global launcher search indexes instance tags and group names', () => {
  assert.match(renderer, /const searchable = \[inst\.name, inst\.group, inst\.loader, inst\.gameVersion, \.\.\.tags\]/);
  assert.match(renderer, /tags\.map\(tag => `#\$\{tag\}`\)/);
  assert.match(renderer, /kind: 'group'/);
  assert.match(html, /Search instances, tags, servers/);
});

test('managed modpacks expose complete lifecycle controls and preserve user files', () => {
  assert.match(preload, /getManagedPackStatus/);
  assert.match(preload, /changeManagedPackVersion/);
  assert.match(preload, /rollbackManagedPack/);
  assert.match(preload, /installModrinthModpack/);
  assert.match(main, /ipcMain\.handle\('get-managed-pack-status'/);
  assert.match(main, /ipcMain\.handle\('change-managed-pack-version'/);
  assert.match(main, /ipcMain\.handle\('rollback-managed-pack'/);
  assert.match(main, /const previousManaged = managedFilesForInstance\(instance\)[\s\S]*?removeManagedFiles\(staging, previousManaged\)/);
  assert.match(main, /userAddedFiles: nextOwnership\.userAdded/);
  assert.match(main, /createAutomaticInstanceBackup\(instance, `Before changing/);
  assert.match(main, /assertManagedMutationAllowed/);
  assert.match(renderer, /Update pack/);
  assert.match(renderer, /Change version/);
  assert.match(renderer, /Reinstall pack/);
  assert.match(renderer, /Roll back to/);
  assert.match(renderer, /keep worlds and user-added files/);
  assert.match(components, /\.managed-pack-card/);
  assert.match(components, /\.pack-health-grid/);
});

test('NeoForge has verified installation, exact compatibility, and a complete loader lifecycle', () => {
  assert.match(renderer, /id: 'neoforge', label: 'NeoForge'/);
  assert.match(main, /async function prepareNeoForge/);
  assert.match(main, /neoforge-\$\{version\}-installer\.jar/);
  assert.match(main, /findNeoForgeProfile/);
  assert.match(main, /isNeoForgeVersionForMinecraft/);
  assert.match(main, /NeoForge installer failed checksum verification/);
  assert.match(main, /ipcMain\.handle\('get-neoforge-status'/);
  assert.match(main, /ipcMain\.handle\('change-neoforge-version'/);
  assert.match(main, /ipcMain\.handle\('repair-neoforge'/);
  assert.match(main, /ipcMain\.handle\('rollback-neoforge'/);
  assert.match(main, /createAutomaticInstanceBackup\(instance, reason\)/);
  assert.match(main, /restoreBackup\(\{ backupsDir: BACKUPS_DIR, instance, instanceDir, id: backup\.id \}\)/);
  assert.match(main, /withNeoForgeOperation/);
  assert.match(main, /Wait for the NeoForge operation to finish before launching/);
  assert.match(preload, /getNeoForgeStatus/);
  assert.match(preload, /changeNeoForgeVersion/);
  assert.match(preload, /repairNeoForge/);
  assert.match(preload, /rollbackNeoForge/);
  assert.match(renderer, /function loadNeoForgePanel/);
  assert.match(renderer, /data-neoforge-repair/);
  assert.match(renderer, /data-neoforge-rollback/);
  assert.match(components, /\.neoforge-loader-card/);
  assert.doesNotMatch(main, /NeoForge launching is not available/);
});

test('step five adds selective copies, bulk organization, and complete playtime surfaces', () => {
  assert.match(html, /id="library-select-btn"/);
  assert.match(html, /id="library-bulk-bar"/);
  assert.match(html, /data-sort="playtime"/);
  assert.match(preload, /bulkUpdateInstances/);
  assert.match(preload, /bulkDeleteInstances/);
  assert.match(main, /ipcMain\.handle\('bulk-update-instances'/);
  assert.match(main, /ipcMain\.handle\('bulk-delete-instances'/);
  assert.match(main, /createDuplicationFilter\(options\.components\)/);
  assert.match(renderer, /data-copy-component/);
  assert.match(renderer, /lastSessionSeconds/);
  assert.match(components, /\.instance-card\.selected/);
  assert.match(components, /\.duplicate-component-grid/);
});

test('step six manages worlds with guarded renames, data packs, screenshots, and downgrades', () => {
  assert.match(html, /id="worlds-backup-btn"/);
  assert.match(html, /id="worlds-screenshots-btn"/);
  assert.match(preload, /renameWorld/);
  assert.match(preload, /installWorldDatapackFile/);
  assert.match(preload, /installModrinthDatapack/);
  assert.match(main, /ipcMain\.handle\('rename-world'/);
  assert.match(main, /ipcMain\.handle\('install-world-datapack-file'/);
  assert.match(main, /ipcMain\.handle\('install-modrinth-datapack'/);
  assert.match(main, /WORLD_DOWNGRADE_CONFIRMATION_REQUIRED/);
  assert.match(main, /Before opening \$\{world\.name\} in older Minecraft/);
  assert.match(renderer, /function openWorldDatapackChooser/);
  assert.match(renderer, /world-downgrade-warning/);
  assert.match(components, /\.world-downgrade-warning/);
  assert.match(renderer, /const actionButton = event\.currentTarget/);
  assert.match(renderer, /actionButton\.isConnected[\s\S]*?actionButton\.disabled = false/);
  assert.match(renderer, /class="world-action-dock"/);
  assert.match(renderer, /class="world-more-menu"/);
  assert.match(components, /#worlds-grid[\s\S]*?minmax\(min\(470px, 100%\), 1fr\)/);
});
