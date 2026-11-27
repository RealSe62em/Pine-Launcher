import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPrideModeState,
  isPrideAccount,
  normalizePrideAccountName,
  PRIDE_ACCOUNT_NAMES,
} from '../renderer/pride-mode.js';

test('pride eligibility is explicit, trimmed, and case-insensitive', () => {
  assert.equal(normalizePrideAccountName('  Se62Em  '), 'se62em');
  for (const name of PRIDE_ACCOUNT_NAMES) {
    assert.equal(isPrideAccount({ name: name.toUpperCase() }), true);
  }
  assert.equal(isPrideAccount({ name: 'someone-else' }), false);
  assert.equal(isPrideAccount(null), false);
});

test('pride mode follows eligibility and the saved preference', () => {
  assert.deepEqual(getPrideModeState({ name: 'se62em' }, {}), { eligible: true, enabled: true });
  assert.deepEqual(getPrideModeState({ name: 'se62em' }, { gayMode: false }), { eligible: true, enabled: false });
  assert.deepEqual(getPrideModeState({ name: 'someone-else' }, { gayMode: true }), { eligible: false, enabled: false });
});
