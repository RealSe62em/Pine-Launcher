'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { listWorlds } = require('./activity-store');
const { inspectModSet, jarLoaderCompatibilityIssue } = require('./mod-compatibility');
const { createBackup, deleteBackup, pruneAutomaticBackups, restoreBackup } = require('./instance-backups');

try {
  let value;
  if (workerData?.type === 'worlds') {
    value = (workerData.roots || []).map(root => listWorlds(root));
  } else if (workerData?.type === 'mod-compatibility') {
    value = (workerData.files || []).map(item => ({
      key: item.key,
      issue: jarLoaderCompatibilityIssue(item.path, item.filename, workerData.loader),
    }));
  } else if (workerData?.type === 'launch-mod-checks') {
    value = inspectModSet(workerData.modsDir, workerData.loader, workerData.gameVersion);
  } else if (workerData?.type === 'backup') {
    const { operation, options } = workerData;
    if (operation === 'create') value = createBackup(options);
    else if (operation === 'restore') value = restoreBackup(options);
    else if (operation === 'delete') value = deleteBackup(options.backupsDir, options.instance, options.id);
    else if (operation === 'prune') value = pruneAutomaticBackups(options.backupsDir, options.instance, options.retention);
    else throw new Error('Unknown backup operation');
  } else {
    throw new Error('Unknown filesystem inspection task');
  }
  parentPort.postMessage({ ok: true, value });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error?.message || String(error) });
}
