'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const { replaceLevelName, validateDatapackArchive } = require('../lib/world-management');

function levelDatWithName(name) {
  const encoded = Buffer.from(name, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(encoded.length);
  return Buffer.concat([Buffer.from([10, 0, 0, 8, 0, 9]), Buffer.from('LevelName'), length, encoded, Buffer.from([0])]);
}

test('renames a compressed Minecraft LevelName without changing the rest of the NBT', () => {
  const source = zlib.gzipSync(levelDatWithName('Old World'));
  const decoded = zlib.gunzipSync(replaceLevelName(source, 'New Pine World'));
  assert.ok(decoded.includes(Buffer.from('New Pine World')));
  assert.equal(decoded.includes(Buffer.from('Old World')), false);
  assert.equal(decoded.at(-1), 0);
});

test('accepts only data-pack ZIPs with a root pack.mcmeta', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-datapack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const valid = path.join(dir, 'valid.zip');
  const archive = new AdmZip();
  archive.addFile('pack.mcmeta', Buffer.from('{"pack":{"pack_format":1,"description":"test"}}'));
  archive.addFile('data/pine/functions/hello.mcfunction', Buffer.from('say hello'));
  archive.writeZip(valid);
  assert.equal(validateDatapackArchive(valid).files, 2);

  const invalid = path.join(dir, 'invalid.zip');
  const nested = new AdmZip();
  nested.addFile('folder/pack.mcmeta', Buffer.from('{}'));
  nested.writeZip(invalid);
  assert.throws(() => validateDatapackArchive(invalid), /pack\.mcmeta/);
});
