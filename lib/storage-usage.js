'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function directorySize(root) {
  let total = 0;
  const pending = [path.resolve(root)];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const item = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(item);
      else if (entry.isFile()) {
        try { total += (await fs.promises.stat(item)).size; } catch {}
      }
    }
  }
  return total;
}

async function storageUsage(categories) {
  const rows = await Promise.all(Object.entries(categories).map(async ([key, root]) => [key, await directorySize(root)]));
  return Object.fromEntries(rows);
}

module.exports = { directorySize, storageUsage };
