// ── Pine Launcher renderer ──────────────────────────────────
// Drives the new shell: Dynamic Island top bar, bottom tab bar, views, docked progress
// progress, and launch metrics. ES module — no globals.
// ─────────────────────────────────────────────────────────────
import { tweenNumber, formatBytes, formatDuration, escHtml, debounce, stagger, pulseOnce, successRing, toast } from './animations.js';
import { classifyLine, stageLabel, shortFile, parseDownloadLine } from './launch-stages.js';

const api = window.electronAPI;

// ── State ───────────────────────────────────────────────────
const state = {
  instances: [],
  groups: [],
  allVersions: [],
  currentView: 'home',
  currentInstance: null,
  selectedLoader: 'vanilla',
  chosenProfile: null,
  performanceMods: [],
  authData: null,
  accounts: [],
  accountsExpanded: false,
  recentDestinations: [],
  commandSearchRequestId: 0,
  updateState: {
    status: 'idle',
    currentVersion: '',
    availableVersion: null,
    releaseNotes: '',
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
    message: 'Pine checks GitHub Releases for updates.',
  },
  updateNoticeVersion: null,
  settings: {},
  launchingName: null,
  logLines: [],
  searchOffset: 0,
  discoverCategory: 'mod',
  searchStartTime: 0,
  pendingIcon: null,
  pendingBanner: null,
  pendingInstanceRoot: '',
  editIcon: null,
  editBanner: null,
  editBlurDir: 'left',
  showSnapshots: false,
  searchLoading: false,
  searchRequestId: 0,
  loaderRequestId: 0,
  activeSearchKey: '',
  pendingModUpdates: [],
  contentCategory: 'mod',
  contentRequestId: 0,
  contentSwitchTimer: null,
  settingsDirty: false,
  settingsSaveTimer: null,
  instanceSettingsDirty: false,
  instanceSettingsSaveTimer: null,
  librarySort: 'recent',
  activeLibraryGroup: null,
  librarySelectionMode: false,
  selectedInstances: new Set(),
  pendingDatapackWorld: null,
};
const SEARCH_LIMIT = 20;
const DISCOVER_DOM_LIMIT = 120;
const TERMINAL_BANNER = String.raw`
          /\
         /**\
        /****\
       /******\
      /********\
         ||||
     PINE LAUNCHER
  Ready when you are :3`;


// ── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  bindTopbar();
  bindTabBar();
  bindViewLinks();
  bindModal();
  bindEditSheet();
  bindDuplicateEvents();
  bindGlobalKeys();
  bindLaunchEvents();
  bindUpdateEvents();
  bindCommandK();

  await loadVersions();
  await loadSettings();
  await loadUpdateState();
  await checkJava();

  try {
    const saved = await api.getAuth();
    if (saved && saved.profile) { state.authData = saved; updateAuthUI(); updatePride(); }
  } catch {}
  await refreshAccounts();

  await loadGroups();
  await loadInstances();
  await loadRecentDestinations();
  switchView('home');
  renderSettingsLayout();
  const instanceTab = document.querySelector('.tabbar-item[data-view="instance"]');
  if (instanceTab) instanceTab.setAttribute('hidden', '');
  bindTopbarScroll();
  setStatus('Ready');
});

// ── Tiny helpers ───────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function setStatus(msg) { const el = $('status-text'); if (el) el.textContent = msg; }

// ── Java check on boot ────────────────────────────────────
async function checkJava() {
  const java = await api.checkJavaInstalled();
  if (java !== false) return;
  setStatus('Java will be installed automatically when an instance is launched');
  return;
  const overlay = $('java-overlay');
  if (!overlay) return;
  overlay.hidden = false;
  overlay.classList.add('visible');
  const installBtn = $('java-install-btn');
  installBtn.onclick = async () => {
    installBtn.disabled = true;
    installBtn.textContent = 'Opening download page…';
    await api.openJavaDownload();
    setTimeout(() => {
      installBtn.disabled = false;
      installBtn.textContent = 'Download Java 21';
    }, 3000);
  };
  $('java-retry-btn').onclick = async () => {
    const retry = await api.checkJavaInstalled();
    if (retry !== false) {
      overlay.classList.remove('visible');
      overlay.hidden = true;
    }
  };
}
function fmtNum(n) { return n ? Number(n).toLocaleString('en-US') : '0'; }
function memoryToGigabytes(value, fallback) {
  const match = String(value || '').trim().match(/^(\d+)([MG])?$/i);
  if (!match) return fallback;
  const amount = Number.parseInt(match[1], 10);
  return (match[2] || 'G').toUpperCase() === 'M' ? Math.max(1, Math.round(amount / 1024)) : amount;
}
function staggerInto(els) { els.forEach((el, i) => el.style.setProperty('--i', i)); }

// ── Top bar ─────────────────────────────────────────────────
function bindTopbar() {
  $('brand-button')?.addEventListener('click', () => switchView('home'));
  $('cmdk-button')?.addEventListener('click', openCommandPalette);
  $('account-row')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAccountMenu();
  });
  document.addEventListener('click', closeAccountMenu);
}

function bindTopbarScroll() {
  const container = document.getElementById('content');
  const topbar = document.querySelector('.topbar');
  if (!container || !topbar) return;
  let lastScrollY = 0;
  container.addEventListener('scroll', () => {
    const y = container.scrollTop;
    if (y > lastScrollY && y > 60) {
      topbar.classList.add('topbar-hidden');
    } else if (y < lastScrollY) {
      topbar.classList.remove('topbar-hidden');
    }
    lastScrollY = y;
  });
}

function bindGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
    if (e.key === 'Escape') {
      closeCommandPalette();
      closeAccountMenu();
      closeModal();
    }
  });
}

function bindCommandK() {
  $('cmdk-button')?.addEventListener('click', openCommandPalette);
}

// ── Command palette (search instances + jump) ─────────────
function openCommandPalette() {
  let overlay = $('cmdk-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'cmdk-overlay';
    overlay.className = 'cmdk-overlay';
    overlay.innerHTML = `
      <div class="cmdk" role="dialog" aria-label="Search">
        <div class="cmdk-input-row">
          <svg width="20" height="20" aria-hidden="true"><use href="#i-search"/></svg>
          <input id="cmdk-input" class="cmdk-input" placeholder="Search instances, tags, groups, servers, and content..." autocomplete="off">
          <kbd>Esc</kbd>
        </div>
        <div id="cmdk-results" class="cmdk-results"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCommandPalette(); });
    $('cmdk-input')?.addEventListener('input', debounce((e) => renderCmdKResults(e.target.value), 160));
  }
  overlay.classList.add('visible');
  const input = $('cmdk-input');
  if (input) input.value = '';
  renderCmdKResults('');
  setTimeout(() => $('cmdk-input')?.focus(), 50);
}

function closeCommandPalette() {
  const overlay = $('cmdk-overlay');
  if (!overlay) return;
  overlay.classList.add('closing');
  overlay.addEventListener('animationend', () => {
    overlay.classList.remove('visible', 'closing');
  }, { once: true });
}

async function renderCmdKResults(query = '') {
  const results = $('cmdk-results');
  if (!results) return;
  const q = query.toLowerCase().trim();
  const requestId = ++state.commandSearchRequestId;
  const items = [];

  // Static actions
  const actions = [
    { id: 'go-home', label: 'Go to Home', action: () => { switchView('home'); closeCommandPalette(); } },
    { id: 'go-discover', label: 'Discover mods', action: () => { switchView('discover'); closeCommandPalette(); } },
    { id: 'go-library', label: 'Library', action: () => { switchView('library'); closeCommandPalette(); } },
    { id: 'go-settings', label: 'Settings', action: () => { switchView('settings'); closeCommandPalette(); } },
    { id: 'new-instance', label: 'Create new instance', action: () => { openCreateModal(); closeCommandPalette(); } },
    { id: 'login', label: state.authData ? 'Re-authenticate Microsoft' : 'Sign in with Microsoft', action: () => { handleAuth(); closeCommandPalette(); } },
  ];
  for (const a of actions) {
    if (!q || a.label.toLowerCase().includes(q)) items.push({ ...a, kind: 'action' });
  }
  // Instances
  for (const inst of state.instances) {
    const tags = Array.isArray(inst.tags) ? inst.tags : [];
    const searchable = [inst.name, inst.group, inst.loader, inst.gameVersion, ...tags].filter(Boolean).join(' ').toLowerCase();
    if (!q || searchable.includes(q)) {
      items.push({
        id: 'inst-' + inst.name,
        label: inst.name,
        sub: [(inst.loader || 'vanilla') + ' ' + (inst.gameVersion || ''), tags.length ? tags.map(tag => `#${tag}`).join(' ') : ''].filter(Boolean).join(' · '),
        action: () => { selectInstance(inst.name); closeCommandPalette(); },
        kind: 'instance',
      });
    }
  }

  for (const group of state.groups) {
    if (q && group.name.toLowerCase().includes(q)) {
      const count = state.instances.filter(instance => String(instance.group || '').toLowerCase() === group.name.toLowerCase()).length;
      items.push({
        id: 'group-' + group.name,
        label: group.name,
        sub: `${count} instance${count === 1 ? '' : 's'}`,
        action: () => { state.activeLibraryGroup = group.name; switchView('library'); closeCommandPalette(); },
        kind: 'group',
      });
    }
  }

  for (const account of state.accounts) {
    const username = account.profile?.name || '';
    if (q && username.toLowerCase().includes(q)) {
      items.push({
        id: 'account-' + account.key,
        label: username,
        sub: `${account.meta?.type === 'offline' ? 'Offline' : 'Microsoft'} account${account.key === state.selectedAccountKey ? ' · Active' : ''}`,
        action: async () => { await chooseAccount(account.key); closeCommandPalette(); },
        kind: 'account',
      });
    }
  }

  for (const destination of state.recentDestinations) {
    const searchable = [destination.label, destination.address, destination.folderName, destination.instanceName].filter(Boolean).join(' ').toLowerCase();
    if (q && searchable.includes(q)) {
      items.push({
        id: `destination-${destination.instanceId || destination.instanceName}-${destination.key}`,
        label: destination.label || destination.identifier,
        sub: `${destination.address || destination.folderName || destination.identifier} · ${destination.deletedInstance ? 'From a deleted instance' : destination.instanceName}`,
        action: () => {
          if (!destination.deletedInstance) launchInstance(destination.instanceName, destination);
          closeCommandPalette();
        },
        kind: destination.type === 'multiplayer' ? 'server' : 'world',
        play: !destination.deletedInstance,
      });
    }
  }

  if (q.length >= 2) {
    const immediateItems = items.slice(0, 10);
    results.innerHTML = renderCommandItems(immediateItems, true);
    bindCommandItems(results, immediateItems);
    try {
      const response = await api.searchMods(q, [], 0, 8, 'relevance');
      if (requestId !== state.commandSearchRequestId) return;
      const allowed = new Set(['mod', 'modpack', 'resourcepack', 'datapack', 'shader']);
      for (const hit of response?.hits || []) {
        if (!allowed.has(hit.project_type)) continue;
        items.push({
          id: 'content-' + hit.project_id,
          label: hit.title,
          sub: hit.description,
          action: () => { closeCommandPalette(); showModDetails(hit.project_id); },
          kind: ({ mod: 'mod', modpack: 'mod pack', resourcepack: 'resource pack', datapack: 'data pack', shader: 'shader' })[hit.project_type] || 'content',
        });
      }
    } catch {
      if (requestId !== state.commandSearchRequestId) return;
    }
  }

  if (!items.length) {
    results.innerHTML = `<div class="cmdk-empty">No matches</div>`;
    return;
  }
  const visibleItems = items.slice(0, 14);
  results.innerHTML = renderCommandItems(visibleItems, false);
  bindCommandItems(results, visibleItems);
}

function renderCommandItems(items, loading) {
  if (!items.length && loading) return '<div class="cmdk-empty cmdk-searching">Searching content…</div>';
  return items.map((item, index) => `
    <div class="cmdk-item-row">
      <button class="cmdk-item" type="button" data-cmdk-idx="${index}">
        <div class="cmdk-item-main">
          <div class="cmdk-item-label">${escHtml(item.label)}</div>
          ${item.sub ? `<div class="cmdk-item-sub">${escHtml(item.sub)}</div>` : ''}
        </div>
        <div class="cmdk-item-kind">${escHtml(item.kind)}</div>
      </button>
      ${item.play ? `<button class="cmdk-play" type="button" data-cmdk-idx="${index}" aria-label="Play ${escHtml(item.label)}"><svg aria-hidden="true"><use href="#i-play"/></svg><span>Play</span></button>` : ''}
    </div>`).join('') + (loading ? '<div class="cmdk-loading-line"></div>' : '');
}

function bindCommandItems(results, items) {
  results.querySelectorAll('[data-cmdk-idx]').forEach((button) => {
    button.addEventListener('click', () => items[parseInt(button.dataset.cmdkIdx, 10)]?.action());
  });
  const input = $('cmdk-input');
  if (input) input.onkeydown = (event) => {
    if (event.key === 'Enter') items[0]?.action();
  };
}

// ── Account menu ────────────────────────────────────────────
function toggleAccountMenu() {
  const existing = $('account-menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.id = 'account-menu';
  menu.className = 'account-menu';
  const visibleAccounts = state.accountsExpanded ? state.accounts : state.accounts.slice(0, 3);
  const accountRows = visibleAccounts.map(account => {
    const selected = account.key === state.selectedAccountKey;
    const isOffline = account.meta?.type === 'offline';
    const initial = (account.profile?.name || 'G')[0].toUpperCase();
    const avatar = !isOffline && account.profile?.uuid
      ? `<img src="https://mc-heads.net/avatar/${encodeURIComponent(account.profile.uuid)}/36" alt="${escHtml(initial)}">`
      : escHtml(initial);
    return `<div class="account-switch-row${selected ? ' selected' : ''}" data-account-key="${escHtml(account.key)}">
      <button class="account-switch-main" type="button" data-act="select-account" aria-label="Use ${escHtml(account.profile.name)}">
        <span class="avatar">${avatar}</span>
        <span class="account-menu-info"><span class="account-menu-name">${escHtml(account.profile.name)}</span><span class="account-menu-sub">${isOffline ? 'Offline' : 'Microsoft'}${selected ? ' · Active' : ''}</span></span>
      </button>
      ${isOffline ? '' : `<button class="account-reauth" type="button" data-act="reauth-account" aria-label="Re-authenticate ${escHtml(account.profile.name)}" title="Re-authenticate"><svg width="13" height="13" aria-hidden="true"><use href="#i-refresh"/></svg></button>`}
      <button class="account-delete" type="button" data-act="delete-account" aria-label="Delete ${escHtml(account.profile.name)}"><svg width="13" height="13" aria-hidden="true"><use href="#i-trash"/></svg></button>
    </div>`;
  }).join('');

  menu.innerHTML = `${accountRows || '<div class="account-menu-empty">No saved accounts</div>'}
    ${state.accounts.length > 3 ? `<button class="account-menu-item" data-act="toggle-more">${state.accountsExpanded ? 'Show less' : `Show ${state.accounts.length - 3} more`}</button>` : ''}
    ${state.accounts.length ? '<div class="account-menu-divider"></div>' : ''}
    <button class="account-menu-item" data-act="signin">
      <svg width="14" height="14" aria-hidden="true"><use href="#i-plus"/></svg>
      Add Microsoft account
    </button>
    <button class="account-menu-item" data-act="offline">
      <svg width="14" height="14" aria-hidden="true"><use href="#i-user"/></svg>
      Add offline account
    </button>
  `;
  const row = $('account-row');
  if (!row) return;
  row.appendChild(menu);
  menu.addEventListener('click', async (e) => {
    e.stopPropagation();
    const action = e.target.closest('[data-act]');
    const act = action?.dataset.act;
    const key = action?.closest('[data-account-key]')?.dataset.accountKey;
    if (act === 'signin') handleAuth({ mode: 'add' });
    if (act === 'offline') openOfflineModal();
    if (act === 'select-account' && key) {
      await chooseAccount(key);
      menu.remove();
      toggleAccountMenu();
      return;
    }
    if (act === 'delete-account' && key) await removeAccount(key);
    if (act === 'reauth-account' && key) {
      await reauthenticateAccount(key);
      menu.remove();
      toggleAccountMenu();
      return;
    }
    if (act === 'toggle-more') {
      state.accountsExpanded = !state.accountsExpanded;
      menu.remove();
      toggleAccountMenu();
      return;
    }
    menu.remove();
  });
}

function closeAccountMenu() {
  const m = $('account-menu');
  if (m) m.remove();
}

function buildAvatarEl(name) {
  const el = document.createElement('div');
  el.className = 'avatar';
  el.textContent = (name || 'G')[0].toUpperCase();
  return el;
}

// ── Tab Bar ────────────────────────────────────────────────
function bindTabBar() {
  $('hero-create-btn')?.addEventListener('click', openCreateModal);
  $('library-create-btn')?.addEventListener('click', openCreateModal);
  $('library-import-btn')?.addEventListener('click', openImportHub);
  $('library-make-group-btn')?.addEventListener('click', openCreateGroupModal);
  $('library-select-btn')?.addEventListener('click', () => setLibrarySelectionMode(!state.librarySelectionMode));
  $('library-select-done')?.addEventListener('click', () => setLibrarySelectionMode(false));
  $('library-bulk-favorite')?.addEventListener('click', () => runBulkInstanceAction({ type: 'favorite', value: true }, 'Selected instances added to favorites'));
  $('library-bulk-unfavorite')?.addEventListener('click', () => runBulkInstanceAction({ type: 'favorite', value: false }, 'Selected instances removed from favorites'));
  $('library-bulk-move')?.addEventListener('click', () => runBulkInstanceAction({ type: 'group', value: $('library-bulk-group')?.value || '' }, 'Selected instances moved'));
  $('library-bulk-delete')?.addEventListener('click', deleteSelectedInstances);
  $('library-group-context')?.addEventListener('click', event => {
    if (event.target.closest('[data-library-group-back]')) {
      state.activeLibraryGroup = null;
      renderLibrary();
      return;
    }
    const deleteButton = event.target.closest('[data-delete-group]');
    if (deleteButton) openDeleteGroupModal(deleteButton.dataset.deleteGroup);
  });
  $('library-sort')?.addEventListener('click', event => {
    const option = event.target.closest('[data-sort]');
    if (!option || option.dataset.sort === state.librarySort) return;
    state.librarySort = option.dataset.sort;
    $('library-sort').querySelectorAll('[data-sort]').forEach(button => {
      const active = button === option;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    moveLibrarySortIndicator();
    renderLibrary();
  });

  document.querySelectorAll('.tabbar-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  $('content-search')?.addEventListener('input', debounce(renderContentList, 80));
  $('content-categories')?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-content-type]');
    if (button) switchContentCategory(button.dataset.contentType);
  });
  $('copy-log-btn')?.addEventListener('click', copyLog);
  $('analyze-log-btn')?.addEventListener('click', () => explainCrash());
  $('dp-stop-game')?.addEventListener('click', stopFrozenGame);
  $('clear-log-btn')?.addEventListener('click', clearLogs);
  $('instance-add-content')?.addEventListener('click', openContentAdder);
  $('instance-play-btn')?.addEventListener('click', () => state.currentInstance && launchInstance(state.currentInstance.name));
  $('instance-backups-btn')?.addEventListener('click', openBackupPanel);
  $('worlds-backup-btn')?.addEventListener('click', backupAllWorlds);
  $('worlds-screenshots-btn')?.addEventListener('click', async () => {
    if (!state.currentInstance) return;
    try { await api.openInstanceScreenshots(state.currentInstance.name); } catch (error) { toast('Could not open screenshots: ' + (error.message || error), 'error'); }
  });
  $('instance-settings-btn')?.addEventListener('click', openEditSheet);
  $('hero-launch-button')?.addEventListener('click', quickLaunch);
  $('discover-search-btn')?.addEventListener('click', () => searchMods(false));
  $('discover-search-btn-alt')?.addEventListener('click', () => searchMods(false));
  $('load-more-btn')?.addEventListener('click', () => searchMods(true));
  const liveSearch = debounce(() => searchMods(false), 220);
  $('search-input')?.addEventListener('input', liveSearch);
  $('search-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMods(false); });
  ['filter-loader', 'filter-version', 'filter-category', 'results-sort'].forEach((id) => {
    $(id)?.addEventListener(id === 'filter-category' ? 'input' : 'change',
      id === 'filter-category' ? debounce(() => searchMods(false), 220) : () => searchMods(false));
  });
  // Infinite scroll
  const moreBtn = $('load-more-btn');
  if (moreBtn) {
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !state.searchLoading && !moreBtn.hidden) searchMods(true);
    }, { rootMargin: '400px' });
    io.observe(moreBtn);
    state._moreObserver = io;
  }
  $('discover-categories')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('discover-categories').querySelectorAll('.chip').forEach((c) => c.classList.remove('chip-active'));
    chip.classList.add('chip-active');
    state.discoverCategory = chip.dataset.category;
    $('search-input').placeholder = `Search ${chip.textContent.trim().toLowerCase()}...`;
    moveDiscoverIndicator();
    searchMods(false);
  });
  window.addEventListener('resize', debounce(() => {
    moveTabIndicator(state.currentView);
    moveDiscoverIndicator();
    moveLibrarySortIndicator();
  }, 80));
}

