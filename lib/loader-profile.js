'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function expectedLoaderProfileId(loader, loaderVersion, gameVersion) {
  return `${loader}-loader-${loaderVersion}-${gameVersion}`;
}

function isSafePathSegment(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && value !== '.'
    && value !== '..'
    && !value.endsWith('.')
    && !/[<>:"/\\|?*\x00-\x1f]/.test(value);
}

function isMatchingLoaderProfile(profile, loader, loaderVersion, gameVersion) {
  if (!profile || typeof profile !== 'object') return false;
  const expectedId = expectedLoaderProfileId(loader, loaderVersion, gameVersion);
  return isSafePathSegment(expectedId)
    && profile.id === expectedId
    && profile.inheritsFrom === gameVersion
    && typeof profile.mainClass === 'string'
    && profile.mainClass.length > 0
    && Array.isArray(profile.libraries);
}

function wait(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function writeJsonAtomic(file, value, attempts = 4) {
  const serialized = JSON.stringify(value, null, 2);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.promises.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
      JSON.parse(await fs.promises.readFile(temporary, 'utf8'));
      try {
        await fs.promises.rename(temporary, file);
      } catch (error) {
        if (!['EEXIST', 'EPERM', 'EACCES'].includes(error?.code) || !fs.existsSync(file)) throw error;
        await fs.promises.rm(file, { force: true });
        await fs.promises.rename(temporary, file);
      }
      JSON.parse(await fs.promises.readFile(file, 'utf8'));
      return serialized;
    } catch (error) {
      lastError = error;
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
      if (attempt < attempts) await wait(attempt * 75);
    }
  }

  throw new Error(`Could not write ${path.basename(file)} after ${attempts} attempts: ${lastError?.message || 'unknown error'}`);
}

module.exports = { expectedLoaderProfileId, isSafePathSegment, isMatchingLoaderProfile, writeJsonAtomic };