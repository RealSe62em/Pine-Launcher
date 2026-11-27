'use strict';

const fs = require('fs');
const path = require('path');

function createDestinationCatalog({
  readJSON,
  writeJSON,
  diagnosticLog = () => {},
  PENDING_DELETIONS_FILE,
  GROUPS_FILE,
  INSTANCES_FILE,
  DESTINATION_CATALOG_FILE,
  getInstanceDir,
  readActivity,
  readSavedServers,
  listWorlds,
  destinationCatalogId,
  sanitizeDestination,
  destinationKey,
  normalizeServerIcon,
  isPrivateServerAddress,
  mergeDestinationCatalog,
}) {
  let pendingDeletionMutationTail = Promise.resolve();

  function pendingDeletions() {
    const value = readJSON(PENDING_DELETIONS_FILE);
    return Array.isArray(value?.items) ? value.items.filter(item => item && typeof item.id === 'string') : [];
  }

  function savePendingDeletions(items) {
    writeJSON(PENDING_DELETIONS_FILE, { format: 1, items: items.slice(0, 200) });
  }

  function validPendingDeletion(item) {
    if (!item || !path.isAbsolute(item.root) || !path.isAbsolute(item.target)) return false;
    const root = path.resolve(item.root);
    const target = path.resolve(item.target);
    return root !== path.parse(root).root
      && path.dirname(target) === root
      && /^\.pine-(?:bulk-)?deleting-[a-z0-9-]+/i.test(path.basename(target));
  }

  function mutatePendingDeletions(change) {
    const run = pendingDeletionMutationTail.then(() => savePendingDeletions(change(pendingDeletions())));
    pendingDeletionMutationTail = run.catch(() => {});
    return run;
  }

  function rememberPendingDeletion(item) {
    return mutatePendingDeletions(items => [...items.filter(entry => entry.id !== item.id), item]);
  }

  function forgetPendingDeletion(id) {
    return mutatePendingDeletions(items => items.filter(item => item.id !== id));
  }

  async function finishPendingDeletion(item) {
    if (!validPendingDeletion(item)) {
      diagnosticLog('ERROR', `Refused invalid pending deletion record ${String(item?.id || '').slice(0, 80)}`);
      return false;
    }
    try {
      await fs.promises.rm(item.target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
      await forgetPendingDeletion(item.id);
      return true;
    } catch (error) {
      diagnosticLog('WARN', `Pending cleanup failed for ${item.instanceName || item.id}: ${error.message}`);
      return false;
    }
  }

  async function recoverPendingDeletions() {
    const items = pendingDeletions();
    let completed = 0;
    for (const item of items) if (await finishPendingDeletion(item)) completed += 1;
    return completed;
  }

  function sanitizeGroupName(value, { optional = false } = {}) {
    const name = String(value || '').replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!name && !optional) throw new Error('Enter a group name');
    return name;
  }

  function readGroups({ includeInstanceGroups = true } = {}) {
    const stored = readJSON(GROUPS_FILE);
    const groups = [];
    const seen = new Set();
    const add = (value, created = null) => {
      const name = sanitizeGroupName(typeof value === 'object' ? value?.name : value, { optional: true });
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) return;
      seen.add(key);
      groups.push({ name, created: created || (typeof value === 'object' ? value?.created : null) || new Date().toISOString() });
    };
    if (Array.isArray(stored)) stored.forEach(group => add(group));
    if (includeInstanceGroups) {
      const registry = readJSON(INSTANCES_FILE) || [];
      registry.forEach(instance => add(instance?.group, instance?.created));
    }
    return groups;
  }

  function ensureGroupExists(value) {
    const name = sanitizeGroupName(value, { optional: true });
    if (!name) return '';
    const groups = readGroups();
    if (!groups.some(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      groups.push({ name, created: new Date().toISOString() });
    }
    writeJSON(GROUPS_FILE, groups);
    return groups.find(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())?.name || name;
  }

  function readDestinationCatalog() {
    const value = readJSON(DESTINATION_CATALOG_FILE);
    return Array.isArray(value?.items) ? value.items.slice(0, 100) : [];
  }

  function writeDestinationCatalog(items) {
    writeJSON(DESTINATION_CATALOG_FILE, { version: 1, items: items.filter(Boolean).slice(0, 100) });
  }

  function syncDestinationCatalog(liveItems, registry, scannedInstanceIds) {
    const existing = readDestinationCatalog();
    const merged = mergeDestinationCatalog(existing, liveItems, registry, scannedInstanceIds);
    writeDestinationCatalog(merged);
    return merged;
  }

  function archiveDeletedInstance(instance) {
    const instanceDir = getInstanceDir(instance);
    const activity = readActivity(path.join(instanceDir, '.pine-activity.json'));
    const savedServers = readSavedServers(instanceDir);
    const worlds = new Map(listWorlds(path.join(instanceDir, 'saves')).map(world => [world.identifier.toLowerCase(), world]));
    const existing = readDestinationCatalog();
    const byId = new Map(existing.map(item => [destinationCatalogId(item), item]).filter(([id]) => id));
    for (const destination of activity.destinations || []) {
      if ((Number(destination.launches) || 0) < 1) continue;
      const clean = sanitizeDestination(destination);
      if (!clean) continue;
      const key = destinationKey(clean);
      const saved = clean.type === 'multiplayer'
        ? savedServers.find(server => destinationKey({ type: 'multiplayer', address: server.ip }) === key)
        : null;
      const world = clean.type === 'singleplayer' ? worlds.get(clean.identifier.toLowerCase()) : null;
      const savedName = String(saved?.name || '').replace(/[\r\n\0]+/g, ' ').trim();
      const usefulName = savedName && !/^(?:minecraft|multiplayer) server$/i.test(savedName);
      const item = {
        ...clean,
        key,
        instanceId: String(instance.id || instance.created || instance.name),
        instanceName: instance.name,
        gameVersion: instance.gameVersion,
        loader: instance.loader,
        label: clean.type === 'multiplayer' ? (usefulName ? savedName.slice(0, 128) : clean.identifier) : (world?.name || clean.label),
        folderName: world?.identifier,
        iconData: clean.type === 'multiplayer' ? normalizeServerIcon(saved?.icon) : world?.iconData,
        launches: Number(destination.launches) || 0,
        lastUsed: destination.lastUsed || instance.lastPlayed || instance.created,
        canFetchMetadata: clean.type === 'multiplayer' && !isPrivateServerAddress(clean.identifier),
        deletedInstance: true,
      };
      const id = destinationCatalogId(item);
      const old = byId.get(id);
      byId.set(id, { ...item, customLabel: old?.customLabel || null, label: old?.customLabel || item.label });
    }
    writeDestinationCatalog([...byId.values()]);
  }

  return {
    pendingDeletions,
    rememberPendingDeletion,
    forgetPendingDeletion,
    finishPendingDeletion,
    recoverPendingDeletions,
    sanitizeGroupName,
    readGroups,
    ensureGroupExists,
    readDestinationCatalog,
    writeDestinationCatalog,
    syncDestinationCatalog,
    archiveDeletedInstance,
  };
}

module.exports = { createDestinationCatalog };
