// @ts-check
'use strict';

const crypto = require('node:crypto');

// Public Cloudflare Worker endpoint for strictly anonymous session heartbeats.
// Stats (/stats, /dashboard) are locked behind the developer's Cloudflare ADMIN_TOKEN secret.
const DEFAULT_ONLINE_COUNTER_ENDPOINT = 'https://pine-launcher-online-counter.seleemjobs.workers.dev';
const HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes

const NEVER_SHARED_ITEMS = Object.freeze([
  'Minecraft username, Microsoft account, email, or player UUID',
  'IP address (never stored by the counter)',
  'Multiplayer server addresses, worlds, or chat/game logs',
  'Installed mods, modpacks, resource packs, or launcher settings',
  'Hardware IDs, MAC addresses, or persistent tracking cookies',
]);

/**
 * Normalize and validate an HTTPS online-counter endpoint URL.
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeCounterEndpoint(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '';
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * Build the strict, minimal 4-field anonymous heartbeat payload.
 * @param {{ sessionId: string, playing: boolean, version: string, platform: string }} input
 */
function buildHeartbeatPayload({ sessionId, playing, version, platform }) {
  const normalizedPlatform = ['win32', 'linux', 'darwin'].includes(platform) ? platform : 'other';
  return {
    sessionId: String(sessionId),
    state: playing ? 'playing' : 'launcher',
    version: String(version || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 32) || 'unknown',
    platform: normalizedPlatform,
  };
}

/**
 * Create the Pine Launcher anonymous online-counter client.
 * Generates a fresh random sessionId in memory per launch (never written to disk).
 * @param {{
 *   appVersion: string,
 *   platform?: string,
 *   endpoint?: string,
 *   env?: NodeJS.ProcessEnv,
 *   fetchImpl?: typeof globalThis.fetch,
 *   intervalMs?: number,
 *   readEnabled: () => boolean,
 *   isPlaying: () => boolean,
 * }} options
 */
function createOnlineCounterController({
  appVersion,
  platform = process.platform,
  endpoint = DEFAULT_ONLINE_COUNTER_ENDPOINT,
  env = process.env,
  fetchImpl = globalThis.fetch,
  intervalMs = HEARTBEAT_INTERVAL_MS,
  readEnabled,
  isPlaying,
}) {
  const sessionId = crypto.randomUUID();
  const resolvedEndpoint = normalizeCounterEndpoint(env.PINE_ONLINE_COUNTER_URL || endpoint);
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  let lastSentAt = null;
  let hasSentHeartbeat = false;

  /** @returns {boolean} */
  function isEnabled() {
    try {
      return readEnabled() !== false;
    } catch {
      return true;
    }
  }

  /** @returns {{ sessionId: string, state: string, version: string, platform: string }} */
  function currentPayload() {
    return buildHeartbeatPayload({
      sessionId,
      playing: Boolean(isPlaying()),
      version: appVersion,
      platform,
    });
  }

  /**
   * Send a single anonymous heartbeat if enabled and an endpoint is configured.
   * Always fails silently so network issues never affect the launcher.
   * @returns {Promise<boolean>}
   */
  async function sendHeartbeat() {
    if (!resolvedEndpoint || !isEnabled()) return false;
    try {
      const payload = currentPayload();
      const res = await fetchImpl(`${resolvedEndpoint}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        hasSentHeartbeat = true;
        lastSentAt = new Date().toISOString();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Remove this ephemeral session immediately on clean quit or opt-out.
   * @returns {Promise<boolean>}
   */
  async function sendLeave() {
    if (!resolvedEndpoint || !hasSentHeartbeat) return false;
    hasSentHeartbeat = false;
    try {
      const res = await fetchImpl(`${resolvedEndpoint}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
        signal: AbortSignal.timeout(4000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function start() {
    if (timer) return;
    if (isEnabled() && resolvedEndpoint) {
      void sendHeartbeat();
    }
    timer = setInterval(() => {
      if (isEnabled() && resolvedEndpoint) {
        void sendHeartbeat();
      }
    }, Math.max(15_000, Number(intervalMs) || HEARTBEAT_INTERVAL_MS));
    timer.unref?.();
  }

  async function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await sendLeave();
  }

  /**
   * Call when the user toggles the setting or starts/stops Minecraft.
   * @param {boolean} enabled
   */
  async function syncEnabled(enabled) {
    if (!enabled) {
      await sendLeave();
      return false;
    }
    return sendHeartbeat();
  }

  /**
   * Exact transparency report shown in the "What's shared?" modal.
   */
  function getTransparencyInfo() {
    return {
      enabled: isEnabled(),
      endpointConfigured: Boolean(resolvedEndpoint),
      intervalMinutes: Math.round((Number(intervalMs) || HEARTBEAT_INTERVAL_MS) / 60000),
      lastSentAt,
      samplePayload: currentPayload(),
      neverShared: [...NEVER_SHARED_ITEMS],
    };
  }

  return {
    sessionId,
    endpoint: resolvedEndpoint,
    start,
    stop,
    sendHeartbeat,
    sendLeave,
    syncEnabled,
    getTransparencyInfo,
  };
}

module.exports = {
  DEFAULT_ONLINE_COUNTER_ENDPOINT,
  HEARTBEAT_INTERVAL_MS,
  NEVER_SHARED_ITEMS,
  normalizeCounterEndpoint,
  buildHeartbeatPayload,
  createOnlineCounterController,
};
