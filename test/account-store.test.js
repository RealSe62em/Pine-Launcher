'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { accountKey, deleteAccount, normalizeAuthStore, publicAccounts, selectAccount, selectedAccount, upsertAccount } = require('../lib/account-store');

const offline = name => ({ access_token: '', profile: { name, uuid: `uuid-${name}` }, meta: { type: 'offline' } });
const microsoft = name => ({ access_token: `token-${name}`, refresh_token: `refresh-${name}`, profile: { name, uuid: `uuid-${name}` }, meta: { type: 'msa' } });

test('migrates a legacy single account into the multi-account store', () => {
  const store = normalizeAuthStore(microsoft('Alex'));
  assert.equal(store.accounts.length, 1);
  assert.equal(selectedAccount(store).profile.name, 'Alex');
});

test('adds, switches, updates, and individually deletes accounts', () => {
  let store = upsertAccount(null, microsoft('Alex'));
  store = upsertAccount(store, offline('Steve'));
  assert.equal(selectedAccount(store).profile.name, 'Steve');
  store = selectAccount(store, accountKey(store.accounts[0]));
  assert.equal(selectedAccount(store).profile.name, 'Alex');
  store = upsertAccount(store, { ...microsoft('Alex'), access_token: 'replacement' });
  assert.equal(store.accounts.length, 2);
  assert.equal(selectedAccount(store).access_token, 'replacement');
  store = deleteAccount(store, accountKey(selectedAccount(store)));
  assert.equal(store.accounts.length, 1);
  assert.equal(selectedAccount(store).profile.name, 'Steve');
});

test('never exposes account tokens to the renderer account list', () => {
  const visible = publicAccounts(upsertAccount(null, microsoft('Alex')));
  assert.equal(visible.accounts[0].profile.name, 'Alex');
  assert.equal('access_token' in visible.accounts[0], false);
  assert.equal(JSON.stringify(visible).includes('refresh-Alex'), false);
});
