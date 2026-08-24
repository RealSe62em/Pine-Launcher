'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeJsonAtomic } = require('./json-store');

function available(storage) {
  try { return Boolean(storage?.isEncryptionAvailable?.()); } catch { return false; }
}

function readSecrets(file, storage) {
  if (!available(storage)) return {};
  for (const candidate of [file, `${file}.bak`]) {
    try {
      const envelope = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (envelope?.format !== 1 || typeof envelope.payload !== 'string') continue;
      const clear = storage.decryptString(Buffer.from(envelope.payload, 'base64'));
      const value = JSON.parse(clear);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {}
  }
  return {};
}

function writeSecrets(file, storage, value) {
  if (!available(storage)) throw new Error('Secure credential storage is unavailable on this system');
  const payload = storage.encryptString(JSON.stringify(value || {})).toString('base64');
  writeJsonAtomic(file, { format: 1, payload });
}

function getSecret(file, storage, name) {
  return String(readSecrets(file, storage)[name] || '');
}

function setSecret(file, storage, name, value) {
  const secrets = readSecrets(file, storage);
  const clean = String(value || '').trim();
  if (clean) secrets[name] = clean;
  else delete secrets[name];
  writeSecrets(file, storage, secrets);
  return Boolean(clean);
}

module.exports = { available, getSecret, readSecrets, setSecret, writeSecrets };