async function explainCrash(requestedInstanceName = '', { automatic = false } = {}) {
  if (document.querySelector('.crash-assistant-root')) return;
  const log = state.logLines.join('\n');
  if (!log.trim()) return automatic ? undefined : toast('Launch Minecraft first so Pine has a log to analyze', 'error', 5000);
  const instanceName = requestedInstanceName || state.currentInstance?.name || state.launchingName || '';
  let diagnosis;
  try { diagnosis = await api.analyzeCrash(instanceName, log); }
  catch (error) { return toast('Could not analyze the log: ' + (error.message || error), 'error', 6000); }
  const overlay = document.createElement('div');
  overlay.className = 'modal-root crash-assistant-root visible';
  const findings = diagnosis.findings || [];
  overlay.innerHTML = `
    <div class="modal crash-assistant-modal" role="dialog" aria-modal="true" aria-labelledby="crash-assistant-title">
      <div class="modal-header">
        <div><h2 id="crash-assistant-title" class="modal-title">Crash assistant</h2><p class="modal-sub">Plain-language checks based on this launch log</p></div>
        <button class="modal-close" type="button" data-close aria-label="Close"><svg width="20" height="20"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body crash-assistant-body">
        <div class="crash-summary ${findings.length ? 'has-findings' : ''}"><svg width="20" height="20"><use href="#${findings.length ? 'i-alert' : 'i-info'}"/></svg><span>${escHtml(diagnosis.summary)}</span></div>
        <div class="crash-findings">${findings.length ? findings.map(finding => `
          <article class="crash-finding">
            <div class="crash-finding-head"><b>${escHtml(finding.title)}</b><span>${escHtml(finding.confidence)} confidence</span></div>
            <p>${escHtml(finding.explanation)}</p>
            <pre>${escHtml(finding.evidence)}</pre>
            <div class="crash-actions">${finding.actions.map(action => `<span><svg width="13" height="13"><use href="#i-check"/></svg>${escHtml(action)}</span>`).join('')}</div>
          </article>`).join('') : '<div class="empty-state"><div class="empty-state-title">No common signature found</div><div class="empty-state-sub">Copy the support summary so a helper can review the relevant context.</div></div>'}</div>
        <section class="crash-recovery">
          <div class="crash-recovery-head"><div><strong>Safe recovery</strong><span>Each change is reversible or asks before touching anything.</span></div></div>
          <div class="crash-recovery-grid">
            ${diagnosis.suspectMod ? `<button class="crash-recovery-action" type="button" data-disable-suspect><svg><use href="#i-x"/></svg><span><b>Disable ${escHtml(diagnosis.suspectMod.title)}</b><small>Keep the file, turn it off, then retry</small></span></button>` : ''}
            ${findings.some(finding => finding.id === 'memory') && diagnosis.recommendedMemoryMb > diagnosis.currentMemoryMb ? `<button class="crash-recovery-action" type="button" data-increase-memory><svg><use href="#i-settings"/></svg><span><b>Increase memory</b><small>${Math.round(diagnosis.currentMemoryMb / 1024)} GB to ${Math.round(diagnosis.recommendedMemoryMb / 1024)} GB</small></span></button>` : ''}
            <button class="crash-recovery-action" type="button" data-repair-files><svg><use href="#i-download"/></svg><span><b>Repair instance files</b><small>Create a restore point and replace damaged files</small></span></button>
            <button class="crash-recovery-action" type="button" data-restore-point><svg><use href="#i-backup"/></svg><span><b>Restore a snapshot</b><small>Choose a known-good restore point</small></span></button>
            <button class="crash-recovery-action" type="button" data-retry-launch><svg><use href="#i-play"/></svg><span><b>Retry launch</b><small>Try again without changing the instance</small></span></button>
            <button class="crash-recovery-action" type="button" data-upload-log><svg><use href="#i-copy"/></svg><span><b>Share anonymized log</b><small>Upload to mclo.gs only after confirmation</small></span></button>
          </div>
          <div class="crash-upload-result" data-upload-result hidden></div>
        </section>
        <p class="duplicate-note">Analysis stays on this computer. Nothing is uploaded unless you choose “Share anonymized log” and confirm.</p>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" type="button" data-copy-summary>Copy support summary</button><button class="btn btn-primary" type="button" data-close>Done</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('[data-close]')) close(); });
  overlay.querySelector('[data-copy-summary]').addEventListener('click', async () => {
    const summary = [
      `Pine crash summary${diagnosis.instance ? ` · ${diagnosis.instance}` : ''}`,
      diagnosis.gameVersion ? `Minecraft ${diagnosis.gameVersion} · ${diagnosis.loader || 'vanilla'}` : '',
      diagnosis.summary,
      ...findings.flatMap(finding => [`\n${finding.title} (${finding.confidence})`, finding.explanation, finding.evidence, ...finding.actions.map(action => `- ${action}`)]),
    ].filter(Boolean).join('\n');
    await api.copyText(summary);
    toast('Support summary copied', 'success');
  });
  overlay.querySelector('[data-disable-suspect]')?.addEventListener('click', async event => {
    const confirmed = await backupConfirmation({ title: `Disable ${diagnosis.suspectMod.title} and retry?`, message: 'Pine will rename the mod so Minecraft cannot load it. The file is kept and can be enabled again from Content.', action: 'Disable and retry' });
    if (!confirmed) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.createInstanceBackup(instanceName, { scope: 'full', description: `Before disabling suspected mod ${diagnosis.suspectMod.title}` });
      await api.disableMod(instanceName, diagnosis.suspectMod.filename);
      close();
      toast(`${diagnosis.suspectMod.title} disabled · restore point created`, 'success');
      launchInstance(instanceName);
    }
    catch (error) { button.disabled = false; toast('Could not disable the mod: ' + (error.message || error), 'error', 7000); }
  });
  overlay.querySelector('[data-increase-memory]')?.addEventListener('click', async event => {
    const nextGb = Math.max(4, Math.round(diagnosis.recommendedMemoryMb / 1024));
    const confirmed = await backupConfirmation({ title: `Use ${nextGb} GB for this instance?`, message: 'This changes only the maximum memory for this instance. You can change it again in Instance Settings.', action: 'Increase memory' });
    if (!confirmed) return;
    event.currentTarget.disabled = true;
    try { await api.updateInstance(instanceName, { maxMemory: `${nextGb}G` }); await loadInstances(); close(); toast(`Maximum memory increased to ${nextGb} GB`, 'success'); }
    catch (error) { event.currentTarget.disabled = false; toast('Could not change memory: ' + (error.message || error), 'error'); }
  });
  overlay.querySelector('[data-repair-files]')?.addEventListener('click', async event => {
    const confirmed = await backupConfirmation({ title: 'Repair this instance?', message: 'Pine will create a full restore point first, remove only files that fail integrity checks, and download required game files again on the next launch. Worlds and settings stay untouched.', action: 'Repair files' });
    if (!confirmed) return;
    event.currentTarget.disabled = true;
    try {
      const result = await api.repairInstanceFiles(instanceName);
      close();
      toast(`Repair complete · ${result.removedShared + result.removedMods} damaged file${result.removedShared + result.removedMods === 1 ? '' : 's'} replaced on next launch`, 'success', 7000);
    } catch (error) { event.currentTarget.disabled = false; toast('Repair failed: ' + (error.message || error), 'error', 7000); }
  });
  overlay.querySelector('[data-restore-point]')?.addEventListener('click', () => {
    close();
    selectInstance(instanceName);
    openBackupPanel();
  });
  overlay.querySelector('[data-retry-launch]')?.addEventListener('click', () => { close(); launchInstance(instanceName); });
  overlay.querySelector('[data-upload-log]')?.addEventListener('click', async event => {
    const confirmed = await backupConfirmation({ title: 'Share an anonymized log?', message: 'Pine will remove local usernames, account tokens, UUIDs, email addresses, and server addresses before sending the log to the third-party service mclo.gs. Anyone with the resulting link may view it.', action: 'Upload anonymized log' });
    if (!confirmed) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const uploaded = await api.uploadCrashLog(instanceName, log, true);
      const result = overlay.querySelector('[data-upload-result]');
      result.hidden = false;
      result.innerHTML = `<div><strong>Support link ready</strong><span>${escHtml(uploaded.url)}</span></div><button class="btn btn-secondary" data-copy-link type="button">Copy link</button><button class="btn btn-secondary" data-open-link type="button">Open</button>`;
      result.querySelector('[data-copy-link]').addEventListener('click', async () => { await api.copyText(uploaded.url); toast('Support link copied', 'success'); });
      result.querySelector('[data-open-link]').addEventListener('click', () => api.openSupportLog(uploaded.url));
      button.remove();
    } catch (error) { button.disabled = false; toast('Upload failed: ' + (error.message || error), 'error', 7000); }
  });
}

function bindViewLinks() {
  document.querySelectorAll('[data-view]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(el.dataset.view);
    });
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchInstanceTab(tab.dataset.tab));
  });
}

// ── View routing ────────────────────────────────────────────
function switchView(view) {
  if (view !== 'library' && state.librarySelectionMode) setLibrarySelectionMode(false);
  if (state.currentView === 'settings' && view !== 'settings' && state.settingsDirty) {
    saveAllSettings(null, { silent: true });
  }
  state.currentView = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  const target = $('view-' + view);
  if (target) {
    target.classList.add('active');
    target.style.animation = 'none';
    void target.offsetWidth; // restart anim
    target.style.animation = '';
  }
  document.querySelectorAll('.tabbar-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  moveTabIndicator(view);
  if (view !== 'instance') {
    const instanceTab = document.querySelector('.tabbar-item[data-view="instance"]');
    if (instanceTab) instanceTab.setAttribute('hidden', '');
  }
  if (view === 'discover') {
    searchMods(false);
    requestAnimationFrame(() => moveDiscoverIndicator());
  }
  if (view === 'library') renderLibrary();
  if (view === 'home') renderHome();
  if (view === 'settings') renderSettingsLayout();
}

function moveTabIndicator(view) {
  const tab = document.querySelector(`.tabbar-item[data-view="${view}"]`);
  const indicator = $('tabbar-indicator');
  if (!tab || !indicator) return;
  const parent = tab.closest('.tabbar');
  const pbox = parent.getBoundingClientRect();
  const tbox = tab.getBoundingClientRect();
  indicator.style.width = tbox.width + 'px';
  indicator.style.transform = `translateX(${tbox.left - pbox.left}px)`;
}

function moveDiscoverIndicator() {
  const active = document.querySelector('#discover-categories .chip-active');
  const indicator = $('discover-indicator');
  if (!active || !indicator) return;
  const parent = active.closest('.discover-categories');
  const pbox = parent.getBoundingClientRect();
  const abox = active.getBoundingClientRect();
  indicator.style.width = abox.width + 'px';
  indicator.style.transform = `translateX(${abox.left - pbox.left}px)`;
}

function moveLibrarySortIndicator() {
  const active = document.querySelector('#library-sort .library-sort-option.active');
  const indicator = $('library-sort-indicator');
  if (!active || !indicator) return;
  const parent = active.closest('.library-sort-categories');
  const pbox = parent.getBoundingClientRect();
  const abox = active.getBoundingClientRect();
  indicator.style.width = abox.width + 'px';
  indicator.style.transform = `translateX(${abox.left - pbox.left + parent.scrollLeft}px)`;
  active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

// ── Versions & Loaders ──────────────────────────────────────
function populateVersionSelect(sel, versions) {
  if (!sel) return;
  sel.innerHTML = '<option value="">Select version</option>' +
    versions.map((v) => `<option value="${v.id}">${v.id}</option>`).join('');
}

function filterVersions() {
  return state.allVersions.filter((v) =>
    state.showSnapshots ? true : v.type === 'release'
  );
}

async function loadVersions() {
  try {
    const versions = await api.getVersions();
    state.allVersions = versions || [];
    const filtered = filterVersions();
    const releases = state.allVersions.filter((v) => v.type === 'release');
    populateVersionSelect($('modal-version'), filtered);
    const filterVer = $('filter-version');
    if (filterVer) filterVer.innerHTML = '<option value="">All versions</option>' +
      releases.slice(0, 30).map((v) => `<option value="${v.id}">${v.id}</option>`).join('');
    const filterLoader = $('filter-loader');
    if (filterLoader) {
      filterLoader.innerHTML = '<option value="">All loaders</option>' +
        ['fabric', 'forge', 'quilt'].map((l) => `<option value="${l}">${l.charAt(0).toUpperCase() + l.slice(1)}</option>`).join('');
    }
    const sortSel = $('results-sort');
    if (sortSel) {
      sortSel.innerHTML = '<option value="relevance">Relevance</option><option value="downloads">Downloads</option><option value="updated">Last Updated</option><option value="newest">Newest</option>';
    }
  } catch (e) {
    setStatus('Failed to load versions: ' + (e.message || e));
  }
}

async function loadLoaderVersions() {
  const version = $('modal-version')?.value;
  const sel = $('modal-loader-version');
  const loader = state.selectedLoader;
  const requestId = ++state.loaderRequestId;
  if (!version || state.selectedLoader === 'vanilla') {
    if (sel) { sel.innerHTML = '<option value="">N/A</option>'; sel.disabled = true; }
    return;
  }
  if (!sel) return;
  sel.disabled = false;
  sel.dataset.loadState = 'loading';
  sel.innerHTML = '<option value="">Loading...</option>';
  try {
    const versions = await api.getLoaderVersions(version, loader);
    if (requestId !== state.loaderRequestId || loader !== state.selectedLoader || version !== $('modal-version')?.value) return;
    if (!Array.isArray(versions) || !versions.length) throw new Error('No compatible loader versions found');
    const stableIdx = versions.findIndex((v) => v.stable !== false);
    const selectedIdx = stableIdx >= 0 ? stableIdx : 0;
    sel.innerHTML = versions.map((v, i) =>
      `<option value="${v.version}"${i === selectedIdx ? ' selected' : ''}>${v.name}${i === selectedIdx ? ' (recommended)' : ''}</option>`
    ).join('');
    sel.dataset.loadState = 'ready';
  } catch (error) {
    if (requestId !== state.loaderRequestId) return;
    sel.dataset.loadState = 'failed';
    sel.innerHTML = '<option value="">Could not load — click to retry</option>';
    setStatus('Could not load ' + loader + ' versions: ' + (error.message || error));
  }
}

// ── Instances ───────────────────────────────────────────────
async function loadGroups() {
  try {
    state.groups = await api.listGroups();
    if (!Array.isArray(state.groups)) state.groups = [];
  } catch {
    state.groups = [];
  }
  populateGroupSelects();
}

function populateGroupSelect(select, selected = '') {
  if (!select) return;
  const names = state.groups.map(group => group.name);
  if (selected && !names.some(name => name.toLowerCase() === selected.toLowerCase())) names.push(selected);
  select.innerHTML = '<option value="">No group</option>' + names.map(name =>
    `<option value="${escHtml(name)}"${name.toLowerCase() === String(selected || '').toLowerCase() ? ' selected' : ''}>${escHtml(name)}</option>`
  ).join('');
}

function populateGroupSelects() {
  populateGroupSelect($('modal-group'), $('modal-group')?.value || '');
  populateGroupSelect($('edit-group'), state.currentInstance?.group || $('edit-group')?.value || '');
}

async function loadInstances() {
  try {
    state.instances = await api.listInstances();
  } catch { state.instances = []; }
  const available = new Set(state.instances.map(instance => instance.name));
  for (const name of state.selectedInstances) if (!available.has(name)) state.selectedInstances.delete(name);
  renderHome();
  renderLibrary();
  updateInstanceCount();
  if (state.currentInstance) {
    const refreshed = state.instances.find((i) => i.name === state.currentInstance.name);
    if (refreshed) state.currentInstance = refreshed;
    else { state.currentInstance = null; switchView('home'); }
  }
}

function updateInstanceCount() {
  const badge = $('instance-count-badge');
  if (badge) badge.textContent = state.instances.length;
  const stat = $('home-instance-stat');
  if (stat) stat.textContent = state.instances.length + ' instance' + (state.instances.length !== 1 ? 's' : '');
}


function selectInstance(name) {
  const inst = state.instances.find((i) => i.name === name);
  if (!inst) return;
  state.currentInstance = inst;
  api.updateInstance(name, { lastOpened: new Date().toISOString() }).catch(() => {});
  const instanceTab = document.querySelector('.tabbar-item[data-view="instance"]');
  if (instanceTab) instanceTab.removeAttribute('hidden');
  switchView('instance');
  openInstanceView();
}

// ── Home ────────────────────────────────────────────────────
function renderHome() {
  const greeting = $('home-greeting');
  if (greeting) greeting.textContent = homeGreetingText();
  const sub = $('home-sub');
  if (sub) sub.textContent = state.instances.length
    ? 'Ready when you are. Click play to launch your most recent instance.'
    : 'Your Minecraft launcher, refined. Create your first instance to get started.';

  const recent = $('recent-cards');
  const grid = $('home-instance-grid');
  renderRecentDestinations();
  if (!recent || !grid) return;

  if (!state.instances.length) {
    recent.innerHTML = `<div class="empty-rail">No recent instances yet. Tap + to create your first one.</div>`;
    grid.innerHTML = '';
    return;
  }

  const sorted = sortByRecency(state.instances);
  const recentItems = sorted.slice(0, 5);
  recent.innerHTML = recentItems.map(renderRecentCard).join('');
  staggerInto(recent.querySelectorAll('.recent-card'));
  recent.querySelectorAll('.recent-card').forEach((card) => {
    card.addEventListener('click', () => selectInstance(card.dataset.name));
    card.querySelector('.recent-card-play')?.addEventListener('click', (e) => {
      e.stopPropagation();
      launchInstance(card.dataset.name);
    });
  });

  grid.innerHTML = state.instances.map(renderInstanceCard).join('');
  staggerInto(grid.querySelectorAll('.instance-card'));
  grid.querySelectorAll('.instance-card').forEach((card) => {
    const name = card.dataset.name;
    card.addEventListener('click', () => selectInstance(name));
    card.querySelector('[data-act="play"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      launchInstance(name);
    });
    card.querySelector('[data-act="open"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      selectInstance(name);
    });
  });

  const heroBtn = $('hero-launch-button');
  if (heroBtn) {
    if (sorted[0]) {
      heroBtn.style.display = '';
      heroBtn.textContent = `Continue playing ${sorted[0].name}`;
      heroBtn.onclick = () => launchInstance(sorted[0].name);
    } else {
      heroBtn.style.display = 'none';
    }
  }
}

async function loadRecentDestinations() {
  try { state.recentDestinations = await api.getRecentDestinations() || []; }
  catch { state.recentDestinations = []; }
  renderRecentDestinations();
}

function renderRecentDestinations() {
  const grid = $('destination-grid');
  const header = $('destinations-header');
  if (!grid || !header) return;
  const items = state.recentDestinations.slice(0, 9);
  grid.hidden = header.hidden = !items.length;
  if (!items.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = items.map((item, index) => {
    const isServer = item.type === 'multiplayer';
    const title = item.label || item.identifier;
    const detail = isServer ? item.address : item.folderName || item.identifier;
    const hasDetail = String(title).toLowerCase() !== String(detail).toLowerCase();
    const visitLabel = Number(item.launches) > 0
      ? `${fmtNum(item.launches)} ${Number(item.launches) === 1 ? 'visit' : 'visits'}`
      : (isServer ? 'Saved server' : 'Available world');
    const image = item.iconData ? `<div class="destination-art"><img src="${escHtml(item.iconData)}" alt="${escHtml(title)} icon"></div>` : '';
    const payload = escHtml(JSON.stringify({ type: item.type, identifier: item.identifier, address: item.address, label: item.label, instanceId: item.instanceId }));
    return `<article class="destination-card${item.iconData ? ' has-art' : ''}${hasDetail ? ' has-detail' : ''}${item.deletedInstance ? ' deleted-instance' : ''}" data-destination-index="${index}" data-key="${escHtml(item.key || '')}">
      <div class="destination-card-main">
        ${image}
        <div class="destination-info">
          <span class="destination-kind">${isServer ? 'SERVER' : 'WORLD'} · ${escHtml(item.instanceName)}${item.deletedInstance ? ' <em>From a deleted instance</em>' : ''}</span>
          <div class="destination-title-row">
            <strong title="${escHtml(title)}">${escHtml(title)}</strong>
            <input class="destination-name-input" value="${escHtml(title)}" maxlength="128" aria-label="Destination name" hidden>
            <button class="destination-title-action" type="button" data-title-action="copy" aria-label="Copy ${escHtml(title)}"><svg aria-hidden="true"><use href="#i-copy"/></svg></button>
            <button class="destination-title-action" type="button" data-title-action="edit" aria-label="Edit ${escHtml(title)} name"><svg aria-hidden="true"><use href="#i-edit"/></svg></button>
          </div>
          <span class="destination-address" title="${escHtml(detail)}">${escHtml(detail)}</span>
          <span class="destination-stats">${visitLabel} · ${formatDestinationDate(item.lastUsed)}</span>
        </div>
      </div>
      <div class="destination-actions" role="group" aria-label="${escHtml(title)} actions">
        <button class="destination-action active" type="button" data-action="play" data-instance="${escHtml(item.instanceName)}" data-destination="${payload}"${item.deletedInstance ? ' disabled title="The original instance was deleted"' : ''}>
          <svg aria-hidden="true"><use href="#i-play"/></svg><span>Play</span>
        </button>
        <button class="destination-action destination-action-remove" type="button" data-action="remove" data-instance="${escHtml(item.instanceName)}" data-destination="${payload}">
          <svg aria-hidden="true"><use href="#i-trash"/></svg><span>Remove</span>
        </button>
        <div class="destination-action-indicator" aria-hidden="true"></div>
      </div>
    </article>`;
  }).join('');

  grid.querySelectorAll('.destination-card').forEach((card) => {
    const item = items[Number(card.dataset.destinationIndex)];
    if (!item) return;
    card.querySelector('[data-title-action="copy"]')?.addEventListener('click', async () => {
      const shownName = card.querySelector('.destination-title-row strong')?.textContent || item.label || item.identifier;
      try {
        await api.copyText(shownName);
        toast('Destination name copied', 'success');
      } catch (error) {
        toast('Could not copy the name: ' + (error.message || error), 'error');
      }
    });
    card.querySelector('[data-title-action="edit"]')?.addEventListener('click', () => beginDestinationRename(card, item));
    card.querySelectorAll('.destination-action').forEach(button => button.addEventListener('click', async () => {
      selectDestinationAction(card, button);
      const destination = JSON.parse(button.dataset.destination);
      if (button.dataset.action === 'play') {
        launchInstance(button.dataset.instance, destination);
        return;
      }
      button.disabled = true;
      try {
        await api.removeRecentDestination(button.dataset.instance, destination);
        state.recentDestinations = state.recentDestinations.filter(entry => !(entry.key === item.key && entry.instanceName === item.instanceName));
        renderRecentDestinations();
        toast(`${item.label || item.identifier} removed from frequently visited`, 'success');
      } catch (error) {
        button.disabled = false;
        selectDestinationAction(card, card.querySelector('[data-action="play"]'));
        toast('Could not remove destination: ' + (error.message || error), 'error');
      }
    }));
    if (item.type === 'multiplayer' && item.canFetchMetadata) hydrateServerMetadata(card, item);
  });
}

function beginDestinationRename(card, item) {
  const input = card.querySelector('.destination-name-input');
  const title = card.querySelector('.destination-title-row strong');
  if (!input || !title || card.classList.contains('saving-name')) return;
  if (!card.classList.contains('editing-name')) {
    input.value = title.textContent.trim();
    input.hidden = false;
    card.classList.add('editing-name');
    requestAnimationFrame(() => { input.focus(); input.select(); });
    input.onkeydown = (event) => {
      if (event.key === 'Enter') { event.preventDefault(); saveDestinationRename(card, item); }
      if (event.key === 'Escape') { event.preventDefault(); cancelDestinationRename(card); }
    };
    return;
  }
  saveDestinationRename(card, item);
}

function cancelDestinationRename(card) {
  const input = card.querySelector('.destination-name-input');
  if (input) input.hidden = true;
  card.classList.remove('editing-name', 'saving-name');
}

async function saveDestinationRename(card, item) {
  const input = card.querySelector('.destination-name-input');
  const title = card.querySelector('.destination-title-row strong');
  const nextName = input?.value.replace(/[\r\n\0]+/g, ' ').trim();
  if (!input || !title || !nextName || card.classList.contains('saving-name')) {
    if (!nextName) toast('Enter a name first', 'error');
    return;
  }
  card.classList.add('saving-name');
  try {
    const destination = { type: item.type, identifier: item.identifier, address: item.address, label: item.label };
    const result = await api.renameRecentDestination(item.instanceName, destination, nextName);
    item.label = result?.label || nextName;
    item.customLabel = item.label;
    item.hasCustomName = true;
    title.textContent = item.label;
    title.title = item.label;
    card.querySelector('[data-title-action="copy"]')?.setAttribute('aria-label', `Copy ${item.label}`);
    card.querySelector('[data-title-action="edit"]')?.setAttribute('aria-label', `Edit ${item.label} name`);
    card.classList.add('has-detail', 'destination-renamed');
    setTimeout(() => card.classList.remove('destination-renamed'), 700);
    cancelDestinationRename(card);
    toast('Destination name updated', 'success');
  } catch (error) {
    card.classList.remove('saving-name');
    toast('Could not update the name: ' + (error.message || error), 'error');
  }
}

function formatDestinationDate(value) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return 'Played recently';
  const elapsed = Math.max(0, Date.now() - time);
  if (elapsed < 60 * 60 * 1000) return 'Played recently';
  if (elapsed < 24 * 60 * 60 * 1000) return `Played ${Math.max(1, Math.floor(elapsed / 3600000))}h ago`;
  if (elapsed < 7 * 24 * 60 * 60 * 1000) return `Played ${Math.max(1, Math.floor(elapsed / 86400000))}d ago`;
  return `Played ${new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function selectDestinationAction(card, selected) {
  if (!card || !selected) return;
  card.querySelectorAll('.destination-action').forEach(button => button.classList.toggle('active', button === selected));
  card.querySelector('.destination-actions')?.classList.toggle('remove-selected', selected.dataset.action === 'remove');
  const indicator = card.querySelector('.destination-action-indicator');
  if (indicator) indicator.style.transform = `translateX(${selected.dataset.action === 'remove' ? '100%' : '0'})`;
}

async function hydrateServerMetadata(card, item) {
  try {
    const metadata = await api.getServerMetadata(item.instanceName, item.address);
    if (!metadata || !card.isConnected) return;
    if (!item.hasCustomName && metadata.name) {
      const title = card.querySelector('.destination-info strong');
      if (title) { title.textContent = metadata.name; title.title = metadata.name; card.classList.add('has-detail'); }
    }
    if (metadata.resolvedAddress) {
      const address = card.querySelector('.destination-address');
      if (address) {
        address.textContent = `${item.address} · ${metadata.resolvedAddress}`;
        address.title = address.textContent;
      }
    }
    if (metadata.iconData && !card.querySelector('.destination-art')) {
      const art = document.createElement('div');
      art.className = 'destination-art';
      const image = document.createElement('img');
      image.src = metadata.iconData;
      image.alt = `${metadata.name || item.label || item.address} icon`;
      image.addEventListener('error', () => art.remove(), { once: true });
      art.appendChild(image);
      card.querySelector('.destination-card-main')?.prepend(art);
      card.classList.add('has-art');
    }
  } catch {}
}

function homeGreetingText() {
  const name = state.authData?.profile?.name?.trim();
  return name ? `Welcome back, ${name}` : 'Welcome to Pine Launcher';
}

function sortByRecency(arr) {
  return [...arr].sort((a, b) => {
    const at = new Date(a.lastPlayed || a.lastOpened || 0).getTime();
    const bt = new Date(b.lastPlayed || b.lastOpened || 0).getTime();
    return bt - at;
  });
}

function renderRecentCard(inst) {
  const initial = (inst.name || '?')[0].toUpperCase();
  const sub = `${inst.loader || 'vanilla'} ${inst.gameVersion || ''}`;
  const iconHtml = inst.iconData
    ? `<img src="${escHtml(inst.iconData)}" alt="">`
    : initial;
  const blurDir = inst.bannerData ? (inst.bannerBlurDir || 'left') : null;
  const bannerUrl = inst.bannerData ? escHtml(inst.bannerData) : '';
  const blurClass = blurDir ? ` blur-${blurDir}` : '';
  return `<div class="recent-card${blurClass}" data-name="${escHtml(inst.name)}">
    ${inst.bannerData ? `<div class="recent-card-banner">
      <div class="instance-banner-blur" style="background-image:url(${bannerUrl})"></div>
      <div class="instance-banner-sharp" style="background-image:url(${bannerUrl})"></div>
    </div>` : ''}
    <button class="recent-card-play" aria-label="Play ${escHtml(inst.name)}">
      <svg width="14" height="14" aria-hidden="true"><use href="#i-play"/></svg>
    </button>
    <div class="recent-card-icon">${iconHtml}</div>
    <div class="recent-card-name">${escHtml(inst.name)}</div>
    <div class="recent-card-sub">${escHtml(sub)}${inst.lastSessionSeconds ? ` · ${formatDuration(inst.lastSessionSeconds)} last session` : ''}</div>
  </div>`;
}

function renderInstanceCard(inst) {
  const initial = (inst.name || '?')[0].toUpperCase();
  const sub = `${inst.loader || 'vanilla'} ${inst.gameVersion || ''}`;
  const isLaunching = state.launchingName === inst.name;
  const iconHtml = inst.iconData
    ? `<img src="${escHtml(inst.iconData)}" alt="">`
    : initial;
  const blurDir = inst.bannerData ? (inst.bannerBlurDir || 'left') : null;
  const bannerUrl = inst.bannerData ? escHtml(inst.bannerData) : '';
  const blurClass = blurDir ? ` blur-${blurDir}` : '';
  const selected = state.selectedInstances.has(inst.name);
  return `<div class="instance-card${isLaunching ? ' launching' : ''}${inst.favorite ? ' favorite' : ''}${selected ? ' selected' : ''}${state.librarySelectionMode ? ' selection-mode' : ''}${blurClass}" data-name="${escHtml(inst.name)}">
    ${state.librarySelectionMode ? `<span class="instance-select-mark" aria-hidden="true"><svg><use href="#i-check"/></svg></span>` : ''}
    ${inst.bannerData ? `<div class="instance-banner">
      <div class="instance-banner-blur" style="background-image:url(${bannerUrl})"></div>
      <div class="instance-banner-sharp" style="background-image:url(${bannerUrl})"></div>
    </div>` : ''}
    <div class="instance-card-top">
      <div class="instance-icon">${iconHtml}</div>
      <div class="instance-info">
        <div class="instance-name">${escHtml(inst.name)}</div>
        <div class="instance-meta">
          <span>${escHtml(sub)}</span>
          ${inst.totalPlaytimeSeconds ? `<span>${formatDuration(inst.totalPlaytimeSeconds)} played</span>` : ''}
          ${inst.lastSessionSeconds ? `<span>${formatDuration(inst.lastSessionSeconds)} last session</span>` : ''}
        </div>
      </div>
      <button class="instance-favorite" data-act="favorite" type="button" aria-label="${inst.favorite ? 'Remove from favorites' : 'Add to favorites'}" title="${inst.favorite ? 'Remove from favorites' : 'Add to favorites'}"><svg width="16" height="16"><use href="#i-star"/></svg></button>
    </div>
    <div class="instance-card-actions">
      ${isLaunching
        ? `<span class="text-muted" style="display:flex;align-items:center;gap:6px">
             <span class="spinner" style="width:12px;height:12px;border-width:2px"></span>
             Launching…
           </span>`
        : `<button class="btn btn-primary btn-sm" data-act="play">
             <svg width="12" height="12" aria-hidden="true"><use href="#i-play"/></svg> Play
           </button>
           <button class="btn btn-secondary btn-sm" data-act="open">Open</button>`
      }
    </div>
  </div>`;
}

function sortLibraryInstances(instances) {
  return [...instances].sort((a, b) => {
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
    if (state.librarySort === 'name') return a.name.localeCompare(b.name);
    if (state.librarySort === 'created') return new Date(b.created || 0) - new Date(a.created || 0);
    if (state.librarySort === 'version') return String(b.gameVersion || '').localeCompare(String(a.gameVersion || ''), undefined, { numeric: true });
    if (state.librarySort === 'loader') return String(a.loader || '').localeCompare(String(b.loader || '')) || a.name.localeCompare(b.name);
    if (state.librarySort === 'playtime') return (Number(b.totalPlaytimeSeconds) || 0) - (Number(a.totalPlaytimeSeconds) || 0) || a.name.localeCompare(b.name);
    return new Date(b.lastPlayed || b.created || 0) - new Date(a.lastPlayed || a.created || 0);
  });
}

function renderGroupTile(instance, index, extraCount = 0) {
  if (extraCount > 0) return `<span class="group-mosaic-tile group-mosaic-more"><b>+${extraCount}</b><small>more</small></span>`;
  if (!instance) return '<span class="group-mosaic-tile group-mosaic-empty"><svg aria-hidden="true"><use href="#i-folder"/></svg></span>';
  if (instance.iconData) return `<span class="group-mosaic-tile"><img src="${escHtml(instance.iconData)}" alt=""></span>`;
  return `<span class="group-mosaic-tile group-mosaic-initial" style="--tile-index:${index}">${escHtml((instance.name || '?')[0].toUpperCase())}</span>`;
}

function renderGroupCard(group) {
  const members = sortLibraryInstances(state.instances.filter(instance => String(instance.group || '').toLowerCase() === group.name.toLowerCase()));
  const tiles = members.length > 4
    ? [renderGroupTile(members[0], 0), renderGroupTile(members[1], 1), renderGroupTile(members[2], 2), renderGroupTile(null, 3, members.length - 3)]
    : Array.from({ length: 4 }, (_, index) => renderGroupTile(members[index], index));
  return `<article class="group-card" data-group="${escHtml(group.name)}" role="button" tabindex="0" aria-label="Open ${escHtml(group.name)} group">
    <button class="group-card-delete" type="button" data-delete-group="${escHtml(group.name)}" aria-label="Delete ${escHtml(group.name)} group" title="Delete group"><svg aria-hidden="true"><use href="#i-trash"/></svg></button>
    <span class="group-mosaic">${tiles.join('')}</span>
    <span class="group-card-copy">
      <strong>${escHtml(group.name)}</strong>
      <small>${members.length} instance${members.length === 1 ? '' : 's'}</small>
    </span>
    <svg class="group-card-arrow" aria-hidden="true"><use href="#i-chevron-right"/></svg>
  </article>`;
}

function bindLibraryInstanceCards(grid) {
  grid.querySelectorAll('.instance-card').forEach((card) => {
    const name = card.dataset.name;
    card.addEventListener('click', () => {
      if (state.librarySelectionMode) {
        if (state.selectedInstances.has(name)) state.selectedInstances.delete(name); else state.selectedInstances.add(name);
        renderLibrary();
      } else selectInstance(name);
    });
    card.querySelector('[data-act="play"]')?.addEventListener('click', (e) => { e.stopPropagation(); if (!state.librarySelectionMode) launchInstance(name); });
    card.querySelector('[data-act="open"]')?.addEventListener('click', (e) => { e.stopPropagation(); if (!state.librarySelectionMode) selectInstance(name); });
    card.querySelector('[data-act="favorite"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (state.librarySelectionMode) return;
      const instance = state.instances.find(item => item.name === name);
      if (!instance) return;
      try { await api.updateInstance(name, { favorite: !instance.favorite }); await loadInstances(); }
      catch (error) { toast('Could not update favorite: ' + (error.message || error), 'error'); }
    });
  });
}

function renderLibrary() {
  const grid = $('library-grid');
  const groupsSection = $('library-groups-section');
  const groupsGrid = $('library-groups-grid');
  const groupContext = $('library-group-context');
  const instancesHeading = $('library-instances-heading');
  if (!grid || !groupsSection || !groupsGrid || !groupContext || !instancesHeading) return;
  requestAnimationFrame(moveLibrarySortIndicator);
  updateBulkBar();

  const activeGroup = state.activeLibraryGroup
    ? state.groups.find(group => group.name.toLowerCase() === state.activeLibraryGroup.toLowerCase())
    : null;
  if (state.activeLibraryGroup && !activeGroup) state.activeLibraryGroup = null;

  if (activeGroup) {
    groupsSection.hidden = true;
    instancesHeading.hidden = true;
    groupContext.hidden = false;
    const memberCount = state.instances.filter(instance => String(instance.group || '').toLowerCase() === activeGroup.name.toLowerCase()).length;
    groupContext.innerHTML = `<button class="library-group-back" type="button" data-library-group-back>
        <svg aria-hidden="true"><use href="#i-chevron-left"/></svg><span>All groups</span>
      </button>
      <div class="library-group-title"><span class="library-group-title-icon"><svg aria-hidden="true"><use href="#i-folder"/></svg></span><div><h2>${escHtml(activeGroup.name)}</h2><p>${memberCount} instance${memberCount === 1 ? '' : 's'}</p></div></div>
      <button class="btn btn-ghost library-group-delete" type="button" data-delete-group="${escHtml(activeGroup.name)}"><svg width="15" height="15" aria-hidden="true"><use href="#i-trash"/></svg>Delete group</button>`;
    const members = sortLibraryInstances(state.instances.filter(instance => String(instance.group || '').toLowerCase() === activeGroup.name.toLowerCase()));
    if (!members.length) {
      grid.innerHTML = `<div class="empty-state library-group-empty">
        <div class="empty-state-icon"><svg width="24" height="24" aria-hidden="true"><use href="#i-folder"/></svg></div>
        <div class="empty-state-title">This group is ready</div>
        <div class="empty-state-sub">Create an instance and choose ${escHtml(activeGroup.name)} to add it here.</div>
        <button class="btn btn-primary" type="button" data-create-in-group>Create an instance</button>
      </div>`;
      grid.querySelector('[data-create-in-group]')?.addEventListener('click', openCreateModal);
      return;
    }
    grid.innerHTML = members.map(renderInstanceCard).join('');
    staggerInto(grid.querySelectorAll('.instance-card'));
    bindLibraryInstanceCards(grid);
    return;
  }

  groupContext.hidden = true;
  groupsSection.hidden = !state.groups.length;
  groupsGrid.innerHTML = state.groups.map(renderGroupCard).join('');
  staggerInto(groupsGrid.querySelectorAll('.group-card'));
  groupsGrid.querySelectorAll('.group-card').forEach(card => {
    const open = () => {
      state.activeLibraryGroup = card.dataset.group;
      renderLibrary();
      $('content')?.scrollTo({ top: 0, behavior: 'smooth' });
    };
    card.addEventListener('click', event => {
      const deleteButton = event.target.closest('[data-delete-group]');
      if (deleteButton) {
        event.stopPropagation();
        openDeleteGroupModal(deleteButton.dataset.deleteGroup);
        return;
      }
      open();
    });
    card.addEventListener('keydown', event => {
      if (event.target.closest('[data-delete-group]')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });

  const instances = sortLibraryInstances(state.instances.filter(instance => !String(instance.group || '').trim()));
  instancesHeading.hidden = !state.groups.length || !instances.length;
  $('library-instances-copy').textContent = state.groups.length ? 'Everything outside a group.' : 'Browse and manage your instances.';
  if (!state.instances.length && !state.groups.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg width="24" height="24" aria-hidden="true"><use href="#i-library"/></svg></div>
      <div class="empty-state-title">No instances yet</div>
      <div class="empty-state-sub">Create an instance or make a group to begin.</div>
    </div>`;
    return;
  }
  if (!instances.length) {
    grid.innerHTML = '';
    return;
  }
  grid.innerHTML = instances.map(renderInstanceCard).join('');
  staggerInto(grid.querySelectorAll('.instance-card'));
  bindLibraryInstanceCards(grid);
}

function setLibrarySelectionMode(enabled) {
  state.librarySelectionMode = Boolean(enabled);
  if (!enabled) state.selectedInstances.clear();
  const button = $('library-select-btn');
  if (button) button.classList.toggle('active', state.librarySelectionMode);
  renderLibrary();
}

function updateBulkBar() {
  const bar = $('library-bulk-bar');
  if (!bar) return;
  bar.hidden = !state.librarySelectionMode;
  const count = state.selectedInstances.size;
  const label = $('library-selected-count');
  if (label) label.textContent = `${count} selected`;
  const select = $('library-bulk-group');
  if (select) select.innerHTML = `<option value="">No group</option>${state.groups.map(group => `<option value="${escHtml(group.name)}">${escHtml(group.name)}</option>`).join('')}`;
  bar.querySelectorAll('button:not(#library-select-done), select').forEach(element => { element.disabled = count === 0; });
}

async function runBulkInstanceAction(action, successMessage) {
  const names = [...state.selectedInstances];
  if (!names.length) return;
  try {
    await api.bulkUpdateInstances(names, action);
    await loadInstances();
    toast(`${successMessage} · ${names.length} updated`, 'success');
  } catch (error) { toast('Could not update selection: ' + (error.message || error), 'error', 7000); }
}

async function deleteSelectedInstances() {
  const names = [...state.selectedInstances];
  if (!names.length) return;
  const confirmed = await backupConfirmation({
    title: `Delete ${names.length} selected instance${names.length === 1 ? '' : 's'}?`,
    message: 'This permanently removes only the selected instances and their files. Your groups and every unselected instance stay untouched.',
    action: 'Delete selected', danger: true,
  });
  if (!confirmed) return;
  try {
    await api.bulkDeleteInstances(names);
    state.selectedInstances.clear();
    await loadInstances();
    toast(`${names.length} instance${names.length === 1 ? '' : 's'} deleted`, 'success');
  } catch (error) { toast('Could not delete selection: ' + (error.message || error), 'error', 7000); }
}

function quickLaunch() {
  const sorted = sortByRecency(state.instances);
  if (sorted[0]) launchInstance(sorted[0].name);
}

// ── Instance view ───────────────────────────────────────────
function openInstanceView() {
  if (!state.currentInstance) return;
  switchView('instance');
  const inst = state.currentInstance;
  const name = inst.name || '';
  const blurDir = inst.bannerData ? (inst.bannerBlurDir || 'left') : null;
  const blurClass = blurDir ? ` blur-${blurDir}` : '';
  // Banner on the page header
  const pageHeader = document.querySelector('#view-instance .page-header');
  if (pageHeader) {
    const existing = pageHeader.querySelector('.instance-banner');
    if (existing) existing.remove();
    if (inst.bannerData) {
      const bannerUrl = escHtml(inst.bannerData);
      const banner = document.createElement('div');
      banner.className = `instance-banner${blurClass}`;
      banner.innerHTML = `<div class="instance-banner-blur" style="background-image:url(${bannerUrl})"></div><div class="instance-banner-sharp" style="background-image:url(${bannerUrl})"></div>`;
      banner.style.borderRadius = '0';
      pageHeader.insertBefore(banner, pageHeader.firstChild);
      pageHeader.classList.add('has-banner');
    } else {
      pageHeader.classList.remove('has-banner');
    }
  }

  const header = $('instance-header-info');
  if (header) {
    const initial = (name || '?')[0].toUpperCase();
    const iconHtml = inst.iconData
      ? `<img src="${escHtml(inst.iconData)}" alt="">`
      : initial;
    header.innerHTML = `
      <div class="instance-icon" style="width:48px;height:48px;font-size:18px">${iconHtml}</div>
      <div>
        <div class="instance-header-name">${escHtml(name)}</div>
        <div class="instance-header-meta">
          ${escHtml((inst.loader || 'vanilla') + ' ' + (inst.gameVersion || ''))}${inst.totalPlaytimeSeconds ? ` · ${formatDuration(inst.totalPlaytimeSeconds)} played` : ''}${inst.lastSessionSeconds ? ` · ${formatDuration(inst.lastSessionSeconds)} last session` : ''}
        </div>
      </div>
    `;
  }
  // Show instance name in the Back button
  const backBtn = document.querySelector('#view-instance .btn-ghost');
  if (backBtn) {
    backBtn.innerHTML = `<svg width="16" height="16" aria-hidden="true"><use href="#i-chevron-left"/></svg> ${escHtml(name)}`;
  }
  switchInstanceTab('content');
}

function switchInstanceTab(tab) {
  const activeTab = document.querySelector('#instance-tabs .tab.active')?.dataset.tab;
  if (activeTab === 'settings' && tab !== 'settings' && state.instanceSettingsDirty) {
    saveInstanceSettings(null, { silent: true });
  }
  document.querySelectorAll('#instance-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('#instance-tab-content .tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.tab === tab));
  if (tab === 'content') loadContentList();
  if (tab === 'worlds') loadWorlds();
  if (tab === 'settings') loadInstanceSettings();
}

function formatBackupDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function backupConfirmation({ title, message, action = 'Continue', danger = false }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-root visible backup-confirm-root';
    overlay.innerHTML = `
      <div class="modal confirm-modal" role="alertdialog" aria-modal="true">
        <div class="modal-header"><div><h2 class="modal-title">${escHtml(title)}</h2></div></div>
        <div class="modal-body"><div class="confirm-warn"><svg width="22" height="22" aria-hidden="true"><use href="#i-alert-triangle"/></svg><span>${escHtml(message)}</span></div></div>
        <div class="modal-footer"><button class="btn btn-secondary" data-cancel type="button">Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm type="button">${escHtml(action)}</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const finish = value => { overlay.remove(); resolve(value); };
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('[data-cancel]')) finish(false);
      if (event.target.closest('[data-confirm]')) finish(true);
    });
  });
}

