'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const website = fs.readFileSync(path.join(root, 'website', 'index.html'), 'utf8');
const websiteScript = fs.readFileSync(path.join(root, 'website', 'script.js'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'website', 'sitemap.xml'), 'utf8');

test('release uses the planned updater-visible version', () => {
  assert.equal(pkg.version, '1.2.9');
  assert.equal(pkg.dependencies['electron-updater'], '6.8.9');
  assert.equal(pkg.devDependencies.electron, '42.11.6');
  assert.match(builder, /electronVersion:\s*42\.11\.6/);
});

test('Windows builds publish GitHub updater metadata and differential packages', () => {
  assert.match(builder, /provider:\s*github/);
  assert.match(builder, /owner:\s*RealSe62em/);
  assert.match(builder, /repo:\s*Pine-Launcher/);
  assert.match(builder, /target:\s*nsis/);
  assert.match(pkg.scripts['build:installer:x64'], /--x64/);
  assert.match(pkg.scripts['build:installer:arm64'], /--arm64/);
  assert.match(workflow, /dist-native\/latest\.yml/);
  assert.match(workflow, /dist-native\/latest-arm64\.yml/);
  assert.match(workflow, /PineLauncherSetup-x64\.exe\.blockmap/);
  assert.match(workflow, /PineLauncherSetup-arm64\.exe\.blockmap/);
  assert.match(workflow, /latest\.yml' -Pattern '\^path: PineLauncherSetup-x64\\\.exe\$'/);
  assert.match(workflow, /latest-arm64\.yml' -Pattern '\^path: PineLauncherSetup-arm64\\\.exe\$'/);
  assert.match(workflow, /ALLOW_UNSIGNED_WINDOWS_RELEASES/);
  assert.match(workflow, /ALLOW_UNSIGNED_WINDOWS_RELEASES" -ne 'true'/);
  assert.doesNotMatch(workflow, /github\.ref_name.*-ne 'v1\.2\.8'/);
  assert.match(workflow, /steps\.windows-signing\.outputs\.enabled == 'true'/);
  assert.match(workflow, /Publishing explicitly approved unsigned Windows installers/);
});

test('Linux release builders install every native compression prerequisite', () => {
  assert.match(workflow, /apt-get install --yes libarchive-tools rpm zstd/);
  assert.match(pkg.scripts['build:rpm:x64'], /--linux rpm --x64/);
  assert.match(pkg.scripts['build:rpm:arm64'], /--linux rpm --arm64/);
  assert.match(builder, /target:\s*rpm[\s\S]*?- x64[\s\S]*?- arm64/);
});

test('Linux windows and packages share the Pine taskbar identity and icon', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.equal(pkg.desktopName, 'pine-launcher');
  assert.match(builder, /linux:[\s\S]*?syncDesktopName:\s*true/);
  assert.match(builder, /linux:[\s\S]*?icon:\s*build\/icons/);
  assert.match(builder, /StartupWMClass:\s*pine-launcher/);
  assert.match(main, /const LINUX_DESKTOP_ID = 'pine-launcher'/);
  assert.match(main, /app\.commandLine\.appendSwitch\('class', LINUX_DESKTOP_ID\)/);
  assert.match(main, /app\.setDesktopName\(`\$\{LINUX_DESKTOP_ID\}\.desktop`\)/);
  assert.match(main, /icon:\s*path\.join\(__dirname, 'icon\.png'\)/);
  for (const size of [16, 22, 24, 32, 36, 48, 64, 72, 96, 128, 192, 256, 512, 1024]) {
    const icon = fs.readFileSync(path.join(root, 'build', 'icons', `${size}x${size}.png`));
    assert.equal(icon.subarray(1, 4).toString(), 'PNG');
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
});

test('website fallbacks point at every 1.2.9 native installer', () => {
  assert.match(website, /data-release-version>1\.2\.9</);
  assert.match(website, /releases\/download\/v1\.2\.9\/PineLauncherSetup-x64\.exe/);
  assert.match(website, /releases\/download\/v1\.2\.9\/PineLauncherSetup-arm64\.exe/);
  assert.match(website, /releases\/download\/v1\.2\.9\/PineLauncher-1\.2\.9-linux-amd64\.deb/);
  assert.match(website, /releases\/download\/v1\.2\.9\/PineLauncher-1\.2\.9-linux-arm64\.deb/);
  assert.match(website, /releases\/download\/v1\.2\.9\/PineLauncher-1\.2\.9-archlinux-x64\.pacman/);
  assert.match(website, /releases\/download\/v1\.2\.9\/PineLauncher-1\.2\.9-fedora-x86_64\.rpm/);
  assert.match(website, /releases\/download\/v1\.2\.9\/PineLauncher-1\.2\.9-fedora-aarch64\.rpm/);
  assert.match(websiteScript, /const FALLBACK_VERSION = '1\.2\.9'/);
  assert.match(websiteScript, /Object\.values\(names\)\.some\(name => !assets\.get\(name\)\?\.browser_download_url\)/);
  assert.doesNotMatch(`${website}\n${websiteScript}`, /releases\/download\/v1\.2\.8/);
});

test('website uses one concise Linux distro picker', () => {
  assert.equal((website.match(/class="button secondary large linux-picker-trigger"/g) || []).length, 1);
  assert.doesNotMatch(website, /data-linux-search/);
  assert.match(website, /Debian[\s\S]*Ubuntu[\s\S]*Linux Mint[\s\S]*Pop!_OS/);
  assert.match(website, /Fedora[\s\S]*Nobara[\s\S]*Arch Linux[\s\S]*Manjaro[\s\S]*EndeavourOS[\s\S]*CachyOS/);
  assert.match(websiteScript, /function setLinuxPickerOpen\(open\)/);
  assert.doesNotMatch(websiteScript, /row\.dataset\.search\.includes\(query\)/);
});

test('website analytics count each download once and publish a fresh sitemap', () => {
  assert.doesNotMatch(websiteScript, /sendAnalyticsEvent\(['"]file_download['"]/);
  assert.match(websiteScript, /enhanced measurement records file_download/i);
  assert.match(sitemap, /<lastmod>2026-10-04<\/lastmod>/);
  assert.match(sitemap, /https:\/\/realse62em\.github\.io\/Pine-Launcher\//);
});
