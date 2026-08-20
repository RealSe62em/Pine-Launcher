'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const AdmZip = require('adm-zip');

function cleanWorldName(value) {
  const name = String(value || '').replace(/[\r\n\0]+/g, ' ').trim();
  const bytes = Buffer.byteLength(name, 'utf8');
  if (!name || name.length > 128 || bytes > 32767) throw new Error('World name must be between 1 and 128 characters');
  return name;
}

function replaceLevelName(buffer, value) {
  const name = cleanWorldName(value);
  const compressed = buffer[0] === 0x1f && buffer[1] === 0x8b;
  const decoded = compressed ? zlib.gunzipSync(buffer) : Buffer.from(buffer);
  const marker = Buffer.concat([Buffer.from([8, 0, 9]), Buffer.from('LevelName')]);
  const markerAt = decoded.indexOf(marker);
  if (markerAt < 0) throw new Error('This world does not contain a readable LevelName field');
  const lengthAt = markerAt + marker.length;
  if (lengthAt + 2 > decoded.length) throw new Error('The world metadata is incomplete');
  const oldLength = decoded.readUInt16BE(lengthAt);
  const valueAt = lengthAt + 2;
  if (valueAt + oldLength > decoded.length) throw new Error('The world name field is damaged');
  const encoded = Buffer.from(name, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(encoded.length);
  const updated = Buffer.concat([decoded.subarray(0, lengthAt), length, encoded, decoded.subarray(valueAt + oldLength)]);
  return compressed ? zlib.gzipSync(updated) : updated;
}

function validateDatapackArchive(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error('Data pack archives must be smaller than 512 MB');
  let archive;
  try { archive = new AdmZip(file); } catch { throw new Error('The selected file is not a valid ZIP archive'); }
  const entries = archive.getEntries();
  if (!entries.some(entry => !entry.isDirectory && entry.entryName.replace(/\\/g, '/').toLowerCase() === 'pack.mcmeta')) {
    throw new Error('This ZIP is not a data pack: pack.mcmeta must be at the archive root');
  }
  for (const entry of entries) {
    const normalized = entry.entryName.replace(/\\/g, '/');
    if (path.posix.isAbsolute(normalized) || normalized.split('/').some(part => part === '..')) {
      throw new Error('The data pack contains an unsafe file path');
    }
  }
  return { files: entries.filter(entry => !entry.isDirectory).length, bytes: stat.size };
}

module.exports = { cleanWorldName, replaceLevelName, validateDatapackArchive };
