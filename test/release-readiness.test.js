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

test('release uses the planned updater-visible version', () => {
  assert.equal(pkg.version, '1.2.8');
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
  assert.match(workflow, /steps\.windows-signing\.outputs\.enabled == 'true'/);
  assert.match(workflow, /Publishing explicitly approved unsigned Windows installers/);
});

test('Linux release builders install every native compression prerequisite', () => {
  assert.match(workflow, /apt-get install --yes libarchive-tools zstd/);
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

test('website fallbacks point at every 1.2.8 native installer', () => {
  assert.match(website, /data-release-version>1\.2\.8</);
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncherSetup-x64\.exe/);
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncherSetup-arm64\.exe/);
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncher-1\.2\.8-linux-amd64\.deb/);
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncher-1\.2\.8-linux-arm64\.deb/);
  assert.match(website, /releases\/download\/v1\.2\.8\/PineLauncher-1\.2\.8-archlinux-x64\.pacman/);
  assert.match(websiteScript, /const FALLBACK_VERSION = '1\.2\.8'/);
  assert.match(websiteScript, /Object\.values\(names\)\.some\(name => !assets\.get\(name\)\?\.browser_download_url\)/);
  assert.doesNotMatch(`${website}\n${websiteScript}`, /releases\/download\/v1\.2\.3/);
});
