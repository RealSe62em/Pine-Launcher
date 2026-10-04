'use strict';

function normalizeCape(cape) {
  if (!cape || typeof cape !== 'object') return null;
  const id = String(cape.id || '').trim();
  if (!id) return null;
  const state = String(cape.state || '').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  return {
    id,
    state,
    url: String(cape.url || '').trim(),
    alias: String(cape.alias || 'Minecraft cape').trim().slice(0, 100) || 'Minecraft cape',
  };
}

/**
 * Minecraft's profile response can temporarily omit inactive capes after a
 * cape change. Keep every cape Pine has already observed, while treating the
 * newest response as authoritative for the active state and metadata.
 */
function mergeCapeInventory(cachedCapes, remoteCapes) {
  const cached = (Array.isArray(cachedCapes) ? cachedCapes : []).map(normalizeCape).filter(Boolean);
  const remote = (Array.isArray(remoteCapes) ? remoteCapes : []).map(normalizeCape).filter(Boolean);
  const byId = new Map(cached.map(cape => [cape.id, { ...cape, state: 'INACTIVE' }]));
  for (const cape of remote) byId.set(cape.id, { ...byId.get(cape.id), ...cape });
  return [
    ...remote.map(cape => byId.get(cape.id)),
    ...cached.filter(cape => !remote.some(current => current.id === cape.id)).map(cape => byId.get(cape.id)),
  ];
}

function applyCapeSelection(capes, capeId) {
  const selectedId = String(capeId || '');
  return (Array.isArray(capes) ? capes : []).map(normalizeCape).filter(Boolean).map(cape => ({
    ...cape,
    state: selectedId && cape.id === selectedId ? 'ACTIVE' : 'INACTIVE',
  }));
}

module.exports = { applyCapeSelection, mergeCapeInventory, normalizeCape };
