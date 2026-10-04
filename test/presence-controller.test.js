'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresenceController, loaderLabel } = require('../lib/presence-controller');

class FakePresence {
  constructor(applicationId, options) {
    this.applicationId = applicationId;
    this.options = options;
    this.enabled = [];
    this.activities = [];
    FakePresence.instance = this;
  }

  setEnabled(value) { this.enabled.push(value); }
  setActivity(value) { this.activities.push(value); }
  destroy() { this.destroyed = true; }
}

test('presence controller preserves launcher, launch, and game activity details', () => {
  assert.equal(loaderLabel({ gameVersion: '1.21.1', loader: 'fabric' }), 'Minecraft 1.21.1 · Fabric');
  assert.equal(loaderLabel({ gameVersion: '1.20.1', loader: 'vanilla' }), 'Minecraft 1.20.1 · Vanilla');

  const controller = createPresenceController({
    PresenceClass: FakePresence,
    readSettings: () => ({ discordPresence: true }),
    parseGameLine: () => ({ type: 'multiplayer', address: 'play.example.net', port: 25565 }),
    displayServerAddress: address => address,
  });

  controller.refresh();
  assert.equal(FakePresence.instance.activities.at(-1).details, 'Browsing instances');

  const instance = { name: 'Test Pack', gameVersion: '1.21.1', loader: 'fabric' };
  controller.setContext({ type: 'launching', instance, startTimestamp: 123 }, { discordPresence: true });
  assert.equal(FakePresence.instance.activities.at(-1).details, 'Launching Test Pack');

  controller.updateFromGameLine('joined', instance, { discordPresence: true }, 123);
  assert.equal(FakePresence.instance.activities.at(-1).state, 'On play.example.net');

  controller.refresh({ discordPresence: false });
  assert.equal(FakePresence.instance.enabled.at(-1), false);
  controller.destroy();
  assert.equal(FakePresence.instance.destroyed, true);
});
