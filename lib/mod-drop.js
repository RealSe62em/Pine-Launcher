'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveSafePath, safeRemoteFilename } = require('./safety');

const DEFAULT_MAX_FILES = 100;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024;

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyDroppedMods({ instanceDir, filePaths, loader = 'vanilla', isValidJar, compatibilityIssue, maxFiles = DEFAULT_MAX_FILES, maxFileBytes = DEFAULT_MAX_FILE_BYTES }) {
  if (!path.isAbsolute(instanceDir)) throw new Error('Instance location is invalid');
  if (typeof isValidJar !== 'function') throw new Error('JAR validation is unavailable');
  if (!Array.isArray(filePaths) || !filePaths.length) throw new Error('Drop one or more mod JAR files');
  if (filePaths.length > maxFiles) throw new Error(`You can add up to ${maxFiles} mods at once`);

  const modsDir = resolveSafePath(instanceDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const result = { copied: [], skipped: [], rejected: [] };

  for (const input of filePaths) {
    let source = '';
    let filename = '';
    let temporary = '';
    try {
      if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('The dropped file path is invalid');
      source = fs.realpathSync(input);
      filename = safeRemoteFilename(path.basename(source));
      if (!/\.jar$/i.test(filename)) throw new Error('Only .jar mod files can be added');
      const stat = fs.statSync(source);
      if (!stat.isFile()) throw new Error('The dropped item is not a file');
      if (stat.size > maxFileBytes) throw new Error('This mod is too large to add');
      if (!isValidJar(source)) throw new Error('This file is not a valid JAR archive');

      const target = resolveSafePath(modsDir, filename);
      const disabledTarget = `${target}.disabled`;
      const existing = fs.existsSync(target) ? target : fs.existsSync(disabledTarget) ? disabledTarget : null;
      if (existing) {
        if (fs.statSync(existing).size === stat.size && fileHash(existing) === fileHash(source)) {
          result.skipped.push({ filename, reason: 'Already installed' });
        } else {
          result.rejected.push({ filename, reason: 'A different mod with this filename is already installed' });
        }
        continue;
      }

      temporary = resolveSafePath(modsDir, `.pine-drop-${crypto.randomUUID()}.tmp`);
      fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
      if (!isValidJar(temporary)) throw new Error('The copied file failed JAR verification');
      fs.renameSync(temporary, target);
      temporary = '';
      result.copied.push({
        filename,
        compatibilityIssue: typeof compatibilityIssue === 'function' ? compatibilityIssue(target, filename, loader) || null : null,
      });
    } catch (error) {
      if (temporary) fs.rmSync(temporary, { force: true });
      result.rejected.push({ filename: filename || path.basename(String(input || 'Unknown file')), reason: error.message || String(error) });
    }
  }
  return result;
}

module.exports = { copyDroppedMods, DEFAULT_MAX_FILES, DEFAULT_MAX_FILE_BYTES };
