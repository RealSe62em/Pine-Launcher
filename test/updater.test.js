'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { createUpdateManager, releaseNotesText, userFacingUpdateError } = require('../lib/updater');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.downloads = 0;
    this.installs = 0;
  }
  async checkForUpdates() { this.checks += 1; }
  async downloadUpdate() { this.downloads += 1; }
  quitAndInstall() { this.installs += 1; }
}

function manager(options = {}) {
  const updater = new FakeUpdater();
  const states = [];
  const timers = [];
  const value = createUpdateManager({
    autoUpdater: updater,
    currentVersion: '1.1.9',
    isPackaged: true,
    platform: 'win32',
    send: state => states.push(state),
    setTimeoutFn: (callback, delay) => { timers.push({ callback, delay }); return { unref() {} }; },
    setIntervalFn: () => ({ unref() {} }),
    clearTimeoutFn: () => {},
    clearIntervalFn: () => {},
    ...options,
  });
  return { updater, states, timers, value };
}

test('installed Windows builds check manually without auto-downloading', async () => {
  const { updater, value } = manager();
  value.start();
  await value.checkForUpdates();
  assert.equal(updater.checks, 1);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.disableWebInstaller, true);
});

test('development builds never contact the update provider', async () => {
  const { updater, value } = manager({ isPackaged: false });
  value.start();
  await value.checkForUpdates();
  assert.equal(updater.checks, 0);
  assert.equal(value.getState().status, 'unsupported');
});

test('available updates download only after an explicit request', async () => {
  const { updater, value } = manager();
  value.start();
  updater.emit('update-available', {
    version: '1.1.10',
    releaseDate: '2026-08-13T00:00:00Z',
    releaseNotes: 'Bug fixes',
  });
  assert.equal(value.getState().status, 'available');
  assert.equal(updater.downloads, 0);
  await value.downloadUpdate();
  assert.equal(updater.downloads, 1);
});

test('download progress is clamped and exposed to the renderer', () => {
  const { updater, value } = manager();
  updater.emit('download-progress', { percent: 140, transferred: 50, total: 100, bytesPerSecond: 25 });
  const state = value.getState();
  assert.equal(state.percent, 100);
  assert.equal(state.transferred, 50);
  assert.equal(state.bytesPerSecond, 25);
});

test('installation is blocked while Minecraft is active', () => {
  const { updater, value, timers } = manager({ isGameActive: () => true });
  updater.emit('update-downloaded', { version: '1.1.10' });
  const state = value.installUpdate();
  assert.equal(state.status, 'downloaded');
  assert.equal(state.installBlocked, true);
  assert.equal(timers.length, 0);
  assert.equal(updater.installs, 0);
});

test('downloaded updates restart through the NSIS updater', () => {
  const { updater, value, timers } = manager();
  updater.emit('update-downloaded', { version: '1.1.10' });
  const state = value.installUpdate();
  assert.equal(state.status, 'installing');
  assert.equal(timers.length, 1);
  timers[0].callback();
  assert.equal(updater.installs, 1);
});

test('Linux packages explain the Debian and Arch manual GitHub update path', () => {
  const { value } = manager({ isPackaged: true, platform: 'linux' });
  const state = value.start();
  assert.equal(state.status, 'unsupported');
  assert.match(state.message, /\.deb or \.pacman releases from GitHub/i);
});

test('Windows ARM64 installations use their architecture-specific update feed', () => {
  const arm = manager({ arch: 'arm64' });
  const x64 = manager({ arch: 'x64' });
  assert.equal(arm.updater.channel, 'latest-arm64');
  assert.notEqual(x64.updater.channel, 'latest-arm64');
});

test('a downloaded update cannot be replaced by another check before restart', async () => {
  const { updater, value } = manager();
  updater.emit('update-downloaded', { version: '1.1.10' });
  await value.checkForUpdates();
  assert.equal(value.getState().status, 'downloaded');
  assert.equal(updater.checks, 0);
});

test('release notes arrays are reduced to safe plain text', () => {
  assert.equal(releaseNotesText([{ note: 'Fix one' }, { note: 'Fix two' }]), 'Fix one\n\nFix two');
});

test('missing release metadata produces a concise user-facing message', () => {
  const raw = new Error('HttpError: 404 Not Found for https://github.com/RealSe62em/Pine-Launcher/releases/download/v1.1.9/latest.yml headers: lots of internal data');
  const message = userFacingUpdateError(raw);
  assert.match(message, /not available for this release/i);
  assert.doesNotMatch(message, /headers|https:\/\//i);
});
