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
