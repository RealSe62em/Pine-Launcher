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
  allVersions: [],
  currentView: 'home',
  currentInstance: null,
  selectedLoader: 'vanilla',
  chosenProfile: null,
  performanceMods: [],
  authData: null,
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
  perfMonitorActive: false,
  perfInterval: null,
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
};
const SEARCH_LIMIT = 20;
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

  await loadInstances();
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
          <input id="cmdk-input" class="cmdk-input" placeholder="Jump to an instance, view, or action..." autocomplete="off">
          <kbd>Esc</kbd>
        </div>
        <div id="cmdk-results" class="cmdk-results"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCommandPalette(); });
    $('cmdk-input')?.addEventListener('input', (e) => renderCmdKResults(e.target.value));
  }
  overlay.classList.add('visible');
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

function renderCmdKResults(query = '') {
  const results = $('cmdk-results');
  if (!results) return;
  const q = query.toLowerCase().trim();
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
    if (!q || inst.name.toLowerCase().includes(q)) {
      items.push({
        id: 'inst-' + inst.name,
        label: inst.name,
        sub: (inst.loader || 'vanilla') + ' ' + (inst.gameVersion || ''),
        action: () => { selectInstance(inst.name); closeCommandPalette(); },
        kind: 'instance',
      });
    }
  }

  if (!items.length) {
    results.innerHTML = `<div class="cmdk-empty">No matches</div>`;
    return;
  }
  results.innerHTML = items.slice(0, 10).map((it, i) => `
    <button class="cmdk-item" data-idx="${i}">
      <div class="cmdk-item-main">
        <div class="cmdk-item-label">${escHtml(it.label)}</div>
        ${it.sub ? `<div class="cmdk-item-sub">${escHtml(it.sub)}</div>` : ''}
      </div>
      <div class="cmdk-item-kind">${escHtml(it.kind)}</div>
    </button>
  `).join('');

  results.querySelectorAll('.cmdk-item').forEach((btn) => {
    btn.addEventListener('click', () => items[parseInt(btn.dataset.idx)].action());
  });
  $('cmdk-input').onkeydown = (e) => {
    if (e.key === 'Enter') items[0]?.action();
  };
}

