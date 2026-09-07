'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveSafePath } = require('./safety');
const { normalizePackPath } = require('./managed-pack');
function contentHash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function previewPackChanges(root, layer, previousFiles, nextFiles) {
  const previousRecords = new Map(previousFiles.map(file => [normalizePackPath(file.path), file]));
  const wasCustomized = (relative, current) => {
    const hashes = previousRecords.get(relative)?.hashes || {};
    const algorithm = ['sha512', 'sha256', 'sha1'].find(key => hashes[key]);
    return algorithm && crypto.createHash(algorithm).update(fs.readFileSync(current)).digest('hex') !== hashes[algorithm];
  };
  const previous = new Set(previousFiles.map(file => normalizePackPath(file.path)));
  const next = new Set(nextFiles.map(file => normalizePackPath(file.path)));
  const added = [], removed = [], changed = [], conflicts = [];
  for (const relative of next) {
    const current = resolveSafePath(root, ...relative.split('/'));
    const incoming = resolveSafePath(layer, ...relative.split('/'));
    if (!fs.existsSync(current)) added.push(relative);
    else if (contentHash(current) !== contentHash(incoming)) {
      changed.push(relative);
      if (!previous.has(relative) || wasCustomized(relative, current)) conflicts.push(relative);
    }
  }
  for (const relative of previous) {
    const current = resolveSafePath(root, ...relative.split('/'));
    if (!next.has(relative) && fs.existsSync(current)) { removed.push(relative); if (wasCustomized(relative, current)) conflicts.push(relative); }
  }
  const snapshot = [...new Set([...previous, ...next])].sort().map(relative => {
    const current = resolveSafePath(root, ...relative.split('/')); const incoming = resolveSafePath(layer, ...relative.split('/'));
    return [relative, fs.existsSync(current) ? contentHash(current) : null, fs.existsSync(incoming) ? contentHash(incoming) : null];
  });
  return { added, removed, changed, conflicts, fingerprint: crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
}
module.exports = { previewPackChanges };
