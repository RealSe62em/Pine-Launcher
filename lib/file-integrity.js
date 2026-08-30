'use strict';

const crypto = require('crypto');
const fs = require('fs');

function expectedHash(hashes = {}) {
  for (const algorithm of ['sha512', 'sha256', 'sha1']) {
    const value = String(hashes?.[algorithm] || '').toLowerCase();
    if (/^[a-f0-9]+$/.test(value)) return { algorithm, value };
  }
  return null;
}

function fileMatchesExpectedHash(file, hashes = {}) {
  const expected = expectedHash(hashes);
  if (!expected) return false;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0) return false;
    const actual = crypto.createHash(expected.algorithm).update(fs.readFileSync(file)).digest('hex');
    return actual === expected.value;
  } catch {
    return false;
  }
}

module.exports = { expectedHash, fileMatchesExpectedHash };
