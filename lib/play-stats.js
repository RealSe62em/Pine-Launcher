'use strict';

const MAX_SESSIONS = 5000;
const MAX_SESSION_SECONDS = 7 * 24 * 60 * 60;
const SECONDS_PER_DAY = 24 * 60 * 60;

function cleanText(value, fallback = '') {
  return String(value || fallback).replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function clampSeconds(value) {
  return Math.max(0, Math.min(MAX_SESSION_SECONDS, Math.round(Number(value) || 0)));
}

function normalizeLifetimeSeconds(value) {
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(value) || 0)));
}

function normalizeSegment(segment) {
  if (!segment || !['menu', 'singleplayer', 'multiplayer'].includes(segment.type)) return null;
  const seconds = clampSeconds(segment.seconds);
  if (!seconds) return null;
  return {
    type: segment.type,
    key: cleanText(segment.key || segment.label || segment.type).toLowerCase(),
    label: cleanText(segment.label, segment.type === 'menu' ? 'Main menu' : segment.type),
    seconds,
  };
}

function normalizeSession(session) {
  const startedAt = new Date(session?.startedAt || 0);
  if (!Number.isFinite(startedAt.getTime())) return null;
  const durationSeconds = clampSeconds(session.durationSeconds);
  if (!durationSeconds) return null;
  const segments = (Array.isArray(session.segments) ? session.segments : []).map(normalizeSegment).filter(Boolean);
  const expectedEnd = startedAt.getTime() + durationSeconds * 1000;
  const suppliedEnd = new Date(session.endedAt || expectedEnd);
  const endedAt = Number.isFinite(suppliedEnd.getTime()) ? suppliedEnd : new Date(expectedEnd);
  return {
    id: cleanText(session.id) || `${startedAt.toISOString()}:${cleanText(session.instanceId || session.instanceName)}`,
    instanceId: cleanText(session.instanceId || session.instanceName),
    instanceName: cleanText(session.instanceName, 'Unknown instance'),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
    segments,
  };
}

function normalizePlayStats(value) {
  const sessions = (Array.isArray(value?.sessions) ? value.sessions : [])
    .map(normalizeSession).filter(Boolean)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, MAX_SESSIONS);
  return { format: 1, sessions };
}

function addPlaySession(value, session) {
  const state = normalizePlayStats(value);
  const clean = normalizeSession(session);
  if (!clean) return state;
  state.sessions = [clean, ...state.sessions.filter(item => item.id !== clean.id)].slice(0, MAX_SESSIONS);
  return state;
}

function localDayKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function increment(map, key, seconds, extra = {}) {
  if (!key || !seconds) return;
  const current = map.get(key) || { key, seconds: 0, ...extra };
  current.seconds += seconds;
  if (extra.label) current.label = extra.label;
  if (extra.instanceName) current.instanceName = extra.instanceName;
  map.set(key, current);
}

