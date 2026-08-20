'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shipped = ['main.js', 'preload.js', 'package.json', 'electron-builder.yml', ...fs.readdirSync(path.join(root, 'lib')).filter(name => name.endsWith('.js')).map(name => `lib/${name}`)];

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
