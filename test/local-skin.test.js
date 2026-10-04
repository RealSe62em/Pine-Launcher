'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { activeLocalSkin, normalizeSkinLibrary, removeCustomSkinLoaderConfig, removeLocalSkin, setActiveLocalSkin, writeCustomSkinLoaderConfig } = require('../lib/local-skin');

test('offline skin selection is stored per account and survives unrelated accounts', () => {
  const library = normalizeSkinLibrary({ version: 1, accounts: {
    alpha: [{ id: 'one', file: 'alpha/one.png', variant: 'slim' }],
    beta: [{ id: 'two', file: 'beta/two.png', variant: 'classic' }],
  } });
  setActiveLocalSkin(library, 'alpha', 'one');
  assert.equal(activeLocalSkin(library, 'alpha').id, 'one');
  assert.equal(activeLocalSkin(library, 'beta'), null);
  assert.deepEqual(library.activeSkins.alpha, { id: 'one', variant: 'slim' });
});

test('deleting an applied local skin clears its selection', () => {
  const library = normalizeSkinLibrary({ version: 1, accounts: { alpha: [{ id: 'one', file: 'alpha/one.png' }] } });
  setActiveLocalSkin(library, 'alpha', 'one');
  removeLocalSkin(library, 'alpha', 'one');
  assert.equal(activeLocalSkin(library, 'alpha'), null);
  assert.equal(library.activeSkins.alpha, undefined);
});

test('CustomSkinLoader config preserves user providers while setting Pine local model', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-local-skin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'CustomSkinLoader.json');
  fs.writeFileSync(file, JSON.stringify({ version: '14.0', loadlist: [{ name: 'Example', type: 'JsonAPI', root: 'https://example.invalid' }] }));
  const config = writeCustomSkinLoaderConfig(file, 'slim');
  assert.equal(config.loadlist.find(item => item.name === 'PineLocalSkin').model, 'slim');
  assert.ok(config.loadlist.some(item => item.name === 'Example'));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).loadlist[0].skin, 'PineLocalSkin/skins/{USERNAME}.png');
  assert.equal(removeCustomSkinLoaderConfig(file), true);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).loadlist.some(item => item.name === 'Example'));
  assert.ok(!JSON.parse(fs.readFileSync(file, 'utf8')).loadlist.some(item => item.name === 'PineLocalSkin'));
});
