'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expectedHash, fileMatchesExpectedHash } = require('../lib/file-integrity');

test('recognizes an existing download only when its strongest supplied hash matches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-existing-mod-'));
  const file = path.join(root, 'mod.jar');
  try {
    fs.writeFileSync(file, 'complete mod bytes');
    const sha512 = crypto.createHash('sha512').update('complete mod bytes').digest('hex');
    const sha1 = crypto.createHash('sha1').update('different bytes').digest('hex');
    assert.deepEqual(expectedHash({ sha1, sha512 }), { algorithm: 'sha512', value: sha512 });
    assert.equal(fileMatchesExpectedHash(file, { sha1, sha512 }), true);
    fs.writeFileSync(file, 'partial');
    assert.equal(fileMatchesExpectedHash(file, { sha1, sha512 }), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not trust an existing download without a provider hash', () => {
  assert.equal(fileMatchesExpectedHash(__filename, {}), false);
});
