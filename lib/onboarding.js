'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { writeJsonAtomic, readJsonRecovering } = require('./json-store');
function claimOnboarding(file, hasHistory = false) {
  if (fs.existsSync(file) || fs.existsSync(`${file}.bak`)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, status: hasHistory ? 'existing-user' : 'shown', firstOpenedAt: new Date().toISOString() }), { flag: 'wx' });
    return !hasHistory;
  } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}
function finishOnboarding(file, status) {
  if (!['completed', 'skipped'].includes(status)) throw new Error('Invalid onboarding status');
  const previous = readJsonRecovering(file) || {};
  writeJsonAtomic(file, { ...previous, version: 1, status, finishedAt: new Date().toISOString() });
}
function recommendedMemory(totalBytes) {
  const gb = totalBytes / 1024 ** 3;
  return `${Math.max(1, Math.min(6, Math.floor(gb / 2)))}G`;
}
module.exports = { claimOnboarding, finishOnboarding, recommendedMemory };
