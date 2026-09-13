'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'lib', 'filesystem-inspector-worker.js'), 'utf8');

test('expensive read-only filesystem checks run outside the Electron main thread', () => {
  assert.match(main, /new Worker\(path\.join\(__dirname, 'lib', 'filesystem-inspector-worker\.js'\)/);
  assert.match(main, /listWorldsInWorker\(registry\.map/);
  assert.match(main, /await inspectLaunchMods\(modsDir, instance\.loader, instance\.gameVersion\)/);
  assert.match(worker, /inspectModSet\(workerData\.modsDir/);
});

test('large backup copies, restores, pruning, and deletion run in a worker', () => {
  assert.match(worker, /workerData\?\.type === 'backup'/);
  assert.match(main, /runBackupInWorker\('create'/);
  assert.match(main, /runBackupInWorker\('restore'/);
  assert.match(main, /runBackupInWorker\('prune'/);
  assert.match(main, /runBackupInWorker\('delete'/);
});

test('mod inspection caches unchanged archives and deduplicates concurrent cold scans', () => {
  assert.match(main, /stat\.size.*stat\.mtimeMs.*loader/s);
  assert.match(main, /modCompatibilityInflight\.get\(batchKey\)/);
  assert.match(main, /launchModInspectionCache\.has\(key\)/);
  assert.match(main, /launchModInspectionInflight\.get\(key\)/);
});

test('game logs batch disk and IPC work instead of updating once per line', () => {
  assert.match(main, /diagnosticLogBuffer\.length >= 64 \* 1024/);
  assert.match(main, /setTimeout\(flushDiagnosticLog, 50\)/);
  assert.match(main, /launchDataBuffer\.length >= 100/);
  assert.match(main, /setTimeout\(flushLaunchData, 32\)/);
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'script.js'), 'utf8');
  assert.match(renderer, /state\.logLines\.push\(\.\.\.lines\)/);
  assert.match(renderer, /state\.logLines\.splice\(0, state\.logLines\.length - 800\)/);
});
