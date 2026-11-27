'use strict';

function sanitizeMemory(value, fallback) {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? `${value}G` : String(value ?? '').trim();
  const match = normalized.match(/^(\d+)([MG])?$/i);
  if (!match) return fallback;
  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] || 'G').toUpperCase();
  const megabytes = unit === 'G' ? amount * 1024 : amount;
  if (megabytes < 512 || megabytes > 131072) return fallback;
  return `${amount}${unit}`;
}

function memoryMegabytes(value) {
  const match = String(value).match(/^(\d+)([MG])$/i);
  return match ? Number(match[1]) * (match[2].toUpperCase() === 'G' ? 1024 : 1) : 0;
}

function resolveLaunchMemory(instance = {}, settings = {}) {
  const hasOverride = instance.memoryOverride === true;
  return {
    min: hasOverride ? (instance.minMemory || '4G') : (settings.minMemory || instance.minMemory || '4G'),
    max: hasOverride ? (instance.maxMemory || '4G') : (settings.maxMemory || '4G'),
  };
}

function sanitizeStringRecord(record, maxEntries = 200, maxValueLen = 2048) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
  const out = {};
  for (const [key, value] of Object.entries(record).slice(0, maxEntries)) {
    const safeKey = String(key || '').trim().slice(0, 240);
    if (!safeKey) continue;
    if (typeof value === 'string') {
      out[safeKey] = value.slice(0, maxValueLen);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[safeKey] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = {};
      for (const [nKey, nVal] of Object.entries(value).slice(0, 40)) {
        const safeNKey = String(nKey || '').trim().slice(0, 80);
        if (!safeNKey) continue;
        if (typeof nVal === 'string') nested[safeNKey] = nVal.slice(0, maxValueLen);
        else if (typeof nVal === 'number' && Number.isFinite(nVal)) nested[safeNKey] = nVal;
        else if (typeof nVal === 'boolean') nested[safeNKey] = nVal;
      }
      out[safeKey] = nested;
    }
  }
  return out;
}

function sanitizeCustomTheme(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = String(raw.id || `custom-theme-${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || `custom-theme-${index + 1}`;
  const name = String(raw.name || 'Custom Theme').trim().slice(0, 80) || 'Custom Theme';
  const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 300) : '';
  const baseTheme = typeof raw.baseTheme === 'string' ? raw.baseTheme.trim().toLowerCase().slice(0, 40) : 'pine-dark';
  const baseUiStyle = typeof raw.baseUiStyle === 'string' ? raw.baseUiStyle.trim().toLowerCase().slice(0, 40) : 'pine-island';
  const updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now();
  const tokens = sanitizeStringRecord(raw.tokens, 80, 512);
  const background = sanitizeStringRecord(raw.background, 30, 2 * 1024 * 1024);
  const elementRules = sanitizeStringRecord(raw.elementRules, 300, 1024);
  const textOverrides = sanitizeStringRecord(raw.textOverrides, 300, 2048);
  const customCss = typeof raw.customCss === 'string' ? raw.customCss.slice(0, 131072) : '';
  return {
    id,
    name,
    description,
    baseTheme,
    baseUiStyle,
    updatedAt,
    tokens,
    background,
    elementRules,
    textOverrides,
    customCss,
  };
}

function sanitizeCustomThemes(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < Math.min(list.length, 50); i += 1) {
    const item = sanitizeCustomTheme(list[i], i);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

module.exports = {
  sanitizeMemory,
  memoryMegabytes,
  resolveLaunchMemory,
  sanitizeCustomTheme,
  sanitizeCustomThemes,
};