async function openBackupPanel() {
  const instance = state.currentInstance;
  if (!instance) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-root visible backup-panel-root';
  overlay.innerHTML = `
    <div class="modal backup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-panel-title">
      <div class="modal-header">
        <div><h2 class="modal-title" id="backup-panel-title">Backups</h2><p class="modal-sub">${escHtml(instance.name)} restore points</p></div>
        <button class="modal-close" data-close type="button" aria-label="Close"><svg width="20" height="20" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body backup-modal-body">
        <div class="backup-explainer">
          <svg width="20" height="20" aria-hidden="true"><use href="#i-backup"/></svg>
          <div><strong>A backup is a safe copy, not a new instance.</strong><span>An entire-instance backup preserves this instance's Minecraft version, worlds, servers, mods, settings, resource packs, shaders, and configuration. Creating one does not change or remove anything from the instance you use now.</span></div>
        </div>
        <section class="backup-create-card">
          <div class="backup-create-heading"><div><strong>Create a backup</strong><span>Choose whether to protect everything or only your saved worlds.</span></div></div>
          <div class="backup-create-grid">
            <label><span>Backup type</span><select class="input" data-backup-scope><option value="full">Entire instance</option><option value="worlds">Worlds only</option></select></label>
            <label><span>Description (optional)</span><input class="input" data-backup-description maxlength="160" placeholder="Before changing my mod list"><small>A private note to help you remember why you made this restore point.</small></label>
          </div>
          <div class="backup-create-action"><button class="btn backup-create-button" data-create-backup type="button"><svg width="17" height="17" aria-hidden="true"><use href="#i-backup"/></svg><span>Create backup</span></button></div>
        </section>
        <div class="backup-list-heading">
          <div><strong>Restore points</strong><span data-backup-count>Loading…</span></div>
          <label class="backup-retention-control">
            <span class="backup-retention-row"><strong>Automatic backups to keep</strong><span class="backup-stepper"><button data-retention-down type="button" aria-label="Keep one fewer automatic backup">−</button><input class="backup-retention" data-retention type="number" min="1" max="20" value="5" readonly aria-label="Number of automatic backups to keep"><button data-retention-up type="button" aria-label="Keep one more automatic backup">+</button></span></span>
            <small>Pine creates safety backups before updates and keeps the newest amount selected above. Backups you create yourself are always kept until you delete them.</small>
          </label>
        </div>
        <div class="backup-list" data-backup-list><div class="backup-empty">Loading backups…</div></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('[data-close]')) close(); });

  const list = overlay.querySelector('[data-backup-list]');
  const count = overlay.querySelector('[data-backup-count]');
  const retention = overlay.querySelector('[data-retention]');
  let backups = [];

  const changeRetention = delta => {
    const current = Number.parseInt(retention.value, 10) || 5;
    retention.value = String(Math.min(20, Math.max(1, current + delta)));
    retention.dispatchEvent(new Event('change'));
  };
  overlay.querySelector('[data-retention-down]').addEventListener('click', () => changeRetention(-1));
  overlay.querySelector('[data-retention-up]').addEventListener('click', () => changeRetention(1));

  const refresh = async () => {
    const result = await api.listInstanceBackups(instance.name);
    backups = result.backups || [];
    retention.value = result.retention || 5;
    count.textContent = `${backups.length} backup${backups.length === 1 ? '' : 's'}`;
    if (!backups.length) {
      list.innerHTML = '<div class="backup-empty"><strong>No backups yet</strong><span>Create a restore point before making a risky change.</span></div>';
      return;
    }
    list.innerHTML = backups.map(backup => `
      <article class="backup-item" data-backup-id="${escHtml(backup.id)}">
        <div class="backup-item-icon"><svg width="19" height="19" aria-hidden="true"><use href="#i-backup"/></svg></div>
        <div class="backup-item-copy">
          <div class="backup-item-title">${escHtml(backup.description || backup.reason || (backup.scope === 'worlds' ? 'Worlds backup' : 'Instance backup'))}</div>
          <div class="backup-item-meta"><span>${escHtml(formatBackupDate(backup.createdAt))}</span><span>${backup.scope === 'worlds' ? 'Worlds only' : 'Entire instance'}</span><span>${formatBytes(backup.bytes || 0)}</span>${backup.kind === 'automatic' ? '<span class="backup-auto-badge">Automatic</span>' : ''}</div>
          ${backup.hasNewerWorlds ? '<div class="backup-world-warning">Contains worlds from a newer Minecraft version</div>' : ''}
        </div>
        <div class="backup-item-actions"><button class="btn btn-secondary" data-restore type="button">Restore</button><button class="btn btn-ghost btn-icon" data-delete type="button" title="Delete backup" aria-label="Delete backup"><svg width="17" height="17" aria-hidden="true"><use href="#i-trash"/></svg></button></div>
      </article>`).join('');
  };

  overlay.querySelector('[data-create-backup]').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>Creating backup…';
    try {
      await api.createInstanceBackup(instance.name, {
        scope: overlay.querySelector('[data-backup-scope]').value,
        description: overlay.querySelector('[data-backup-description]').value,
      });
      overlay.querySelector('[data-backup-description]').value = '';
      await refresh();
      toast('Backup created', 'success');
    } catch (error) {
      toast('Backup failed: ' + (error.message || error), 'error', 6000);
    } finally {
      button.disabled = false;
      button.innerHTML = '<svg width="17" height="17" aria-hidden="true"><use href="#i-backup"/></svg><span>Create backup</span>';
    }
  });

  retention.addEventListener('change', async () => {
    try {
      retention.value = await api.setInstanceBackupRetention(instance.name, retention.value);
      await refresh();
      toast(`Keeping the latest ${retention.value} automatic backups`, 'success');
    } catch (error) { toast('Could not save retention: ' + (error.message || error), 'error'); }
  });

  list.addEventListener('click', async event => {
    const card = event.target.closest('[data-backup-id]');
    const backup = backups.find(item => item.id === card?.dataset.backupId);
    if (!backup) return;
    if (event.target.closest('[data-delete]')) {
      if (!await backupConfirmation({ title: 'Delete this backup?', message: 'This restore point will be permanently removed. The current instance will not be changed.', action: 'Delete backup', danger: true })) return;
      try { await api.deleteInstanceBackup(instance.name, backup.id); await refresh(); toast('Backup deleted', 'success'); }
      catch (error) { toast('Could not delete backup: ' + (error.message || error), 'error'); }
    }
    if (event.target.closest('[data-restore]')) {
      const warning = backup.hasNewerWorlds
        ? 'This backup contains worlds last opened in a newer Minecraft version. Restoring and opening them in this instance may permanently damage them. Pine will create a safety backup first.'
        : 'Pine will create a safety backup of the current instance first, then replace the selected data with this restore point.';
      if (!await backupConfirmation({ title: 'Restore this backup?', message: warning, action: 'Restore backup', danger: backup.hasNewerWorlds })) return;
      const button = card.querySelector('[data-restore]');
      button.disabled = true;
      button.textContent = 'Restoring…';
      try {
        await api.restoreInstanceBackup(instance.name, backup.id, backup.hasNewerWorlds);
        await refresh();
        await loadContentList();
        toast('Backup restored', 'success');
      } catch (error) {
        toast('Restore failed: ' + (error.message || error), 'error', 7000);
      } finally {
        button.disabled = false;
        button.textContent = 'Restore';
      }
    }
  });

  try { await refresh(); }
  catch (error) { list.innerHTML = `<div class="backup-empty">Could not load backups: ${escHtml(error.message || error)}</div>`; }
}

let cachedMods = [];
const CONTENT_LABELS = {
  mod: { singular: 'mod', plural: 'mods' },
  resourcepack: { singular: 'resource pack', plural: 'resource packs' },
  shader: { singular: 'shader', plural: 'shaders' },
  datapack: { singular: 'data pack', plural: 'data packs' },
};

function switchContentCategory(type) {
  if (!CONTENT_LABELS[type] || state.contentCategory === type) return;
  state.contentCategory = type;
  $('content-categories')?.querySelectorAll('[data-content-type]').forEach(button => {
    button.classList.toggle('active', button.dataset.contentType === type);
  });
  const search = $('content-search');
  if (search) {
    search.value = '';
    search.placeholder = `Filter installed ${CONTENT_LABELS[type].plural}...`;
  }
  const list = $('content-list');
  list?.classList.add('content-switching');
  clearTimeout(state.contentSwitchTimer);
  state.contentSwitchTimer = setTimeout(() => loadContentList(), 120);
}

async function loadContentList() {
  if (!state.currentInstance) return;
  const container = $('content-list');
  if (!container) return;
  const requestId = ++state.contentRequestId;
  const category = state.contentCategory;
  container.innerHTML = `<div class="skeleton skeleton-block"></div>`.repeat(3);
  try {
    cachedMods = await api.getInstanceContent(state.currentInstance.name, category);
    if (requestId !== state.contentRequestId || category !== state.contentCategory) return;
    if (category === 'mod') checkForModUpdates(state.currentInstance.name);
    else state.pendingModUpdates = [];
    renderContentList();
    container.classList.remove('content-switching');
    container.classList.add('content-entering');
    setTimeout(() => container.classList.remove('content-entering'), 280);
    refreshContentCounts();
  } catch (error) {
    if (requestId !== state.contentRequestId) return;
    container.classList.remove('content-switching');
    container.innerHTML = `<div class="text-muted" style="text-align:center;padding:24px">Failed to load ${CONTENT_LABELS[category].plural}: ${escHtml(error.message || error)}</div>`;
  }
}

async function refreshContentCounts() {
  if (!state.currentInstance) return;
  const instanceName = state.currentInstance.name;
  await Promise.all(Object.keys(CONTENT_LABELS).map(async type => {
    try {
      const items = type === state.contentCategory ? cachedMods : await api.getInstanceContent(instanceName, type);
      const count = document.querySelector(`[data-count="${type}"]`);
      if (count && state.currentInstance?.name === instanceName) count.textContent = items.length;
    } catch {}
  }));
}

async function checkForModUpdates(instanceName) {
  try {
    const updates = await api.checkModUpdates(instanceName);
    if (state.currentInstance?.name !== instanceName || state.contentCategory !== 'mod') return;
    state.pendingModUpdates = updates || [];
  } catch {
    if (state.currentInstance?.name !== instanceName || state.contentCategory !== 'mod') return;
    state.pendingModUpdates = [];
  }
  renderContentList();
}

function renderContentList() {
  const container = $('content-list');
  if (!container) return;
  const query = ($('content-search')?.value || '').toLowerCase().trim();
  const labels = CONTENT_LABELS[state.contentCategory];
  const filtered = query
    ? cachedMods.filter((m) => (m.title || m.filename).toLowerCase().includes(query))
    : cachedMods;
  if (!filtered.length) {
    container.innerHTML = query
      ? `<div class="text-muted" style="text-align:center;padding:24px">No ${labels.plural} match "${escHtml(query)}"</div>`
      : `<div class="text-muted" style="text-align:center;padding:24px">No ${labels.plural} installed.${state.contentCategory === 'datapack' ? ' Data packs are stored inside individual worlds.' : ' Click "Add content" to install some.'}</div>`;
    return;
  }
  container.innerHTML = filtered.map((m) => {
    const update = !m.compatibilityIssue && state.contentCategory === 'mod' && (state.pendingModUpdates || []).find(u => u.projectId === m.projectId);
    return `
    <div class="content-item ${update ? 'has-update' : ''}${m.disabled ? ' is-disabled' : ''}" data-pid="${escHtml(m.projectId || m.filename)}">
      <div class="content-item-icon">
        ${m.iconUrl ? `<img src="${escHtml(m.iconUrl)}" alt="" loading="lazy" decoding="async">` : escHtml((m.title || m.filename)[0].toUpperCase())}
      </div>
      <div class="content-item-info">
        <div class="content-item-name">${escHtml(m.title || m.filename)} ${m.disabled ? '<span class="update-badge">Disabled</span>' : (m.compatibilityIssue ? '<span class="update-badge">Incompatible</span>' : (update ? '<span class="update-badge">Update</span>' : ''))}</div>
        <div class="content-item-version">${update ? escHtml(update.latestVersionName) : escHtml(m.world ? `${m.world} · ${m.filename}` : m.filename)}</div>
        ${m.compatibilityIssue ? `<div class="content-compatibility-warning">${escHtml(m.compatibilityIssue)}</div>` : ''}
      </div>
      <div class="content-item-actions">
        ${update ? `<button class="btn btn-primary btn-sm" data-act="update">Update</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-act="toggle">${m.disabled ? 'Enable' : 'Disable'}</button>
        <button class="btn btn-secondary btn-sm" data-act="remove">
          <svg width="12" height="12" aria-hidden="true"><use href="#i-trash"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
  container.querySelectorAll('.content-item').forEach((row) => {
    const pid = row.dataset.pid;
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      if (mProjectId(row, pid)) showModDetails(mProjectId(row, pid));
    });
    row.querySelector('[data-act="remove"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const mod = cachedMods.find((m) => (m.projectId || m.filename) === pid);
      if (mod) removeContentItem(mod);
    });
    row.querySelector('[data-act="toggle"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const mod = cachedMods.find((m) => (m.projectId || m.filename) === pid);
      if (!mod) return;
      try {
        if (state.contentCategory === 'mod') await api.disableMod(state.currentInstance.name, mod.filename);
        else await api.toggleInstanceContent(state.currentInstance.name, state.contentCategory, mod.key || mod.filename);
        await loadContentList();
      } catch (err) { setStatus('Toggle failed: ' + (err.message || err)); }
    });
    row.querySelector('[data-act="update"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const mod = cachedMods.find((m) => (m.projectId || m.filename) === pid);
      if (mod && mod.projectId) updateMod(state.currentInstance, mod);
    });
  });
}

function mProjectId(_row, pid) {
  return cachedMods.find(item => (item.projectId || item.filename) === pid)?.projectId || null;
}

async function removeContentItem(item) {
  try {
    if (state.contentCategory === 'mod') await api.removeMod(state.currentInstance.name, item.filename);
    else await api.removeInstanceContent(state.currentInstance.name, state.contentCategory, item.key || item.filename);
    setStatus(`Removed ${item.title || item.filename}`);
    await loadContentList();
  } catch (error) {
    setStatus('Remove failed: ' + (error.message || error));
    toast('Remove failed: ' + (error.message || error), 'error', 4000);
  }
}

async function removeMod(name, filename) {
  try {
    await api.removeMod(name, filename);
    setStatus(`Removed ${filename}`);
    loadContentList();
  } catch (e) {
    setStatus('Remove failed: ' + (e.message || e));
  }
}

async function updateMod(inst, mod) {
  if (!mod.projectId) return;
  toast('Checking for updates…', 'info');
  try {
    if (String(mod.projectId).startsWith('curseforge:')) {
      const update = state.pendingModUpdates.find(item => item.projectId === mod.projectId);
      if (!update) { toast('Already up to date', 'success', 3000); return; }
      await api.installCurseForgeContent(inst.name, { projectId: mod.projectId, fileId: Number(update.latestVersion), type: 'mod', replaceFilename: mod.filename });
      await loadContentList();
      await checkForModUpdates(inst.name);
      toast(`${mod.title} updated`, 'success');
      return;
    }
    const loaders = inst.loader === 'vanilla' ? [] : [inst.loader];
    const versions = await findCompatibleVersion(mod.projectId, loaders, inst.gameVersion);
    if (!versions || !versions.length) {
      toast('No update available', 'error', 3000);
      return;
    }
    const latest = versions[0];
    if (latest.id === mod.installedVersion) {
      toast('Already up to date', 'success', 3000);
      return;
    }
    await doInstallMod(inst, mod.projectId, { createBackup: true, backupReason: `Before updating ${mod.title || mod.filename}` });
  } catch (e) {
    toast('Update failed: ' + (e.message || e), 'error', 4000);
  }
}

async function openContentAdder() {
  if (!state.currentInstance) return;
  state.discoverCategory = state.contentCategory;
  $('discover-categories')?.querySelectorAll('[data-category]').forEach(chip => {
    chip.classList.toggle('chip-active', chip.dataset.category === state.discoverCategory);
  });
  const search = $('search-input');
  if (search) search.placeholder = `Search ${CONTENT_LABELS[state.contentCategory].plural}...`;
  const loaderSel = $('filter-loader');
  if (loaderSel) loaderSel.value = state.currentInstance.loader === 'vanilla' ? '' : state.currentInstance.loader;
  switchView('discover');
  moveDiscoverIndicator();
  searchMods(false);
}

async function loadWorlds() {
  const container = $('worlds-grid');
  const instance = state.currentInstance;
  if (!container || !instance) return;
  container.innerHTML = '<div class="empty-state"><span class="spinner"></span><div class="empty-state-sub">Reading worlds…</div></div>';
  let worlds = [];
  try { worlds = await api.getInstanceWorldDetails(instance.name); }
  catch (error) { return void (container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Could not read worlds</div><div class="empty-state-sub">${escHtml(error.message || String(error))}</div></div>`); }
  if (!worlds.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg width="24" height="24" aria-hidden="true"><use href="#i-globe"/></svg></div>
      <div class="empty-state-title">No worlds yet</div>
      <div class="empty-state-sub">Worlds will appear here once you play this instance.</div>
    </div>`;
    return;
  }
  container.innerHTML = worlds.map((world, index) => `
    <article class="world-card" data-world-index="${index}">
      <div class="world-art" ${world.iconData ? `style="background-image:url('${world.iconData}')"` : ''}>
        ${world.iconData ? '' : '<svg width="28" height="28"><use href="#i-globe"/></svg>'}
      </div>
      <div class="world-card-body">
        <div class="world-card-heading">
          <div class="world-card-title"><b>${escHtml(world.name || world.identifier)}</b><small>${escHtml(world.identifier)}</small></div>
          ${world.downgradeRisk ? `<div class="world-downgrade-warning" title="This save was played in a newer Minecraft version"><svg><use href="#i-alert-triangle"/></svg><span>Newer version</span></div>` : ''}
        </div>
        <div class="world-meta">
          ${world.version ? `<span>${escHtml(world.version)}</span>` : ''}
          ${world.gameMode ? `<span>${escHtml(world.gameMode)}</span>` : ''}
          <span>${formatBytes(Number(world.size) || 0)}</span>
        </div>
        ${world.lastPlayed ? `<div class="world-last-played">Last played ${escHtml(formatBackupDate(world.lastPlayed))}</div>` : ''}
        <div class="world-action-dock" aria-label="World actions">
          <button class="world-dock-action world-dock-play" data-world-action="play" type="button"><svg><use href="#i-play"/></svg><span>Play</span></button>
          <button class="world-dock-action" data-world-action="rename" type="button"><svg><use href="#i-edit"/></svg><span>Rename</span></button>
          <button class="world-dock-action" data-world-action="datapack" type="button"><svg><use href="#i-plus"/></svg><span>Data packs</span></button>
          <button class="world-dock-action" data-world-action="open" type="button"><svg><use href="#i-folder"/></svg><span>Folder</span></button>
          <button class="world-dock-action" data-world-action="more" type="button" aria-expanded="false"><svg><use href="#i-more"/></svg><span>More</span></button>
          <div class="world-more-menu" hidden>
            <button data-world-action="duplicate" type="button"><svg><use href="#i-copy"/></svg><span><b>Duplicate world</b><small>Make an independent copy</small></span></button>
            <button data-world-action="export" type="button"><svg><use href="#i-download"/></svg><span><b>Export world</b><small>Save it as a ZIP archive</small></span></button>
            <button class="world-delete" data-world-action="delete" type="button"><svg><use href="#i-trash"/></svg><span><b>Delete world</b><small>A restore point is created first</small></span></button>
          </div>
        </div>
      </div>
    </article>`).join('');
  container.querySelectorAll('[data-world-action]').forEach(button => button.addEventListener('click', async event => {
    const actionButton = event.currentTarget;
    const card = actionButton.closest('[data-world-index]');
    const world = worlds[Number(card.dataset.worldIndex)];
    const action = actionButton.dataset.worldAction;
    if (!world) return;
    if (action === 'more') {
      const menu = card.querySelector('.world-more-menu');
      const opening = menu.hidden;
      container.querySelectorAll('.world-more-menu').forEach(other => { other.hidden = true; });
      container.querySelectorAll('[data-world-action="more"]').forEach(other => other.setAttribute('aria-expanded', 'false'));
      menu.hidden = !opening;
      actionButton.setAttribute('aria-expanded', String(opening));
      return;
    }
    card.querySelector('.world-more-menu').hidden = true;
    card.querySelector('[data-world-action="more"]').setAttribute('aria-expanded', 'false');
    actionButton.disabled = true;
    try {
      if (action === 'play') launchInstance(instance.name, { type: 'singleplayer', identifier: world.identifier, label: world.name, version: world.version });
      if (action === 'rename') {
        const name = await askForWorldName(world.name || world.identifier);
        if (name && name !== world.name) {
          await api.renameWorld(instance.name, world.identifier, name);
          toast('World renamed · restore point created', 'success');
          await loadWorlds();
        }
      }
      if (action === 'datapack') openWorldDatapackChooser(instance, world);
      if (action === 'open') await api.openWorldFolder(instance.name, world.identifier);
      if (action === 'duplicate') {
        await api.duplicateWorld(instance.name, world.identifier);
        toast(`${world.name || world.identifier} duplicated`, 'success');
        await loadWorlds();
      }
      if (action === 'export') {
        const exported = await api.exportWorld(instance.name, world.identifier);
        if (exported) toast('World exported', 'success');
      }
      if (action === 'delete') {
        const confirmed = await backupConfirmation({
          title: `Delete ${world.name || world.identifier}?`,
          message: 'Pine will create a restore point first, then remove this world from the instance.',
          action: 'Delete world', danger: true,
        });
        if (confirmed) {
          await api.deleteWorld(instance.name, world.identifier);
          toast('World deleted · restore point created', 'success');
          await loadWorlds();
        }
      }
    } catch (error) {
      toast(`World action failed: ${error.message || error}`, 'error', 7000);
    } finally { if (actionButton.isConnected) actionButton.disabled = false; }
  }));
  container.onclick = event => {
    if (event.target.closest('.world-action-dock')) return;
    container.querySelectorAll('.world-more-menu').forEach(menu => { menu.hidden = true; });
    container.querySelectorAll('[data-world-action="more"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  };
}

function askForWorldName(currentName) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-root visible';
    overlay.innerHTML = `<div class="modal confirm-modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2 class="modal-title">Rename world</h2><p class="modal-sub">The save folder stays in place. Pine changes the name shown inside Minecraft.</p></div></div><div class="modal-body"><input class="input" data-world-name maxlength="128" value="${escHtml(currentName)}"></div><div class="modal-footer"><button class="btn btn-secondary" data-cancel type="button">Cancel</button><button class="btn btn-primary" data-save type="button">Save name</button></div></div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('[data-world-name]');
    const finish = value => { overlay.remove(); resolve(value); };
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('[data-cancel]')) finish(null);
      if (event.target.closest('[data-save]')) finish(input.value.trim());
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') finish(input.value.trim()); });
    input.select();
  });
}

