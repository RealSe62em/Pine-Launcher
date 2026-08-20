'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createBackup,
  deleteBackup,
  listBackups,
  recoverInterruptedRestores,
  restoreBackup,
} = require('../lib/instance-backups');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-backups-'));
  const instanceDir = path.join(root, 'instance');
  const backupsDir = path.join(root, 'backups');
  fs.mkdirSync(path.join(instanceDir, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(instanceDir, 'saves', 'World One'), { recursive: true });
  fs.writeFileSync(path.join(instanceDir, 'mods', 'example.jar'), 'mod-v1');
  fs.writeFileSync(path.join(instanceDir, 'saves', 'World One', 'level.dat'), 'world-v1');
  fs.mkdirSync(path.join(instanceDir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(instanceDir, 'logs', 'latest.log'), 'ignored');
  const instance = { id: 'instance-id', name: 'Testing', path: instanceDir, gameVersion: '1.21.11' };
  return { root, instanceDir, backupsDir, instance };
}

test('full backups restore playable data while excluding disposable logs', () => {
  const value = fixture();
  try {
    const backup = createBackup({ ...value, scope: 'full', description: 'Known good state' });
    fs.writeFileSync(path.join(value.instanceDir, 'mods', 'example.jar'), 'mod-v2');
    fs.writeFileSync(path.join(value.instanceDir, 'new-file.txt'), 'remove me');
    restoreBackup({ ...value, id: backup.id });
    assert.equal(fs.readFileSync(path.join(value.instanceDir, 'mods', 'example.jar'), 'utf8'), 'mod-v1');
    assert.equal(fs.existsSync(path.join(value.instanceDir, 'new-file.txt')), false);
    assert.equal(fs.existsSync(path.join(value.instanceDir, 'logs', 'latest.log')), false);
    assert.equal(listBackups(value.backupsDir, value.instance)[0].description, 'Known good state');
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('world-only restore leaves mods untouched', () => {
  const value = fixture();
  try {
    const backup = createBackup({ ...value, scope: 'worlds' });
    fs.writeFileSync(path.join(value.instanceDir, 'mods', 'example.jar'), 'mod-v2');
    fs.writeFileSync(path.join(value.instanceDir, 'saves', 'World One', 'level.dat'), 'world-v2');
    restoreBackup({ ...value, id: backup.id });
    assert.equal(fs.readFileSync(path.join(value.instanceDir, 'mods', 'example.jar'), 'utf8'), 'mod-v2');
    assert.equal(fs.readFileSync(path.join(value.instanceDir, 'saves', 'World One', 'level.dat'), 'utf8'), 'world-v1');
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('automatic retention never removes manual restore points', async () => {
  const value = fixture();
  try {
    const manual = createBackup({ ...value, kind: 'manual', description: 'Keep me' });
    for (let index = 0; index < 4; index += 1) {
      createBackup({ ...value, kind: 'automatic', retention: 2, reason: `Update ${index}` });
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    const backups = listBackups(value.backupsDir, value.instance);
    assert.equal(backups.filter(item => item.kind === 'automatic').length, 2);
    assert.ok(backups.some(item => item.id === manual.id));
    deleteBackup(value.backupsDir, value.instance, manual.id);
    assert.equal(listBackups(value.backupsDir, value.instance).some(item => item.id === manual.id), false);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});

test('interrupted restore recovery puts the rollback folder back', () => {
  const value = fixture();
  try {
    fs.mkdirSync(value.backupsDir, { recursive: true });
    const rollback = path.join(value.root, '.instance.pine-rollback-test');
    const staging = path.join(value.root, '.instance.pine-restore-test');
    fs.renameSync(value.instanceDir, rollback);
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(value.backupsDir, '.restore-a1.json'), JSON.stringify({
      target: value.instanceDir,
      staging,
      rollback,
      phase: 'swapped-old',
    }));
    const recovered = recoverInterruptedRestores(value.backupsDir);
    assert.deepEqual(recovered, [value.instanceDir]);
    assert.equal(fs.readFileSync(path.join(value.instanceDir, 'mods', 'example.jar'), 'utf8'), 'mod-v1');
    assert.equal(fs.existsSync(staging), false);
  } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
});
