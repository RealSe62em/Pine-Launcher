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

test('updates section hides the unrelated settings save button', () => {
  assert.match(renderer, /syncSettingsHeaderSave\(btn\.dataset\.cat\)/);
  assert.match(renderer, /headerSave\.hidden = category === 'updates'/);
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
  assert.match(main, /fs\.promises\.rm\(deletionTarget/);
  assert.match(components, /destination-card\.has-detail \.destination-address/);
  assert.match(components, /@keyframes destination-name-set/);
  assert.match(components, /backdrop-filter:\s*blur\(30px\) saturate\(185%\) contrast\(108%\)/);
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
});

test('CurseForge and private integration settings are not exposed in the launcher UI', () => {
  assert.doesNotMatch(html, /catalog-source|CurseForge/i);
  assert.doesNotMatch(renderer, /data-cat="integrations"|set-curseforge-key|searchCurseForge\(/i);
  assert.doesNotMatch(website, /CurseForge/i);
  assert.match(renderer, /api\.searchMods\(query, facets, state\.searchOffset, SEARCH_LIMIT, sort\)/);
});