function openWorldDatapackChooser(instance, world) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-root visible';
  overlay.innerHTML = `<div class="modal duplicate-instance-modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2 class="modal-title">Add a data pack</h2><p class="modal-sub">Install into ${escHtml(world.name || world.identifier)}. Pine creates a worlds restore point first.</p></div><button class="modal-close" data-close type="button"><svg width="20" height="20"><use href="#i-x"/></svg></button></div><div class="modal-body export-choice-grid"><button class="export-choice" data-local type="button"><svg><use href="#i-download"/></svg><span><b>Choose a ZIP</b><small>Install a local data pack with a valid pack.mcmeta.</small></span></button><button class="export-choice" data-modrinth type="button"><svg><use href="#i-search"/></svg><span><b>Find on Modrinth</b><small>Browse packs compatible with this instance.</small></span></button></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', async event => {
    if (event.target === overlay || event.target.closest('[data-close]')) return overlay.remove();
    if (event.target.closest('[data-local]')) {
      overlay.remove();
      try {
        const result = await api.installWorldDatapackFile(instance.name, world.identifier);
        if (result) toast(`${result.filename} installed · restore point created`, 'success');
      } catch (error) { toast('Could not install data pack: ' + (error.message || error), 'error', 7000); }
    }
    if (event.target.closest('[data-modrinth]')) {
      state.pendingDatapackWorld = { instanceName: instance.name, identifier: world.identifier, worldName: world.name || world.identifier };
      state.discoverCategory = 'datapack';
      overlay.remove();
      document.querySelectorAll('#discover-categories [data-category]').forEach(chip => chip.classList.toggle('chip-active', chip.dataset.category === 'datapack'));
      switchView('discover');
      moveDiscoverIndicator();
      searchMods(false);
      toast(`Choose a data pack for ${world.name || world.identifier}`, 'info', 5000);
    }
  });
}

async function backupAllWorlds() {
  const instance = state.currentInstance;
  if (!instance) return;
  const button = $('worlds-backup-btn');
  button.disabled = true;
  try {
    await api.createInstanceBackup(instance.name, { scope: 'worlds', description: 'Manual worlds backup' });
    toast('Worlds backup created', 'success');
  } catch (error) { toast('Could not back up worlds: ' + (error.message || error), 'error', 7000); }
  finally { button.disabled = false; }
}

async function refreshNeoForgeInstance(instanceName) {
  await loadInstances();
  const refreshed = state.instances.find(item => item.name === instanceName);
  if (refreshed) state.currentInstance = refreshed;
  loadInstanceSettings();
}

async function loadNeoForgePanel(instance) {
  const statusHost = $('neoforge-status');
  const actionsHost = $('neoforge-actions');
  if (!statusHost || !actionsHost) return;
  try {
    const status = await api.getNeoForgeStatus(instance.name);
    const health = status.health || {};
    const issueCount = Number(health.missingLibraries || 0) + Number(health.damagedLibraries || 0);
    const ready = health.installed && health.valid;
    statusHost.innerHTML = `
      <div class="loader-health-state ${ready ? 'is-ready' : 'needs-repair'}"><svg aria-hidden="true"><use href="#${ready ? 'i-check' : 'i-alert'}"/></svg><div><strong>${ready ? 'Launch profile ready' : health.installed ? 'Repair recommended' : 'Installation required'}</strong><span>${ready ? `NeoForge ${escHtml(status.installedVersion)} is installed and verified for Minecraft ${escHtml(status.gameVersion)}.` : `${issueCount} missing or damaged loader file${issueCount === 1 ? '' : 's'} detected.`}</span></div></div>
      <div class="loader-health-grid"><span><b>${escHtml(status.installedVersion)}</b><small>Installed</small></span><span><b>${health.missingLibraries || 0}</b><small>Missing</small></span><span><b>${health.damagedLibraries || 0}</b><small>Damaged</small></span></div>`;
    const versions = status.versions || [];
    const lockedMessage = status.lockedByPack ? '<p class="loader-version-note">This managed pack controls its NeoForge version. Repair is available, but changing versions requires updating the pack or unlocking it first.</p>' : '';
    actionsHost.innerHTML = `
      ${status.latestVersion && !status.lockedByPack ? `<div class="loader-update-callout"><div><strong>NeoForge ${escHtml(status.latestVersion)} is available</strong><span>Pine will create a restore point before changing the loader.</span></div><button class="btn btn-primary" type="button" data-neoforge-update>Update</button></div>` : ''}
      <div class="loader-version-picker"><label for="inst-neoforge-version">NeoForge version</label><div><select id="inst-neoforge-version" class="input" ${versions.length && !status.lockedByPack ? '' : 'disabled'}>${versions.length ? versions.map(item => `<option value="${escHtml(item.version)}" ${item.version === status.installedVersion ? 'selected' : ''}>${escHtml(item.name)}${item.stable ? '' : ' · preview'}</option>`).join('') : `<option>${escHtml(status.installedVersion)}</option>`}</select><button class="btn btn-secondary" type="button" data-neoforge-change ${versions.length && !status.lockedByPack ? '' : 'disabled'}>Change version</button></div></div>
      ${lockedMessage}
      ${status.versionError ? `<p class="loader-version-note">Could not check the public NeoForge catalog: ${escHtml(status.versionError)}</p>` : ''}
      <div class="loader-action-row"><button class="btn btn-secondary" type="button" data-neoforge-repair>${ready ? 'Reinstall NeoForge' : 'Repair NeoForge'}</button>${status.rollbackVersion && !status.lockedByPack ? `<button class="btn btn-ghost" type="button" data-neoforge-rollback>Roll back to ${escHtml(status.rollbackVersion)}</button>` : '<button class="btn btn-ghost" type="button" data-neoforge-backups>View restore points</button>'}</div>
      <p class="loader-version-note">Worlds, mods, and settings stay untouched. Loader changes and repairs receive an automatic full restore point.</p>`;

    const runChange = async (version, button) => {
      if (!version || version === status.installedVersion) return toast('That NeoForge version is already installed', 'error');
      const confirmed = await backupConfirmation({ title: `Change to NeoForge ${version}?`, message: `Pine verified this release belongs to Minecraft ${status.gameVersion}. A full restore point will be created before the loader profile changes.`, action: 'Change NeoForge' });
      if (!confirmed) return;
      actionsHost.querySelectorAll('button, select').forEach(control => control.disabled = true);
      if (button) button.textContent = 'Installing…';
      try { await api.changeNeoForgeVersion(instance.name, version); toast(`NeoForge updated to ${version}`, 'success', 6000); await refreshNeoForgeInstance(instance.name); }
      catch (error) { toast('NeoForge update failed: ' + (error.message || error), 'error', 8000); loadNeoForgePanel(instance); }
    };
    actionsHost.querySelector('[data-neoforge-update]')?.addEventListener('click', event => runChange(status.latestVersion, event.currentTarget));
    actionsHost.querySelector('[data-neoforge-change]')?.addEventListener('click', event => runChange($('inst-neoforge-version')?.value, event.currentTarget));
    actionsHost.querySelector('[data-neoforge-repair]')?.addEventListener('click', async event => {
      const confirmed = await backupConfirmation({ title: `${ready ? 'Reinstall' : 'Repair'} NeoForge ${status.installedVersion}?`, message: 'Pine will create a full restore point, rebuild this loader profile, verify its downloaded libraries, and keep your worlds, mods, configurations, and settings.', action: ready ? 'Reinstall NeoForge' : 'Repair NeoForge' });
      if (!confirmed) return;
      actionsHost.querySelectorAll('button, select').forEach(control => control.disabled = true);
      event.currentTarget.textContent = 'Repairing…';
      try { await api.repairNeoForge(instance.name); toast(`NeoForge ${status.installedVersion} is ready`, 'success', 6000); await refreshNeoForgeInstance(instance.name); }
      catch (error) { toast('NeoForge repair failed: ' + (error.message || error), 'error', 8000); loadNeoForgePanel(instance); }
    });
    actionsHost.querySelector('[data-neoforge-backups]')?.addEventListener('click', () => openBackupPanel());
    actionsHost.querySelector('[data-neoforge-rollback]')?.addEventListener('click', async event => {
      const confirmed = await backupConfirmation({ title: `Roll back to NeoForge ${status.rollbackVersion}?`, message: 'Pine will first save the current setup, then restore the complete loader state from before the last NeoForge update. Worlds and personal files remain protected by the restore workflow.', action: 'Roll back NeoForge' });
      if (!confirmed) return;
      actionsHost.querySelectorAll('button, select').forEach(control => control.disabled = true);
      event.currentTarget.textContent = 'Rolling back…';
      try { await api.rollbackNeoForge(instance.name); toast(`NeoForge rolled back to ${status.rollbackVersion}`, 'success', 6000); await refreshNeoForgeInstance(instance.name); }
      catch (error) { toast('NeoForge rollback failed: ' + (error.message || error), 'error', 8000); loadNeoForgePanel(instance); }
    });
  } catch (error) {
    statusHost.innerHTML = `<p class="loader-version-note">Could not inspect NeoForge: ${escHtml(error.message || String(error))}</p>`;
    actionsHost.innerHTML = '';
  }
}

function managedPackSourceLabel(source) {
  return source === 'curseforge' ? 'CurseForge' : source === 'modrinth' ? 'Modrinth' : 'Managed pack';
}

async function refreshManagedPackInstance(name) {
  await loadInstances();
  const refreshed = state.instances.find(instance => instance.name === name);
  if (refreshed) state.currentInstance = refreshed;
  loadInstanceSettings();
}

async function loadManagedPackPanel(instance) {
  const panel = $('managed-pack-panel');
  if (!panel || !instance.modpack) return;
  const statusHost = $('managed-pack-status');
  const actionsHost = $('managed-pack-actions');
  try {
    const status = await api.getManagedPackStatus(instance.name);
    if (!status || state.currentInstance?.name !== instance.name || !$('managed-pack-panel')) return;
    const files = status.files || {};
    statusHost.innerHTML = `
      <div class="pack-health-stat"><strong>${files.checked || 0}</strong><span>managed</span></div>
      <div class="pack-health-stat ${files.modified ? 'has-warning' : ''}"><strong>${files.modified || 0}</strong><span>modified</span></div>
      <div class="pack-health-stat ${files.missing ? 'has-warning' : ''}"><strong>${files.missing || 0}</strong><span>missing</span></div>
      <div class="pack-health-stat"><strong>${files.userAdded || 0}</strong><span>your files</span></div>`;
    const versions = status.versions || [];
    const canManageVersions = versions.length > 0 && instance.modpack.lockState !== 'unpaired';
    const versionOptions = versions.map(version => `<option value="${escHtml(version.id)}" ${version.current ? 'selected' : ''}>${escHtml(version.name)}${version.gameVersions?.length ? ` · MC ${escHtml(version.gameVersions.slice(-2).join(', '))}` : ''}</option>`).join('');
    actionsHost.innerHTML = `
      ${status.latest ? `<div class="pack-update-callout"><span><b>Update available</b><small>${escHtml(status.latest.name)}</small></span><button class="btn btn-primary btn-sm" type="button" data-pack-update="${escHtml(status.latest.id)}">Update pack</button></div>` : ''}
      ${status.versionError ? `<p class="pack-version-note">Could not check online versions: ${escHtml(status.versionError)}</p>` : ''}
      ${canManageVersions ? `<div class="pack-version-picker"><label for="inst-pack-version">Pack version</label><div><select id="inst-pack-version" class="input" data-pack-control>${versionOptions}</select><button class="btn btn-secondary" type="button" data-pack-change>Change version</button></div></div>` : `<p class="pack-version-note">${instance.modpack.lockState === 'unpaired' ? 'Pair this instance again to use managed updates and repair.' : 'This locally imported pack has no catalog project link. Repair and file protection remain available.'}</p>`}
      <div class="pack-action-row">
        ${instance.modpack.lockState !== 'unpaired' ? '<button class="btn btn-secondary" type="button" data-pack-repair>Verify & repair</button>' : ''}
        ${canManageVersions ? '<button class="btn btn-ghost" type="button" data-pack-reinstall>Reinstall pack</button>' : ''}
        ${status.history?.length ? `<button class="btn btn-ghost" type="button" data-pack-rollback>Roll back to ${escHtml(status.history[status.history.length - 1].fromName)}</button>` : ''}
      </div>`;

    const changeVersion = async (versionId, { reinstall = false } = {}) => {
      if (!versionId) return;
      const version = versions.find(item => item.id === versionId);
      if (version?.current && !reinstall) return void toast('That version is already installed', 'success');
      const confirmed = await backupConfirmation({
        title: reinstall ? `Reinstall ${version?.name || 'this pack'}?` : `Change to ${version?.name || 'selected version'}?`,
        message: 'Pine will create a restore point, keep worlds and user-added files, then replace only pack-managed files.',
        action: reinstall ? 'Reinstall pack' : 'Change version',
      });
      if (!confirmed) return;
      const buttons = actionsHost.querySelectorAll('button');
      buttons.forEach(button => { button.disabled = true; });
      try {
        await api.changeManagedPackVersion(instance.name, versionId);
        toast(`Pack changed to ${version?.name || 'selected version'}`, 'success', 5000);
        await refreshManagedPackInstance(instance.name);
      } catch (error) {
        buttons.forEach(button => { button.disabled = false; });
        toast('Pack change failed: ' + (error.message || error), 'error', 8000);
      }
    };
    actionsHost.querySelector('[data-pack-update]')?.addEventListener('click', event => changeVersion(event.currentTarget.dataset.packUpdate));
    actionsHost.querySelector('[data-pack-change]')?.addEventListener('click', () => changeVersion($('inst-pack-version')?.value));
    actionsHost.querySelector('[data-pack-reinstall]')?.addEventListener('click', () => changeVersion((versions.find(version => version.current) || versions[0])?.id, { reinstall: true }));
    actionsHost.querySelector('[data-pack-repair]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Verifying…';
      try {
        const result = await api.repairManagedPack(instance.name);
        toast(result.repaired ? `Repaired ${result.repaired} managed file${result.repaired === 1 ? '' : 's'} · your files kept` : 'Every managed file is healthy', 'success', 5000);
        await loadManagedPackPanel(state.currentInstance);
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Verify & repair';
        toast('Pack repair failed: ' + (error.message || error), 'error', 8000);
      }
    });
    actionsHost.querySelector('[data-pack-rollback]')?.addEventListener('click', async () => {
      const previous = status.history[status.history.length - 1];
      const confirmed = await backupConfirmation({
        title: `Roll back to ${previous.fromName}?`,
        message: 'Pine will restore the pre-update pack snapshot. Your current state also gets a safety restore point first.',
        action: 'Roll back',
      });
      if (!confirmed) return;
      try {
        await api.rollbackManagedPack(instance.name);
        toast(`Rolled back to ${previous.fromName}`, 'success', 5000);
        await refreshManagedPackInstance(instance.name);
      } catch (error) { toast('Rollback failed: ' + (error.message || error), 'error', 8000); }
    });
  } catch (error) {
    statusHost.innerHTML = `<p class="pack-version-note">Could not inspect this pack: ${escHtml(error.message || String(error))}</p>`;
    actionsHost.innerHTML = '';
  }
}

function loadInstanceSettings() {
  if (!state.currentInstance) return;
  const inst = state.currentInstance;
  const form = $('instance-settings-form');
  if (!form) return;
  form.innerHTML = `
    ${inst.modpack ? `<div class="settings-card managed-pack-card" id="managed-pack-panel">
      <div class="managed-pack-head"><span class="managed-pack-icon"><svg aria-hidden="true"><use href="#i-library"/></svg></span><div><div class="settings-card-title">${escHtml(inst.modpack.name || 'Managed pack')}</div><p>${managedPackSourceLabel(inst.modpack.source)} · ${escHtml(inst.modpack.versionName || inst.modpack.installedVersion || 'Imported version')}</p></div><span class="pack-state-badge state-${escHtml(inst.modpack.lockState || 'locked')}">${escHtml(inst.modpack.lockState || 'locked')}</span></div>
      <div class="settings-row"><label>Pack relationship</label><select id="inst-pack-state" class="input" data-pack-control><option value="locked" ${inst.modpack.lockState === 'locked' ? 'selected' : ''}>Locked · protect curated files</option><option value="unlocked" ${inst.modpack.lockState === 'unlocked' ? 'selected' : ''}>Unlocked · allow manual changes</option><option value="unpaired" ${inst.modpack.lockState === 'unpaired' ? 'selected' : ''}>Unpaired · ordinary instance</option></select></div>
      <div class="pack-health-grid" id="managed-pack-status"><span class="spinner"></span><small>Inspecting pack ownership…</small></div>
      <div id="managed-pack-actions"></div>
    </div>` : ''}
    ${inst.loader === 'neoforge' ? `<div class="settings-card neoforge-loader-card">
      <div class="neoforge-loader-head"><span class="neoforge-loader-mark">N</span><div><div class="settings-card-title">NeoForge</div><p>Minecraft ${escHtml(inst.gameVersion)} · loader lifecycle</p></div></div>
      <div id="neoforge-status" class="loader-status-host"><span class="spinner"></span><small>Verifying loader profile…</small></div>
      <div id="neoforge-actions"></div>
    </div>` : ''}
    <div class="settings-card">
      <div class="settings-card-title">Memory</div>
      <div class="settings-row"><label>Min memory (GB)</label><input id="inst-min-mem" class="input" type="number" min="1" max="128" step="1" value="${memoryToGigabytes(inst.minMemory, 2)}"></div>
      <div class="settings-row"><label>Max memory (GB)</label><input id="inst-max-mem" class="input" type="number" min="1" max="128" step="1" value="${memoryToGigabytes(inst.maxMemory, 4)}"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Java</div>
      <div class="settings-row"><label>Java path</label><input id="inst-java-path" class="input" value="${escHtml(inst.javaPath || '')}" placeholder="(use system default)"></div>
      <div class="settings-row"><label>JVM args</label><input id="inst-jvm-args" class="input" value="${escHtml(inst.jvmArgs || '')}" placeholder="-XX:+UseG1GC ..."></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">Window</div>
      <div class="settings-row"><label>Width</label><input id="inst-res-w" class="input" type="number" value="${inst.windowWidth || 1280}"></div>
      <div class="settings-row"><label>Height</label><input id="inst-res-h" class="input" type="number" value="${inst.windowHeight || 720}"></div>
    </div>
    <button class="btn btn-primary" id="inst-save-btn">Save settings</button>
  `;
  $('inst-save-btn')?.addEventListener('click', saveInstanceSettings);
  if (inst.modpack) loadManagedPackPanel(inst);
  if (inst.loader === 'neoforge') loadNeoForgePanel(inst);
  $('inst-pack-state')?.addEventListener('change', async event => {
    const previous = inst.modpack.lockState || 'locked';
    if (event.currentTarget.value === 'unpaired') {
      const confirmed = await backupConfirmation({
        title: 'Unpair this modpack?',
        message: 'The instance and all of its files stay intact. Pine will pause managed updates, repair, and file protection until you pair it again.',
        action: 'Unpair pack',
      });
      if (!confirmed) { event.currentTarget.value = previous; return; }
    }
    await saveInstanceSettings(null, { silent: true });
    loadInstanceSettings();
    toast(event.currentTarget.value === 'locked' ? 'Managed files are protected' : event.currentTarget.value === 'unlocked' ? 'Manual pack changes are allowed' : 'Pack management paused', 'success');
  });
  state.instanceSettingsDirty = false;
  form.querySelectorAll('input:not([data-pack-control]), select:not([data-pack-control])').forEach(input => input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
    state.instanceSettingsDirty = true;
    clearTimeout(state.instanceSettingsSaveTimer);
    state.instanceSettingsSaveTimer = setTimeout(() => saveInstanceSettings(null, { silent: true }), 500);
  }));
}

async function saveInstanceSettings(button = null, { silent = false } = {}) {
  if (!state.currentInstance) return;
  clearTimeout(state.instanceSettingsSaveTimer);
  const data = {
    minMemory: `${parseInt($('inst-min-mem')?.value, 10) || 2}G`,
    maxMemory: `${parseInt($('inst-max-mem')?.value, 10) || 4}G`,
    javaPath: $('inst-java-path')?.value,
    jvmArgs: $('inst-jvm-args')?.value,
    windowWidth: parseInt($('inst-res-w')?.value) || 1280,
    windowHeight: parseInt($('inst-res-h')?.value) || 720,
    modpackLockState: $('inst-pack-state')?.value,
  };
  try {
    const updated = await api.updateInstance(state.currentInstance.name, data);
    state.currentInstance = updated;
    const index = state.instances.findIndex(instance => instance.name === updated.name);
    if (index >= 0) state.instances[index] = updated;
    state.instanceSettingsDirty = false;
    setStatus('Settings saved');
    if (!silent) toast(`Memory saved: ${updated.minMemory}–${updated.maxMemory}`, 'success');
    successRing(button || (!silent ? $('inst-save-btn') : null));
  } catch (e) {
    state.instanceSettingsDirty = true;
    setStatus('Save failed: ' + (e.message || e));
    if (!silent) toast('Could not save instance settings: ' + (e.message || e), 'error', 4500);
  }
}

// ── Auth ────────────────────────────────────────────────────
async function refreshAccounts() {
  try {
    const result = await api.listAccounts();
    state.accounts = result?.accounts || [];
    state.selectedAccountKey = result?.selectedKey || null;
  } catch {
    state.accounts = [];
    state.selectedAccountKey = null;
  }
}

async function chooseAccount(key) {
  try {
    state.authData = await api.selectAccount(key);
    await refreshAccounts();
    updateAuthUI();
    updatePride();
    renderHome();
    toast(`Using ${state.authData.profile.name}`, 'success');
    return true;
  } catch (error) {
    toast('Could not switch account: ' + (error.message || error), 'error');
    return false;
  }
}

async function removeAccount(key) {
  const account = state.accounts.find(item => item.key === key);
  if (!account || !confirm(`Delete ${account.profile.name} from Pine Launcher?`)) return;
  try {
    const result = await api.deleteAccount(key);
    state.accounts = result?.accounts || [];
    state.selectedAccountKey = result?.selectedKey || null;
    state.authData = result?.selected || null;
    updateAuthUI();
    updatePride();
    renderHome();
    toast('Account removed', 'success');
  } catch (error) {
    toast('Could not remove account: ' + (error.message || error), 'error');
  }
}

async function reauthenticateAccount(key) {
  const account = state.accounts.find(item => item.key === key && item.meta?.type !== 'offline');
  if (!account) return false;
  try {
    state.authData = await api.microsoftLogin({ mode: 'reauth', accountKey: key });
    await refreshAccounts();
    updateAuthUI();
    updatePride();
    renderHome();
    setStatus(`${account.profile.name} re-authenticated`);
    toast(`${account.profile.name} re-authenticated`, 'success');
    return true;
  } catch (error) {
    setStatus('Re-authentication failed: ' + (error.message || error));
    toast('Could not re-authenticate: ' + (error.message || error), 'error', 6000);
    return false;
  }
}

async function handleAuth(options = { mode: 'add' }) {
  const nameEl = $('account-name');
  if (nameEl) nameEl.textContent = 'Logging in…';
  try {
    state.authData = await api.microsoftLogin(options);
    await refreshAccounts();
    updateAuthUI(); updatePride();
    setStatus(`Signed in as ${state.authData.profile.name}`);
    toast('Signed in', 'success');
    return true;
  } catch (e) {
    if (nameEl) nameEl.textContent = 'Sign in failed';
    setStatus('Login failed: ' + (e.message || e));
    return false;
  }
}

async function signOut() {
  try {
    await api.signOut();
    await refreshAccounts();
    state.authData = await api.getAuth();
    updateAuthUI();
    setStatus('Signed out');
    toast('Signed out', 'success');
  } catch (e) {
    setStatus('Sign out failed: ' + (e.message || e));
  }
}

// ── Offline (username-only) login ─────────────────────────
function openOfflineModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-root visible';
  overlay.style.zIndex = '300';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <div><h2 class="modal-title">Play offline</h2><p class="modal-sub">Choose a username to play without a Microsoft account.</p></div>
        <button class="modal-close" data-close type="button" aria-label="Close"><svg width="20" height="20" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <input id="offline-name-input" class="input" placeholder="Steve" autocomplete="off" maxlength="16" spellcheck="false">
        <div id="offline-name-error" class="modal-error text-muted" hidden></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-cancel type="button">Cancel</button>
        <button class="btn btn-primary" data-ok type="button">Play</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#offline-name-input');
  const err = overlay.querySelector('#offline-name-error');
  const close = () => overlay.remove();
  const submit = async () => {
    const name = input.value.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      err.textContent = 'Use 3-16 characters: letters, numbers, underscores';
      err.hidden = false;
      input.focus();
      return;
    }
    const okBtn = overlay.querySelector('[data-ok]');
    okBtn.disabled = true;
    try {
      state.authData = await api.offlineLogin(name);
      await refreshAccounts();
      updateAuthUI(); updatePride();
      setStatus(`Playing offline as ${name}`);
      toast('Offline account set', 'success');
      close();
    } catch (e) {
      err.textContent = e.message || 'Invalid username';
      err.hidden = false;
      okBtn.disabled = false;
    }
  };
  overlay.querySelector('[data-ok]').addEventListener('click', submit);
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => input.focus(), 50);
}

function openAccountRequiredModal(instanceName) {
  document.getElementById('account-required-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'account-required-modal';
  overlay.className = 'modal-root visible';
  overlay.style.zIndex = '320';
  const alternativeAccounts = state.accounts.filter(account => account.key !== state.selectedAccountKey);
  const alternatives = alternativeAccounts.length ? [
    '<div class="account-required-saved"><label>Other saved accounts</label>',
    ...alternativeAccounts.map(account => `<button class="btn btn-secondary" data-saved-account="${escHtml(account.key)}" type="button">${escHtml(account.profile.name)} · ${account.meta?.type === 'offline' ? 'Offline' : 'Microsoft'}</button>`),
    '</div>',
  ].join('') : '';
  overlay.innerHTML = [
    '<div class="modal" style="max-width:470px">',
    '<div class="modal-header">',
    '<div><h2 class="modal-title">Choose an account first</h2>',
    '<p class="modal-sub">Pine needs a player account before it can launch this instance.</p></div>',
    '<button class="modal-close" data-close type="button" aria-label="Close">X</button>',
    '</div>',
    '<div class="modal-body">',
    alternatives,
    '<label for="required-offline-name">Offline username</label>',
    '<input id="required-offline-name" class="input" placeholder="Enter 3-16 characters" autocomplete="off" maxlength="16" spellcheck="false">',
    '<div id="required-account-error" class="modal-error text-muted" hidden></div>',
    '<div class="text-muted" style="margin-top:10px;font-size:12px">Offline accounts only work on servers that allow offline players. For normal online play, use Microsoft sign-in.</div>',
    '</div>',
    '<div class="modal-footer" style="gap:8px;flex-wrap:wrap">',
    '<button class="btn btn-secondary" data-cancel type="button">Cancel</button>',
    '<button class="btn btn-secondary" data-microsoft type="button">Sign in with Microsoft</button>',
    '<button class="btn btn-primary" data-offline type="button">Use offline name</button>',
    '</div>',
    '</div>',
  ].join('');
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#required-offline-name');
  const error = overlay.querySelector('#required-account-error');
  const microsoftButton = overlay.querySelector('[data-microsoft]');
  const offlineButton = overlay.querySelector('[data-offline]');
  const close = () => overlay.remove();
  const showError = message => {
    error.textContent = message;
    error.hidden = false;
  };
  const continueLaunch = () => {
    close();
    launchInstance(instanceName);
  };
  const useOffline = async () => {
    const offlineName = input.value.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(offlineName)) {
      showError('Use 3-16 characters: letters, numbers, or underscores.');
      input.focus();
      return;
    }
    offlineButton.disabled = true;
    microsoftButton.disabled = true;
    try {
      state.authData = await api.offlineLogin(offlineName);
      await refreshAccounts();
      updateAuthUI();
      updatePride();
      setStatus('Playing offline as ' + offlineName);
      toast('Offline account set', 'success');
      continueLaunch();
    } catch (loginError) {
      showError(loginError.message || 'Could not create the offline account.');
      offlineButton.disabled = false;
      microsoftButton.disabled = false;
    }
  };

  offlineButton.addEventListener('click', useOffline);
  overlay.querySelectorAll('[data-saved-account]').forEach(button => button.addEventListener('click', async () => {
    offlineButton.disabled = true;
    microsoftButton.disabled = true;
    try {
      const selected = await chooseAccount(button.dataset.savedAccount);
      if (selected && state.authData?.profile) return continueLaunch();
      showError('Could not switch to that saved account.');
      offlineButton.disabled = false;
      microsoftButton.disabled = false;
    } catch (accountError) {
      showError(accountError.message || 'Could not switch accounts.');
      offlineButton.disabled = false;
      microsoftButton.disabled = false;
    }
  }));
  microsoftButton.addEventListener('click', async () => {
    offlineButton.disabled = true;
    microsoftButton.disabled = true;
    const signedIn = await handleAuth();
    if (signedIn && state.authData?.profile) return continueLaunch();
    showError('Microsoft sign-in did not finish. Try again or use an offline username.');
    offlineButton.disabled = false;
    microsoftButton.disabled = false;
  });
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') useOffline(); });
  setTimeout(() => input.focus(), 50);
}
function setAvatarImage(el, uuid, name) {
  if (!uuid) { el.textContent = (name || 'G')[0].toUpperCase(); return; }
  const img = document.createElement('img');
  img.alt = (name || 'G')[0].toUpperCase();
  img.onload = function () { el.textContent = ''; el.appendChild(this); };
  img.onerror = function () { el.textContent = (name || 'G')[0].toUpperCase(); };
  img.src = `https://mc-heads.net/avatar/${uuid}/64`;
}