// ── Account menu ────────────────────────────────────────────
function toggleAccountMenu() {
  const existing = $('account-menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.id = 'account-menu';
  menu.className = 'account-menu';
  const uuid = state.authData?.profile?.uuid;
  const initial = (state.authData?.profile?.name || 'G')[0].toUpperCase();
  const isOffline = state.authData?.meta?.type === 'offline';
  const avatarHtml = uuid && !isOffline
    ? `<img src="https://mc-heads.net/avatar/${uuid}/36" alt="${escHtml(initial)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`
    : escHtml(initial);

  menu.innerHTML = state.authData ? `
    <div class="account-menu-header">
      <div class="avatar">${avatarHtml}</div>
      <div class="account-menu-info">
        <div class="account-menu-name">${escHtml(state.authData.profile.name)}</div>
        <div class="account-menu-sub">${isOffline ? 'Offline account' : 'Microsoft account'}</div>
      </div>
    </div>
    <div class="account-menu-divider"></div>
    ${!isOffline ? `
      <button class="account-menu-item" data-act="reauth">
        <svg width="14" height="14" aria-hidden="true"><use href="#i-settings"/></svg>
        Re-authenticate
      </button>` : `
      <button class="account-menu-item" data-act="signin">
        <svg width="14" height="14" aria-hidden="true"><use href="#i-plus"/></svg>
        Sign in with Microsoft
      </button>`}
    <button class="account-menu-item" data-act="offline">
      <svg width="14" height="14" aria-hidden="true"><use href="#i-user"/></svg>
      Play offline
    </button>
    <button class="account-menu-item danger" data-act="signout">
      <svg width="14" height="14" aria-hidden="true"><use href="#i-trash"/></svg>
      Sign out
    </button>
  ` : `
    <button class="account-menu-item" data-act="signin">
      <svg width="14" height="14" aria-hidden="true"><use href="#i-plus"/></svg>
      Sign in with Microsoft
    </button>
    <button class="account-menu-item" data-act="offline">
      <svg width="14" height="14" aria-hidden="true"><use href="#i-user"/></svg>
      Play offline
    </button>
  `;
  const row = $('account-row');
  if (!row) return;
  row.appendChild(menu);
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'signin' || act === 'reauth') handleAuth();
    if (act === 'offline') openOfflineModal();
    if (act === 'signout') signOut();
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

  document.querySelectorAll('.tabbar-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  $('content-search')?.addEventListener('input', debounce(renderContentList, 80));
  $('content-categories')?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-content-type]');
    if (button) switchContentCategory(button.dataset.contentType);
  });
  $('copy-log-btn')?.addEventListener('click', copyLog);
  $('clear-log-btn')?.addEventListener('click', clearLogs);
  $('instance-add-content')?.addEventListener('click', openContentAdder);
  $('instance-play-btn')?.addEventListener('click', () => state.currentInstance && launchInstance(state.currentInstance.name));
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
async function loadInstances() {
  try {
    state.instances = await api.listInstances();
  } catch { state.instances = []; }
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
    <div class="recent-card-sub">${escHtml(sub)}</div>
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
  return `<div class="instance-card${isLaunching ? ' launching' : ''}${blurClass}" data-name="${escHtml(inst.name)}">
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
        </div>
      </div>
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

function renderLibrary() {
  const grid = $('library-grid');
  if (!grid) { state.searchLoading = false; return; }
  if (!state.instances.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg width="24" height="24" aria-hidden="true"><use href="#i-library"/></svg></div>
      <div class="empty-state-title">No instances yet</div>
      <div class="empty-state-sub">Tap + above to create your first one.</div>
    </div>`;
    return;
  }
  grid.innerHTML = state.instances.map(renderInstanceCard).join('');
  staggerInto(grid.querySelectorAll('.instance-card'));
  grid.querySelectorAll('.instance-card').forEach((card) => {
    const name = card.dataset.name;
    card.addEventListener('click', () => selectInstance(name));
    card.querySelector('[data-act="play"]')?.addEventListener('click', (e) => { e.stopPropagation(); launchInstance(name); });
    card.querySelector('[data-act="open"]')?.addEventListener('click', (e) => { e.stopPropagation(); selectInstance(name); });
  });
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
          ${escHtml((inst.loader || 'vanilla') + ' ' + (inst.gameVersion || ''))}
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
    state.pendingModUpdates = updates || [];
  } catch {
    state.pendingModUpdates = [];
  }
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
        ${m.iconUrl ? `<img src="${escHtml(m.iconUrl)}" alt="" loading="lazy">` : escHtml((m.title || m.filename)[0].toUpperCase())}
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
    await doInstallMod(inst, mod.projectId);
  } catch (e) {
    toast('Update failed: ' + (e.message || e), 'error', 4000);
  }
}

async function openContentAdder() {
  if (!state.currentInstance) return;
  if (state.contentCategory === 'datapack') {
    toast('Data packs belong to a specific world. Add them from that world’s datapacks folder.', 'info', 5000);
    return;
  }
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
  if (!container) return;
  container.innerHTML = `<div class="empty-state">
    <div class="empty-state-icon"><svg width="24" height="24" view-hidden="true"><use href="#i-globe"/></svg></div>
    <div class="empty-state-title">No worlds yet</div>
    <div class="empty-state-sub">Worlds will appear here once you play this instance.</div>
  </div>`;
}

