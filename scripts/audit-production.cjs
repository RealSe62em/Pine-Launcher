'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const requestPath = 'node_modules/minecraft-launcher-core/node_modules/request';
const originalPackage = fs.readFileSync(packagePath, 'utf8');
const manifest = JSON.parse(originalPackage);
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

if (lock.packages?.[requestPath]?.name !== '@cypress/request') {
  throw new Error('The audited lockfile does not contain Pine\'s patched request fork.');
}

// npm's audit command currently treats an npm: replacement override as a
// semver comparator and exits before contacting the advisory service. The
// installed tree and lockfile already contain the replacement, so hide only
// that manifest entry while npm audits the exact locked production tree.
delete manifest.overrides?.request;

let result;
try {
  fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  result = spawnSync('npm', [
    'audit',
    '--omit=dev',
    '--audit-level=high',
  ], {
    cwd: root,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
} finally {
  fs.writeFileSync(packagePath, originalPackage);
}

if (result?.error) throw result.error;
process.exitCode = Number.isInteger(result?.status) ? result.status : 1;