function updateAuthUI() {
  const el = $('account-name');
  const av = $('account-avatar');
  if (!el || !av) return;
  if (state.authData && state.authData.profile) {
    el.textContent = state.authData.profile.name;
    av.classList.remove('avatar-logged-out');
    const uuid = state.authData.profile.uuid;
    const isOffline = state.authData.meta?.type === 'offline';
    if (uuid && !isOffline) {
      setAvatarImage(av, uuid, state.authData.profile.name);
    } else {
      av.textContent = (state.authData.profile.name || 'G')[0].toUpperCase();
    }
  } else {
    el.textContent = 'Sign in';
    av.classList.add('avatar-logged-out');
    av.textContent = 'G';
  }
  const greeting = $('home-greeting');
  if (greeting) {
    greeting.textContent = homeGreetingText();
  }
}

function updatePride() {
  const name = (state.authData?.profile?.name || '').toLowerCase();
  const eligible = new Set(['undrrwrldd', 'se62em', 'shemes', 'exobeast']).has(name);
  const enabled = eligible && state.settings.gayMode !== false;
  document.documentElement.classList.toggle('pride-mode', !!enabled);
  const row = $('gay-mode-row');
  if (row) row.style.display = eligible ? '' : 'none';
  return eligible;
}

// ── Settings ────────────────────────────────────────────────
async function loadSettings() {
  try { state.settings = await api.getSettings() || {}; } catch { state.settings = {}; }
  applyAppearanceSettings();
}

function applyAppearanceSettings() {
  const accent = /^#[0-9a-f]{6}$/i.test(state.settings.accentColor || '') ? state.settings.accentColor : '#ff5cb9';
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.classList.toggle('reduced-motion', state.settings.reducedMotion === true);
  updatePride();
}

function renderSettingsLayout() {
  const layout = $('settings-layout');
  if (!layout) return;
  const s = state.settings;
  layout.innerHTML = `
    <nav class="settings-nav">
      <button class="active" data-cat="general">General</button>
      <button data-cat="java">Java &amp; memory</button>
      <button data-cat="appearance">Appearance</button>
      <button data-cat="discord">Discord</button>
      <button data-cat="updates">Updates</button>
    </nav>
    <div class="settings-form">
      <div class="settings-pane active" data-cat="general">
        <div class="settings-card">
          <div class="settings-card-title">General</div>
          <div class="settings-row"><label>Launch behavior</label>
            <select id="set-launch-behavior" class="input">
              <option ${s.launchBehavior === 'Keep open' ? 'selected' : ''}>Keep open</option>
              <option ${s.launchBehavior === 'Close on launch' ? 'selected' : ''}>Close on launch</option>
            </select>
          </div>
          <div class="settings-row"><label>Download limit (concurrent)</label>
            <input id="set-dl-limit" class="input" type="number" min="2" max="16" step="1" value="${s.dlLimit || 4}">
          </div>
        </div>
      </div>
      <div class="settings-pane" data-cat="java">
        <div class="settings-card">
          <div class="settings-card-title">Java &amp; memory</div>
          <div class="settings-row"><label>Default Java path</label>
            <input id="set-java-path" class="input" value="${escHtml(s.javaPath || '')}" placeholder="(use system default)">
          </div>
          <div class="settings-row"><label>Default min memory (GB)</label>
            <input id="set-min-mem" class="input" type="number" min="1" max="128" step="1" value="${memoryToGigabytes(s.minMemory, 2)}">
          </div>
          <div class="settings-row"><label>Default max memory (GB)</label>
            <input id="set-max-mem" class="input" type="number" min="1" max="128" step="1" value="${memoryToGigabytes(s.maxMemory, 4)}">
          </div>
          <div class="settings-row"><label>Default JVM args</label>
            <input id="set-jvm-args" class="input" value="${escHtml(s.jvmArgs || '')}" placeholder="Optional, e.g. -XX:+UseG1GC">
          </div>
        </div>
        <div class="settings-card">
          <div class="settings-card-title">Default game window</div>
          <div class="settings-row"><label>Width</label>
            <input id="set-window-width" class="input" type="number" min="320" max="7680" value="${s.windowWidth || 1280}">
          </div>
          <div class="settings-row"><label>Height</label>
            <input id="set-window-height" class="input" type="number" min="240" max="4320" value="${s.windowHeight || 720}">
          </div>
        </div>
      </div>
      <div class="settings-pane" data-cat="appearance">
        <div class="settings-card">
          <div class="settings-card-title">Appearance</div>
          <div class="settings-row"><label>Accent color</label>
            <div class="color-swatches">
              ${['#7c5cff', '#5ce0ff', '#ff5cb9', '#4ade80', '#fbbf24', '#f87171'].map((c) =>
                `<button class="color-swatch ${s.accentColor === c ? 'active' : ''}" data-color="${c}" style="background:${c}" aria-label="Accent ${c}"></button>`
              ).join('')}
            </div>
          </div>
          <div class="settings-row" id="gay-mode-row"${updatePride() ? '' : ' style="display:none"'}>
            <label>Gay mode</label>
            <label class="snapshot-inline" style="position:static;padding:0">
              <input type="checkbox" id="gay-mode-toggle" ${s.gayMode !== false && updatePride() ? 'checked' : ''}>
              <span class="check-visual"></span>
            </label>
          </div>
          <div class="settings-row"><label>Reduce animations</label>
            <label class="snapshot-inline" style="position:static;padding:0">
              <input type="checkbox" id="set-reduced-motion" ${s.reducedMotion ? 'checked' : ''}>
              <span class="check-visual"></span>
            </label>
          </div>
        </div>
        <div class="settings-actions">
          <button class="btn btn-ghost" id="set-reset-btn">Reset defaults</button>
        </div>
      </div>
      <div class="settings-pane" data-cat="discord">
        <div class="settings-card">
          <div class="settings-card-title">Discord Rich Presence</div>
          <div class="settings-row"><label>Show Pine on your Discord profile</label>
            <label class="snapshot-inline" style="position:static;padding:0">
              <input type="checkbox" id="set-discord-presence" ${s.discordPresence !== false ? 'checked' : ''}>
              <span class="check-visual"></span>
            </label>
          </div>
          <div class="settings-row"><label>Show instance name</label>
            <label class="snapshot-inline" style="position:static;padding:0">
              <input type="checkbox" id="set-discord-instance" ${s.discordShowInstance !== false ? 'checked' : ''}>
              <span class="check-visual"></span>
            </label>
          </div>
          <div class="settings-row"><label>Show multiplayer server</label>
            <label class="snapshot-inline" style="position:static;padding:0">
              <input type="checkbox" id="set-discord-server" ${s.discordShowServer !== false ? 'checked' : ''}>
              <span class="check-visual"></span>
            </label>
          </div>
          <p class="text-muted" style="margin:12px 0 0;line-height:1.55">Requires the Discord desktop app. When multiplayer sharing is enabled, Pine displays the server address you joined.</p>
        </div>
      </div>
      <div class="settings-pane" data-cat="updates">
        <div class="settings-card update-card">
          <div class="settings-card-title">Launcher updates</div>
          <div class="update-version-row">
            <div><span class="text-muted">Installed</span><strong id="update-current-version">-</strong></div>
            <div id="update-available-wrap" hidden><span class="text-muted">Available</span><strong id="update-available-version">-</strong></div>
          </div>
          <div class="update-status" id="update-status">Checking update status...</div>
          <div class="update-progress" id="update-progress" hidden>
            <div class="progress-bar"><div class="progress-fill" id="update-progress-fill"></div></div>
            <div class="update-progress-meta"><span id="update-progress-size"></span><span id="update-progress-speed"></span></div>
          </div>
          <div class="update-release-notes" id="update-release-notes" hidden></div>
          <div class="update-actions">
            <button class="btn btn-secondary" id="update-check-btn" type="button">Check for updates</button>
            <button class="btn btn-primary" id="update-action-btn" type="button" hidden></button>
          </div>
          <p class="text-muted update-source-note">Updates come from official Pine Launcher GitHub Releases. Pine verifies the release package before installation.</p>
        </div>
      </div>
    </div>
  `;
  layout.querySelectorAll('.settings-nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      layout.querySelectorAll('.settings-nav button').forEach((b) => b.classList.remove('active'));
      layout.querySelectorAll('.settings-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      layout.querySelector(`.settings-pane[data-cat="${btn.dataset.cat}"]`)?.classList.add('active');
      syncSettingsHeaderSave(btn.dataset.cat);
    });
  });
  layout.querySelectorAll('.color-swatch').forEach((s) => {
    s.addEventListener('click', () => {
      const color = s.dataset.color;
      document.documentElement.style.setProperty('--accent', color);
      layout.querySelectorAll('.color-swatch').forEach((sw) => sw.classList.remove('active'));
      s.classList.add('active');
      state.settings.accentColor = color;
    });
  });
  $('update-check-btn')?.addEventListener('click', checkForLauncherUpdates);
  $('update-action-btn')?.addEventListener('click', runUpdateAction);
  renderUpdatePanel();
  const headerSave = $('settings-header-save');
  if (headerSave) headerSave.onclick = (event) => saveAllSettings(event.currentTarget);
  syncSettingsHeaderSave('general');
  $('set-reset-btn')?.addEventListener('click', resetSettings);
  $('set-reduced-motion')?.addEventListener('change', (e) => {
    document.documentElement.classList.toggle('reduced-motion', e.target.checked);
  });
  const gayToggle = $('gay-mode-toggle');
  if (gayToggle) {
    gayToggle.addEventListener('change', () => {
      state.settings.gayMode = gayToggle.checked;
      updatePride();
      saveAllSettings();
    });
  }
  state.settingsDirty = false;
  layout.querySelectorAll('input, select').forEach(control => {
    control.addEventListener('input', () => {
      state.settingsDirty = true;
      clearTimeout(state.settingsSaveTimer);
      state.settingsSaveTimer = setTimeout(() => saveAllSettings(null, { silent: true }), 500);
    });
    control.addEventListener('change', () => {
      state.settingsDirty = true;
      saveAllSettings(null, { silent: true });
    });
  });
}

function syncSettingsHeaderSave(category) {
  const headerSave = $('settings-header-save');
  if (!headerSave) return;
  headerSave.hidden = false;
}

async function saveAllSettings(button = null, { silent = false } = {}) {
  clearTimeout(state.settingsSaveTimer);
  state.settings = {
    ...state.settings,
    javaPath: $('set-java-path')?.value || '',
    minMemory: `${parseInt($('set-min-mem')?.value, 10) || 2}G`,
    maxMemory: `${parseInt($('set-max-mem')?.value, 10) || 4}G`,
    launchBehavior: $('set-launch-behavior')?.value || 'Keep open',
    dlLimit: parseInt($('set-dl-limit')?.value) || 4,
    gayMode: $('gay-mode-toggle')?.checked !== false,
    windowWidth: parseInt($('set-window-width')?.value) || 1280,
    windowHeight: parseInt($('set-window-height')?.value) || 720,
    jvmArgs: $('set-jvm-args')?.value || '',
    reducedMotion: $('set-reduced-motion')?.checked === true,
    discordPresence: $('set-discord-presence')?.checked !== false,
    discordShowInstance: $('set-discord-instance')?.checked !== false,
    discordShowServer: $('set-discord-server')?.checked !== false,
  };
  try {
    state.settings = await api.saveSettings(state.settings);
    state.settingsDirty = false;
    applyAppearanceSettings();
    setStatus('Settings saved');
    if (!silent) toast('Settings saved', 'success');
    successRing(button);
  } catch (e) {
    state.settingsDirty = true;
    setStatus('Save failed: ' + (e.message || e));
    if (!silent) toast('Could not save settings: ' + (e.message || e), 'error', 4500);
  }
}

async function resetSettings() {
  state.settings = {
    launchBehavior: 'Keep open', dlLimit: 4, javaPath: '', minMemory: '2G', maxMemory: '4G',
    jvmArgs: '', windowWidth: 1280, windowHeight: 720, accentColor: '#ff5cb9',
    reducedMotion: false, gayMode: true, discordPresence: true,
    discordShowInstance: true, discordShowServer: true,
  };
  try {
    state.settings = await api.saveSettings(state.settings);
    applyAppearanceSettings();
    renderSettingsLayout();
    setStatus('Settings reset');
    toast('Settings reset to defaults', 'success');
  } catch (e) {
    toast('Could not reset settings: ' + (e.message || e), 'error', 4500);
  }
}

function formatUpdateBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function bindUpdateEvents() {
  api.onUpdateState((value) => applyUpdateState(value, true));
  $('update-pill')?.addEventListener('click', openUpdatesSettings);
}

async function loadUpdateState() {
  try {
    applyUpdateState(await api.getUpdateState(), false);
  } catch (error) {
    applyUpdateState({ status: 'error', message: error.message || 'Could not read update status.' }, false);
  }
}

function applyUpdateState(value, notify = false) {
  if (!value || typeof value !== 'object') return;
  const previous = state.updateState;
  state.updateState = { ...state.updateState, ...value };
  renderUpdatePanel();
  renderUpdatePill();
  if (notify && state.updateState.status === 'available' && state.updateState.availableVersion &&
      state.updateNoticeVersion !== state.updateState.availableVersion) {
    state.updateNoticeVersion = state.updateState.availableVersion;
    toast(`Pine Launcher ${state.updateState.availableVersion} is available`, 'success', 6000);
  }
  if (notify && state.updateState.status === 'downloaded' && previous?.status !== 'downloaded') {
    toast('Update downloaded. Restart Pine when you are ready.', 'success', 7000);
  }
}

function renderUpdatePill() {
  const pill = $('update-pill');
  const label = $('update-pill-text');
  if (!pill || !label) return;
  const update = state.updateState;
  const visible = ['available', 'downloading', 'downloaded', 'installing'].includes(update.status) ||
    (update.status === 'error' && update.availableVersion);
  pill.hidden = !visible;
  pill.classList.toggle('downloaded', update.status === 'downloaded');
  if (!visible) return;
  if (update.status === 'downloading') label.textContent = `Updating ${Math.round(update.percent || 0)}%`;
  else if (update.status === 'downloaded') label.textContent = 'Restart to update';
  else if (update.status === 'installing') label.textContent = 'Installing...';
  else label.textContent = `Update ${update.availableVersion || ''}`.trim();
}

function renderUpdatePanel() {
  const status = $('update-status');
  if (!status) return;
  const update = state.updateState;
  $('update-current-version').textContent = update.currentVersion || 'Development build';
  const availableWrap = $('update-available-wrap');
  availableWrap.hidden = !update.availableVersion;
  $('update-available-version').textContent = update.availableVersion || '-';
  status.textContent = update.message || 'Pine checks GitHub Releases for updates.';
  status.className = `update-status status-${update.status || 'idle'}`;

  const progress = $('update-progress');
  const showProgress = update.status === 'downloading' || update.status === 'downloaded';
  progress.hidden = !showProgress;
  $('update-progress-fill').style.width = `${Math.max(0, Math.min(100, Number(update.percent) || 0))}%`;
  $('update-progress-size').textContent = update.total
    ? `${formatUpdateBytes(update.transferred)} / ${formatUpdateBytes(update.total)}`
    : '';
  $('update-progress-speed').textContent = update.status === 'downloading' && update.bytesPerSecond
    ? `${formatUpdateBytes(update.bytesPerSecond)}/s`
    : '';

  const notes = $('update-release-notes');
  notes.hidden = !update.releaseNotes;
  notes.textContent = update.releaseNotes || '';

  const check = $('update-check-btn');
  check.disabled = ['checking', 'downloading', 'downloaded', 'installing'].includes(update.status) || update.status === 'unsupported';
  check.textContent = update.status === 'checking' ? 'Checking...' : 'Check for updates';

  const action = $('update-action-btn');
  const canDownload = update.status === 'available' || (update.status === 'error' && update.availableVersion);
  const canInstall = update.status === 'downloaded';
  action.hidden = !canDownload && !canInstall && update.status !== 'downloading' && update.status !== 'installing';
  action.disabled = update.status === 'downloading' || update.status === 'installing';
  if (canDownload) action.textContent = update.status === 'error' ? 'Retry download' : 'Download update';
  else if (canInstall) action.textContent = 'Restart and install';
  else if (update.status === 'downloading') action.textContent = `Downloading ${Math.round(update.percent || 0)}%`;
  else if (update.status === 'installing') action.textContent = 'Restarting...';
}

function openUpdatesSettings() {
  switchView('settings');
  requestAnimationFrame(() => document.querySelector('.settings-nav [data-cat="updates"]')?.click());
}

async function checkForLauncherUpdates() {
  try {
    applyUpdateState(await api.checkForUpdates(), false);
  } catch (error) {
    toast('Update check failed: ' + (error.message || error), 'error', 6000);
  }
}

async function runUpdateAction() {
  const update = state.updateState;
  try {
    const next = update.status === 'downloaded'
      ? await api.installUpdate()
      : await api.downloadUpdate();
    applyUpdateState(next, false);
    if (next?.installBlocked) toast(next.message, 'error', 7000);
  } catch (error) {
    toast('Update failed: ' + (error.message || error), 'error', 7000);
  }
}

// ── Modal: create instance ──────────────────────────────────
const PERFORMANCE_MODS = [
  'sodium', 'entityculling', 'ferrite-core', 'krypton', 'modernfix',
  'no-chat-reports', 'memoryleakfix', 'lazydfu', 'ebe', 'immediatelyfast',
  'alternate-current', 'dynamic-fps', 'fastload', 'moreculling', 'fastanim',
  'vmp-fabric', 'reeses-sodium-options', 'skip-transitions',
  'fabric-api', 'cloth-config', 'modmenu',
];

function openDeleteGroupModal(requestedName) {
  if ($('delete-group-overlay')) return;
  const group = state.groups.find(item => item.name.toLowerCase() === String(requestedName || '').toLowerCase());
  if (!group) return;
  const memberCount = state.instances.filter(instance => String(instance.group || '').toLowerCase() === group.name.toLowerCase()).length;
  const overlay = document.createElement('div');
  overlay.id = 'delete-group-overlay';
  overlay.className = 'modal-root visible';
  overlay.innerHTML = `
    <div class="modal confirm-modal delete-group-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-group-title">
      <div class="modal-header">
        <div>
          <h2 class="modal-title" id="delete-group-title">Delete “${escHtml(group.name)}”?</h2>
          <p class="modal-sub">The group will be removed, not its instances.</p>
        </div>
      </div>
      <div class="modal-body">
        <div class="delete-group-assurance">
          <span class="delete-group-assurance-icon"><svg aria-hidden="true"><use href="#i-folder"/></svg></span>
          <div><strong>Your instances stay safe</strong><p>${memberCount ? `${memberCount} instance${memberCount === 1 ? '' : 's'} will move back to the main Library.` : 'This empty group will simply disappear from the Library.'}</p></div>
        </div>
        <div class="modal-error text-muted" data-delete-group-error hidden></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-close-delete-group>Cancel</button>
        <button class="btn btn-danger" type="button" data-confirm-delete-group>Delete group</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const deleteButton = overlay.querySelector('[data-confirm-delete-group]');
  const close = () => {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 180);
  };
  const remove = async () => {
    deleteButton.disabled = true;
    deleteButton.innerHTML = '<span class="spinner"></span> Deleting…';
    try {
      const result = await api.deleteGroup(group.name);
      state.activeLibraryGroup = null;
      await loadGroups();
      await loadInstances();
      close();
      toast(result.ungrouped ? `Group deleted · ${result.ungrouped} instance${result.ungrouped === 1 ? '' : 's'} kept` : 'Group deleted', 'success');
    } catch (failure) {
      const error = overlay.querySelector('[data-delete-group-error]');
      error.textContent = failure.message || String(failure);
      error.hidden = false;
      deleteButton.disabled = false;
      deleteButton.textContent = 'Delete group';
    }
  };
  overlay.querySelector('[data-close-delete-group]').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  deleteButton.addEventListener('click', remove);
  setTimeout(() => overlay.querySelector('[data-close-delete-group]')?.focus(), 50);
}

function openCreateGroupModal() {
  if ($('create-group-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'create-group-overlay';
  overlay.className = 'modal-root visible';
  overlay.innerHTML = `
    <div class="modal create-group-modal" role="dialog" aria-modal="true" aria-labelledby="create-group-title">
      <div class="modal-header">
        <div>
          <h2 class="modal-title" id="create-group-title">Make a group</h2>
          <p class="modal-sub">Give related instances a home in your Library.</p>
        </div>
        <button class="modal-close" type="button" data-close-group aria-label="Close"><svg width="20" height="20"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="create-group-preview" aria-hidden="true">
          <span><svg><use href="#i-folder"/></svg></span>
          <span><svg><use href="#i-folder"/></svg></span>
          <span><svg><use href="#i-folder"/></svg></span>
          <span><svg><use href="#i-plus"/></svg></span>
        </div>
        <div class="form-row">
          <label for="create-group-name">Group name</label>
          <input id="create-group-name" class="input" maxlength="48" placeholder="e.g. Modpacks" autocomplete="off">
        </div>
        <div class="modal-error text-muted" data-group-error hidden></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-close-group>Cancel</button>
        <button class="btn btn-primary" type="button" data-create-group>Create group</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#create-group-name');
  const createButton = overlay.querySelector('[data-create-group]');
  const close = () => {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 180);
  };
  const create = async () => {
    const name = input.value.trim();
    const error = overlay.querySelector('[data-group-error]');
    if (!name) {
      error.textContent = 'Enter a group name.';
      error.hidden = false;
      input.focus();
      return;
    }
    createButton.disabled = true;
    createButton.innerHTML = '<span class="spinner"></span> Creating…';
    try {
      const group = await api.createGroup(name);
      await loadGroups();
      state.activeLibraryGroup = null;
      renderLibrary();
      close();
      toast(`“${group.name}” is ready`, 'success');
    } catch (failure) {
      error.textContent = failure.message || String(failure);
      error.hidden = false;
      createButton.disabled = false;
      createButton.textContent = 'Create group';
    }
  };
  overlay.querySelectorAll('[data-close-group]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') create();
  });
  createButton.addEventListener('click', create);
  setTimeout(() => input.focus(), 50);
}

function openCreateModal() {
  const overlay = $('modal-overlay');
  if (overlay) {
    overlay.removeAttribute('hidden');
    overlay.classList.add('visible');
  }
  $('modal-name').value = '';
  $('modal-loader-version').disabled = true;
  $('modal-loader-version').innerHTML = '<option value="">N/A</option>';
  $('modal-progress').setAttribute('hidden', '');
  $('modal-create-btn').disabled = false;
  $('modal-create-btn').innerHTML = 'Create';
  $('modal-progress-fill').style.width = '0%';
  $('modal-progress-text').textContent = 'Creating instance…';
  state.chosenProfile = 'vanilla';
  state.performanceMods = [];
  state.removedPerfMods = new Set();
  state.selectedLoader = 'vanilla';
  state.pendingIcon = null;
  state.pendingBanner = null;
  state.pendingInstanceRoot = '';
  populateGroupSelect($('modal-group'), state.activeLibraryGroup || '');
  const locationInput = $('modal-instance-location');
  if (locationInput) locationInput.value = '';
  $('modal-location-clear')?.setAttribute('hidden', '');
  state.bannerBlurDir = 'left';
  state.showSnapshots = false;
  const blurWrap = $('blur-dir-wrap');
  if (blurWrap) {
    blurWrap.hidden = true;
    blurWrap.querySelector('[value="left"]').checked = true;
  }
  document.querySelectorAll('.profile-card').forEach((c) => c.classList.remove('selected'));
  document.querySelector('.profile-card[data-profile="vanilla"]')?.classList.add('selected');
  buildLoaderSegmented();
  setCollapsible($('perf-mods-wrap'), false);
  // Reset upload fields
  ['icon', 'banner'].forEach((t) => {
    const input = $(`modal-${t}`);
    const preview = $(`${t}-preview`);
    const placeholder = preview?.previousElementSibling;
    if (input) input.value = '';
    if (preview) { preview.style.backgroundImage = ''; preview.hidden = true; }
    if (placeholder) placeholder.hidden = false;
  });
}

function closeModal() {
  const overlay = $('modal-overlay');
  if (overlay) {
    overlay.classList.remove('visible');
    overlay.setAttribute('hidden', '');
  }
}

