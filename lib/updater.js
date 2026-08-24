'use strict';

const AUTO_CHECK_DELAY_MS = 15 * 1000;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function releaseNotesText(notes) {
  const value = Array.isArray(notes)
    ? notes.map(item => item?.note || '').filter(Boolean).join('\n\n')
    : String(notes || '');
  return value.replace(/\r\n/g, '\n').slice(0, 8000);
}

function updaterErrorMessage(error) {
  const value = error?.message || String(error || 'Unknown update error');
  return value.replace(/[\r\n]+/g, ' ').slice(0, 1000);
}

function userFacingUpdateError(error, context = 'Update check failed') {
  const detail = updaterErrorMessage(error);
  if (/latest\.yml/i.test(detail) && /(?:404|not found)/i.test(detail)) {
    return 'Automatic update information is not available for this release yet. You can keep using Pine normally and try again after the next release.';
  }
  if (/(?:ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|network|offline|timed?\s*out)/i.test(detail)) {
    return 'Pine could not reach GitHub. Check your internet connection and try again.';
  }
  if (/403|rate limit/i.test(detail)) {
    return 'GitHub temporarily limited update checks. Please try again in a few minutes.';
  }
  return `${context}. Please try again later.`;
}

function createUpdateManager({
  autoUpdater,
  currentVersion,
  isPackaged,
  platform = process.platform,
  arch = process.arch,
  send = () => {},
  isGameActive = () => false,
  log = () => {},
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
  clearTimeoutFn = clearTimeout,
  clearIntervalFn = clearInterval,
  fetchLatestRelease = null,
  autoCheckDelayMs = AUTO_CHECK_DELAY_MS,
  autoCheckIntervalMs = AUTO_CHECK_INTERVAL_MS,
} = {}) {
  if (!autoUpdater) throw new Error('autoUpdater is required');

  // System package managers own Debian and Arch installations. Keep in-app
  // installation disabled until Pine has an apt or Pacman repository; Windows
  // continues to use the existing NSIS update path.
  const supported = Boolean(platform === 'linux' || (isPackaged && platform === 'win32'));
  const automaticInstallSupported = Boolean(isPackaged && platform === 'win32');
  let started = false;
  let checkTimer = null;
  let intervalTimer = null;
  let state = {
    status: supported ? 'idle' : 'unsupported',
    currentVersion: String(currentVersion || '0.0.0'),
    availableVersion: null,
    releaseDate: null,
    releaseNotes: '',
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
    message: supported
      ? 'Pine checks GitHub Releases for updates.'
      : 'Update checks are available in installed builds.',
    manualDownloadUrl: null,
    installBlocked: false,
  };

  function snapshot() {
    return { ...state, gameActive: Boolean(isGameActive()) };
  }

  function publish(patch = {}) {
    state = { ...state, ...patch };
    const value = snapshot();
    try { send(value); } catch {}
    return value;
  }

  function infoPatch(info = {}) {
    return {
      availableVersion: info.version ? String(info.version) : state.availableVersion,
      releaseDate: info.releaseDate || state.releaseDate,
      releaseNotes: releaseNotesText(info.releaseNotes) || state.releaseNotes,
    };
  }

  function reportError(error, context) {
    const message = updaterErrorMessage(error);
    log('error', `${context}: ${message}`);
    return publish({
      status: 'error',
      message: userFacingUpdateError(error, context),
      installBlocked: false,
    });
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  if (arch === 'arm64') autoUpdater.channel = 'latest-arm64';
  autoUpdater.logger = {
    debug: message => log('debug', String(message)),
    info: message => log('info', String(message)),
    warn: message => log('warn', String(message)),
    error: message => log('error', updaterErrorMessage(message)),
  };

  autoUpdater.on('checking-for-update', () => {
    log('info', 'Checking GitHub Releases');
    publish({ status: 'checking', message: 'Checking for updates…', installBlocked: false });
  });
  autoUpdater.on('update-available', info => {
    log('info', `Update ${info?.version || 'unknown'} is available`);
    publish({
      ...infoPatch(info),
      status: 'available',
      percent: 0,
      transferred: 0,
      total: 0,
      bytesPerSecond: 0,
      message: `Pine Launcher ${info?.version || ''} is ready to download.`.trim(),
      installBlocked: false,
    });
  });
  autoUpdater.on('update-not-available', info => {
    log('info', 'Pine Launcher is up to date');
    publish({
      status: 'not-available',
      currentVersion: String(currentVersion || info?.version || state.currentVersion),
      availableVersion: null,
      releaseDate: null,
      releaseNotes: '',
      percent: 0,
      message: 'You are using the latest version.',
      installBlocked: false,
    });
  });
  autoUpdater.on('download-progress', progress => {
    publish({
      status: 'downloading',
      percent: clampPercent(progress?.percent),
      transferred: Number(progress?.transferred) || 0,
      total: Number(progress?.total) || 0,
      bytesPerSecond: Number(progress?.bytesPerSecond) || 0,
      message: `Downloading update… ${Math.round(clampPercent(progress?.percent))}%`,
      installBlocked: false,
    });
  });
  autoUpdater.on('update-downloaded', info => {
    log('info', `Update ${info?.version || state.availableVersion || ''} downloaded`);
    publish({
      ...infoPatch(info),
      status: 'downloaded',
      percent: 100,
      message: 'Update downloaded. Restart Pine to install it.',
      installBlocked: false,
    });
  });
  autoUpdater.on('update-cancelled', () => {
    publish({ status: 'available', percent: 0, message: 'Update download was cancelled.' });
  });
  autoUpdater.on('error', error => {
    if (state.status === 'installing') return;
    reportError(error, state.status === 'downloading' ? 'Update download failed' : 'Update check failed');
  });

  async function checkForUpdates({ manual = true } = {}) {
    if (!supported) return publish();
    if (['checking', 'downloading', 'downloaded', 'installing'].includes(state.status)) return snapshot();
    if (platform === 'linux') {
      if (typeof fetchLatestRelease !== 'function') return publish({ status: 'error', message: 'Linux update information is unavailable.' });
      publish({ status: 'checking', message: 'Checking for updates…', installBlocked: false });
      try {
        const release = await fetchLatestRelease();
        const available = compareVersions(release.version, currentVersion) > 0;
        return publish(available ? {
          status: 'available', availableVersion: release.version, releaseDate: release.releaseDate || null,
          releaseNotes: releaseNotesText(release.releaseNotes), manualDownloadUrl: release.url,
          message: `Pine Launcher ${release.version} is available. Open the release to choose the .deb or Arch package.`,
        } : {
          status: 'not-available', availableVersion: null, releaseDate: null, releaseNotes: '', manualDownloadUrl: null,
          message: 'You are using the latest version.',
        });
      } catch (error) {
        return reportError(error, 'Update check failed');
      }
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (state.status === 'checking') reportError(error, 'Update check failed');
      if (manual) log('warn', updaterErrorMessage(error));
    }
    return snapshot();
  }

  async function downloadUpdate() {
    if (!automaticInstallSupported) return snapshot();
    if (!state.availableVersion) {
      return publish({ status: 'error', message: 'Check for an update before downloading.' });
    }
    if (state.status === 'downloading' || state.status === 'downloaded') return snapshot();
    publish({ status: 'downloading', percent: 0, message: 'Starting update download…', installBlocked: false });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      if (state.status === 'downloading') reportError(error, 'Update download failed');
    }
    return snapshot();
  }

  function installUpdate() {
    if (!automaticInstallSupported) return snapshot();
    if (state.status !== 'downloaded') {
      return publish({ message: 'Download the update before installing it.' });
    }
    if (isGameActive()) {
      return publish({
        message: 'Close Minecraft before restarting Pine to install the update.',
        installBlocked: true,
      });
    }
    publish({ status: 'installing', message: 'Restarting Pine to install the update…', installBlocked: false });
    const timer = setTimeoutFn(() => autoUpdater.quitAndInstall(true, true), 150);
    timer?.unref?.();
    return snapshot();
  }

  function start() {
    if (started) return snapshot();
    started = true;
    publish();
    if (!supported) return snapshot();
    checkTimer = setTimeoutFn(() => checkForUpdates({ manual: false }), autoCheckDelayMs);
    checkTimer?.unref?.();
    intervalTimer = setIntervalFn(() => checkForUpdates({ manual: false }), autoCheckIntervalMs);
    intervalTimer?.unref?.();
    return snapshot();
  }

  function dispose() {
    if (checkTimer) clearTimeoutFn(checkTimer);
    if (intervalTimer) clearIntervalFn(intervalTimer);
    checkTimer = null;
    intervalTimer = null;
  }

  return { checkForUpdates, dispose, downloadUpdate, getState: snapshot, installUpdate, start };
}

function compareVersions(left, right) {
  const parts = value => String(value || '').replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

module.exports = {
  AUTO_CHECK_DELAY_MS,
  AUTO_CHECK_INTERVAL_MS,
  clampPercent,
  compareVersions,
  createUpdateManager,
  releaseNotesText,
  updaterErrorMessage,
  userFacingUpdateError,
};
