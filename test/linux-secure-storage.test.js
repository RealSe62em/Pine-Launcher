'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { configureLinuxSecureStorage } = require('../lib/linux-secure-storage');

test('forces the secure libsecret backend on Linux custom desktops', () => {
  const calls = [];
  const app = {
    commandLine: {
      hasSwitch: () => false,
      appendSwitch: (...args) => calls.push(args),
    },
  };

  assert.equal(configureLinuxSecureStorage(app, 'linux'), true);
  assert.deepEqual(calls, [['password-store', 'gnome-libsecret']]);
});

test('does not change Windows behavior', () => {
  const calls = [];
  const app = { commandLine: { appendSwitch: (...args) => calls.push(args) } };

  assert.equal(configureLinuxSecureStorage(app, 'win32'), false);
  assert.deepEqual(calls, []);
});

test('preserves an explicit password store override', () => {
  const calls = [];
  const app = {
    commandLine: {
      hasSwitch: name => name === 'password-store',
      appendSwitch: (...args) => calls.push(args),
    },
  };

  assert.equal(configureLinuxSecureStorage(app, 'linux'), false);
  assert.deepEqual(calls, []);
});