// ── Edit Sheet ──────────────────────────────────────────────
function bindEditSheet() {
  $('edit-sheet-close')?.addEventListener('click', closeEditSheet);
  $('edit-sheet-cancel')?.addEventListener('click', closeEditSheet);
  $('edit-sheet-root')?.addEventListener('click', (e) => {
    if (e.target === $('edit-sheet-root')) closeEditSheet();
  });
  $('edit-sheet-save')?.addEventListener('click', saveEditSheet);
  $('edit-sheet-delete')?.addEventListener('click', showDeleteConfirm);
  $('edit-sheet-duplicate')?.addEventListener('click', openDuplicateDialog);
  $('edit-sheet-export')?.addEventListener('click', openExportDialog);
  $('edit-copy-path')?.addEventListener('click', copyInstancePath);
  $('edit-open-folder')?.addEventListener('click', openInstanceFolder);
  $('confirm-cancel')?.addEventListener('click', closeConfirmDialog);
  $('confirm-delete')?.addEventListener('click', deleteInstance);
  $('confirm-dialog-root')?.addEventListener('click', (e) => {
    if (e.target === $('confirm-dialog-root')) closeConfirmDialog();
  });

  // Upload areas
  ['icon', 'banner'].forEach((t) => {
    const area = $(`edit-${t}-upload`);
    const input = $(`edit-${t}`);
    if (!area || !input) return;
    area.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const key = `edit${t.charAt(0).toUpperCase() + t.slice(1)}`;
        state[key] = dataUrl;
        const preview = $(`edit-${t}-preview`);
        const placeholder = preview?.previousElementSibling;
        if (preview) { preview.style.backgroundImage = `url(${dataUrl})`; preview.hidden = false; }
        if (placeholder) placeholder.hidden = true;
        if (t === 'banner') {
          const wrap = $('edit-blur-dir-wrap');
          if (wrap) wrap.hidden = false;
        }
      };
      reader.readAsDataURL(file);
    });
  });

  // Blur direction radios
  $('edit-blur-dir-wrap')?.addEventListener('change', (e) => {
    if (e.target.name === 'edit-blur-dir') state.editBlurDir = e.target.value;
  });
}

function bindDuplicateEvents() {
  api.onDuplicateProgress?.((progress) => {
    const root = $('duplicate-instance-root');
    if (!root || root.dataset.name !== progress.name) return;
    const fill = root.querySelector('[data-progress-fill]');
    const label = root.querySelector('[data-progress-label]');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%`;
    if (label) label.textContent = progress.current
      ? `Copying ${shortFile(progress.current)} · ${progress.percent}%`
      : `Copying instance · ${progress.percent}%`;
  });
}

function suggestedDuplicateName(name) {
  const base = `${name} Copy`;
  if (!state.instances.some(item => item.name.toLowerCase() === base.toLowerCase())) return base;
  let number = 2;
  while (state.instances.some(item => item.name.toLowerCase() === `${base} ${number}`.toLowerCase())) number += 1;
  return `${base} ${number}`;
}

function openDuplicateDialog() {
  const instance = state.currentInstance;
  if (!instance) return;
  closeEditSheet();
  document.getElementById('duplicate-instance-root')?.remove();
  const root = document.createElement('div');
  root.id = 'duplicate-instance-root';
  root.className = 'modal-root duplicate-instance-root visible';
  root.innerHTML = `
    <div class="modal duplicate-instance-modal" role="dialog" aria-modal="true" aria-labelledby="duplicate-instance-title">
      <div class="modal-header">
        <div>
          <h2 id="duplicate-instance-title" class="modal-title">Duplicate instance</h2>
          <p class="modal-sub">Create an independent copy with the same worlds, mods, settings, servers, and custom files.</p>
        </div>
        <button class="modal-close" type="button" data-close aria-label="Close"><svg width="20" height="20"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body modal-form">
        <div class="duplicate-source-card">
          <span class="instance-icon instance-icon-sm">${escHtml(instance.name.slice(0, 1).toUpperCase())}</span>
          <span><b>${escHtml(instance.name)}</b><small>${escHtml(instance.gameVersion || '')} · ${escHtml(instance.loader || 'vanilla')}</small></span>
          <span class="duplicate-complete-badge">Complete copy</span>
        </div>
        <div class="form-row">
          <label for="duplicate-instance-name">New instance name</label>
          <input id="duplicate-instance-name" class="input" maxlength="120" autocomplete="off">
        </div>
        <div class="form-row">
          <label>Save location</label>
          <div class="sheet-folder-row">
            <span data-location-label>${instance.customRoot ? 'Same custom folder as the original' : 'Pine instances folder'}</span>
            <button class="btn btn-ghost btn-sm" type="button" data-browse>Change</button>
          </div>
        </div>
        <div class="form-row">
          <label>What to copy</label>
          <div class="duplicate-component-grid">
            ${[
              ['worlds', 'World saves'], ['mods', 'Mods & configurations'], ['settings', 'Game settings'],
              ['servers', 'Saved servers'], ['screenshots', 'Screenshots'], ['resourcepacks', 'Resource packs'], ['shaderpacks', 'Shader packs'],
            ].map(([key, label]) => `<label class="duplicate-component"><input type="checkbox" data-copy-component="${key}" checked><span class="duplicate-check"><svg><use href="#i-check"/></svg></span><span>${label}</span></label>`).join('')}
          </div>
        </div>
        <p class="duplicate-note">The original is never changed. Pine verifies the copy before it appears in your library.</p>
      </div>
      <div class="modal-progress" data-progress hidden>
        <div class="progress-bar"><div class="progress-fill" data-progress-fill></div></div>
        <span data-progress-label>Preparing copy…</span>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-close data-cancel-copy>Cancel</button>
        <button class="btn btn-primary" type="button" data-duplicate><svg width="15" height="15"><use href="#i-copy"/></svg>Duplicate instance</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const input = root.querySelector('#duplicate-instance-name');
  input.value = suggestedDuplicateName(instance.name);
  input.select();
  let selectedRoot = instance.customRoot || '';
  const operationId = crypto.randomUUID();
  const updateCopyBadge = () => {
    const fields = [...root.querySelectorAll('[data-copy-component]')];
    const badge = root.querySelector('.duplicate-complete-badge');
    if (badge) badge.textContent = fields.every(field => field.checked) ? 'Complete copy' : 'Custom copy';
  };
  root.querySelectorAll('[data-copy-component]').forEach(field => field.addEventListener('change', updateCopyBadge));
  const close = () => root.remove();
  root.addEventListener('click', event => {
    if ((event.target === root || event.target.closest('[data-close]')) && !root.dataset.busy) close();
  });
  root.querySelector('[data-browse]').addEventListener('click', async () => {
    const selected = await api.chooseInstanceLocation();
    if (!selected) return;
    selectedRoot = selected;
    root.querySelector('[data-location-label]').textContent = selected;
  });
  root.querySelector('[data-cancel-copy]').addEventListener('click', async event => {
    if (!root.dataset.busy) return;
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Cancelling…';
    await api.cancelTransfer(operationId).catch(() => false);
  });
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return toast('Enter a name for the copied instance', 'error');
    root.dataset.busy = 'true';
    root.dataset.name = name;
    input.disabled = true;
    root.querySelectorAll('[data-copy-component]').forEach(field => { field.disabled = true; });
    root.querySelector('[data-browse]').disabled = true;
    root.querySelectorAll('[data-close]:not([data-cancel-copy])').forEach(button => { button.disabled = true; });
    root.querySelector('[data-cancel-copy]').textContent = 'Cancel copy';
    const button = root.querySelector('[data-duplicate]');
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>Copying…';
    root.querySelector('[data-progress]').hidden = false;
    try {
      const components = Object.fromEntries([...root.querySelectorAll('[data-copy-component]')].map(field => [field.dataset.copyComponent, field.checked]));
      const copied = await api.duplicateInstance(instance.name, { name, customRoot: selectedRoot, components, operationId });
      await loadInstances();
      await loadRecentDestinations();
      state.currentInstance = state.instances.find(item => item.id === copied.id) || copied;
      root.querySelector('[data-progress-fill]').style.width = '100%';
      root.querySelector('[data-progress-label]').textContent = 'Copy verified and ready';
      toast(`${name} is ready`, 'success');
      setTimeout(() => { close(); selectInstance(name); }, 350);
    } catch (error) {
      delete root.dataset.busy;
      input.disabled = false;
      root.querySelectorAll('[data-copy-component]').forEach(field => { field.disabled = false; });
      root.querySelector('[data-browse]').disabled = false;
      root.querySelectorAll('[data-close]').forEach(closeButton => { closeButton.disabled = false; });
      root.querySelector('[data-cancel-copy]').textContent = 'Cancel';
      button.disabled = false;
      button.innerHTML = '<svg width="15" height="15"><use href="#i-copy"/></svg>Duplicate instance';
      root.querySelector('[data-progress]').hidden = true;
      const message = error.message || String(error);
      toast(message.includes('Transfer cancelled') ? 'Copy cancelled · no partial instance was kept' : 'Could not duplicate instance: ' + message, message.includes('Transfer cancelled') ? 'info' : 'error', 7000);
    }
  };
  root.querySelector('[data-duplicate]').addEventListener('click', submit);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') submit(); });
}

function openExportDialog() {
  const instance = state.currentInstance;
  if (!instance) return;
  closeEditSheet();
  const root = document.createElement('div');
  root.className = 'modal-root visible';
  root.innerHTML = `<div class="modal duplicate-instance-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div><h2 class="modal-title">Export ${escHtml(instance.name)}</h2><p class="modal-sub">Choose what the archive should carry with it.</p></div><button class="modal-close" data-close type="button"><svg width="20" height="20"><use href="#i-x"/></svg></button></div>
    <div class="modal-body export-choice-grid">
      <button class="export-choice selected" data-export-mode="complete" type="button"><span class="export-choice-icon"><svg width="20" height="20"><use href="#i-library"/></svg></span><span><b>Complete instance</b><small>Worlds, servers, screenshots, mods, settings, and every custom file.</small></span><span class="choice-check"><svg width="14" height="14"><use href="#i-check"/></svg></span></button>
      <button class="export-choice" data-export-mode="shareable" type="button"><span class="export-choice-icon"><svg width="20" height="20"><use href="#i-user"/></svg></span><span><b>Shareable pack</b><small>Mods and configuration without personal worlds, servers, screenshots, or logs.</small></span><span class="choice-check"><svg width="14" height="14"><use href="#i-check"/></svg></span></button>
      <button class="export-choice" data-export-mode="mrpack" type="button"><span class="export-choice-icon"><svg width="20" height="20"><use href="#i-download"/></svg></span><span><b>Modrinth .mrpack</b><small>Provider download references and safe overrides in the standard Modrinth format.</small></span><span class="choice-check"><svg width="14" height="14"><use href="#i-check"/></svg></span></button>
      <button class="export-choice" data-export-mode="manifest" type="button"><span class="export-choice-icon"><svg width="20" height="20"><use href="#i-info"/></svg></span><span><b>Lightweight Pine manifest</b><small>A small JSON recipe with verified downloads and hashes, without bundling personal files.</small></span><span class="choice-check"><svg width="14" height="14"><use href="#i-check"/></svg></span></button>
      <p class="duplicate-note">Account tokens are never stored inside an instance and are never exported.</p>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" data-close type="button">Cancel</button><button class="btn btn-primary" data-export type="button"><svg width="15" height="15"><use href="#i-download"/></svg>Export archive</button></div>
  </div>`;
  document.body.appendChild(root);
  let mode = 'complete';
  root.querySelectorAll('[data-export-mode]').forEach(choice => choice.addEventListener('click', () => {
    mode = choice.dataset.exportMode;
    root.querySelectorAll('[data-export-mode]').forEach(item => item.classList.toggle('selected', item === choice));
  }));
  const close = () => root.remove();
  root.addEventListener('click', event => { if ((event.target === root || event.target.closest('[data-close]')) && !root.dataset.busy) close(); });
  root.querySelector('[data-export]').addEventListener('click', async event => {
    root.dataset.busy = 'true';
    const button = event.currentTarget;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>Building archive…';
    try {
      const exported = await api.exportInstance(instance.name, { mode });
      if (exported) {
        const label = mode === 'complete' ? 'Instance' : mode === 'shareable' ? 'Shareable pack' : mode === 'mrpack' ? 'Modrinth pack' : 'Pine manifest';
        const omitted = Number(exported.omitted?.length) || 0;
        toast(`${label} exported${omitted ? ` · ${omitted} unreferenced file${omitted === 1 ? '' : 's'} listed in the report` : ''}`, omitted ? 'info' : 'success', 7000);
      }
      close();
    } catch (error) {
      delete root.dataset.busy;
      button.disabled = false;
      button.textContent = 'Export archive';
      toast('Export failed: ' + (error.message || error), 'error', 7000);
    }
  });
}

async function openPineImport() {
  let selected;
  try { selected = await api.chooseInstanceImport(); }
  catch (error) { return toast('Could not inspect archive: ' + (error.message || error), 'error', 7000); }
  if (!selected) return;
  const isModrinth = selected.kind === 'modrinth';
  const isManifest = selected.kind === 'pine-manifest';
  const dependencies = selected.manifest.dependencies || {};
  const detectedLoader = dependencies['fabric-loader'] ? 'fabric' : dependencies['quilt-loader'] ? 'quilt' : dependencies.neoforge ? 'neoforge' : dependencies.forge ? 'forge' : 'vanilla';
  const source = isModrinth ? { name: selected.manifest.name || 'Modrinth Pack', gameVersion: dependencies.minecraft || '', loader: detectedLoader } : (selected.manifest.instance || {});
  const root = document.createElement('div');
  root.className = 'modal-root visible';
  root.innerHTML = `<div class="modal duplicate-instance-modal import-hub-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div><h2 class="modal-title">Import ${isModrinth ? 'Modrinth pack' : isManifest ? 'Pine manifest' : 'Pine instance'}</h2><p class="modal-sub">The ${isManifest ? 'download recipe' : 'archive'} passed Pine’s format check.</p></div><button class="modal-close" data-close type="button"><svg width="20" height="20"><use href="#i-x"/></svg></button></div>
    <div class="modal-body modal-form">
      <div class="duplicate-source-card"><span class="instance-icon instance-icon-sm">${escHtml(String(source.name || 'P').slice(0, 1).toUpperCase())}</span><span><b>${escHtml(source.name || 'Pine instance')}</b><small>${escHtml(source.gameVersion || '')} · ${escHtml(source.loader || 'vanilla')}</small></span><span class="duplicate-complete-badge">${isModrinth ? '.mrpack' : isManifest ? 'Verified recipe' : selected.manifest.mode === 'shareable' ? 'Shareable pack' : 'Complete archive'}</span></div>
      <div class="form-row"><label for="pine-import-name">Instance name</label><input id="pine-import-name" class="input" maxlength="120" autocomplete="off"></div>
      <div class="form-row"><label>Save location</label><div class="sheet-folder-row"><span data-location-label>Pine instances folder</span><button class="btn btn-ghost btn-sm" data-browse type="button">Change</button></div></div>
      <p class="duplicate-note">Pine ${isManifest ? 'downloads each referenced file into' : 'extracts into'} a temporary folder, verifies the result, and only then adds it to your library.</p>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" data-close type="button">Cancel</button><button class="btn btn-primary" data-import type="button"><svg width="15" height="15"><use href="#i-download"/></svg>Import instance</button></div>
  </div>`;
  document.body.appendChild(root);
  const input = root.querySelector('#pine-import-name');
  input.value = suggestedDuplicateName(source.name || 'Imported Instance').replace(/ Copy$/, '');
  if (state.instances.some(item => item.name.toLowerCase() === input.value.toLowerCase())) input.value = suggestedDuplicateName(source.name || 'Imported Instance');
  input.select();
  let selectedRoot = '';
  const close = () => root.remove();
  root.addEventListener('click', event => { if ((event.target === root || event.target.closest('[data-close]')) && !root.dataset.busy) close(); });
  root.querySelector('[data-browse]').addEventListener('click', async () => {
    const folder = await api.chooseInstanceLocation();
    if (!folder) return;
    selectedRoot = folder;
    root.querySelector('[data-location-label]').textContent = folder;
  });
  root.querySelector('[data-import]').addEventListener('click', async event => {
    const name = input.value.trim();
    if (!name) return toast('Enter an instance name', 'error');
    root.dataset.busy = 'true';
    root.querySelectorAll('button,input').forEach(element => { element.disabled = true; });
    event.currentTarget.innerHTML = '<span class="spinner"></span>Validating and importing…';
    try {
      const imported = isModrinth
        ? await api.importModrinthArchive({ file: selected.file, name, customRoot: selectedRoot })
        : isManifest
          ? await api.importPineManifest({ file: selected.file, name, customRoot: selectedRoot })
          : await api.importPineArchive({ file: selected.file, name, customRoot: selectedRoot });
      await loadInstances();
      close();
      toast(`${imported.name} imported`, 'success');
      selectInstance(imported.name);
    } catch (error) {
      delete root.dataset.busy;
      root.querySelectorAll('button,input').forEach(element => { element.disabled = false; });
      event.currentTarget.textContent = 'Import instance';
      toast('Import failed: ' + (error.message || error), 'error', 7000);
    }
  });
}

function openImportHub() {
  const root = document.createElement('div');
  root.className = 'modal-root visible';
  root.innerHTML = `<div class="modal duplicate-instance-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div><h2 class="modal-title">Bring Minecraft data into Pine</h2><p class="modal-sub">Your source stays untouched and account sessions are never imported.</p></div><button class="modal-close" data-close type="button"><svg width="20" height="20"><use href="#i-x"/></svg></button></div>
    <div class="modal-body export-choice-grid import-hub-body">
      <button class="export-choice" data-import-kind="archive" type="button"><span class="export-choice-icon"><svg width="20" height="20"><use href="#i-download"/></svg></span><span><b>Import an archive</b><small>Pine instance ZIP or Modrinth .mrpack.</small></span><svg class="export-choice-chevron" width="16" height="16"><use href="#i-chevron-right"/></svg></button>
      <button class="export-choice" data-import-kind="folder" type="button"><span class="export-choice-icon"><svg width="20" height="20"><use href="#i-folder"/></svg></span><span><b>Choose an existing instance folder</b><small>Works with standard Minecraft folders, popular launchers and clients, portable setups, and backups.</small></span><svg class="export-choice-chevron" width="16" height="16"><use href="#i-chevron-right"/></svg></button>
      <button class="export-choice" data-import-kind="scan" type="button"><span class="export-choice-icon"><svg width="20" height="20"><use href="#i-search"/></svg></span><span><b>Find installed launchers</b><small>Check only the standard launcher folders you approve.</small></span><svg class="export-choice-chevron" width="16" height="16"><use href="#i-chevron-right"/></svg></button>
      <p class="duplicate-note">Pine reads only the folder you choose. Nothing is uploaded, moved, or removed from the original launcher.</p>
    </div>
  </div>`;
  document.body.appendChild(root);
  const close = () => root.remove();
  root.addEventListener('click', event => { if (event.target === root || event.target.closest('[data-close]')) close(); });
  root.querySelector('[data-import-kind="archive"]').addEventListener('click', () => { close(); openPineImport(); });
  root.querySelector('[data-import-kind="folder"]').addEventListener('click', () => { close(); openFolderImport(); });
  root.querySelector('[data-import-kind="scan"]').addEventListener('click', () => { close(); openLauncherScanConsent(); });
}

async function openFolderImport(preselected = null) {
  let source = preselected;
  try { if (!source) source = await api.chooseExistingInstanceFolder(); }
  catch (error) { return toast('Could not inspect folder: ' + (error.message || error), 'error', 7000); }
  if (!source) return;
  const counts = source.counts || {};
  const transfer = source.transfer || {};
  const transferCategories = Object.entries(transfer.categories || {}).filter(([, category]) => category.files > 0);
  const root = document.createElement('div');
  root.className = 'modal-root visible';
  root.innerHTML = `<div class="modal duplicate-instance-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div><h2 class="modal-title">Found Minecraft data</h2><p class="modal-sub">${escHtml(source.source)} · local read-only inspection</p></div><button class="modal-close" data-close type="button"><svg width="20" height="20"><use href="#i-x"/></svg></button></div>
    <div class="modal-body modal-form">
      <div class="import-preview-stats"><span><b>${counts.worlds || 0}</b> worlds</span><span><b>${counts.servers || 0}</b> servers</span><span><b>${counts.mods || 0}</b> mods</span><span><b>${counts.screenshots || 0}</b> screenshots</span></div>
      ${transferCategories.length ? `<div class="form-row"><label>What to import</label><div class="import-category-grid">${transferCategories.map(([key, category]) => `<label class="import-category"><input type="checkbox" data-import-category="${escHtml(key)}" ${category.selected ? 'checked' : ''}><span class="duplicate-check"><svg><use href="#i-check"/></svg></span><span><b>${escHtml(category.label)}</b><small>${category.files} file${category.files === 1 ? '' : 's'} · ${formatBytes(category.bytes)}</small></span></label>`).join('')}</div></div>` : ''}
      <div class="import-plan-summary"><span><b>${Number(transfer.totalFiles || 0).toLocaleString()}</b> selected files</span><span><b>${formatBytes(Number(transfer.requiredBytes) || 0)}</b> required space</span>${transfer.rejectedCount ? `<span><b>${transfer.rejectedCount}</b> private or unsafe item${transfer.rejectedCount === 1 ? '' : 's'} skipped</span>` : ''}</div>
      ${(transfer.warnings || []).length ? `<div class="import-plan-warnings">${transfer.warnings.map(warning => `<span><svg><use href="#i-alert-triangle"/></svg>${escHtml(warning.message || warning)}</span>`).join('')}</div>` : ''}
      <div class="form-row"><label for="folder-import-name">Instance name</label><input id="folder-import-name" class="input" maxlength="120" autocomplete="off"></div>
      <div class="form-grid-2"><div class="form-row"><label for="folder-import-version">Minecraft version</label><select id="folder-import-version" class="input"></select></div><div class="form-row"><label for="folder-import-loader">Loader</label><select id="folder-import-loader" class="input"><option value="vanilla">Vanilla</option><option value="fabric">Fabric</option><option value="quilt">Quilt</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option></select></div></div>
      <div class="form-row" data-loader-version-row><label for="folder-import-loader-version">Loader version</label><select id="folder-import-loader-version" class="input"></select></div>
      <label class="import-world-warning" data-world-warning hidden><input type="checkbox" data-confirm-worlds><span><b>Newer world version detected</b><small>Opening a world in an older Minecraft version can permanently damage it. I understand and want to import it.</small></span></label>
      <p class="duplicate-note">Microsoft tokens, launcher accounts, cookies, passwords, and login sessions are excluded. Pine copies files and leaves this folder usable.</p>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" data-close type="button">Cancel</button><button class="btn btn-primary" data-import type="button">Import folder</button></div>
  </div>`;
  document.body.appendChild(root);
  const nameInput = root.querySelector('#folder-import-name');
  nameInput.value = source.name || 'Imported Instance';
  if (state.instances.some(item => item.name.toLowerCase() === nameInput.value.toLowerCase())) nameInput.value = suggestedDuplicateName(nameInput.value);
  const versionSelect = root.querySelector('#folder-import-version');
  versionSelect.innerHTML = state.allVersions.map(version => `<option value="${escHtml(version.id)}">${escHtml(version.id)}</option>`).join('');
  if (source.gameVersion && !state.allVersions.some(version => version.id === source.gameVersion)) versionSelect.insertAdjacentHTML('afterbegin', `<option value="${escHtml(source.gameVersion)}">${escHtml(source.gameVersion)}</option>`);
  versionSelect.value = source.gameVersion || state.allVersions[0]?.id || '';
  const loaderSelect = root.querySelector('#folder-import-loader');
  loaderSelect.value = source.loader || 'vanilla';
  const loaderVersionSelect = root.querySelector('#folder-import-loader-version');
  const updateWorldWarning = () => {
    const parts = value => String(value || '').split(/[^0-9]+/).filter(Boolean).map(Number);
    const compare = (left, right) => { const a = parts(left); const b = parts(right); for (let i = 0; i < Math.max(a.length, b.length); i += 1) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); } return 0; };
    const newer = (source.worlds || []).filter(world => world.version && compare(world.version, versionSelect.value) > 0);
    const warning = root.querySelector('[data-world-warning]');
    warning.hidden = !newer.length;
    if (!newer.length) root.querySelector('[data-confirm-worlds]').checked = false;
  };
  const loadDetectedLoaderVersions = async () => {
    const loader = loaderSelect.value;
    root.querySelector('[data-loader-version-row]').hidden = loader === 'vanilla';
    if (loader === 'vanilla') { loaderVersionSelect.innerHTML = '<option value="">Not required</option>'; return; }
    loaderVersionSelect.disabled = true;
    loaderVersionSelect.innerHTML = '<option>Checking compatible versions…</option>';
    try {
      const versions = await api.getLoaderVersions(versionSelect.value, loader);
      loaderVersionSelect.innerHTML = versions.map(item => `<option value="${escHtml(item.version)}">${escHtml(item.name || item.version)}</option>`).join('');
      if (source.loader === loader && source.loaderVersion && !versions.some(item => item.version === source.loaderVersion)) loaderVersionSelect.insertAdjacentHTML('afterbegin', `<option value="${escHtml(source.loaderVersion)}">${escHtml(source.loaderVersion)} · detected</option>`);
      if (source.loader === loader && source.loaderVersion) loaderVersionSelect.value = source.loaderVersion;
    } catch (error) { loaderVersionSelect.innerHTML = `<option value="${escHtml(source.loaderVersion || '')}">${escHtml(source.loaderVersion || 'Could not load versions')}</option>`; }
    loaderVersionSelect.disabled = false;
  };
  loaderSelect.addEventListener('change', loadDetectedLoaderVersions);
  versionSelect.addEventListener('change', () => { updateWorldWarning(); loadDetectedLoaderVersions(); });
  updateWorldWarning();
  await loadDetectedLoaderVersions();
  const close = () => root.remove();
  root.addEventListener('click', event => { if ((event.target === root || event.target.closest('[data-close]')) && !root.dataset.busy) close(); });
  root.querySelector('[data-import]').addEventListener('click', async event => {
    root.dataset.busy = 'true';
    root.querySelectorAll('button,input,select').forEach(element => { element.disabled = true; });
    event.currentTarget.innerHTML = '<span class="spinner"></span>Copying and validating…';
    try {
      const selection = Object.fromEntries([...root.querySelectorAll('[data-import-category]')].map(input => [input.dataset.importCategory, input.checked]));
      const imported = await api.importExistingInstanceFolder({ folder: source.folder, name: nameInput.value, gameVersion: versionSelect.value, loader: loaderSelect.value, loaderVersion: loaderVersionSelect.value, confirmNewerWorlds: root.querySelector('[data-confirm-worlds]').checked, selection });
      await loadInstances(); close(); toast(`${imported.name} imported`, 'success'); selectInstance(imported.name);
    } catch (error) {
      delete root.dataset.busy;
      root.querySelectorAll('button,input,select').forEach(element => { element.disabled = false; });
      event.currentTarget.textContent = 'Import folder';
      toast('Import failed: ' + (error.message || error), 'error', 7000);
    }
  });
}

async function openLauncherScanConsent() {
  let launchers;
  try { launchers = await api.getKnownLauncherFolders(); }
  catch (error) { return toast('Could not list launcher folders: ' + (error.message || error), 'error'); }
  const root = document.createElement('div');
  root.className = 'modal-root visible';
  root.innerHTML = `<div class="modal duplicate-instance-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div><h2 class="modal-title">Permission to check launcher folders</h2><p class="modal-sub">Pine will only read the standard folders selected below.</p></div><button class="modal-close" data-close type="button"><svg width="20" height="20"><use href="#i-x"/></svg></button></div>
    <div class="modal-body modal-form">
      <div class="scan-privacy"><svg width="20" height="20"><use href="#i-info"/></svg><span>The check is local and read-only. Pine will not search your computer, access browser data, import account sessions, or upload anything.</span></div>
      <div class="launcher-folder-list">${launchers.map(item => `<label class="launcher-folder-option ${item.available ? '' : 'unavailable'}"><input type="checkbox" value="${escHtml(item.key)}" ${item.available ? 'checked' : ''}><span><b>${escHtml(item.label)}</b><small>${item.available ? 'Standard folder found' : 'Standard folder not found'}</small></span></label>`).join('')}</div>
      <details class="scan-folder-details"><summary>Show folders being checked</summary>${launchers.map(item => `<div><b>${escHtml(item.label)}</b>${item.folders.map(folder => `<code>${escHtml(folder)}</code>`).join('')}</div>`).join('')}</details>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" data-close type="button">Cancel</button><button class="btn btn-primary" data-scan type="button">Check selected folders</button></div>
  </div>`;
  document.body.appendChild(root);
  const close = () => root.remove();
  root.addEventListener('click', event => { if ((event.target === root || event.target.closest('[data-close]')) && !root.dataset.busy) close(); });
  root.querySelector('[data-scan]').addEventListener('click', async event => {
    const keys = [...root.querySelectorAll('.launcher-folder-option input:checked')].map(input => input.value);
    if (!keys.length) return toast('Select at least one launcher folder', 'error');
    root.dataset.busy = 'true';
    event.currentTarget.disabled = true;
    event.currentTarget.innerHTML = '<span class="spinner"></span>Checking selected folders…';
    try {
      const found = await api.scanKnownLauncherFolders(keys);
      close();
      showFoundLauncherInstances(found);
    } catch (error) {
      delete root.dataset.busy;
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = 'Check selected folders';
      toast('Folder check failed: ' + (error.message || error), 'error', 7000);
    }
  });
}

