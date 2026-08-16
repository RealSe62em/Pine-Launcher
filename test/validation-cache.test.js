'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ValidationCache } = require('../lib/validation-cache');

test('validation cache skips unchanged files and revalidates changed files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-validation-cache-'));
  const file = path.join(dir, 'client.jar');
  const cacheFile = path.join(dir, 'cache', 'validation.json');
  let validations = 0;
  const validator = target => {
    validations += 1;
    return fs.readFileSync(target, 'utf8') === 'valid';
  };
  try {
    fs.writeFileSync(file, 'valid');
    const cache = new ValidationCache(cacheFile);
    assert.equal(cache.isValid(file, 'sha1:expected', validator), true);
    assert.equal(cache.isValid(file, 'sha1:expected', validator), true);
    assert.equal(validations, 1);
    cache.flush();

    const restored = new ValidationCache(cacheFile);
    assert.equal(restored.isValid(file, 'sha1:expected', validator), true);
    assert.equal(validations, 1);

    fs.writeFileSync(file, 'broken-data');
    assert.equal(restored.isValid(file, 'sha1:expected', validator), false);
    assert.equal(validations, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt validation-cache metadata safely falls back to validation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-validation-corrupt-'));
  const file = path.join(dir, 'library.jar');
  const cacheFile = path.join(dir, 'validation.json');
  try {
    fs.writeFileSync(file, 'valid');
    fs.writeFileSync(cacheFile, '{not json');
    const cache = new ValidationCache(cacheFile);
    assert.equal(cache.isValid(file, 'jar', () => true), true);
    cache.flush();
    assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).version, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
