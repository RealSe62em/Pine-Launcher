'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJsonRecovering, writeJsonAtomic } = require('../lib/json-store');

test('atomic JSON writes keep a recoverable previous value', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-json-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'registry.json');
  writeJsonAtomic(file, { revision: 1 });
  writeJsonAtomic(file, { revision: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { revision: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { revision: 1 });
});

test('damaged primary JSON is restored from its backup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-json-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  writeJsonAtomic(file, { good: true });
  fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, '{broken');
  let recovered = false;
  assert.deepEqual(readJsonRecovering(file, { onRecovery: () => { recovered = true; } }), { good: true });
  assert.equal(recovered, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { good: true });
});

test('validation rejects both invalid primary and backup values', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-json-validation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'groups.json');
  fs.writeFileSync(file, JSON.stringify({ groups: [] }));
  fs.writeFileSync(`${file}.bak`, JSON.stringify({ groups: [] }));
  assert.equal(readJsonRecovering(file, { validate: Array.isArray }), null);
});