function showFoundLauncherInstances(found) {
  const root = document.createElement('div');
  root.className = 'modal-root visible';
  root.innerHTML = `<div class="modal backup-modal" role="dialog" aria-modal="true">
    <div class="modal-header"><div><h2 class="modal-title">${found.length ? `Found ${found.length} Minecraft instance${found.length === 1 ? '' : 's'}` : 'No instances found'}</h2><p class="modal-sub">Choose an instance to preview and import.</p></div><button class="modal-close" data-close type="button"><svg width="20" height="20"><use href="#i-x"/></svg></button></div>
    <div class="modal-body found-instance-list">${found.length ? found.map((item, index) => `<button class="found-instance" data-found-index="${index}" type="button"><span class="instance-icon instance-icon-sm">${escHtml(String(item.name || 'M').slice(0, 1).toUpperCase())}</span><span><b>${escHtml(item.name)}</b><small>${escHtml(item.launcher || item.source)} · ${escHtml(item.gameVersion || 'version not detected')} · ${item.counts?.worlds || 0} worlds · ${item.counts?.mods || 0} mods</small></span><svg width="16" height="16"><use href="#i-chevron-right"/></svg></button>`).join('') : '<div class="empty-state"><div class="empty-state-title">Nothing was found in the selected standard folders</div><div class="empty-state-sub">You can still choose an instance folder manually.</div></div>'}</div>
    <div class="modal-footer"><button class="btn btn-secondary" data-close type="button">Done</button>${found.length ? '' : '<button class="btn btn-primary" data-manual type="button">Choose folder manually</button>'}</div>
  </div>`;
  document.body.appendChild(root);
  const close = () => root.remove();
  root.addEventListener('click', event => { if (event.target === root || event.target.closest('[data-close]')) close(); });
  root.querySelectorAll('[data-found-index]').forEach(button => button.addEventListener('click', () => { const selected = found[Number(button.dataset.foundIndex)]; close(); openFolderImport(selected); }));
  root.querySelector('[data-manual]')?.addEventListener('click', () => { close(); openFolderImport(); });
}

function getDefaultInstancesDir() {
  const p = window.location.pathname;
  const idx = p.lastIndexOf('/renderer/');
  if (idx > 0) return decodeURIComponent(p.slice(0, idx)) + '/instances';
  return '';
}

async function resolveInstancePath(inst) {
  if (inst.path) return inst.path;
  try {
    const dir = await api.getInstancesDir();
    if (dir) return dir + '/' + inst.name;
  } catch {}
  const localDir = getDefaultInstancesDir();
  if (localDir) return localDir + '/' + inst.name;
  return '[path unavailable]';
}

async function openEditSheet() {
  const inst = state.currentInstance;
  if (!inst) return;
  const root = $('edit-sheet-root');
  if (!root) return;

  state.editIcon = null;
  state.editBanner = null;
  state.editBlurDir = inst.bannerBlurDir || 'left';

  // Pre-fill name
  $('edit-name').value = inst.name || '';
  $('edit-name').dataset.original = inst.name || '';
  populateGroupSelect($('edit-group'), inst.group || '');
  $('edit-tags').value = Array.isArray(inst.tags) ? inst.tags.join(', ') : '';

  // Show sheet immediately (path loads async below)
  root.removeAttribute('hidden');
  requestAnimationFrame(() => root.classList.add('visible'));
  $('edit-folder-path').textContent = 'Loading...';

  // Folder path (async fallback to computed path)
  const pathStr = await resolveInstancePath(inst);
  $('edit-folder-path').textContent = pathStr;

  // Reset upload previews
  ['icon', 'banner'].forEach((t) => {
    const preview = $(`edit-${t}-preview`);
    const placeholder = preview?.previousElementSibling;
    if (preview) { preview.hidden = true; preview.style.backgroundImage = ''; }
    if (placeholder) placeholder.hidden = false;
    const input = $(`edit-${t}`);
    if (input) input.value = '';
  });
  const blurWrap = $('edit-blur-dir-wrap');
  if (blurWrap) {
    const checked = blurWrap.querySelector(`[value="${state.editBlurDir}"]`);
    if (checked) checked.checked = true;
    blurWrap.hidden = !inst.bannerData;
  }

}

function showDeleteConfirm() {
  const inst = state.currentInstance;
  if (!inst) return;
  const root = $('confirm-dialog-root');
  const nameEl = $('confirm-instance-name');
  const deleteButton = $('confirm-delete');
  if (nameEl) nameEl.textContent = inst.name || '';
  if (deleteButton) { deleteButton.disabled = false; deleteButton.textContent = 'Delete'; }
  if (!root) return;
  root.removeAttribute('hidden');
  requestAnimationFrame(() => root.classList.add('visible'));
}

function closeConfirmDialog() {
  const root = $('confirm-dialog-root');
  if (!root) return;
  root.classList.remove('visible');
  root.setAttribute('hidden', '');
  const deleteButton = $('confirm-delete');
  if (deleteButton) { deleteButton.disabled = false; deleteButton.textContent = 'Delete'; }
}

async function deleteInstance() {
  const inst = state.currentInstance;
  if (!inst) return;
  const btn = $('confirm-delete');
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    await api.deleteInstance(inst.name);
    closeConfirmDialog();
    closeEditSheet();
    state.currentInstance = null;
    await loadInstances();
    await loadRecentDestinations();
    switchView('library');
    setStatus('Instance deleted');
  } catch (e) {
    setStatus('Delete failed: ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
  }
}

function closeEditSheet() {
  const root = $('edit-sheet-root');
  if (!root) return;
  root.classList.remove('visible');
  root.setAttribute('hidden', '');
}

async function openInstanceFolder() {
  const instance = state.currentInstance;
  if (!instance) return;
  try {
    await api.openInstanceFolder(instance.name);
    setStatus('Opened instance folder');
    successRing($('edit-open-folder'));
  } catch (error) {
    const message = error.message || String(error);
    setStatus('Could not open instance folder: ' + message);
    toast('Could not open folder: ' + message, 'error', 6000);
  }
}

async function copyInstancePath() {
  const path = $('edit-folder-path')?.textContent;
  if (!path) return;
  try {
    await api.copyText(path);
    setStatus('Path copied');
    successRing($('edit-copy-path'));
    toast('Instance path copied', 'success');
  } catch (error) {
    const message = error.message || String(error);
    setStatus('Could not copy path: ' + message);
    toast('Could not copy path: ' + message, 'error', 6000);
  }
}

async function saveEditSheet() {
  const inst = state.currentInstance;
  if (!inst) return;

  const name = $('edit-name').value.trim();
  if (!name) return setStatus('Please enter an instance name');

  const updateData = {};
  if (name !== inst.name) updateData.name = name;
  if (state.editIcon !== null) updateData.iconData = state.editIcon;
  if (state.editBanner !== null) updateData.bannerData = state.editBanner;
  updateData.bannerBlurDir = state.editBlurDir;
  updateData.group = $('edit-group')?.value || '';
  updateData.tags = ($('edit-tags')?.value || '').split(',').map(tag => tag.trim()).filter(Boolean);

  try {
    const updated = await api.updateInstance(inst.name, updateData);
    state.currentInstance = updated;
    await loadInstances();
    openInstanceView();
    closeEditSheet();
    setStatus('Instance updated');
  } catch (e) {
    setStatus('Update failed: ' + (e.message || e));
  }
}

function buildLoaderSegmented() {
  const seg = $('loader-segmented');
  if (!seg) return;
  const loaders = [
    { id: 'vanilla', label: 'Vanilla' },
    { id: 'fabric', label: 'Fabric' },
    { id: 'quilt', label: 'Quilt' },
    { id: 'forge', label: 'Forge' },
    { id: 'neoforge', label: 'NeoForge' },
  ];
  seg.innerHTML = loaders.map((l) => `<button type="button" data-loader="${l.id}" class="${l.id === state.selectedLoader ? 'active' : ''}">${l.label}</button>`).join('');

  // Create moving indicator
  let indicator = seg.querySelector('.segmented-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'segmented-indicator';
    seg.appendChild(indicator);
  }

  const moveIndicator = (btn, instant = false) => {
    if (instant) indicator.style.transition = 'none';
    const sbox = seg.getBoundingClientRect();
    const bbox = btn.getBoundingClientRect();
    indicator.style.width = bbox.width + 'px';
    indicator.style.transform = `translateX(${bbox.left - sbox.left}px)`;
    if (instant) {
      void indicator.offsetWidth;
      indicator.style.transition = '';
    }
  };

  const active = seg.querySelector('button.active');
  if (active) moveIndicator(active, true);

  seg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      state.selectedLoader = b.dataset.loader;
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      moveIndicator(b, false);
      loadLoaderVersions();
    });
  });
  if (state.selectedLoader === 'vanilla') {
    const versionSelect = $('modal-loader-version');
    if (versionSelect) delete versionSelect.dataset.loadState;
  }
}

function bindModal() {
  $('modal-close-btn')?.addEventListener('click', closeModal);
  $('modal-cancel-btn')?.addEventListener('click', closeModal);
  $('modal-overlay')?.addEventListener('click', (e) => { if (e.target === $('modal-overlay')) closeModal(); });
  $('modal-create-btn')?.addEventListener('click', createInstance);
  $('modal-location-browse')?.addEventListener('click', async () => {
    try {
      const selected = await api.chooseInstanceLocation();
      if (!selected) return;
      state.pendingInstanceRoot = selected;
      const input = $('modal-instance-location');
      if (input) input.value = selected;
      $('modal-location-clear')?.removeAttribute('hidden');
    } catch (error) {
      showModalError('Could not use that folder: ' + (error.message || error));
    }
  });
  $('modal-location-clear')?.addEventListener('click', () => {
    state.pendingInstanceRoot = '';
    const input = $('modal-instance-location');
    if (input) input.value = '';
    $('modal-location-clear')?.setAttribute('hidden', '');
  });
  document.querySelectorAll('.profile-card').forEach((c) => {
    c.addEventListener('click', () => selectProfile(c.dataset.profile));
  });
  $('modal-version')?.addEventListener('change', () => {
    loadLoaderVersions();
    updatePerfModsList();
  });
  $('modal-loader-version')?.addEventListener('pointerdown', () => {
    if ($('modal-loader-version')?.dataset.loadState === 'failed') {
      loadLoaderVersions();
    }
  });
  $('perf-mods-list')?.addEventListener('click', (e) => {
    const row = e.target.closest('.perf-mod-row');
    if (!row) return;
    const modId = row.dataset.mod;
    if (e.target.closest('.trash-icon')) {
      state.removedPerfMods.add(modId);
      row.classList.add('removed');
    } else if (e.target.closest('.restore-icon')) {
      state.removedPerfMods.delete(modId);
      row.classList.remove('removed');
    }
  });

  // Wire up blur direction radios
  $('blur-dir-wrap')?.addEventListener('change', (e) => {
    if (e.target.name === 'blur-dir') state.bannerBlurDir = e.target.value;
  });

  // Wire up image/banner upload areas
  ['icon', 'banner'].forEach((t) => {
    const area = $(`${t}-upload`);
    const input = $(`modal-${t}`);
    if (!area || !input) return;
    area.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const key = `pending${t.charAt(0).toUpperCase() + t.slice(1)}`;
        state[key] = dataUrl;
        const preview = $(`${t}-preview`);
        const placeholder = preview?.previousElementSibling;
        if (preview) { preview.style.backgroundImage = `url(${dataUrl})`; preview.hidden = false; }
        if (placeholder) placeholder.hidden = true;
        // Show blur direction picker when banner is selected
        if (t === 'banner') {
          const wrap = $('blur-dir-wrap');
          if (wrap) wrap.hidden = false;
        }
      };
      reader.readAsDataURL(file);
    });
  });

  // Snapshot toggle
  $('show-snapshots')?.addEventListener('change', (e) => {
    state.showSnapshots = e.target.checked;
    const filtered = filterVersions();
    populateVersionSelect($('modal-version'), filtered);
    loadLoaderVersions();
    updatePerfModsList();
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}

function setCollapsible(el, show) {
  if (!el) return;
  el.classList.toggle('visible', show);
}

function selectProfile(profile) {
  state.chosenProfile = profile;
  document.querySelectorAll('.profile-card').forEach((c) => c.classList.toggle('selected', c.dataset.profile === profile));
  pulseOnce(document.querySelector(`.profile-card[data-profile="${profile}"]`));
  const wrap = $('perf-mods-wrap');
  if (profile === 'vanilla') {
    state.selectedLoader = 'vanilla';
    buildLoaderSegmented();
    setSegmentedLocked(true);
    setCollapsible(wrap, false);
  } else if (profile === 'performance') {
    state.selectedLoader = 'fabric';
    buildLoaderSegmented();
    setSegmentedLocked(true);
    updatePerfModsList();
    setCollapsible(wrap, true);
  } else {
    setSegmentedLocked(false);
    setCollapsible(wrap, false);
  }
  loadLoaderVersions();
}

function setSegmentedLocked(locked) {
  const seg = $('loader-segmented');
  if (!seg) return;
  seg.querySelectorAll('button').forEach((b) => {
    b.style.pointerEvents = locked ? 'none' : '';
    b.style.opacity = locked ? '0.6' : '';
  });
}

function updatePerfModsList() {
  const version = $('modal-version').value;
  let modIds = [...PERFORMANCE_MODS];
  if (version) {
    const parts = version.split('.');
    const major = parseInt(parts[0]), minor = parseInt(parts[1]);
    if (major === 1 && minor < 20) modIds.push('phosphor', 'starlight');
    if (major === 1 && minor >= 21) {
      modIds = modIds.filter(id => !['lazydfu', 'fastload', 'modernfix', 'memoryleakfix', 'ebe', 'skip-transitions', 'fastanim'].includes(id));
      modIds.push('sodium-extra');
    }
  }
  state.performanceMods = modIds;
  const container = $('perf-mods-list');
  if (container) {
    container.innerHTML = modIds.map((id) => {
      const removed = state.removedPerfMods?.has(id) ?? false;
      return `<div class="perf-mod-row${removed ? ' removed' : ''}" data-mod="${escHtml(id)}">
        <span class="mod-name">${escHtml(id)}</span>
        <span class="mod-action">
          <svg class="trash-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path class="trash-body" d="M19 7v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7"/>
            <g class="trash-lid">
              <path d="M3 7h18"/>
              <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </g>
          </svg>
          <svg class="restore-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 10h13a4 4 0 0 1 0 8H7"/>
            <path d="M7 6l-4 4 4 4"/>
          </svg>
        </span>
      </div>`;
    }).join('');
  }
}

async function findCompatibleVersion(projectId, loaders, gameVersion) {
  const versions = await api.getProjectVersions(projectId, loaders, [gameVersion]);
  if (versions && versions.length) return versions;
  return [];
}

async function createInstance() {
  const name = $('modal-name').value.trim();
  const version = $('modal-version').value;
  const loaderVer = $('modal-loader-version').value;
  if (!name) return showModalError('Please enter an instance name');
  if (!version) return showModalError('Please select a game version');
  if (state.selectedLoader !== 'vanilla' && !loaderVer) return showModalError('Please select a loader version');

  const btn = $('modal-create-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating…';
  $('modal-progress').removeAttribute('hidden');
  $('modal-progress-fill').style.width = '0%';

  let createdThisAttempt = false;
  try {
    await api.createInstance({ name, gameVersion: version, profile: state.chosenProfile || 'custom', loader: state.selectedLoader, loaderVersion: loaderVer || null, iconData: state.pendingIcon || null, bannerData: state.pendingBanner || null, bannerBlurDir: state.bannerBlurDir || 'left', customRoot: state.pendingInstanceRoot || '', group: $('modal-group')?.value || '' });
    createdThisAttempt = true;
    setProgress($('modal-progress-fill'), $('modal-progress-text'), 40, 'Instance created');

    if (state.chosenProfile === 'performance' && state.performanceMods.length) {
      const perfLoaders = state.selectedLoader === 'vanilla' ? ['fabric'] : [state.selectedLoader];
      const selectedMods = state.performanceMods.filter((id) => !state.removedPerfMods.has(id));
      if (!selectedMods.length) { setProgress($('modal-progress-fill'), $('modal-progress-text'), 95, 'Skipping — no mods selected'); }
      const versionIds = [];
      const versionSizes = {};
      const disableFiles = new Set();
      for (let i = 0; i < selectedMods.length; i++) {
        const modId = selectedMods[i];
        const pVersions = await findCompatibleVersion(modId, perfLoaders, version);
        if (!pVersions?.length) throw new Error(`${modId} has no compatible ${version} ${perfLoaders.join('/')} release`);
        const v = pVersions.find((pv) => pv.loaders?.some(l => perfLoaders.includes(l)));
        if (!v) throw new Error(`${modId} has no compatible loader release`);
        const check = await api.checkInstallFeasibility(name, modId, v.id, perfLoaders, version);
        if (!check?.feasible) throw new Error(check?.errors?.[0]?.message || `${modId} cannot be installed`);
        versionIds.push(v.id, ...(check.requiredDepVersionIds || []));
        versionSizes[v.id] = check.file?.size || 0;
        Object.assign(versionSizes, check.requiredDepSizes || {});
        for (const warning of check.warnings || []) if (warning.existingFile) disableFiles.add(warning.existingFile);
        const pct = 40 + ((i + 1) / selectedMods.length) * 55;
        setProgress($('modal-progress-fill'), $('modal-progress-text'), pct, `Checking ${modId} (${i + 1}/${selectedMods.length})`);
      }
      if (versionIds.length) await api.installMod(name, { versionIds: [...new Set(versionIds)], versionSizes, disableFiles: [...disableFiles] });
      burstConfetti();
    }

    setProgress($('modal-progress-fill'), $('modal-progress-text'), 100, 'Ready!');
    setTimeout(async () => {
      closeModal();
      await loadInstances();
      setStatus(`Instance "${name}" created`);
      successRing(btn);
      toast('Instance created', 'success');
    }, 400);
  } catch (e) {
    if (createdThisAttempt) {
      try { await api.deleteInstance(name); } catch {}
    }
    showModalError(e.message || e);
    btn.disabled = false;
    btn.innerHTML = 'Create';
    $('modal-progress').setAttribute('hidden', '');
  }
}

function setProgress(fillEl, textEl, pct, text) {
  if (fillEl) fillEl.style.width = pct + '%';
  if (textEl) textEl.textContent = text;
}

let modalErrorTimeout = null;
function showModalError(msg) {
  const existing = document.querySelector('.modal-error');
  if (existing) existing.remove();
  if (modalErrorTimeout) clearTimeout(modalErrorTimeout);
  const div = document.createElement('div');
  div.className = 'modal-error text-muted';
  div.style.cssText = 'padding:10px 12px;background:var(--danger-dim);color:var(--danger);border-radius:var(--r-sm);margin-bottom:12px;font-size:13px';
  div.textContent = msg;
  $('modal-body').insertBefore(div, $('modal-body').firstChild);
  modalErrorTimeout = setTimeout(() => div.remove(), 5000);
}

// ── Logs ────────────────────────────────────────────────────
function appendLog(line) {
  if (typeof line !== 'string') line = String(line);
  state.logLines.push(line);
  if (state.logLines.length > 800) state.logLines.shift();
  const viewer = $('logs-viewer');
  if (!viewer) return;
  viewer.textContent = state.logLines.join('\n');
  viewer.scrollTop = viewer.scrollHeight;
  const status = $('log-status');
  if (status) status.textContent = state.logLines.length + ' lines';
}

function clearLogs({ showBanner = true } = {}) {
  state.logLines = [];
  const viewer = $('logs-viewer');
  if (viewer) viewer.textContent = showBanner ? TERMINAL_BANNER : '';
  const status = $('log-status');
  if (status) status.textContent = '';
}

async function copyLog() {
  const viewer = $('logs-viewer');
  if (!viewer) return;
  try {
    await api.copyText(viewer.textContent);
    setStatus('Log copied');
    successRing($('copy-log-btn'));
  } catch (error) {
    setStatus('Could not copy log: ' + (error.message || error));
  }
}

// ── Launch flow ─────────────────────────────────────────────
function launchErrorMessage(error) {
  return error?.message || String(error || 'Unknown launch error');
}

function isAccountRequiredError(error) {
  return /sign in with microsoft|offline account|choose an account|microsoft session expired|session .*revoked/i.test(launchErrorMessage(error));
}

function bindLaunchEvents() {
  api.onJavaInstallProgress?.((update) => {
    const label = update?.label || 'Preparing Java';
    setStatus(label);
    if (update?.error) {
      toast(label, 'error', 7000);
    } else if (update?.complete) {
      toast(label, 'success');
    }
  });
  api.onLaunchProgress((p) => {
    if (typeof p === 'number') {
      const pct = Math.round(Math.min(100, p * 100));
      setDockedProgress(pct, pct + '%');
    }
  });
  api.onLaunchData((d) => {
    appendLog(d);
    $('dp-stop-game')?.removeAttribute('hidden');
    setStatus(typeof d === 'string' ? d.split('\n')[0].slice(0, 80) : '');
  });
  api.onLaunchError((e) => {
    const instanceName = state.launchingName;
    const message = launchErrorMessage(e);
    setStatus('Launch failed: ' + message);
    setDockedProgressVisible(false);
    $('dp-stop-game')?.setAttribute('hidden', '');
    if (state.currentInstance) $('instance-play-btn')?.removeAttribute('disabled');
    state.launchingName = null;
    renderAllInstanceCards();
    if (isAccountRequiredError(e) && instanceName) {
      state.authData = null;
      updateAuthUI();
      openAccountRequiredModal(instanceName);
    } else {
      toast('Launch failed: ' + message, 'error', 8000);
      setTimeout(() => explainCrash(instanceName, { automatic: true }), 180);
    }
  });
  api.onLaunchClose(() => {
    clearLogs();
    setStatus('Minecraft closed');
    setDockedProgressVisible(false);
    $('dp-stop-game')?.setAttribute('hidden', '');
    setPlayingPill(null);
    if (state.currentInstance) $('instance-play-btn')?.removeAttribute('disabled');
    state.launchingName = null;
    renderAllInstanceCards();
    loadRecentDestinations();
  });
  api.onLaunchLog((line) => appendLog(line));
  api.onLaunchMetrics((m) => updateDockedMetrics(m));
  api.onLaunchWarning((message) => {
    appendLog('[WARNING] ' + message);
    setStatus(message);
    toast(message, 'error', 10000);
    loadInstances().catch(() => undefined);
  });  api.onLaunchFixed((count) => {
    const banner = $('dp-fix');
    if (!banner) return;
    banner.textContent = `Found and fixed ${count} corrupted file${count > 1 ? 's' : ''}`;
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 5000);
  });
}

async function stopFrozenGame() {
  let status;
  try { status = await api.getGameStatus(); }
  catch (error) { return toast('Could not check Minecraft: ' + (error.message || error), 'error'); }
  if (!status?.processStarted) return toast('Minecraft is not running', 'error');
  const confirmed = await backupConfirmation({
    title: 'Stop Minecraft now?',
    message: 'Use this only when Minecraft is frozen. Forcing it closed can lose unsaved progress in the current world, but does not delete the world itself.',
    action: 'Force stop',
    danger: true,
  });
  if (!confirmed) return;
  const button = $('dp-stop-game');
  if (button) button.disabled = true;
  try { await api.terminateGame(status.instanceName, true); toast('Minecraft was stopped', 'success'); }
  catch (error) { toast('Could not stop Minecraft: ' + (error.message || error), 'error', 7000); }
  finally { if (button) button.disabled = false; }
}

async function launchInstance(name, destination = null) {
  if (state.launchingName) return;
  if (!state.authData?.profile) {
    openAccountRequiredModal(name);
    return;
  }
  if (destination?.type === 'singleplayer' && !destination.confirmNewerWorld) {
    try {
      const risk = await api.getWorldLaunchRisk(name, destination.identifier);
      if (risk.risk) {
        const confirmed = await backupConfirmation({
          title: `Open ${risk.name} in an older version?`,
          message: `This world was last played in Minecraft ${risk.worldVersion}, but ${name} uses ${risk.instanceVersion}. Minecraft may permanently remove newer blocks, items, or world data. Pine will create a worlds restore point before continuing.`,
          action: 'Open anyway', danger: true,
        });
        if (!confirmed) return;
        destination = { ...destination, confirmNewerWorld: true };
      }
    } catch (error) { return toast('Could not verify world safety: ' + (error.message || error), 'error', 7000); }
  }
  clearLogs({ showBanner: false });
  state.launchingName = name;
  setStatus(`Launching ${name}…`);
  renderAllInstanceCards();
  setDockedProgressVisible(true);
  setDockedInstanceName(name);
  setDockedStage('Preparing', 'authenticating');
  setDockedMetrics({ stage: 'authenticating' });
  setPlayingPill(name);
  // Event handlers cover failures after a launcher client exists. Rejections
  // before that point (auth refresh, missing account, registry errors) must
  // also reset the UI.
  const launchPromise = destination ? api.launchDestination(name, destination) : api.launchInstance(name);
  launchPromise.catch((e) => {
    if (state.launchingName !== name) return;
    const message = launchErrorMessage(e);
    state.launchingName = null;
    setPlayingPill(null);
    setDockedProgressVisible(false);
    $('instance-play-btn')?.removeAttribute('disabled');
    renderAllInstanceCards();
    setStatus('Launch failed: ' + message);
    if (isAccountRequiredError(e)) {
      state.authData = null;
      updateAuthUI();
      openAccountRequiredModal(name);
    } else {
      toast('Launch failed: ' + message, 'error', 8000);
    }
  });
}

function renderAllInstanceCards() {
  renderHome();
  renderLibrary();
  if (state.currentView === 'instance' && state.currentInstance) openInstanceView();
}

// ── Docked progress UI ──────────────────────────────────────
function setDockedProgressVisible(visible) {
  const el = $('docked-progress');
  if (!el) return;
  if (visible) {
    el.removeAttribute('hidden');
    void el.offsetWidth;
    el.classList.add('visible');
  } else {
    el.classList.remove('visible');
    setTimeout(() => {
      if (!el.classList.contains('visible')) el.setAttribute('hidden', '');
    }, 600);
  }
}

function setDockedInstanceName(name) {
  const el = $('dp-instance-name');
  if (el) el.textContent = name;
}

function setDockedStage(text, stage) {
  const el = $('dp-stage');
  if (!el) return;
  el.textContent = text;
}

const PROGRESS_COLORS = [
  { stop: 0,   r: 255, g: 255, b: 255, a: 0.65 },
  { stop: 25,  r: 94,  g: 92,  b: 230, a: 1 },
  { stop: 50,  r: 100, g: 210, b: 255, a: 1 },
  { stop: 75,  r: 48,  g: 209, b: 88,  a: 1 },
  { stop: 100, r: 255, g: 255, b: 255, a: 1 },
];
function progressColor(pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  for (let i = 0; i < PROGRESS_COLORS.length - 1; i++) {
    const a = PROGRESS_COLORS[i], b = PROGRESS_COLORS[i + 1];
    if (clamped >= a.stop && clamped <= b.stop) {
      const t = (clamped - a.stop) / (b.stop - a.stop);
      return `rgba(${Math.round(a.r + (b.r - a.r) * t)},${Math.round(a.g + (b.g - a.g) * t)},${Math.round(a.b + (b.b - a.b) * t)},${a.a + (b.a - a.a) * t})`;
    }
  }
  return 'rgba(255,255,255,0.65)';
}

function setDockedProgress(pct, label) {
  const fill = $('dp-fill');
  const bar = $('dp-bar');
  const pctEl = $('dp-pct');
  const stage = $('dp-stage');
  if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (bar && pct < 0) bar.classList.add('indeterminate');
  else if (bar) bar.classList.remove('indeterminate');
  if (pctEl) pctEl.textContent = label || Math.round(pct) + '%';
  if (stage && pct >= 0) stage.style.color = progressColor(pct);
}

function setDockedMetrics(m) {
  const speed = $('dp-speed');
  const eta = $('dp-eta');
  if (speed) speed.textContent = m.bytesPerSec > 0 ? formatBytes(m.bytesPerSec) + '/s' : '—';
  if (eta) eta.textContent = m.etaSec != null ? formatDuration(m.etaSec) : '—';
}

function updateDockedMetrics(m) {
  if (!m) return;
  setDockedInstanceName($('dp-instance-name')?.textContent || state.launchingName || 'Launching');
  const label = stageLabel(m.stage);
  setDockedStage(m.currentFile ? `${label} · ${shortFile(m.currentFile)}` : label, m.stage);
  if (m.progress != null && m.progress > 0) {
    setDockedProgress(m.progress, Math.round(m.progress) + '%');
  } else if (['authenticating', 'libraries', 'assets', 'natives', 'building'].includes(m.stage)) {
    setDockedProgress(-1, '');
  }
  if (m.stage === 'launching') { setDockedProgress(100, '100%'); setPlayingPill(state.launchingName); setStatus(''); }
  if (m.stage === 'done' && state.launchingName) {
    setDockedProgress(100, '100%');
    setStatus('');
    setDockedProgressVisible(false);
    state.launchingName = null;
    $('instance-play-btn')?.removeAttribute('disabled');
    renderAllInstanceCards();
  }
  if (m.stage === 'closed') { setDockedStage('Minecraft closed', 'closed'); setPlayingPill(null); }
  if (m.stage === 'error') { setDockedStage('Launch failed', 'error'); setPlayingPill(null); }
  setDockedMetrics(m);
}

function setPlayingPill(name) {
  const pill = $('playing-pill');
  if (!pill) return;
  if (name) {
    pill.removeAttribute('hidden');
    $('playing-pill-name').textContent = `Playing ${name}`;
  } else {
    pill.setAttribute('hidden', '');
  }
}

// ── Confetti (success reward) ──────────────────────────────
function burstConfetti() {
  const colors = ['#7c5cff', '#5ce0ff', '#ff5cb9', '#4ade80', '#fbbf24'];
  for (let i = 0; i < 28; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const x = (Math.random() - 0.5) * 360;
    const y = -(120 + Math.random() * 200);
    piece.style.background = colors[i % colors.length];
    piece.style.left = '50%';
    piece.style.top = '50%';
    piece.style.setProperty('--cx', x + 'px');
    piece.style.setProperty('--cy', y + 'px');
    piece.style.setProperty('--cr', (Math.random() * 720 - 360) + 'deg');
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1100);
  }
}

