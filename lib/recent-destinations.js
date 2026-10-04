'use strict';

const { destinationKey } = require('./activity-store');

function destinationCatalogId(value) {
  const instanceRef = String(value?.instanceId || value?.instanceName || '').trim();
  const key = String(value?.key || destinationKey(value)).trim();
  return instanceRef && key ? `${instanceRef}\0${key}` : '';
}

function mergeDestinationCatalog(existing, liveItems, registry, scannedInstanceIds) {
  const previous = new Map((existing || []).map(item => [destinationCatalogId(item), item]).filter(([id]) => id));
  const liveIds = new Set();
  const normalizedLive = (liveItems || []).flatMap(item => {
    const id = destinationCatalogId(item);
    if (!id || liveIds.has(id)) return [];
    liveIds.add(id);
    const old = previous.get(id);
    return [{
      ...item,
      customLabel: old?.customLabel || item.customLabel || null,
      label: old?.customLabel || item.label,
      deletedInstance: false,
    }];
  });
  const activeIds = new Set((registry || []).map(item => String(item.id || item.created || item.name)));
  const scannedIds = scannedInstanceIds instanceof Set ? scannedInstanceIds : new Set(scannedInstanceIds || activeIds);
  const retained = (existing || []).flatMap(item => {
    const id = destinationCatalogId(item);
    const instanceId = String(item.instanceId || '');
    if (!id || liveIds.has(id) || (Number(item.launches) || 0) < 1) return [];
    if (activeIds.has(instanceId)) {
      return scannedIds.has(instanceId) ? [] : [{ ...item, deletedInstance: false, label: item.customLabel || item.label }];
    }
    return [{ ...item, deletedInstance: true, label: item.customLabel || item.label }];
  });
  return [...normalizedLive, ...retained];
}

module.exports = { destinationCatalogId, mergeDestinationCatalog };
