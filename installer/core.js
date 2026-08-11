const fs = require('fs');
const path = require('path');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function isInstalledDir(dir) {
  try {
    return fs.existsSync(path.join(dir, 'package.json'))
      && fs.existsSync(path.join(dir, 'main.js'))
      && fs.existsSync(path.join(dir, 'node_modules', 'electron', 'dist', 'electron.exe'));
  } catch { return false; }
}

function isOwnedInstallDir(dir, product, productKey, markerName) {
  try {
    const marker = readJSON(path.join(dir, markerName));
    if (marker?.product === productKey && isInstalledDir(dir)) return true;
    const pkg = readJSON(path.join(dir, 'package.json'));
    return isInstalledDir(dir) && pkg?.productName === product;
  } catch { return false; }
}

function encodeInstallDir(dir) { return Buffer.from(path.resolve(dir), 'utf8').toString('base64url'); }
function decodeInstallDir(value) {
  try { return path.resolve(Buffer.from(value, 'base64url').toString('utf8')); } catch { return null; }
}

module.exports = { readJSON, isInstalledDir, isOwnedInstallDir, encodeInstallDir, decodeInstallDir };