// ── Discover / Modrinth ─────────────────────────────────────
async function searchMods(append = false) {
  if (append && state.searchLoading) return;
  if (!append) state.searchOffset = 0;
  const query = $('search-input')?.value.trim() || '';
  const loader = $('filter-loader')?.value || '';
  const version = $('filter-version')?.value || '';
  const category = $('filter-category')?.value.trim() || '';
  const sort = $('results-sort')?.value || 'relevance';
  const facets = [['project_type:' + (state.discoverCategory || 'mod')]];
  if (loader) facets.push(['categories:' + loader]);
  if (version) facets.push(['versions:' + version]);
  if (category) facets.push(['categories:' + category]);
  const searchKey = JSON.stringify({ query, loader, version, category, sort, type: state.discoverCategory });
  const requestId = ++state.searchRequestId;
  state.activeSearchKey = searchKey;
  state.searchLoading = true;

  const grid = $('results-grid');
  const count = $('results-count');
  const loadMoreBtn = $('load-more-btn');
  if (!grid) return;

  if (!append) {
    count.textContent = 'Searching…';
    grid.innerHTML = `<div class="skeleton skeleton-block"></div>`.repeat(6);
    state.searchStartTime = performance.now();
    if (loadMoreBtn) loadMoreBtn.setAttribute('hidden', '');
  }

  try {
    const response = await api.searchMods(query, facets, state.searchOffset, SEARCH_LIMIT, sort);
    if (requestId !== state.searchRequestId || searchKey !== state.activeSearchKey) return;
    const hits = (response.hits || []).map(hit => ({ ...hit, source: 'modrinth' }));
    state.searchOffset += SEARCH_LIMIT;
    const total = response.total_hits || response.hits?.length || 0;
    const took = Math.round(performance.now() - state.searchStartTime);

    if (!hits.length && !append) {
      count.textContent = 'No results';
      const label = ({ mod: 'mods', resourcepack: 'resource packs', modpack: 'mod packs', datapack: 'data packs', shader: 'shaders' })[state.discoverCategory] || 'mods';
      grid.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><svg width="24" height="24" aria-hidden="true"><use href="#i-search"/></svg></div>
        <div class="empty-state-title">No ${label} found</div>
        <div class="empty-state-sub">Try adjusting your search or filters.</div>
      </div>`;
      return;
    }
    count.textContent = `${fmtNum(total)} results · ${took} ms`;

    const html = hits.map((mod) => `
      <div class="mod-card" data-pid="${escHtml(mod.project_id || '')}">
        <div class="mod-card-icon">
          ${mod.icon_url ? `<img src="${escHtml(mod.icon_url)}" alt="" loading="lazy">` : escHtml((mod.title || '?')[0].toUpperCase())}
        </div>
        <div class="mod-card-body">
          <div class="mod-card-title">${escHtml(mod.title || mod.name)}</div>
          <div class="mod-card-author">by ${escHtml(mod.author || 'unknown')} · Modrinth</div>
          <div class="mod-card-desc">${escHtml(mod.description || '')}</div>
          <div class="mod-card-footer">
            <span class="mod-card-dls">${fmtNum(mod.downloads)} downloads</span>
            <button class="btn btn-primary btn-sm" data-act="install">Install</button>
          </div>
        </div>
      </div>
    `).join('');
    if (append) {
      grid.insertAdjacentHTML('beforeend', html);
      const cards = [...grid.querySelectorAll('.mod-card')];
      cards.slice(0, Math.max(0, cards.length - DISCOVER_DOM_LIMIT)).forEach(card => card.remove());
    }
    else {
      const cards = grid.querySelectorAll('.mod-card');
      if (cards.length) {
        cards.forEach((c) => c.classList.add('leaving'));
        await new Promise((r) => setTimeout(r, 300));
        if (requestId !== state.searchRequestId) return;
      }
      grid.innerHTML = html;
    }
    staggerInto(grid.querySelectorAll('.mod-card'));
    grid.querySelectorAll('.mod-card:not([data-bound])').forEach((card) => {
      card.setAttribute('data-bound', '');
      const pid = card.dataset.pid;
      card.addEventListener('click', () => showModDetails(pid));
      card.querySelector('[data-act="install"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        installModFromSearch(pid);
      });
    });
    if (state.searchOffset < total && hits.length >= SEARCH_LIMIT) loadMoreBtn?.removeAttribute('hidden');
    else loadMoreBtn?.setAttribute('hidden', '');
    state.searchLoading = false;
  } catch (e) {
    if (requestId !== state.searchRequestId) return;
    count.textContent = 'Error';
    grid.innerHTML = `<div class="text-muted" style="text-align:center;padding:24px">Search failed: ${escHtml(e.message || e)}</div>`;
  } finally {
    if (requestId === state.searchRequestId) state.searchLoading = false;
  }
}

async function installModFromSearch(projectId) {
  if (state.discoverCategory === 'modpack') {
    try {
      const project = await api.getProject(projectId);
      openModrinthPackInstall(project);
    } catch (error) { toast('Could not load modpack: ' + (error.message || error), 'error', 6000); }
    return;
  }
  if (state.discoverCategory === 'datapack') {
    const target = state.pendingDatapackWorld;
    if (!target) {
      toast('Open an instance world and choose “Add data pack” first.', 'error', 6500);
      return;
    }
    try {
      const installed = await api.installModrinthDatapack(target.instanceName, target.identifier, projectId);
      state.pendingDatapackWorld = null;
      toast(`${installed.title || installed.filename} installed into ${target.worldName} · restore point created`, 'success', 6000);
      const instance = state.instances.find(item => item.name === target.instanceName);
      if (instance) { state.currentInstance = instance; openInstanceView(); switchInstanceTab('worlds'); }
    } catch (error) { toast('Could not install data pack: ' + (error.message || error), 'error', 7000); }
    return;
  }
  if (!state.instances.length) {
    setStatus('Create an instance first, then select the mod again');
    toast('Create an instance first, then return to Discover and select the mod you want to install.', 'error', 6500);
    showInstallNeedsInstanceWarning();
    return;
  }
  if (state.instances.length === 1) {
    doInstallMod(state.instances[0], projectId);
    return;
  }
  // Check which instances already have this mod
  const instHasMod = {};
  await Promise.all(state.instances.map(async (i) => {
    try {
      const mods = await api.getInstanceMods(i.name);
      instHasMod[i.name] = mods.some(m => m.projectId === projectId);
    } catch { instHasMod[i.name] = false; }
  }));

  // Modal-style picker
  const sorted = sortByRecency(state.instances);
  const overlay = document.createElement('div');
  overlay.className = 'modal-root visible';
  overlay.style.zIndex = '300';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <div><h2 class="modal-title">Install into…</h2><p class="modal-sub">Pick an instance to install this mod</p></div>
        <button class="modal-close" data-close><svg width="20" height="20" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body" style="padding:0 0 var(--s-2);display:flex;flex-direction:column">
        ${sorted.map((i) => {
          const has = instHasMod[i.name];
          return `<button class="pick-instance${has ? ' has-mod' : ''}" data-name="${escHtml(i.name)}"${has ? ' disabled' : ''}>
          <span class="pick-instance-icon">${(i.name || 'G')[0].toUpperCase()}</span>
          <span class="pick-instance-body">
            <span class="pick-instance-name">${escHtml(i.name)}${has ? ' <svg width="14" height="14" class="installed-warn" aria-label="Already installed"><use href="#i-alert-triangle"/></svg>' : ''}</span>
            <span class="pick-instance-desc">${escHtml(i.loader)} ${escHtml(i.gameVersion)}${has ? ' · Already installed' : ''}</span>
          </span>
        </button>`;
        }).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
    const card = e.target.closest('.pick-instance:not([disabled])');
    if (card) {
      const inst = state.instances.find((i) => i.name === card.dataset.name);
      overlay.remove();
      if (inst) doInstallMod(inst, projectId);
    }
  });
}

function showInstallNeedsInstanceWarning() {
  if ($('install-needs-instance')) return;
  const overlay = document.createElement('div');
  overlay.id = 'install-needs-instance';
  overlay.className = 'modal-root visible';
  overlay.style.zIndex = '320';
  overlay.innerHTML = `
    <div class="modal" style="max-width:430px">
      <div class="modal-header">
        <div><h2 class="modal-title">Create an instance first</h2><p class="modal-sub">Mods need a Minecraft instance to install into.</p></div>
        <button class="modal-close" data-close type="button"><svg width="20" height="20" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">
        <p class="text-muted" style="line-height:1.6">Go create an instance, then return to Discover and select the mod again.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-close type="button">Not now</button>
        <button class="btn btn-primary" data-create-instance type="button">Create instance</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('[data-close]')) overlay.remove();
    if (event.target.closest('[data-create-instance]')) {
      overlay.remove();
      openCreateModal();
    }
  });
}

async function doInstallMod(inst, projectId, backupOptions = {}) {
  let project;
  try { project = await api.getProject(projectId); } catch (e) {
    setStatus('Could not load project details: ' + (e.message || e));
    return;
  }
  const ptype = project?.project_type || 'mod';
  // Resource packs / shaders / datapacks don't declare loaders, so
  // filtering by the instance's loader would exclude them all.
  const noLoaderFilter = ptype === 'resourcepack' || ptype === 'shader' || ptype === 'datapack';
  const loaders = (inst.loader === 'vanilla' || noLoaderFilter) ? [] : [inst.loader];
  let versions;
  try {
    versions = await findCompatibleVersion(projectId, loaders, inst.gameVersion);
  } catch (e) {
    setStatus('Version check failed: ' + (e.message || e));
    return;
  }
  if (!versions || !versions.length) {
    setStatus(`No compatible ${inst.gameVersion}${loaders.length ? ` ${loaders[0]}` : ''} version exists for this project`);
    toast('No compatible version found', 'error', 5000);
    return;
  }
  const version = versions[0];

  // ── Phase 1: Pre-flight check ────────────────────────────
  setStatus('Running compatibility checks…');
  let check;
  try {
    check = await api.checkInstallFeasibility(inst.name, projectId, version.id, loaders, inst.gameVersion);
  } catch (e) {
    setStatus('Pre-flight check failed: ' + (e.message || e));
    return;
  }

  if (!check.feasible) {
    const err = check.errors?.[0];
    if (err?.code === 'NO_DOWNLOAD_URL') {
      showManualInstallDialog(err);
    } else if (err?.code === 'DISK_SPACE') {
      toast(err.message + ' — ' + err.detail, 'error', 5000);
      setStatus('Install aborted: ' + err.message);
    } else {
      setStatus('Install aborted: ' + (err?.message || 'Unknown error'));
    }
    return;
  }

  // ── Warnings UI ───────────────────────────────────────────
  const disableFiles = [];
  for (const w of check.warnings || []) {
    if (w.code === 'DUPLICATE' || w.code === 'INCOMPATIBLE_INSTALLED') {
      if (w.existingFile) disableFiles.push(w.existingFile);
      toast(w.message, 'error', 4000);
    } else if (w.code === 'SERVER_ONLY') {
      toast(w.message + ' — ' + w.detail, 'error', 4000);
    } else if (w.code === 'OLD_JAVA') {
      toast(w.message + '. ' + w.detail, 'error', 5000);
    } else {
      toast(w.message, 'error', 4000);
    }
  }

  // ── Optional deps UI ─────────────────────────────────────
  const optionalDeps = check.optionalDeps || [];
  let chosenOptional = [];
  if (optionalDeps.length) {
    chosenOptional = await showOptionalDepsDialog(optionalDeps);
  }

  // ── Resolve all version IDs + sizes (primary + required + chosen optional) ──
  const allVersionIds = [version.id];
  const versionSizes = {};
  versionSizes[version.id] = version.files?.[0]?.size || 0;
  if (check.requiredDepSizes) {
    for (const [vid, sz] of Object.entries(check.requiredDepSizes)) {
      versionSizes[vid] = sz;
      if (!allVersionIds.includes(vid)) allVersionIds.push(vid);
    }
  }
  if (chosenOptional.length) {
    for (const pid of chosenOptional) {
      try {
        const optVersions = await findCompatibleVersion(pid, loaders, inst.gameVersion);
        if (optVersions?.[0]) {
          allVersionIds.push(optVersions[0].id);
          versionSizes[optVersions[0].id] = optVersions[0].files?.[0]?.size || 0;
        }
      } catch {}
    }
  }

  // ── Phase 2: Download all with progress ───────────────────
  setStatus('Downloading…');
  const onProgress = (p) => {
    if (p.phase === 'downloading') setStatus(p.message || `Downloading… ${p.percent}%`);
    else if (p.phase === 'verifying') setStatus(p.message || 'Verifying file integrity…');
    else if (p.phase === 'caching') setStatus(p.message || 'Checking cache…');
    else if (p.phase === 'done') setStatus('Installed ✅');
    else setStatus(p.message || 'Installing…');
  };
  api.onInstallProgress(onProgress);

  try {
    const result = await api.installMod(inst.name, { versionIds: allVersionIds, versionSizes, disableFiles, ...backupOptions });
    const primary = result.primary || result.installed?.[0];
    toast(`Installed ${result.installed.length} file${result.installed.length > 1 ? 's' : ''}`, 'success');
    setStatus(primary ? `Installed ${primary.filename}` : 'Installed');
    if (state.currentInstance?.name === inst.name) loadContentList();
  } catch (e) {
    toast('Install failed: ' + (e.message || e), 'error', 5000);
    setStatus('Install failed');
  }
}

function confirmInstallAnyway(project, inst) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-root visible';
    overlay.style.zIndex = '300';
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px">
        <div class="modal-header">
          <div><h2 class="modal-title">No compatible version found</h2>
            <p class="modal-sub">This content isn't marked for the instance's version</p></div>
          <button class="modal-close" data-close><svg width="20" height="20" aria-hidden="true"><use href="#i-x"/></svg></button>
        </div>
        <div class="modal-body">
          <p style="color:var(--text-md);line-height:1.6;margin-bottom:12px">
            <strong>${escHtml(project?.title || 'This item')}</strong> has no version marked compatible with
            <strong>${escHtml(inst.name)}</strong> (${escHtml(inst.loader || 'vanilla')} · MC ${escHtml(inst.gameVersion || '?')}).
            It may not work correctly. Install it anyway?
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-cancel>Cancel</button>
          <button class="btn btn-primary" data-ok>Install anyway</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]') || e.target.closest('[data-cancel]')) {
        overlay.remove();
        resolve(false);
      } else if (e.target.closest('[data-ok]')) {
        overlay.remove();
        resolve(true);
      }
    });
  });
}

function showManualInstallDialog(err) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-root visible';
  overlay.style.zIndex = '300';
  overlay.innerHTML = `
    <div class="modal" style="max-width:460px">
      <div class="modal-header">
        <div><h2 class="modal-title">Manual install required</h2></div>
        <button class="modal-close" data-close><svg width="20" height="20" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body" style="text-align:center;padding:var(--s-6)">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" style="margin-bottom:var(--s-3)"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
        <p style="color:var(--text-hi);font-weight:600;margin-bottom:var(--s-2)">${escHtml(err.message)}</p>
        <p style="color:var(--text-md);font-size:var(--text-caption);margin-bottom:var(--s-4)">${escHtml(err.detail)}</p>
        <a class="btn btn-primary" href="${escHtml(err.url)}" target="_blank" rel="noopener">Open in browser</a>
        <button class="btn btn-secondary" data-close style="margin-left:8px">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
  });
}

function showOptionalDepsDialog(deps) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-root visible';
    overlay.style.zIndex = '300';
    const items = deps.map((d, i) => `
      <label class="opt-dep-row">
        <input type="checkbox" data-idx="${i}" checked>
        <span>${escHtml(d.title || d.project_id)}</span>
      </label>
    `).join('');
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <div><h2 class="modal-title">Optional dependencies</h2><p class="modal-sub">Select extra mods to install</p></div>
          <button class="modal-close" data-close><svg width="20" height="20" aria-hidden="true"><use href="#i-x"/></svg></button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:4px">
          ${items}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-close>Skip</button>
          <button class="btn btn-primary" id="opt-dep-confirm">Install selected</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#opt-dep-confirm').addEventListener('click', () => {
      const checked = [...overlay.querySelectorAll('input:checked')].map(inp => deps[parseInt(inp.dataset.idx)].project_id);
      overlay.remove();
      resolve(checked);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) {
        overlay.remove();
        resolve([]);
      }
    });
  });
}

async function openModrinthPackInstall(project) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-root visible';
  overlay.style.zIndex = '330';
  overlay.innerHTML = `<div class="modal">
    <div class="modal-header"><div><h2 class="modal-title">Install ${escHtml(project.title || 'Modrinth pack')}</h2><p class="modal-sub">Create a managed instance with updates, repair, and rollback.</p></div><button class="modal-close" data-close><svg width="20" height="20"><use href="#i-x"/></svg></button></div>
    <div class="modal-body">
      <div class="form-row"><label for="mr-pack-name">Instance name</label><input id="mr-pack-name" class="input" maxlength="64" value="${escHtml(project.title || 'Modrinth Pack')}"></div>
      <div class="form-row" style="margin-top:var(--s-3)"><label for="mr-pack-version">Pack version</label><select id="mr-pack-version" class="input"><option value="">Loading versions…</option></select></div>
      <div class="modal-error text-muted" data-pack-install-error hidden></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" data-install-pack disabled>Install managed pack</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  const select = overlay.querySelector('#mr-pack-version');
  const install = overlay.querySelector('[data-install-pack]');
  const error = overlay.querySelector('[data-pack-install-error]');
  try {
    const versions = await api.getProjectVersions(project.id, [], []);
    const packs = (versions || []).filter(version => (version.files || []).some(file => String(file.filename || '').toLowerCase().endsWith('.mrpack')));
    select.innerHTML = packs.map(version => `<option value="${escHtml(version.id)}">${escHtml(version.name || version.version_number || version.id)}${version.game_versions?.length ? ` · MC ${escHtml(version.game_versions.slice(-2).join(', '))}` : ''}</option>`).join('');
    install.disabled = !packs.length;
    if (!packs.length) { error.hidden = false; error.textContent = 'No downloadable .mrpack versions are available.'; }
  } catch (failure) {
    select.innerHTML = '<option value="">Could not load versions</option>';
    error.hidden = false;
    error.textContent = failure.message || String(failure);
  }
  install.addEventListener('click', async () => {
    const name = overlay.querySelector('#mr-pack-name').value.trim();
    if (!name || !select.value) return;
    install.disabled = true;
    install.innerHTML = '<span class="spinner"></span> Installing…';
    error.hidden = true;
    try {
      await api.installModrinthModpack({ projectId: project.id, versionId: select.value, name });
      await loadInstances();
      close();
      switchView('library');
      toast(`${project.title || 'Modpack'} installed as a managed pack`, 'success', 6000);
    } catch (failure) {
      install.disabled = false;
      install.textContent = 'Install managed pack';
      error.hidden = false;
      error.textContent = failure.message || String(failure);
    }
  });
}

async function showModDetails(projectId) {
  if (!projectId) return;
  try {
    const p = await api.getProject(projectId);
    const overlay = document.createElement('div');
    overlay.className = 'modal-root visible';
    overlay.style.zIndex = '300';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <div style="display:flex;gap:12px;align-items:center;min-width:0">
            <div class="instance-icon" style="width:48px;height:48px;flex-shrink:0">
              ${p.icon_url ? `<img src="${escHtml(p.icon_url)}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.replaceWith(document.createTextNode('${(p.title || '?')[0]}'))">` : (p.title || '?')[0].toUpperCase()}
            </div>
            <div style="min-width:0">
              <h2 class="modal-title" style="font-size:18px">${escHtml(p.title || '')}</h2>
              <p class="modal-sub">${fmtNum(p.downloads || 0)} downloads · ${fmtNum(p.followers || 0)} followers</p>
            </div>
          </div>
          <button class="modal-close" data-close><svg width="20" height="20" aria-hidden="true"><use href="#i-x"/></svg></button>
        </div>
        <div class="modal-body">
          <p style="color:var(--text-md);line-height:1.6;margin-bottom:12px;white-space:pre-wrap">${escHtml(p.description || 'No description')}</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
            ${(p.categories || []).slice(0, 8).map((c) => `<span class="chip">${escHtml(c)}</span>`).join('')}
          </div>
          ${(p.game_versions || []).length ? `<div style="margin-bottom:14px;font-size:12px;color:var(--text-lo)"><strong>Versions:</strong> ${escHtml(p.game_versions.slice(-6).join(', '))}</div>` : ''}
        </div>
        <div class="modal-footer">
          ${p.client_side || p.server_side ? `<span class="text-muted">Client: ${escHtml(p.client_side || '?')} · Server: ${escHtml(p.server_side || '?')}</span>` : '<span></span>'}
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" data-close>Close</button>
            ${p.project_type === 'modpack' ? '<button class="btn btn-primary" type="button" data-install-modrinth-pack>Install pack</button>' : ''}
            ${p.slug ? `<a class="btn btn-primary" href="https://modrinth.com/project/${escHtml(p.slug)}" target="_blank" rel="noopener">View on Modrinth</a>` : ''}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-install-modrinth-pack]')?.addEventListener('click', () => { overlay.remove(); openModrinthPackInstall(p); });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
    });
  } catch (e) {
    setStatus('Failed to load mod: ' + (e.message || e));
  }
}

async function showCurseForgeDetails(projectId, focusInstall = false) {
  const type = state.discoverCategory || 'mod';
  const overlay = document.createElement('div');
  overlay.className = 'modal-root visible';
  overlay.style.zIndex = '320';
  overlay.innerHTML = `<div class="modal-backdrop"></div><div class="modal-card modal-card-wide">
    <div class="modal-head"><div><h2 class="modal-title">Loading CurseForge project…</h2><p class="modal-sub">Checking compatible files</p></div><button class="icon-btn" data-close type="button"><svg width="16" height="16"><use href="#i-x"/></svg></button></div>
    <div class="modal-body"><div class="skeleton skeleton-block"></div></div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.querySelector('.modal-backdrop').addEventListener('click', close);
  try {
    const project = await api.getCurseForgeProject(projectId);
    const defaultInstance = state.currentInstance || sortByRecency(state.instances)[0] || null;
    overlay.querySelector('.modal-title').textContent = project.name || 'CurseForge project';
    overlay.querySelector('.modal-sub').textContent = `CurseForge · ${fmtNum(project.downloadCount || 0)} downloads`;
    const body = overlay.querySelector('.modal-body');
    body.innerHTML = `<p class="modal-description">${escHtml(project.summary || 'No description supplied.')}</p>
      ${type === 'modpack' ? `
        <label>New instance name</label><input id="cf-pack-name" class="input" maxlength="64" value="${escHtml(project.name || 'CurseForge Pack')}">
      ` : `
        <label>Install into</label><select id="cf-instance" class="input">${state.instances.map(instance => `<option value="${escHtml(instance.name)}" ${instance.name === defaultInstance?.name ? 'selected' : ''}>${escHtml(instance.name)} · ${escHtml(instance.gameVersion)} · ${escHtml(instance.loader)}</option>`).join('')}</select>
      `}
      <label>Compatible file</label><select id="cf-file" class="input"><option>Loading…</option></select>
      <div id="cf-world-wrap" hidden><label>World</label><select id="cf-world" class="input"></select></div>
      <div id="cf-error" class="modal-error text-muted" hidden></div>
      <div class="modal-actions"><button class="btn btn-ghost" data-close-action type="button">Cancel</button><button class="btn btn-primary" id="cf-install" type="button" ${type !== 'modpack' && !state.instances.length ? 'disabled' : ''}>${type === 'modpack' ? 'Import modpack' : 'Install'}</button></div>`;
    body.querySelector('[data-close-action]').addEventListener('click', close);
    const instanceSelect = body.querySelector('#cf-instance');
    const fileSelect = body.querySelector('#cf-file');
    const worldWrap = body.querySelector('#cf-world-wrap');
    const worldSelect = body.querySelector('#cf-world');
    const error = body.querySelector('#cf-error');
    let availableFiles = [];
    const showError = message => { error.hidden = false; error.textContent = message; };
    const loadOptions = async () => {
      error.hidden = true;
      fileSelect.disabled = true;
      fileSelect.innerHTML = '<option>Loading…</option>';
      try {
        availableFiles = await api.getCurseForgeFiles(projectId, type === 'modpack' ? null : instanceSelect.value);
        fileSelect.innerHTML = '';
        for (const file of availableFiles) {
          const option = document.createElement('option');
          option.value = String(file.id);
          option.textContent = file.displayName || file.fileName || String(file.id);
          fileSelect.appendChild(option);
        }
        fileSelect.disabled = !availableFiles.length;
        if (!availableFiles.length) showError('No compatible files were found for this instance.');
        if (type === 'datapack') {
          const worlds = await api.getInstanceWorlds(instanceSelect.value);
          worldWrap.hidden = false;
          worldSelect.innerHTML = '';
          for (const world of worlds) {
            const option = document.createElement('option'); option.value = world; option.textContent = world; worldSelect.appendChild(option);
          }
          if (!worlds.length) showError('Create or copy a world into this instance before installing a data pack.');
        }
      } catch (loadError) { showError(loadError.message || loadError); }
    };
    instanceSelect?.addEventListener('change', loadOptions);
    await loadOptions();
    const installButton = body.querySelector('#cf-install');
    installButton.addEventListener('click', async () => {
      if (!fileSelect.value || fileSelect.disabled) return;
      installButton.disabled = true;
      error.hidden = true;
      try {
        if (type === 'modpack') {
          await api.importCurseForgeModpack({ projectId, fileId: Number(fileSelect.value), name: body.querySelector('#cf-pack-name').value });
          await loadInstances();
          toast('CurseForge modpack imported', 'success');
        } else {
          await api.installCurseForgeContent(instanceSelect.value, { projectId, fileId: Number(fileSelect.value), type, world: worldSelect?.value || null });
          if (state.currentInstance?.name === instanceSelect.value) await loadContentList();
          toast(`${project.name} installed`, 'success');
        }
        close();
      } catch (installError) {
        showError(installError.message || installError);
        installButton.disabled = false;
      }
    });
    if (focusInstall) installButton.focus();
  } catch (error) {
    overlay.querySelector('.modal-body').innerHTML = `<div class="modal-error">${escHtml(error.message || error)}</div>`;
  }
}
