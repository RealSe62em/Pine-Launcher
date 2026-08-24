'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { directorySize, storageUsage } = require('../lib/storage-usage');

test('storage usage counts nested files and ignores symlinks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-usage-'));
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'one'), Buffer.alloc(10));
  fs.writeFileSync(path.join(root, 'nested', 'two'), Buffer.alloc(15));
  try { fs.symlinkSync(path.join(root, 'one'), path.join(root, 'link')); } catch {}
  assert.equal(await directorySize(root), 25);
  assert.deepEqual(await storageUsage({ cache: root }), { cache: 25 });
});
