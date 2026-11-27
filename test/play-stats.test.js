'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addPlaySession, buildPlayStatsDashboard } = require('../lib/play-stats');

test('play statistics preserve lifetime totals and aggregate tracked destinations', () => {
  let stats = addPlaySession({}, {
    id: 'one', instanceId: 'main-id', instanceName: 'Main', startedAt: '2026-09-22T18:00:00.000Z', endedAt: '2026-09-22T19:00:00.000Z', durationSeconds: 3600,
    segments: [{ type: 'multiplayer', key: 'play.example.com', label: 'Example Server', seconds: 2400 }, { type: 'menu', key: 'menu', label: 'Main menu', seconds: 1200 }],
  });
  stats = addPlaySession(stats, {
    id: 'two', instanceId: 'main-id', instanceName: 'Main', startedAt: '2026-09-22T20:00:00.000Z', durationSeconds: 1800,
    segments: [{ type: 'singleplayer', key: 'world', label: 'Pine Valley', seconds: 1800 }],
  });
  const dashboard = buildPlayStatsDashboard(stats, [{ id: 'main-id', name: 'Main', totalPlaytimeSeconds: 7200 }], new Date('2026-09-22T23:00:00.000Z'));
  assert.equal(dashboard.totalSeconds, 7200);
  assert.equal(dashboard.trackedSeconds, 5400);
  assert.equal(dashboard.previousSeconds, 1800);
  assert.equal(dashboard.instances[0].seconds, 7200);
  assert.equal(dashboard.servers[0].label, 'Example Server');
  assert.equal(dashboard.servers[0].seconds, 2400);
  assert.equal(dashboard.worlds[0].label, 'Pine Valley');
  assert.equal(dashboard.sessionCount, 2);
});

test('duplicate session identifiers are replaced instead of counted twice', () => {
  const first = addPlaySession({}, { id: 'same', instanceName: 'Main', startedAt: '2026-09-20T10:00:00Z', durationSeconds: 60 });
  const second = addPlaySession(first, { id: 'same', instanceName: 'Main', startedAt: '2026-09-20T10:00:00Z', durationSeconds: 120 });
  assert.equal(second.sessions.length, 1);
  assert.equal(second.sessions[0].durationSeconds, 120);
});

test('multi-day sessions split across local calendar days and never exceed 24h in a single day', () => {
  const start = new Date(2026, 10, 21, 10, 0, 0); // Local Nov 21 10:00 AM
  const durationSeconds = 28 * 3600 + 32 * 60; // 28h 32m (ends Nov 22 14:32)
  const stats = addPlaySession({}, {
    id: 'marathon',
    instanceName: 'Main',
    startedAt: start.toISOString(),
    durationSeconds,
  });
  const dashboard = buildPlayStatsDashboard(stats, [], new Date(2026, 10, 23, 12, 0, 0));
  const nov21 = dashboard.daily.find(d => d.key === '2026-11-21');
  const nov22 = dashboard.daily.find(d => d.key === '2026-11-22');
  assert.ok(nov21 && nov22);
  assert.equal(nov21.seconds, 14 * 3600); // 10:00 -> 24:00 = 14h
  assert.equal(nov22.seconds, 14 * 3600 + 32 * 60); // 00:00 -> 14:32 = 14h 32m
  for (const day of dashboard.daily) {
    assert.ok(day.seconds <= 86400, `${day.key} exceeded 24h: ${day.seconds}`);
  }
});
