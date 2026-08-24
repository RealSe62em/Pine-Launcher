'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getSecret, setSecret } = require('../lib/secure-secrets');

function fakeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`sealed:${value}`),
    decryptString: value => value.toString().slice(7),
  };
}

test('secure secrets are encrypted at rest and can be removed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-secrets-'));
  const file = path.join(root, 'secrets.json');
  setSecret(file, fakeStorage(), 'curseForgeApiKey', 'private-key');
  assert.equal(getSecret(file, fakeStorage(), 'curseForgeApiKey'), 'private-key');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /private-key/);
  setSecret(file, fakeStorage(), 'curseForgeApiKey', '');
  assert.equal(getSecret(file, fakeStorage(), 'curseForgeApiKey'), '');
});

test('secure secrets refuse plaintext fallback', () => {
  const file = path.join(os.tmpdir(), `pine-secrets-${process.pid}.json`);
  assert.throws(() => setSecret(file, { isEncryptionAvailable: () => false }, 'key', 'value'), /unavailable/);
});

test('secure secrets recover the previous encrypted value after corruption', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-secrets-recovery-'));
  const file = path.join(root, 'secrets.json');
  setSecret(file, fakeStorage(), 'curseForgeApiKey', 'first-private-key');
  setSecret(file, fakeStorage(), 'curseForgeApiKey', 'second-private-key');
  fs.writeFileSync(file, '{broken');
  assert.equal(getSecret(file, fakeStorage(), 'curseForgeApiKey'), 'first-private-key');
});
