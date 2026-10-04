'use strict';

const path = require('path');
const AdmZip = require('adm-zip');

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ICON_MIME = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

function preferredIconPath(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value)
    .filter(([, iconPath]) => typeof iconPath === 'string')
    .sort(([left], [right]) => (Number(right) || 0) - (Number(left) || 0))[0]?.[1] || '';
}

function tomlValue(source, key) {
  const match = String(source || '').match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'im'));
  return match?.[1] || '';
}

function safeEmbeddedIcon(archive, requestedPath) {
  const clean = String(requestedPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const mime = ICON_MIME[path.extname(clean).toLowerCase()];
  if (!clean || !mime || clean.includes('../')) return null;
  const entry = archive.getEntry(clean);
  if (!entry || entry.isDirectory || Number(entry.header?.size || 0) > MAX_ICON_BYTES) return null;
  const data = entry.getData();
  if (!data.length || data.length > MAX_ICON_BYTES) return null;
  return `data:${mime};base64,${data.toString('base64')}`;
}

function readEmbeddedModPresentation(jarPath) {
  try {
    const archive = new AdmZip(jarPath);
    let title = '';
    let iconPath = '';

    const fabricEntry = archive.getEntry('fabric.mod.json');
    if (fabricEntry) {
      const metadata = JSON.parse(fabricEntry.getData().toString('utf8'));
      title = typeof metadata.name === 'string' ? metadata.name : '';
      iconPath = preferredIconPath(metadata.icon);
    }

    if (!title || !iconPath) {
      const quiltEntry = archive.getEntry('quilt.mod.json');
      if (quiltEntry) {
        const metadata = JSON.parse(quiltEntry.getData().toString('utf8'))?.quilt_loader?.metadata || {};
        if (!title && typeof metadata.name === 'string') title = metadata.name;
        if (!iconPath) iconPath = preferredIconPath(metadata.icon);
      }
    }

    if (!title || !iconPath) {
      const forgeEntry = archive.getEntry('META-INF/neoforge.mods.toml') || archive.getEntry('META-INF/mods.toml');
      if (forgeEntry) {
        const metadata = forgeEntry.getData().toString('utf8');
        if (!title) title = tomlValue(metadata, 'displayName');
        if (!iconPath) iconPath = tomlValue(metadata, 'logoFile');
      }
    }

    return {
      title: String(title || '').trim().slice(0, 160),
      iconUrl: safeEmbeddedIcon(archive, iconPath),
    };
  } catch {
    return { title: '', iconUrl: null };
  }
}

module.exports = { readEmbeddedModPresentation };
