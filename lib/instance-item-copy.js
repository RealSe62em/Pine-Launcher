'use strict';

const fs = require('fs');
const path = require('path');

function safeRelative(value) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value) || value.includes('\0')) throw new Error('Invalid instance item path');
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error('Instance item escapes its instance');
  return normalized;
}

function resolveInside(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, safeRelative(relative));
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('Instance item escapes its instance');
  return target;
}

function assertCopyable(source) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error('Filesystem links cannot be copied between instances');
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source)) assertCopyable(path.join(source, entry));
  } else if (!stat.isFile()) throw new Error('Unsupported instance item');
  return stat;
}

function availableCopyPath(target, { renameOnConflict = false } = {}) {
  if (!fs.existsSync(target)) return target;
  if (!renameOnConflict) return null;
  const extension = path.extname(target);
  const stem = extension ? target.slice(0, -extension.length) : target;
  for (let number = 2; number <= 999; number++) {
    const candidate = `${stem} - Copy${number === 2 ? '' : ` ${number}`}${extension}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Too many copies with the same name');
}

function copyTree(source, destination) {
  const stat = assertCopyable(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: false });
    for (const entry of fs.readdirSync(source)) copyTree(path.join(source, entry), path.join(destination, entry));
  } else {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    try { fs.utimesSync(destination, stat.atime, stat.mtime); } catch {}
  }
}

function copyInstanceItems({ sourceRoot, destinationRoot, items }) {
  const sourceBase = path.resolve(sourceRoot);
  const destinationBase = path.resolve(destinationRoot);
  if (sourceBase === destinationBase) throw new Error('Choose another instance as the destination');
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('Select between 1 and 100 items to copy');
  const copied = [];
  const skipped = [];

  for (const item of items) {
    const relative = safeRelative(item?.relative);
    const source = resolveInside(sourceBase, relative);
    if (!fs.existsSync(source)) throw new Error(`Source item no longer exists: ${path.basename(relative)}`);
    const requestedTarget = resolveInside(destinationBase, relative);
    const renameOnConflict = item?.kind === 'world' || item?.kind === 'screenshot';
    const destination = availableCopyPath(requestedTarget, { renameOnConflict });
    if (!destination) {
      skipped.push({ ...item, relative, reason: 'already exists' });
      continue;
    }
    copyTree(source, destination);
    copied.push({ ...item, relative, destinationRelative: path.relative(destinationBase, destination) });
  }
  return { copied, skipped };
}

module.exports = { assertCopyable, availableCopyPath, copyInstanceItems, copyTree, resolveInside, safeRelative };
