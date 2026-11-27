const PRIDE_ACCOUNT_NAMES = Object.freeze([
  'undrrwrldd',
  'se62em',
  'shemes',
  'exobeast',
]);

const PRIDE_ACCOUNT_SET = new Set(PRIDE_ACCOUNT_NAMES);

export function normalizePrideAccountName(value) {
  return String(value || '').trim().toLowerCase();
}

export function isPrideAccount(profile) {
  return PRIDE_ACCOUNT_SET.has(normalizePrideAccountName(profile?.name));
}

export function getPrideModeState(profile, settings = {}) {
  const eligible = isPrideAccount(profile);
  return {
    eligible,
    enabled: eligible && settings.gayMode !== false,
  };
}

export { PRIDE_ACCOUNT_NAMES };
