'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCounterEndpoint,
  buildHeartbeatPayload,
  createOnlineCounterController,
} = require('../lib/online-counter');

test('online counter builds strictly anonymous 4-field payloads and validates HTTPS endpoints', () => {
  assert.equal(normalizeCounterEndpoint('https://counter.example.workers.dev/'), 'https://counter.example.workers.dev');
  assert.equal(normalizeCounterEndpoint('http://insecure.example.com'), '');
  assert.equal(normalizeCounterEndpoint('not-a-url'), '');

  const payload = buildHeartbeatPayload({
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    playing: true,
    version: '1.3.0',
    platform: 'linux',
  });
  assert.deepEqual(Object.keys(payload).sort(), ['platform', 'sessionId', 'state', 'version']);
  assert.equal(payload.state, 'playing');
  assert.equal(payload.platform, 'linux');
});

test('online counter respects opt-out, sends heartbeat/leave cleanly, and exposes exact transparency report', async () => {
  const requests = [];
  let enabled = true;
  let playing = false;
  const counter = createOnlineCounterController({
    appVersion: '1.3.0',
    platform: 'win32',
    endpoint: 'https://pine-counter.example.workers.dev',
    env: {},
    readEnabled: () => enabled,
    isPlaying: () => playing,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init.method, body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 204 });
    },
  });

  const info = counter.getTransparencyInfo();
  assert.equal(info.enabled, true);
  assert.equal(info.endpointConfigured, true);
  assert.equal(info.samplePayload.state, 'launcher');
  assert.equal(info.samplePayload.platform, 'win32');
  assert.ok(info.neverShared.length >= 4);

  assert.equal(await counter.sendHeartbeat(), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://pine-counter.example.workers.dev/heartbeat');
  assert.equal(requests[0].body.state, 'launcher');

  playing = true;
  assert.equal(await counter.sendHeartbeat(), true);
  assert.equal(requests[1].body.state, 'playing');

  // Opting out sends /leave and stops heartbeats
  enabled = false;
  await counter.syncEnabled(false);
  assert.equal(requests[2].url, 'https://pine-counter.example.workers.dev/leave');
  assert.equal(requests[2].body.sessionId, counter.sessionId);
  assert.equal(await counter.sendHeartbeat(), false);
  assert.equal(requests.length, 3);

  await counter.stop();
});

test('online counter stays completely idle when no endpoint is configured and fails silently on network errors', async () => {
  let called = 0;
  const idle = createOnlineCounterController({
    appVersion: '1.3.0',
    endpoint: '',
    env: {},
    readEnabled: () => true,
    isPlaying: () => false,
    fetchImpl: async () => { called += 1; return new Response(null, { status: 204 }); },
  });
  assert.equal(await idle.sendHeartbeat(), false);
  assert.equal(called, 0);

  const failing = createOnlineCounterController({
    appVersion: '1.3.0',
    endpoint: 'https://pine-counter.example.workers.dev',
    env: {},
    readEnabled: () => true,
    isPlaying: () => false,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(await failing.sendHeartbeat(), false);
});
