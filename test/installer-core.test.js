const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isOwnedInstallDir, encodeInstallDir, decodeInstallDir } = require('../installer/core');

test('installer never claims an arbitrary non-empty directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-installer-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'personal-file.txt'), 'keep');
    assert.equal(isOwnedInstallDir(dir, 'Pine Launcher', 'PineLauncher', '.pine-launcher-install.json'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install directory command argument round-trips spaces and Unicode', () => {
  const dir = path.resolve('Some Folder', 'Pine ⛏');
  assert.equal(decodeInstallDir(encodeInstallDir(dir)), dir);
});
