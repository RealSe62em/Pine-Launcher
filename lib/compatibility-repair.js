'use strict';

const VERSION_ACTIONS = new Set(['replace', 'install', 'replace-curseforge', 'install-curseforge']);

function repairTargetKey(action) {
  const provider = String(action.type || '').endsWith('curseforge') ? 'curseforge' : 'modrinth';
  return `${provider}:${String(action.projectId || '').toLowerCase()}`;
}

function repairVersionKey(action) {
  return String(action.versionId ?? action.fileId ?? '');
}

function buildCompatibilityRepairPlan(findings = []) {
  const changes = [];
  const conflicts = [];
  const unresolved = [];
  const selected = new Map();

  for (const finding of findings) {
    const action = (finding.actions || []).find(candidate => VERSION_ACTIONS.has(candidate.type));
    if (!action || !action.projectId || !repairVersionKey(action)) {
      if (finding.severity === 'error') unresolved.push({ code: finding.code, title: finding.title });
      continue;
    }
    const key = repairTargetKey(action);
    const previous = selected.get(key);
    if (previous && repairVersionKey(previous.action) !== repairVersionKey(action)) {
      conflicts.push({ projectId: action.projectId, first: previous.action, second: action });
      if (!unresolved.some(item => item.code === finding.code && item.title === finding.title)) {
        unresolved.push({ code: finding.code, title: finding.title });
      }
      continue;
    }
    if (previous) continue;
    const change = {
      findingCode: finding.code,
      findingTitle: finding.title,
      action: { ...action },
    };
    selected.set(key, change);
    changes.push(change);
  }

  return { changes, conflicts, unresolved, complete: unresolved.length === 0 && conflicts.length === 0 };
}

module.exports = { VERSION_ACTIONS, buildCompatibilityRepairPlan };
