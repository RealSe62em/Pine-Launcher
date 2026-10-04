'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCompatibilityRepairPlan } = require('../lib/compatibility-repair');

test('builds a deduplicated plan from version-changing compatibility actions', () => {
  const plan = buildCompatibilityRepairPlan([
    { code: 'MISMATCH', title: 'Wrong build', severity: 'error', actions: [{ type: 'replace', projectId: 'sodium', versionId: 'v2', filename: 'sodium.jar', label: 'Downgrade Sodium' }] },
    { code: 'DEPENDENCY', title: 'Needs Sodium', severity: 'error', actions: [{ type: 'replace', projectId: 'sodium', versionId: 'v2', filename: 'sodium.jar', label: 'Install compatible Sodium' }] },
    { code: 'MISSING', title: 'Needs Fabric API', severity: 'error', actions: [{ type: 'install', projectId: 'fabric-api', versionId: 'api2', label: 'Install Fabric API' }] },
  ]);
  assert.equal(plan.changes.length, 2);
  assert.equal(plan.complete, true);
  assert.deepEqual(plan.changes.map(change => change.action.projectId), ['sodium', 'fabric-api']);
});

test('marks non-version repairs and conflicting targets as unresolved', () => {
  const plan = buildCompatibilityRepairPlan([
    { code: 'CORRUPT', title: 'Broken archive', severity: 'error', actions: [{ type: 'remove', filename: 'bad.jar' }] },
    { code: 'ONE', title: 'First requirement', severity: 'error', actions: [{ type: 'replace', projectId: 'shared', versionId: 'v1' }] },
    { code: 'TWO', title: 'Second requirement', severity: 'error', actions: [{ type: 'replace', projectId: 'shared', versionId: 'v2' }] },
  ]);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.unresolved.length, 2);
  assert.equal(plan.complete, false);
});

test('includes CurseForge changes and ignores warning-only manual suggestions', () => {
  const plan = buildCompatibilityRepairPlan([
    { code: 'CF', title: 'Wrong CF build', severity: 'error', actions: [{ type: 'replace-curseforge', projectId: 'curseforge:42', fileId: 99, filename: 'old.jar' }] },
    { code: 'ONLINE', title: 'Provider unavailable', severity: 'warning', actions: [] },
  ]);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].action.fileId, 99);
  assert.equal(plan.complete, true);
});
