'use strict';

function accountKey(account) {
  const type = account?.meta?.type === 'offline' ? 'offline' : 'microsoft';
  const identity = account?.profile?.uuid || account?.profile?.name || '';
  return `${type}:${String(identity).toLowerCase()}`;
}

function isUsableAccount(account) {
  return Boolean(account && typeof account === 'object'
    && typeof account.profile?.name === 'string'
    && typeof account.profile?.uuid === 'string');
}

function normalizeAuthStore(value) {
  if (value && value.version === 2 && Array.isArray(value.accounts)) {
    const accounts = value.accounts.filter(isUsableAccount);
    const selectedKey = accounts.some(account => accountKey(account) === value.selectedKey)
      ? value.selectedKey
      : (accounts[0] ? accountKey(accounts[0]) : null);
    return { version: 2, selectedKey, accounts };
  }
  if (isUsableAccount(value)) {
    return { version: 2, selectedKey: accountKey(value), accounts: [value] };
  }
  return { version: 2, selectedKey: null, accounts: [] };
}

function selectedAccount(store) {
  const normalized = normalizeAuthStore(store);
  return normalized.accounts.find(account => accountKey(account) === normalized.selectedKey) || null;
}

function upsertAccount(store, account) {
  if (!isUsableAccount(account)) throw new Error('Account data is incomplete');
  const normalized = normalizeAuthStore(store);
  const key = accountKey(account);
  const existing = normalized.accounts.findIndex(item => accountKey(item) === key);
  const saved = { ...account, savedAt: new Date().toISOString() };
  if (existing >= 0) normalized.accounts[existing] = saved;
  else normalized.accounts.push(saved);
  normalized.selectedKey = key;
  return normalized;
}

function selectAccount(store, key) {
  const normalized = normalizeAuthStore(store);
  if (!normalized.accounts.some(account => accountKey(account) === key)) throw new Error('Account not found');
  normalized.selectedKey = key;
  return normalized;
}

function deleteAccount(store, key) {
  const normalized = normalizeAuthStore(store);
  normalized.accounts = normalized.accounts.filter(account => accountKey(account) !== key);
  if (normalized.selectedKey === key) {
    normalized.selectedKey = normalized.accounts[0] ? accountKey(normalized.accounts[0]) : null;
  }
  return normalized;
}

function publicAccounts(store) {
  const normalized = normalizeAuthStore(store);
  return {
    selectedKey: normalized.selectedKey,
    accounts: normalized.accounts.map(account => ({
      key: accountKey(account),
      profile: { name: account.profile.name, uuid: account.profile.uuid },
      meta: { type: account.meta?.type === 'offline' ? 'offline' : 'microsoft' },
      savedAt: account.savedAt || null,
    })),
  };
}

module.exports = {
  accountKey,
  deleteAccount,
  normalizeAuthStore,
  publicAccounts,
  selectAccount,
  selectedAccount,
  upsertAccount,
};