function buildPlayStatsDashboard(value, instances = [], now = new Date()) {
  const state = normalizePlayStats(value);
  const current = new Date(now);
  const todayStart = startOfLocalDay(current);
  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 6);
  const dailyStart = new Date(todayStart); dailyStart.setDate(dailyStart.getDate() - 13);
  const daily = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(dailyStart); date.setDate(date.getDate() + index);
    return { key: localDayKey(date), label: date.toLocaleDateString(undefined, { weekday: 'short' }), date: date.toISOString(), seconds: 0 };
  });
  const dailyByKey = new Map(daily.map(item => [item.key, item]));
  const trackedByInstance = new Map();
  const servers = new Map();
  const worlds = new Map();
  const modes = new Map([['menu', { key: 'menu', label: 'Menus', seconds: 0 }], ['singleplayer', { key: 'singleplayer', label: 'Singleplayer', seconds: 0 }], ['multiplayer', { key: 'multiplayer', label: 'Multiplayer', seconds: 0 }]]);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0 }));
  let trackedSeconds = 0;
  let todaySeconds = 0;
  let weekSeconds = 0;

  const activeDays = new Set();

  for (const session of state.sessions) {
    const started = new Date(session.startedAt);
    const seconds = session.durationSeconds;
    const endMs = started.getTime() + seconds * 1000;
    trackedSeconds += seconds;

    // Split session across local calendar days so overnight or multi-day sessions
    // never dump > 24 hours onto a single starting day.
    let cursorMs = started.getTime();
    while (cursorMs < endMs) {
      const cursorDate = new Date(cursorMs);
      const nextMidnight = new Date(cursorDate);
      nextMidnight.setHours(24, 0, 0, 0);
      const sliceEndMs = Math.min(endMs, nextMidnight.getTime());
      const sliceSeconds = Math.max(0, Math.round((sliceEndMs - cursorMs) / 1000));
      if (sliceSeconds > 0) {
        const dayKey = localDayKey(cursorDate);
        activeDays.add(dayKey);
        if (sliceEndMs > todayStart.getTime()) {
          const todaySliceStart = Math.max(cursorMs, todayStart.getTime());
          todaySeconds += Math.max(0, Math.round((sliceEndMs - todaySliceStart) / 1000));
        }
        if (sliceEndMs > weekStart.getTime()) {
          const weekSliceStart = Math.max(cursorMs, weekStart.getTime());
          weekSeconds += Math.max(0, Math.round((sliceEndMs - weekSliceStart) / 1000));
        }
        const day = dailyByKey.get(dayKey);
        if (day) day.seconds += sliceSeconds;
      }
      cursorMs = sliceEndMs;
    }

    // Split hour-of-day buckets across the hours the session actually ran.
    let hourCursorMs = started.getTime();
    while (hourCursorMs < endMs) {
      const hDate = new Date(hourCursorMs);
      const nextHour = new Date(hDate);
      nextHour.setMinutes(60, 0, 0);
      const hEndMs = Math.min(endMs, nextHour.getTime());
      const hSec = Math.max(0, Math.round((hEndMs - hourCursorMs) / 1000));
      if (hSec > 0) hours[hDate.getHours()].seconds += hSec;
      hourCursorMs = hEndMs;
    }

    increment(trackedByInstance, session.instanceId || session.instanceName, seconds, { instanceName: session.instanceName });
    for (const segment of session.segments) {
      increment(modes, segment.type, segment.seconds, { label: segment.type === 'menu' ? 'Menus' : segment.type === 'singleplayer' ? 'Singleplayer' : 'Multiplayer' });
      if (segment.type === 'multiplayer') increment(servers, segment.key, segment.seconds, { label: segment.label, instanceName: session.instanceName });
      if (segment.type === 'singleplayer') increment(worlds, `${session.instanceId}:${segment.key}`, segment.seconds, { label: segment.label, instanceName: session.instanceName });
    }
  }

  // Physically impossible to play more than 24h in one calendar day (e.g. overlapping/duplicated historical entries).
  for (const day of daily) {
    day.seconds = Math.min(SECONDS_PER_DAY, day.seconds);
  }
  todaySeconds = Math.min(SECONDS_PER_DAY, todaySeconds);
  weekSeconds = Math.min(7 * SECONDS_PER_DAY, weekSeconds);

  const instanceRows = new Map();
  let lifetimeSeconds = 0;
  for (const instance of instances) {
    const id = cleanText(instance.id || instance.name);
    const tracked = trackedByInstance.get(id)?.seconds || trackedByInstance.get(cleanText(instance.name))?.seconds || 0;
    const total = Math.max(tracked, normalizeLifetimeSeconds(instance.totalPlaytimeSeconds));
    lifetimeSeconds += total;
    instanceRows.set(id, { key: id, label: cleanText(instance.name, 'Instance'), seconds: total, trackedSeconds: tracked, iconData: typeof instance.iconData === 'string' ? instance.iconData : null, gameVersion: cleanText(instance.gameVersion), loader: cleanText(instance.loader, 'vanilla') });
  }
  for (const item of trackedByInstance.values()) {
    if ([...instanceRows.values()].some(row => row.key === item.key || row.label === item.instanceName)) continue;
    lifetimeSeconds += item.seconds;
    instanceRows.set(item.key, { key: item.key, label: item.instanceName, seconds: item.seconds, trackedSeconds: item.seconds, iconData: null, gameVersion: '', loader: '' });
  }
  lifetimeSeconds = Math.max(lifetimeSeconds, trackedSeconds);
  const averageSeconds = state.sessions.length ? Math.round(trackedSeconds / state.sessions.length) : 0;
  const sorted = map => [...map.values()].filter(item => item.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  let streakDays = 0;
  const cursor = new Date(todayStart);
  if (!activeDays.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.has(localDayKey(cursor))) { streakDays++; cursor.setDate(cursor.getDate() - 1); }
  const peakHour = hours.reduce((best, item) => item.seconds > best.seconds ? item : best, hours[0]);

  return {
    totalSeconds: lifetimeSeconds,
    trackedSeconds,
    previousSeconds: Math.max(0, lifetimeSeconds - trackedSeconds),
    todaySeconds,
    weekSeconds,
    sessionCount: state.sessions.length,
    averageSeconds,
    streakDays,
    peakHour: peakHour.seconds ? peakHour.hour : null,
    daily,
    instances: [...instanceRows.values()].filter(item => item.seconds > 0).sort((a, b) => b.seconds - a.seconds),
    servers: sorted(servers).slice(0, 12),
    worlds: sorted(worlds).slice(0, 12),
    modes: sorted(modes),
    hours,
    recentSessions: state.sessions.slice(0, 12),
  };
}

module.exports = { addPlaySession, buildPlayStatsDashboard, normalizePlayStats };
