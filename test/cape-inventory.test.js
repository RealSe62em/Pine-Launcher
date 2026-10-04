'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCapeSelection, mergeCapeInventory } = require('../lib/cape-inventory');

test('unequipping does not remove previously observed owned capes', () => {
  const cached = [{ id: 'pan', alias: 'Pan Cape', url: 'https://textures.minecraft.net/texture/pan', state: 'ACTIVE' }];
  assert.deepEqual(mergeCapeInventory(cached, []), [{
    id: 'pan', alias: 'Pan Cape', url: 'https://textures.minecraft.net/texture/pan', state: 'INACTIVE',
  }]);
});

test('newly claimed capes are added and the remote active state wins', () => {
  const cached = [{ id: 'pan', alias: 'Pan Cape', url: 'pan', state: 'ACTIVE' }];
  const remote = [{ id: 'twitch', alias: 'Twitch Cape', url: 'twitch', state: 'ACTIVE' }];
  assert.deepEqual(mergeCapeInventory(cached, remote), [
    { id: 'twitch', alias: 'Twitch Cape', url: 'twitch', state: 'ACTIVE' },
    { id: 'pan', alias: 'Pan Cape', url: 'pan', state: 'INACTIVE' },
  ]);
});

test('successful equip and unequip operations only change active state', () => {
  const capes = [
    { id: 'pan', alias: 'Pan Cape', url: 'pan', state: 'ACTIVE' },
    { id: 'twitch', alias: 'Twitch Cape', url: 'twitch', state: 'INACTIVE' },
  ];
  assert.deepEqual(applyCapeSelection(capes, 'twitch').map(cape => [cape.id, cape.state]), [
    ['pan', 'INACTIVE'], ['twitch', 'ACTIVE'],
  ]);
  assert.deepEqual(applyCapeSelection(capes, null).map(cape => [cape.id, cape.state]), [
    ['pan', 'INACTIVE'], ['twitch', 'INACTIVE'],
  ]);
});