function loadInstanceSettings() {
  if (!state.currentInstance) return;
  const inst = state.currentInstance;
  const form = $('instance-settings-form');
  if (!form) return;
  form.innerHTML = `
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
  state.instanceSettingsDirty = false;
  form.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
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
async function handleAuth() {
  const nameEl = $('account-name');
  if (nameEl) nameEl.textContent = 'Logging in…';
  try {
    state.authData = await api.microsoftLogin();
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
    state.authData = null;
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
  overlay.innerHTML = [
    '<div class="modal" style="max-width:470px">',
    '<div class="modal-header">',
    '<div><h2 class="modal-title">Choose an account first</h2>',
    '<p class="modal-sub">Pine needs a player account before it can launch this instance.</p></div>',
    '<button class="modal-close" data-close type="button" aria-label="Close">X</button>',
    '</div>',
    '<div class="modal-body">',
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
  const name = state.authData?.profile?.name || '';
  const eligible = name === 'undrrwrldd' || name === 'Se62em' || name === 'Shemes' || name === 'Exobeast';
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
        <button class="btn btn-primary set-save-btn">Save settings</button>
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
        <button class="btn btn-primary set-save-btn">Save settings</button>
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
          <button class="btn btn-primary set-save-btn">Save settings</button>
          <button class="btn btn-ghost" id="set-reset-btn">Reset defaults</button>
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
  layout.querySelectorAll('.set-save-btn').forEach((button) => button.addEventListener('click', () => saveAllSettings(button)));
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
  headerSave.hidden = category === 'updates';
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
    reducedMotion: false, gayMode: true,
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
  if (nameEl) nameEl.textContent = inst.name || '';
  if (!root) return;
  root.removeAttribute('hidden');
  requestAnimationFrame(() => root.classList.add('visible'));
}

function closeConfirmDialog() {
  const root = $('confirm-dialog-root');
  if (!root) return;
  root.classList.remove('visible');
  root.setAttribute('hidden', '');
}

async function deleteInstance() {
  const inst = state.currentInstance;
  if (!inst) return;
  const btn = $('confirm-delete');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    await api.deleteInstance(inst.name);
    closeConfirmDialog();
    closeEditSheet();
    state.currentInstance = null;
    await loadInstances();
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
    await api.createInstance({ name, gameVersion: version, profile: state.chosenProfile || 'custom', loader: state.selectedLoader, loaderVersion: loaderVer || null, iconData: state.pendingIcon || null, bannerData: state.pendingBanner || null, bannerBlurDir: state.bannerBlurDir || 'left', customRoot: state.pendingInstanceRoot || '' });
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
  return /sign in with microsoft|offline account|choose an account/i.test(launchErrorMessage(error));
}

function bindLaunchEvents() {
  api.onLaunchProgress((p) => {
    if (typeof p === 'number') {
      const pct = Math.round(Math.min(100, p * 100));
      setDockedProgress(pct, pct + '%');
    }
  });
  api.onLaunchData((d) => {
    appendLog(d);
    setStatus(typeof d === 'string' ? d.split('\n')[0].slice(0, 80) : '');
  });
  api.onLaunchError((e) => {
    const instanceName = state.launchingName;
    const message = launchErrorMessage(e);
    setStatus('Launch failed: ' + message);
    setDockedProgressVisible(false);
    if (state.currentInstance) $('instance-play-btn')?.removeAttribute('disabled');
    state.launchingName = null;
    renderAllInstanceCards();
    if (isAccountRequiredError(e) && instanceName) {
      state.authData = null;
      updateAuthUI();
      openAccountRequiredModal(instanceName);
    } else {
      toast('Launch failed: ' + message, 'error', 8000);
    }
  });
  api.onLaunchClose(() => {
    clearLogs();
    setStatus('Minecraft closed');
    setDockedProgressVisible(false);
    setPlayingPill(null);
    if (state.currentInstance) $('instance-play-btn')?.removeAttribute('disabled');
    state.launchingName = null;
    renderAllInstanceCards();
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

function launchInstance(name) {
  if (state.launchingName) return;
  if (!state.authData?.profile) {
    openAccountRequiredModal(name);
    return;
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
  api.launchInstance(name).catch((e) => {
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
    const result = await api.searchMods(query, facets, state.searchOffset, SEARCH_LIMIT, sort);
    if (requestId !== state.searchRequestId || searchKey !== state.activeSearchKey) return;
    const hits = result.hits || [];
    state.searchOffset += hits.length;
    const total = result.total_hits || hits.length;
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
          <div class="mod-card-author">by ${escHtml(mod.author || 'unknown')}</div>
          <div class="mod-card-desc">${escHtml(mod.description || '')}</div>
          <div class="mod-card-footer">
            <span class="mod-card-dls">${fmtNum(mod.downloads)} downloads</span>
            <button class="btn btn-primary btn-sm" data-act="install">Install</button>
          </div>
        </div>
      </div>
    `).join('');
    if (append) grid.insertAdjacentHTML('beforeend', html);
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
  if (!state.instances.length) {
    setStatus('Create an instance first');
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

async function doInstallMod(inst, projectId) {
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
    const result = await api.installMod(inst.name, { versionIds: allVersionIds, versionSizes, disableFiles });
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
            ${p.slug ? `<a class="btn btn-primary" href="https://modrinth.com/project/${escHtml(p.slug)}" target="_blank" rel="noopener">View on Modrinth</a>` : ''}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) overlay.remove();
    });
  } catch (e) {
    setStatus('Failed to load mod: ' + (e.message || e));
  }
}
