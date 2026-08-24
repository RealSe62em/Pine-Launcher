'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function temporaryPath(file) {
  return `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
}

function writeJsonAtomic(file, value, { keepBackup = true } = {}) {
  const target = path.resolve(file);
  const backup = `${target}.bak`;
  const temporary = temporaryPath(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const handle = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  try {
    if (keepBackup && fs.existsSync(target)) fs.copyFileSync(target, backup);
    fs.renameSync(temporary, target);
    try {
      const directory = fs.openSync(path.dirname(target), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch {}
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return target;
}

function readJsonRecovering(file, { validate = () => true, onRecovery = () => {} } = {}) {
  const target = path.resolve(file);
  const candidates = [target, `${target}.bak`];
  let primaryError = null;
  for (const candidate of candidates) {
    try {
      const value = parseJsonFile(candidate);
      if (validate(value) !== true) throw new Error('JSON data failed validation');
      if (candidate !== target) {
        writeJsonAtomic(target, value, { keepBackup: false });
        onRecovery({ file: target, backup: candidate, error: primaryError });
      }
      return value;
    } catch (error) {
      if (candidate === target) primaryError = error;
    }
  }
  return null;
}

module.exports = { readJsonRecovering, writeJsonAtomic };
