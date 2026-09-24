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
const features = read('renderer/styles/features.css');
const preload = read('preload.js');
const main = read('main.js');
const website = read('website/index.html');

test('custom install location keeps browse controls visually separate from the path field', () => {
  assert.match(html, /class="instance-location-actions"/);
  assert.match(styles, /\.instance-location-row\s*\{[^}]*gap:\s*14px/s);
});

test('Home library heading navigates to the full Library view', () => {
  assert.match(html, /id="home-library-link"[^>]*data-view="library"[^>]*type="button"/);
  assert.match(html, /id="home-library-link"[\s\S]*?<h2>Your library<\/h2>[\s\S]*?View all/);
  assert.match(renderer, /document\.querySelectorAll\('\[data-view\]'\)[\s\S]*?switchView\(el\.dataset\.view\)/);
  assert.match(components, /\.home-library-link\s*\{[\s\S]*?width:\s*100%/);
});

test('Library split workspace persists four independent panes and copies instance items safely', () => {
  assert.match(html, /id="library-create-btn"[\s\S]*?id="library-split-btn"/);
  assert.match(html, /id="split-workspace"[^>]*hidden/);
  assert.match(renderer, /const SPLIT_WORKSPACE_STORAGE_KEY = 'pine\.split-workspace\.v1'/);
  assert.match(renderer, /state\.splitPanes\.length < 4/);
  assert.match(renderer, /state\.splitPanes = \[newSplitPane\(\), newSplitPane\(\)\]/);
  assert.match(renderer, /state\.splitWorkspaceActive && view === state\.splitWorkspaceDock\) renderSplitWorkspace\(\);\s*else hideSplitWorkspace\(\)/);
  assert.match(renderer, /state\.splitWorkspaceDock = 'instance';\s*state\.splitPanes = \[newSplitPane\(\), newSplitPane\(\)\]/);
  assert.match(renderer, /saveSplitWorkspace\(\);\s*switchView\('instance'\);\s*renderSplitWorkspace\(\)/);
  assert.doesNotMatch(renderer, /stored\.dock !== 'instance'/);
  assert.match(renderer, /data-split-sort=/);
  assert.match(renderer, /data-split-group=/);
  assert.match(renderer, /application\/x-pine-instance-item/);
  assert.match(renderer, /application\/x-pine-split-pane/);
  assert.match(renderer, /data-split-reorder=/);
  assert.match(renderer, /function swapSplitPanes\(sourceId, targetId\)/);
  assert.match(renderer, /data-split-item-query=/);
  assert.match(renderer, /function beginSplitResize\(event, axis\)/);
  assert.match(renderer, /data-split-resize=/);
  assert.match(renderer, /api\.copyInstanceItems\(payload\.sourceInstance, target\.instanceName/);
  assert.match(preload, /copyInstanceItems:[\s\S]*?ipcRenderer\.invoke\('copy-instance-items'/);
  assert.match(main, /ipcMain\.handle\('copy-instance-items'/);
  assert.match(main, /String\(item\.key \|\| item\.filename \|\| ''\) === requestedKey/);
  assert.match(main, /assertManagedMutationAllowed\(destinationRecord/);
  assert.match(features, /\.split-grid\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(features, /\.split-workspace\s*\{[^}]*height:clamp\(440px,calc\(100dvh - 230px\),820px\)/);
  assert.match(features, /\.split-library-list,\.split-item-list\s*\{[^}]*overflow:auto/);
  assert.match(features, /\.split-item-search\s*\{/);
  assert.match(features, /\.split-resize-column\s*\{/);
  assert.match(features, /\.split-resize-row\s*\{/);
  assert.match(features, /\.split-pane\.split-drop-target::after/);
  assert.ok(fs.existsSync(path.join(root, 'lib', 'instance-item-copy.js')));
});

test('top navigation hover uses the transparent Pine tree mark', () => {
  assert.match(read('renderer/styles/shell.css'), /\.brand-mark\s*\{[\s\S]*?background-image:\s*url\('\.\.\/pine-tree-logo\.png'\)/);
  assert.match(read('renderer/styles/shell.css'), /\.brand-mark\s*\{[\s\S]*?background-size:\s*contain/);
  assert.ok(fs.existsSync(path.join(root, 'renderer', 'pine-tree-logo.png')));
  assert.match(fs.readFileSync(path.join(root, 'renderer', 'pine-tree-logo.png')).subarray(1, 4).toString(), /PNG/);
});

test('launcher uses integrated cross-platform window controls', () => {
  assert.match(main, /frame:\s*false/);
  assert.match(main, /ipcMain\.handle\('window-control'/);
  assert.match(preload, /windowControl:\s*\(action\)/);
  assert.match(preload, /onWindowMaximizedChanged/);
  assert.match(html, /class="window-drag-region"/);
  assert.match(html, /id="notifications-button"[\s\S]*?aria-label="Notifications"/);
  assert.match(html, /id="discord-button"[\s\S]*?<svg width="24" height="24" viewBox="1 3\.5 22 16"/);
  assert.match(preload, /openDiscordServer:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('open-discord-server'\)/);
  assert.match(main, /ipcMain\.handle\('open-discord-server'[\s\S]*?shell\.openExternal\(DISCORD_SERVER_URL\)/);
  assert.match(renderer, /\$\('discord-button'\)[\s\S]*?api\.openDiscordServer\(\)/);
  for (const action of ['minimize', 'maximize', 'close']) {
    assert.match(html, new RegExp(`data-window-action="${action}"`));
  }
  assert.match(renderer, /function bindWindowChrome\(\)/);
  assert.match(read('renderer/styles/shell.css'), /\.window-drag-region\s*\{[\s\S]*?-webkit-app-region:\s*drag/);
  assert.match(read('renderer/styles/shell.css'), /\.window-controls\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/);
  assert.match(read('renderer/styles/shell.css'), /\.window-control\s*\{[\s\S]*?width:\s*var\(--topbar-h\);[\s\S]*?height:\s*var\(--topbar-h\)/);
  assert.match(read('renderer/styles/shell.css'), /\.topbar\s*\{[\s\S]*?min-width:\s*min\(900px, calc\(100% - 530px\)\)[\s\S]*?width:\s*max-content[\s\S]*?max-width:\s*min\(1180px, calc\(100% - 180px\)\)/);
  assert.match(read('renderer/styles/shell.css'), /#playing-pill-name\s*\{[\s\S]*?max-width:\s*clamp\(140px, 22vw, 380px\)[\s\S]*?text-overflow:\s*ellipsis/);
  assert.doesNotMatch(read('renderer/styles/shell.css'), /\.app \.topbar\s*\{[\s\S]*?left:\s*16px/);
  assert.match(read('renderer/styles/shell.css'), /\.topbar-discord\s*\{/);
  assert.match(read('renderer/styles/shell.css'), /\.topbar-discord svg\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*fill:\s*currentColor/);
  assert.match(html, /id="discord-button"[\s\S]*?<svg width="24" height="24" viewBox="1 3\.5 22 16"[\s\S]*?<path/);
  assert.match(html, /id="activity-center"[\s\S]*?id="activity-list"[\s\S]*?id="activity-empty"/);
  assert.match(renderer, /const ACTIVITY_STORAGE_KEY/);
  assert.match(renderer, /api\.onDownloadJobs\?\.\(syncDownloadActivities\)/);
  assert.match(renderer, /api\.onInstallProgress\?\.\(handleInstallActivity\)/);
  assert.match(renderer, /title:\s*`Creating \$\{name\}`[\s\S]*?status:\s*'done'/);
  assert.match(renderer, /data-toggle-activity/);
  assert.match(renderer, /function activityItemType\(item\)/);
  assert.match(read('renderer/styles/shell.css'), /\.activity-expand\s*\{/);
  assert.match(main, /sendInstallProgress\(instance\.name,[\s\S]*?\{ items: installed \}\)/);
  assert.match(main, /role:\s*requestedRole/);
});

test('instance creation reports every missing required field together', () => {
  assert.match(renderer, /const missing = \[\]/);
  assert.match(renderer, /if \(!name\) missing\.push/);
  assert.match(renderer, /if \(!version\) missing\.push/);
  assert.match(renderer, /state\.selectedLoader !== 'vanilla' && !loaderVer/);
  assert.match(renderer, /missing\.map\(item => item\.message\)\.join\('; '\)/);
  assert.match(renderer, /first\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.match(components, /\.create-field-invalid\s*\{[\s\S]*?var\(--danger\)/);
});

test('loader selection retries failures and requests versions when a profile changes', () => {
  assert.match(renderer, /Could not load — click to retry/);
  assert.match(renderer, /function selectProfile[\s\S]*?loadLoaderVersions\(\);\s*\n\}/);
  assert.match(renderer, /selectedIdx = stableIdx >= 0 \? stableIdx : 0/);
  assert.match(main, /const loaderVersionCache = new Map\(\)/);
});

test('all curated presets are preflighted for the selected version and display skipped mods', () => {
  for (const profile of ['performance', 'beginner', 'builder', 'pvp']) {
    assert.match(html, new RegExp(`data-profile="${profile}"`));
  }
  assert.match(preload, /checkInstancePreset/);
  assert.match(main, /ipcMain\.handle\('check-instance-preset'/);
  assert.match(renderer, /refreshPresetCompatibility\(\)/);
  assert.match(renderer, /will be installed · \$\{preview\.excluded\.length\} will be skipped/);
  assert.match(renderer, /Skipped · \$\{escHtml\(item\.reason\)\}/);
  assert.match(renderer, /state\.presetCompatibility\.included\.find/);
  assert.doesNotMatch(renderer, /const PERFORMANCE_MODS/);
  assert.match(html, /class="modal create-instance-modal"/);
  assert.match(components, /#modal-overlay \.create-instance-modal\s*\{[\s\S]*?width:\s*min\(760px/);
  assert.match(components, /\.profile-grid\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
});

test('launcher surfaces share one dialog, button, empty-state, and tab language', () => {
  const buttonRule = components.match(/\.btn\s*\{([^}]*)\}/)?.[1] || '';
  const modalRootRule = components.match(/\.modal-root\s*\{([^}]*)\}/)?.[1] || '';
  const modalRule = components.match(/\.modal\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(buttonRule, /align-items:\s*center/);
  assert.match(modalRootRule, /align-items:\s*flex-end/);
  assert.match(modalRootRule, /backdrop-filter:\s*none/);
  assert.match(modalRule, /border-radius:\s*var\(--r-xl\)/);
  assert.match(modalRule, /animation:\s*sheet-up/);
  assert.equal((components.match(/^\.btn-icon\s*\{/gm) || []).length, 1);
  assert.doesNotMatch(renderer, /class="modal" style="max-width/);
  assert.doesNotMatch(renderer, /class="modal-(?:card|head|actions)"|class="icon-btn"/);
  assert.match(renderer, /function bindAccessibleLayers\(\)/);
  assert.match(renderer, /function bindTabKeys\(host, selector\)/);
  assert.match(renderer, /function emptyStateMarkup\(title, copy, icon/);
  assert.match(html, /id="instance-tabs"[^>]*role="tablist"/);
  assert.match(html, /data-content-type="mod"[^>]*role="tab"[^>]*aria-selected="true"/);
  assert.match(html, /class="btn btn-secondary"[^>]*id="hero-create-btn"/);
  assert.match(html, /class="btn btn-primary"[^>]*id="library-create-btn"/);
  assert.match(read('renderer/features.js'), /class="modal-close"/);
});

test('discover search focus stays inside its pill without a Linux first-frame flash', () => {
  const searchInputRule = components.match(/\.search-container-input\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(searchInputRule, /flex:\s*1 1 0/);
  assert.match(searchInputRule, /min-width:\s*0/);
  assert.match(searchInputRule, /box-shadow:\s*none/);
  assert.match(components, /\.search-container-input:hover,\s*\.search-container-input:focus,\s*\.search-container-input:focus-visible\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s);
  assert.doesNotMatch(components, /(?:^|,)\s*input:hover\s*(?:,|\{)/m);
  assert.doesNotMatch(components, /(?:^|,)\s*input:focus\s*(?:,|\{)/m);
  assert.match(preload, /platform:\s*process\.platform/);
  assert.match(renderer, /document\.documentElement\.dataset\.platform\s*=\s*api\?\.platform/);
  assert.match(components, /html\[data-platform="linux"\] \.search-container\s*\{[^}]*backdrop-filter:\s*none/s);
});

test('startup restores the selected account rather than only listing account names', () => {
  assert.match(renderer, /Promise\.all\(\[api\.listAccounts\(\), api\.getAuth\(\)\]\)/);
  assert.match(renderer, /state\.authData = selected \|\| null/);
  assert.match(renderer, /refreshAccounts\(\)[\s\S]*?updateAuthUI\(\)/);
});

test('nonfatal mod compatibility findings stay in diagnostics and launch logs', () => {
  assert.match(main, /inspectLaunchMods\(modsDir, instance\.loader, instance\.gameVersion\)[\s\S]*?modInspection\.duplicates[\s\S]*?diagnosticLog\('WARN', warning\)[\s\S]*?send\('launch-log'/);
  assert.doesNotMatch(main, /send\('launch-warning'/);
  const warningHandler = renderer.match(/api\.onLaunchWarning\([\s\S]*?\n\s*\}\);/)?.[0] || '';
  assert.match(warningHandler, /appendLog/);
  assert.doesNotMatch(warningHandler, /toast|setStatus/);
});

test('launch validation survives ordinary cache clearing and application updates', () => {
  assert.match(main, /LAUNCH_VALIDATION_CACHE_FILE = path\.join\(GLOBAL_DIR, '\.pine', 'launch-validation\.json'\)/);
  assert.match(main, /LEGACY_LAUNCH_VALIDATION_CACHE_FILE/);
  assert.match(main, /clear-download-cache[\s\S]*?path\.join\(app\.getPath\('userData'\), 'cache'\)/);
});

test('installing a mod during play reports restart behavior and repairs interrupted files', () => {
  assert.match(main, /restartRequired = activeInstanceName === instance.name/);
  assert.match(main, /fileMatchesExpectedHash\(filePath, file\.hashes\)/);
  assert.match(main, /Replacing incomplete or unverified existing content file/);
  assert.match(renderer, /will apply on the next launch from Pine/);
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

test('global and per-instance memory use the same dual-handle range control', () => {
  assert.match(preload, /getSystemMemoryGb:\s*\(\) => ipcRenderer\.invoke\('get-system-memory-gb'\)/);
  assert.match(main, /ipcMain\.handle\('get-system-memory-gb'/);
  assert.match(renderer, /function memoryRangeMarkup\(prefix, minValue, maxValue\)/);
  assert.match(renderer, /memoryRangeMarkup\('set'/);
  assert.match(renderer, /memoryRangeMarkup\('inst'/);
  assert.match(renderer, /function bindMemoryRange\(prefix\)/);
  assert.match(renderer, /<b>Min<\/b>/);
  assert.match(renderer, /<b>Max<\/b>/);
  assert.match(renderer, /class="memory-range-input memory-range-input-min"/);
  assert.match(renderer, /class="memory-range-input memory-range-input-max"/);
  assert.match(components, /\.memory-range-input-max/);
  assert.match(components, /\.memory-handle-label[\s\S]*?left:\s*calc\(var\(--memory-min\) \* 1%\)/);
  assert.match(components, /\.memory-max-label\s*\{\s*left:\s*calc\(var\(--memory-max\) \* 1%\)/);
});

test('instance Mods accepts verified local JARs through a themed copy drop zone', () => {
  assert.match(preload, /webUtils\.getPathForFile\(file\)/);
  assert.match(preload, /copyModFiles:\s*\(instanceName, filePaths\) => ipcRenderer\.invoke\('copy-mod-files'/);
  assert.match(main, /ipcMain\.handle\('copy-mod-files'/);
  assert.match(main, /copyDroppedMods\(\{/);
  assert.match(html, /id="mod-drop-zone"[\s\S]*?Drop mods to copy them/);
  assert.match(renderer, /function bindModDropZone\(\)/);
  assert.match(renderer, /event\.dataTransfer\.dropEffect = 'copy'/);
  assert.match(renderer, /await api\.copyModFiles\(instanceName, filePaths\)/);
  assert.match(components, /\.mod-drop-zone\s*\{[\s\S]*?border:\s*2px dashed/);
});

test('Discover includes legacy releases and provider-aware classic mod results', () => {
  assert.match(renderer, /for \(const version of releases\) filterVer\.add/);
  assert.doesNotMatch(renderer, /releases\.slice\(0, 30\)/);
  assert.match(renderer, /versionSel\.value = gameVersion/);
  assert.match(renderer, /Promise\.allSettled\(\[\s*api\.searchMods[\s\S]*?api\.searchCurseForge/);
  assert.match(renderer, /function officialDiscoverResults\(query, version, loader, category/);
  assert.match(renderer, /project_id: 'official:optifine'/);
  assert.match(preload, /getOptiFineBuilds:\s*\(gameVersion\) => ipcRenderer\.invoke\('get-optifine-builds'/);
  assert.match(preload, /installOptiFine:\s*\(instanceName, filename\) => ipcRenderer\.invoke\('install-optifine'/);
  assert.match(main, /ipcMain\.handle\('get-optifine-builds'/);
  assert.match(main, /ipcMain\.handle\('install-optifine'/);
  assert.match(main, /getOptiFineDownloadUrl\(filename\)/);
  assert.match(renderer, /await api\.installOptiFine\(instanceName, buildSelect\.value\)/);
  assert.match(renderer, /Downloaded directly from OptiFine/);
  assert.match(main, /if \(!curseForgeApiKey\(\)\) return \{ hits: \[\], total_hits: 0, configured: false \}/);
  assert.match(main, /'optifine\.net', 'www\.optifine\.net'/);
  assert.match(components, /\.official-mod-card/);
  assert.match(components, /\.official-mod-notice/);
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

test('export choices center fixed-size icons without applying text-column alignment', () => {
  assert.match(components, /\.export-choice > \.export-choice-icon\s*\{[^}]*flex:\s*0 0 38px[^}]*display:\s*grid[^}]*place-items:\s*center[^}]*align-self:\s*center/s);
  assert.match(components, /\.export-choice > \.export-choice-icon svg\s*\{[^}]*display:\s*block[^}]*width:\s*20px[^}]*height:\s*20px/s);
  assert.match(components, /\.export-choice > \.choice-check\s*\{[^}]*flex:\s*0 0 24px[^}]*display:\s*grid[^}]*place-items:\s*center[^}]*align-self:\s*center/s);
  assert.match(components, /\.export-choice > \.choice-check svg\s*\{[^}]*display:\s*block[^}]*width:\s*14px[^}]*height:\s*14px/s);
});

test('share recipes resolve resource packs and present reviewable download cards', () => {
  const features = read('renderer/features.js');
  const featureStyles = read('renderer/styles/features.css');
  assert.match(main, /readJSON\(path\.join\(root, 'content_meta\.json'\)\)/);
  assert.match(main, /version_file\/\$\{sha1\}\?algorithm=sha1/);
  assert.match(main, /project_type:resourcepack/);
  assert.match(main, /searchResourcePackCandidates\(instance, item\)/);
  assert.match(preload, /getRecipePreview:\s*\(name, resourcepackMatches\)/);
  assert.match(features, /class="recipe-section"/);
  assert.match(features, /class="recipe-unavailable"/);
  assert.match(features, /Is this the resource pack you want the recipe to download\?/);
  assert.match(features, /resourcepackMatches:\s*Object\.fromEntries\(selectedMatches\)/);
  assert.doesNotMatch(features, /JSON\.stringify\(recipe\.omitted/);
  assert.match(featureStyles, /\.recipe-file-list/);
  assert.match(featureStyles, /\.recipe-candidate\.selected/);
});

test('instance settings keeps consistent space between form sections', () => {
  assert.match(components, /#edit-sheet-body\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*gap:\s*var\(--s-4\)/s);
  assert.match(components, /#edit-sheet-body > \.upload-grid\s*\{\s*margin-bottom:\s*0/);
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

test('account menu paginates saved accounts in stable six-row pages', () => {
  assert.match(renderer, /const ACCOUNT_PAGE_SIZE = 6/);
  assert.match(renderer, /state\.accounts\.slice\(start, start \+ ACCOUNT_PAGE_SIZE\)/);
  assert.match(renderer, /Page \$\{state\.accountPage \+ 1\} of \$\{pageCount\}/);
  assert.match(renderer, /data-act="account-prev"/);
  assert.match(renderer, /data-act="account-next"/);
  assert.doesNotMatch(renderer, /accountsExpanded|toggle-more|account-extra/);
  assert.match(components, /\.account-switch-row\s*\{[^}]*flex:\s*0 0 50px[^}]*min-height:\s*50px/s);
  assert.match(components, /\.account-pagination\s*\{/);
});

test('async mod update checks immediately re-render the visible list', () => {
  assert.match(renderer, /async function checkForModUpdates[\s\S]*?renderContentList\(\);/);
});

test('content offers an actionable whole-instance mod compatibility check', () => {
  assert.match(html, /id="check-mod-compatibility"[\s\S]*?Check compatibility/);
  assert.match(preload, /checkModCompatibility:\s*\(instanceName\)/);
  assert.match(main, /ipcMain\.handle\('check-mod-compatibility'/);
  assert.match(main, /type:\s*'replace'[\s\S]*?versionId/);
  assert.match(main, /MISSING_DEPENDENCY|PROVIDER_MISSING_DEPENDENCY/);
  assert.match(main, /DUPLICATE_MOD_ID/);
  assert.match(main, /WRONG_LOADER/);
  assert.match(main, /PROVIDER_VERSION_MISMATCH/);
  assert.match(main, /DECLARED_CONFLICT/);
  assert.match(renderer, /function openModCompatibilityCheck\(\)/);
  assert.match(renderer, /function applyCompatibilityAction\(action, finding, overlay\)/);
  assert.match(renderer, /createBackup:\s*true, backupReason:/);
  assert.match(components, /\.compatibility-finding\s*\{/);
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
  assert.match(renderer, /destination-server-status/);
  assert.match(renderer, /status\.players/);
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
  assert.match(components, /\.destination-grid\s*\{[\s\S]*?padding:\s*10px[\s\S]*?contain:\s*layout paint style/);
  assert.match(components, /\.destination-card\s*\{[\s\S]*?contain:\s*layout style/);
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
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncherSetup-x64\.exe/);
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncherSetup-arm64\.exe/);
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncher-1\.2\.8-linux-amd64\.deb/);
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncher-1\.2\.8-linux-arm64\.deb/);
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncher-1\.2\.8-archlinux-x64\.pacman/);
  assert.match(website, /data-hash="9437104F80FA048CB4638E214CB091ECC4172F41F36746BA40CCA5D1B5A12377"/);
  assert.match(website, /virustotal\.com\/gui\/file\/9437104f80fa048cb4638e214cb091ecc4172f41f36746ba40cca5d1b5a12377/);
  assert.doesNotMatch(website, /data-build="universal"|Download universal installer/);
});

test('ordinary users are not asked to configure third-party credentials', () => {
  assert.doesNotMatch(renderer, /data-cat="integrations"|curseforge-api-key|saveCurseForgeKey|testCurseForgeKey/);
  assert.doesNotMatch(preload, /getIntegrationStatus|saveCurseForgeKey|testCurseForgeKey/);
  assert.doesNotMatch(main, /INTEGRATION_SECRETS_FILE|save-curseforge-key|test-curseforge-key/);
  assert.doesNotMatch(read('README.md'), /Settings → Integrations|approved third-party API key/);
  assert.doesNotMatch(website, /CurseForge/i);
  assert.match(renderer, /api\.searchMods\(query, facets, state\.searchOffset, SEARCH_LIMIT, sort\)/);
});

test('high-density home and performance surfaces avoid live scrolling blur', () => {
  assert.match(renderer, /classList\.toggle\('is-scrolling', optimizeHomeScroll\)/);
  assert.match(renderer, /requestAnimationFrame\(\(\) => \{[\s\S]*?lastScrollY = y/);
  assert.match(read('renderer/styles/base.css'), /html\.is-scrolling body::after\s*\{\s*opacity:\s*0/);
  assert.match(read('renderer/styles/shell.css'), /html\.is-scrolling \.topbar\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.doesNotMatch(read('renderer/styles/shell.css'), /html\.is-scrolling \.tabbar\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.doesNotMatch(read('renderer/styles/shell.css'), /html\.is-scrolling \.main \*/);
  assert.match(read('renderer/styles/shell.css'), /\.main\s*\{[\s\S]*?scroll-behavior:\s*auto/);
  assert.match(components, /#modal-overlay\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(components, /#modal-overlay \.create-instance-modal\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(components, /\.perf-mods-list\s*\{[^}]*contain:\s*layout paint style/);
  assert.match(components, /\.destination-actions\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(components, /\.destination-card\s*\{[\s\S]*?transform:\s*translateZ\(0\)/);
  assert.match(components, /html\.is-scrolling \.destination-grid\s*\{\s*pointer-events:\s*none/);
  assert.match(components, /#view-home \.instance-card\s*\{[\s\S]*?content-visibility:\s*auto/);
  assert.match(components, /#view-home \.recent-card\s*\{[\s\S]*?content-visibility:\s*auto/);
  assert.match(renderer, /directionStartY - y >= 42/);
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
  assert.match(renderer, /Go create an instance, then return to Discover and select the mod again/);
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
  assert.match(renderer, /class="btn btn-primary backup-create-button"/);
  assert.doesNotMatch(components, /\.backup-create-button\s*\{[^}]*background:/);
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

test('Linux update checks download and install the verified native package inside Pine', () => {
  assert.match(main, /downloadLinuxUpdate: downloadLinuxReleasePackage/);
  assert.match(main, /installLinuxUpdate: installLinuxReleasePackage/);
  assert.match(main, /failed SHA-256 verification/);
  assert.match(main, /execFile\('pkexec'/);
  assert.match(renderer, /if \(next\?\.status === 'downloaded'\) next = await api\.installUpdate\(\)/);
  assert.doesNotMatch(renderer, /Open GitHub release|openUpdateDownload/);
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
  assert.match(renderer, /previewPackUpdate\(instance.name, versionId\)/);
  assert.match(renderer, /changeManagedPackVersion\(instance.name, versionId, fingerprint\)/);
  assert.match(renderer, /const installRequest = api\.installModrinthModpack[\s\S]*?close\(\);[\s\S]*?await installRequest/);
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
  assert.match(main, /runBackupInWorker\('restore', \{ backupsDir: BACKUPS_DIR, instance, instanceDir, id: backup\.id \}\)/);
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

test('instance settings offer safe beta version migration into a separate copy', () => {
  assert.match(preload, /migrateInstanceVersion/);
  assert.match(preload, /onMigrationProgress/);
  assert.match(main, /ipcMain\.handle\('migrate-instance-version'/);
  assert.match(main, /include: createMigrationFilter\(\)/);
  assert.match(main, /migratedFrom:/);
  assert.match(renderer, /id="migrate-instance-version"/);
  assert.match(renderer, /Beta testing/);
  assert.match(renderer, /function openVersionMigrationDialog/);
  assert.match(read('renderer\/styles\/features.css'), /\.migration-beta-warning/);
});

test('play statistics have a dedicated navigation view backed by recorded sessions', () => {
  assert.match(html, /data-view="stats"[\s\S]*?<span>Stats<\/span>/);
  assert.match(html, /id="view-stats"[\s\S]*?id="stats-dashboard"/);
  assert.match(preload, /getPlayStats:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-play-stats'\)/);
  assert.match(main, /ipcMain\.handle\('get-play-stats'/);
  assert.match(main, /addPlaySession\(readJSON\(PLAY_STATS_FILE\)/);
  assert.match(renderer, /function renderPlayStats\(\)/);
  assert.match(renderer, /function statsRanking\(/);
  assert.match(read('renderer/styles/features.css'), /\.stats-daily-chart/);
  assert.match(read('renderer/styles/features.css'), /\.stats-donut/);
  assert.match(renderer, /STATS_HISTORY_DISMISSED_KEY/);
  assert.match(renderer, /data-dismiss-stats-history/);
});

test('Discover keeps Minecraft content and adds public, skin, and saved server libraries', () => {
  for (const mode of ['minecraft', 'servers', 'skins', 'saved']) assert.match(html, new RegExp(`data-discover-mode="${mode}"`));
  assert.match(html, /id="discover-minecraft-panel"[\s\S]*?id="discover-categories"/);
  assert.match(html, /id="discover-servers-panel"[\s\S]*?id="server-results-grid"/);
  assert.match(html, /id="server-provider-filter"[\s\S]*?Minecraft Java Servers[\s\S]*?GSM[\s\S]*?CraftSerwery\.pl[\s\S]*?Craftdex[\s\S]*?Pine Partner/);
  assert.match(html, /<select id="server-version-filter"[\s\S]*?All versions[\s\S]*?<\/select>/);
  assert.match(html, /id="discover-saved-panel"[\s\S]*?id="saved-server-grid"/);
  assert.match(html, /id="discover-skins-panel"[\s\S]*?id="skin-library-grid"/);
  assert.match(preload, /searchServerDirectory/);
  assert.match(preload, /addInstanceServer/);
  assert.match(preload, /getPublicServerStatus/);
  assert.match(preload, /browseSkinLibrary/);
  assert.match(preload, /lookupPlayerSkin/);
  assert.match(preload, /saveLibrarySkin/);
  assert.match(main, /ipcMain\.handle\('search-server-directory'/);
  assert.match(main, /https:\/\/minecraft-java-servers\.com\/api\/v1\/servers/);
  assert.match(main, /https:\/\/craftserwery\.pl\/api\/v1\/servers/);
  assert.match(main, /https:\/\/craftdex\.net\/servers\/servers\.json/);
  assert.match(main, /https:\/\/gsm\.kuryzhev\.cloud\/api\/minecraft\/servers/);
  assert.match(main, /name: 'Limitless Network', address: 'limitlessnet\.work'/);
  assert.match(main, /partner\.statusAddress = '185\.207\.164\.216:21336'/);
  assert.match(main, /source: 'Pine Partner', partner: true/);
  assert.match(main, /ipcMain\.handle\('add-instance-server'/);
  assert.match(main, /Close Minecraft before changing this instance server list/);
  assert.match(main, /ipcMain\.handle\('browse-skin-library'/);
  assert.match(main, /ipcMain\.handle\('lookup-player-skin'/);
  assert.match(main, /sessionserver\.mojang\.com\/session\/minecraft\/profile/);
  assert.match(main, /https:\/\/api\.mineskin\.org\/v2\/skins/);
  assert.match(main, /ipcMain\.handle\('save-library-skin'/);
  assert.match(renderer, /function setDiscoverMode\(mode\)/);
  assert.match(renderer, /const livePlayerSkinLookup = debounce\(username =>/);
  assert.match(renderer, /lookupPlayerSkin\(\{ username, silent: true \}\)/);
  assert.match(renderer, /const requestId = \+\+state\.skinPlayerRequestId/);
  assert.match(renderer, /Number\(Boolean\(b\.player\)\) - Number\(Boolean\(a\.player\)\)/);
  assert.match(renderer, /function renderServerDirectory\(\)/);
  assert.match(renderer, /function generatedServerBannerMarkup\(server\)/);
  assert.match(renderer, /const SERVER_BATCH_SIZE = 20/);
  assert.match(renderer, /function loadNextServerBatch\(\)/);
  assert.match(renderer, /function scheduleServerDirectoryRetry\(\)/);
  assert.match(renderer, /server-provider-filter/);
  assert.match(renderer, /for \(const version of releases\) serverVersionFilter\.add/);
  assert.match(renderer, /SERVER_METADATA_STORAGE_KEY/);
  assert.match(main, /failedSources/);
  assert.match(main, /failedSources\.length \? 5_000 : 5 \* 60_000/);
  assert.doesNotMatch(renderer, /mcapi\.tr\/api\/v1\/banner/);
  assert.match(renderer, /Add to server list/);
  assert.match(renderer, /server-partner-badge/);
  assert.match(renderer, /function renderSavedServers\(\)/);
  assert.match(renderer, /function renderSkinLibrary\(\)/);
  assert.match(renderer, /async function lookupPlayerSkin\(\{ username: requestedUsername = '', silent = false \} = \{\}\)/);
  assert.match(renderer, /function openLibrarySkinPreview\(skin\)/);
  assert.match(read('renderer/styles/features.css'), /\.discover-mode-tabs/);
  assert.match(read('renderer/styles/features.css'), /\.server-discovery-card/);
});

test('Instance is a permanent navigation destination with an unselected landing view', () => {
  assert.match(html, /data-view="instance" type="button" aria-label="Instance">/);
  assert.match(html, /id="instance-landing"/);
  assert.match(renderer, /function renderInstanceLanding\(\)/);
  assert.match(renderer, /Choose an instance/);
  assert.doesNotMatch(renderer, /instanceTab\.setAttribute\('hidden'/);
  assert.match(read('renderer/styles/shell.css'), /max-width:\s*590px/);
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

test('Discover mod cards browse and install compatible older versions', () => {
  assert.match(renderer, /data-act="versions"/);
  assert.match(renderer, /async function openModVersionBrowser/);
  assert.match(renderer, /api\.getProjectVersions\(projectId, \[instance\.loader\], \[instance\.gameVersion\]\)/);
  assert.match(renderer, /data-use-version/);
  assert.match(renderer, /data-version-instance-trigger/);
  assert.match(renderer, /data-version-instance-icon/);
  assert.match(renderer, /preferred\.iconData/);
  assert.match(renderer, /role="listbox"/);
  assert.match(renderer, /doInstallMod\(instance, projectId, \{\}, version\)/);
  assert.match(main, /The selected version does not belong to this project/);
  assert.match(components, /\.version-browser-row/);
  assert.match(components, /\.version-instance-menu/);
});

test('appearance colors persist and support presets plus a custom picker', () => {
  assert.match(renderer, /const ACCENT_PRESETS =/);
  assert.match(renderer, /id="set-custom-accent" type="color"/);
  assert.match(renderer, /state\.settingsDirty = true;[\s\S]*?saveAllSettings\(null, \{ silent: true \}\)/);
  assert.match(renderer, /--accent-grad/);
  assert.match(main, /accentColor: \/\^#\[0-9a-f\]\{6\}\$\/i/);
  assert.match(components, /\.custom-color-control/);
});

test('wardrobe, screenshot viewer, and sync controls keep their interactive states visible', () => {
  assert.match(main, /textures\.minecraft\.net/);
  assert.match(renderer, /host\.addEventListener\('pointermove'/);
  assert.match(renderer, /new lib\.SkinViewer/);
  assert.match(renderer, /viewer\.controls\.enableRotate = true/);
  assert.match(renderer, /hitCount >= 15/);
  assert.match(renderer, /triggerWardrobeCrystalEasterEgg/);
  assert.match(renderer, /zoomLevel = \(zoomLevel \+ 1\) % 3/);
  assert.match(renderer, /translate3d\(\$\{panX\}px,\$\{panY\}px,0\)/);
  assert.match(renderer, /check-visual.*?<svg aria-hidden="true"><use href="#i-check"/);
  assert.match(features, /\.skin-card-actions \{[^}]*align-items:center/);
  assert.match(features, /\.sync-choice input:checked \+ \.check-visual svg/);
  assert.match(features, /@keyframes wardrobe-fallout/);
});
