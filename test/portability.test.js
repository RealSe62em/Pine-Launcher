'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shipped = ['main.js', 'preload.js', 'package.json', 'electron-builder.yml', ...fs.readdirSync(path.join(root, 'lib')).filter(name => name.endsWith('.js')).map(name => `lib/${name}`)];
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('shipped launcher source contains no developer-specific Windows profile path', () => {
  for (const relative of shipped) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /C:\\Users\\selee|C:\/Users\/selee|AppData\\Roaming\\Pine Launcher/i, relative);
  }
});

test('release scripts build separate native installers and updater feeds', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(pkg.scripts['build:installer'], /build:installer:x64.*build:installer:arm64/);
  assert.match(pkg.scripts['build:installer'], /preserve-update-feed\.js x64.*preserve-update-feed\.js arm64/);
  assert.match(workflow, /latest-arm64\.yml/);
  assert.match(workflow, /SHA256/);
});

test('Debian is a native electron-builder target without changing Windows NSIS builds', () => {
  const pkg = JSON.parse(read('package.json'));
  const builder = read('electron-builder.yml');
  const script = read('build-deb.sh');
  assert.match(pkg.scripts['build:deb:x64'], /--linux deb --x64/);
  assert.match(builder, /win:[\s\S]*target:\s*nsis/);
  assert.match(builder, /linux:[\s\S]*target:\s*deb/);
  assert.match(builder, /artifactName: PineLauncher-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}/);
  assert.match(script, /npm run build:deb:x64/);
  assert.doesNotMatch(script, /npm install|chmod 777/);
});

test('Arch Linux has a native Pacman target with current runtime dependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  const builder = read('electron-builder.yml');
  const script = read('build-arch.sh');
  const workflow = read('.github/workflows/release.yml');
  assert.match(pkg.scripts['build:pacman:x64'], /--linux pacman --x64/);
  assert.match(builder, /linux:[\s\S]*target:\s*pacman/);
  assert.match(builder, /pacman:[\s\S]*artifactName: PineLauncher-\$\{version\}-archlinux-\$\{arch\}\.\$\{ext\}/);
  assert.match(builder, /pacman:[\s\S]*depends:[\s\S]*- libsecret/);
  assert.doesNotMatch(builder.match(/pacman:[\s\S]*/)?.[0] || '', /- http-parser/);
  assert.match(script, /npm run build:pacman:x64/);
  assert.doesNotMatch(script, /npm install|chmod 777/);
  assert.match(workflow, /apt-get install --yes libarchive-tools/);
});
