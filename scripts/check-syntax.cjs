'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const sourceRoots = ['lib', 'renderer', 'scripts', 'installer', 'website'];
const ignoredDirectories = new Set(['node_modules', 'vendor', 'dist', 'dist-native']);
const files = [path.join(root, 'main.js'), path.join(root, 'preload.js')];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.isFile() && /\.(?:c?js|mjs)$/.test(entry.name)) files.push(target);
  }
}

for (const directory of sourceRoots.map(name => path.join(root, name))) {
  if (fs.existsSync(directory)) collect(directory);
}

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) continue;
  process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
  process.exit(result.status || 1);
}

console.log(`Syntax checked ${files.length} JavaScript files.`);
