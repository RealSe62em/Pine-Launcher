'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

function freshModules() {
  const patchPath = require.resolve('../lib/mcl-reliability');
  const handlerPath = require.resolve('minecraft-launcher-core/components/handler');
  delete require.cache[patchPath];
  delete require.cache[handlerPath];
  return {
    install: require('../lib/mcl-reliability').installMclReliabilityPatches,
    Handler: require('minecraft-launcher-core/components/handler'),
  };
}

function makeHandler(Handler) {
  const client = new EventEmitter();
  client.options = { overrides: {}, timeout: 1000 };
  return new Handler(client);
}

test('patched downloads reject instead of silently succeeding', async () => {
  const { install, Handler } = freshModules();
  install({ fetchImpl: async () => { throw new Error('network blocked'); } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-download-fail-'));
  try {
    await assert.rejects(makeHandler(Handler).downloadAsync('https://example.invalid/file.jar', dir, 'file.jar', false, 'classes'), /network blocked/);
    assert.equal(fs.existsSync(path.join(dir, 'file.jar')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patched downloads commit complete responses atomically', async () => {
  const { install, Handler } = freshModules();
  const body = Buffer.from('complete file');
  install({ fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-download-ok-'));
  try {
    await makeHandler(Handler).downloadAsync('https://example.test/file.jar', dir, 'file.jar', false, 'classes');
    assert.deepEqual(fs.readFileSync(path.join(dir, 'file.jar')), body);
    assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.part')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
