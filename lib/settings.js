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
    max: hasOverride ? (instance.maxMemory || '4G') : (settings.maxMemory || instance.maxMemory || '4G'),
  };
}

module.exports = { sanitizeMemory, memoryMegabytes, resolveLaunchMemory };
