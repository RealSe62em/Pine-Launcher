const api = window.installerAPI;
const $ = (id) => document.getElementById(id);

let state = null;

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = true; });
  $(id).hidden = false;
}

let lastToast = null;

function toast(msg) {
  if (msg === lastToast) return;
  lastToast = msg;
  const log = $('progress-log');
  const div = document.createElement('div');
  div.textContent = msg;
  log.appendChild(div);
  while (log.children.length > 40) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function setProgress(pct, line) {
  $('progress-pct').textContent = Math.round(pct) + '%';
  $('bar-fill').style.width = Math.min(100, pct) + '%';
  $('progress-line').textContent = line || '';
}

async function main() {
  state = await api.getState();
  $('tb-title').textContent = state.isUninstaller ? 'Uninstall' : 'Pine Launcher';
  $('hero-version').textContent = 'v' + state.version;

  if (state.isUninstaller) {
    $('welcome-card').hidden = true;
    $('uninstall-card').hidden = false;
    $('uninstall-sub').textContent = state.installedDir || state.appPath;
    $('btn-close').addEventListener('click', () => api.closeWindow());
    $('btn-back').addEventListener('click', () => api.closeWindow());
    $('btn-uninstall-go').addEventListener('click', runUninstall);
  } else {
    $('install-dir').value = state.defaultDir;
    $('state-badge').hidden = !state.isInstalled;
    if (state.isInstalled) {
      $('welcome-title').textContent = 'Update available';
      $('welcome-sub').textContent = 'A previous install was found — it will be replaced.';
      $('btn-install').textContent = 'Update';
      $('btn-uninstall').hidden = false;
    }
    $('btn-close').addEventListener('click', () => api.closeWindow());
    $('btn-browse').addEventListener('click', browse);
    $('btn-install').addEventListener('click', runInstall);
    $('btn-uninstall').addEventListener('click', () => {
      $('welcome-card').hidden = true;
      $('uninstall-card').hidden = false;
      $('uninstall-sub').textContent = state.installedDir || state.defaultDir;
    });
    $('btn-back').addEventListener('click', () => {
      $('uninstall-card').hidden = true;
      $('welcome-card').hidden = false;
    });
    $('btn-uninstall-go').addEventListener('click', runUninstall);
    $('btn-launch').addEventListener('click', () => { api.launchInstalled(); api.closeWindow(); });
    $('btn-finish').addEventListener('click', () => api.closeWindow());
  }

  api.onProgress(({ percent, line }) => {
    setProgress(percent, line);
    toast(line);
  });
}

async function browse() {
  const dir = await api.chooseDir();
  if (dir) $('install-dir').value = dir;
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (label) btn.textContent = label;
}

function showError(msg) {
  const err = $('err');
  err.textContent = msg;
  err.hidden = false;
}

function hideError() {
  const err = $('err');
  if (err) err.hidden = true;
}

async function runInstall() {
  hideError();
  lastToast = null;
  const btn = $('btn-install');
  const dir = $('install-dir').value.trim();
  setBusy(btn, true, 'Installing…');
  show('screen-progress');
  setProgress(0, 'Preparing…');
  const res = await api.install(dir);
  if (!res.ok) {
    setProgress(0, '');
    toast('[ERROR] ' + (res.error || 'Install failed'));
    $('progress-orb').classList.remove('done');
    setTimeout(() => { show('screen-welcome'); setBusy(btn, false, 'Retry'); showError(res.error); }, 1400);
    return;
  }
  finish('Installed', 'Pine Launcher is ready to play.');
}

async function runUninstall() {
  lastToast = null;
  const btn = $('btn-uninstall-go');
  setBusy(btn, true, 'Removing…');
  show('screen-progress');
  setProgress(0, 'Preparing…');
  const res = await api.uninstall();
  if (!res.ok) {
    toast('[ERROR] ' + (res.error || 'Uninstall failed'));
    setTimeout(() => api.closeWindow(), 1600);
    return;
  }
  finish('Removed', 'Pine Launcher has been uninstalled.');
  setTimeout(() => api.closeWindow(), 1800);
}

function finish(title, sub) {
  $('progress-pct').textContent = '100%';
  $('bar-fill').style.width = '100%';
  $('progress-orb').classList.add('done');
  $('bar-fill').classList.add('done');
  setTimeout(() => {
    show('screen-done');
    $('done-title').textContent = title;
    $('done-sub').textContent = sub;
    $('btn-launch').hidden = title !== 'Installed';
  }, 500);
}

document.addEventListener('DOMContentLoaded', main);
