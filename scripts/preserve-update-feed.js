'use strict';

const fs = require('fs');
const path = require('path');

const arch = process.argv[2];
if (!['x64', 'arm64'].includes(arch)) throw new Error('Expected x64 or arm64');
const output = path.join(__dirname, '..', 'dist-native');
const current = path.join(output, 'latest.yml');
if (!fs.existsSync(current)) throw new Error(`Missing updater metadata after ${arch} build`);
const architectureFeed = path.join(output, `latest-${arch}.yml`);
fs.copyFileSync(current, architectureFeed);
if (arch === 'arm64') {
  const x64Feed = path.join(output, 'latest-x64.yml');
  if (!fs.existsSync(x64Feed)) throw new Error('Build x64 before ARM64 so the default updater feed remains x64');
  fs.copyFileSync(x64Feed, current);
}
