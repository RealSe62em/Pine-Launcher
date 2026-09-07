import { escHtml as esc, toast } from './animations.js';

let ctx;

function dialog(title, content) {
  const el = document.createElement('dialog');
  el.className = 'feature-dialog';
  el.innerHTML = `<header><h2>${esc(title)}</h2><button class="btn btn-ghost" data-close aria-label="Close"><svg width="18" height="18" aria-hidden="true"><use href="#i-x"/></svg></button></header><div class="feature-body">${content}</div>`;
  document.body.append(el);
  const closed = new Promise(resolve => el.addEventListener('close', () => { resolve(el.returnValue); el.remove(); }, { once: true }));
  el.querySelector('[data-close]').onclick = () => el.close();
  el.showModal();
  return { el, closed, body: el.querySelector('.feature-body') };
}

function errorText(error) { return error?.message || String(error); }
function button(label, action, primary = false) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `btn ${primary ? 'btn-primary' : 'btn-secondary'}`;
  el.textContent = label;
  el.onclick = async () => {
    el.disabled = true;
    try { await action(); } catch (error) { toast(errorText(error), 'error', 7000); }
    finally { el.disabled = false; }
  };
  return el;
}
function actions(host, entries) {
  const row = document.createElement('div');
  row.className = 'feature-actions';
  entries.forEach(entry => row.append(button(...entry)));
  host.append(row);
}

export async function initFeatures(context) {
  ctx = context;
  document.getElementById('health-button').onclick = () => openInstanceHealth(ctx.state.currentInstance?.name).catch(error => toast(errorText(error), 'error'));
  document.getElementById('recipe-button').onclick = openRecipe;
  document.getElementById('support-report-button').onclick = openReport;
  await startOnboarding();
}

export async function openInstanceHealth(name) {
  if (!name) return false;
  const health = await ctx.api.getInstanceHealth(name);
  const view = dialog('Instance health', `<p>${esc(name)} · ${health.inspectedMods} active mod files checked.</p>${health.pendingFiles ? `<p>${health.pendingFiles} queued files will apply before launch. Check again after they are applied.</p>` : ''}${health.healthy ? '<p>No issues found in these checks. Pine will choose Java automatically unless you set a custom runtime.</p>' : '<p>Review the findings below. These checks cannot detect every mod conflict.</p>'}<div data-issues></div>`);
  const host = view.el.querySelector('[data-issues]');
  for (const issue of health.issues) {
    const card = document.createElement('article');
    card.className = 'feature-card';
    card.innerHTML = `<strong>${esc(issue.title)}</strong><p>${esc(issue.detail || '')}</p>`;
    card.append(button(issue.action === 'content' ? 'Review mods' : 'Open settings', () => {
      view.el.close();
      ctx.selectInstance(name);
      ctx.switchInstanceTab(issue.action);
    }));
    host.append(card);
  }
  actions(view.body, [['Done', () => view.el.close()]]);
  await view.closed;
}

export async function previewPackUpdate(name, versionId) {
  const view = dialog('Preview pack update', '<p data-status>Downloading and comparing the selected pack…</p>');
  let preview;
  try {
    preview = await ctx.api.previewManagedPackVersion(name, versionId);
    if (!view.el.isConnected) return null;
    view.body.querySelector('[data-status]').textContent = `${preview.versionName || 'Selected pack'} · Minecraft ${preview.previousGameVersion} → ${preview.gameVersion} · ${preview.loader}`;
    for (const [key, label] of [['added', 'Added'], ['removed', 'Removed'], ['changed', 'Changed'], ['conflicts', 'Custom files affected']]) {
      const section = document.createElement('details');
      section.open = key === 'conflicts' && preview[key].length > 0;
      section.innerHTML = `<summary>${label} (${preview[key].length})</summary><ul>${preview[key].map(file => `<li>${esc(file)}</li>`).join('')}</ul>`;
      view.body.append(section);
    }
    const note = document.createElement('p');
    note.textContent = 'Pine creates a restore point before applying this update. Review affected custom files above; those paths will be replaced or removed. Unrelated files and worlds are kept.';
    view.body.append(note);
    actions(view.body, [['Cancel', () => view.el.close()], ['Create restore point & apply', () => view.el.close('apply'), true]]);
  } catch (error) { if (view.el.isConnected) view.body.querySelector('[data-status]').textContent = errorText(error); }
  return (await view.closed) === 'apply' ? preview.fingerprint : null;
}

async function openRecipe() {
  const name = ctx.state.currentInstance?.name;
  if (!name) return;
  const view = dialog('Share instance recipe', '<p data-status>Resolving downloadable content…</p>');
  try {
    const recipe = await ctx.api.getRecipePreview(name);
    if (!view.el.isConnected) return;
    view.body.innerHTML = `<p><strong>${esc(recipe.name)}</strong> · Minecraft ${esc(recipe.gameVersion)} · ${esc(recipe.loader)}</p><p>Memory: ${esc(recipe.memory.min)}–${esc(recipe.memory.max)}. ${recipe.files.length} downloadable files.</p><p>A small Pine manifest lets another user recreate this setup. Worlds, accounts, and local file contents are not bundled. Use a full export to include local content.</p><details><summary>Included downloads</summary><ul>${recipe.files.map(file => `<li>${esc(file)}</li>`).join('')}</ul></details><details><summary>Unavailable for download (${recipe.omitted.length})</summary><pre>${esc(JSON.stringify(recipe.omitted, null, 2))}</pre></details>`;
    actions(view.body, [['Import recipe', () => { view.el.close(); ctx.openImportHub(); }], ['Save recipe', () => ctx.api.exportInstance(name, { mode: 'manifest' }), true]]);
  } catch (error) { view.body.textContent = errorText(error); }
}

async function openReport() {
  const name = ctx.state.currentInstance?.name;
  if (!name) return;
  const view = dialog('Review support report', '<p data-status>Collecting diagnostics…</p>');
  try {
    const log = ctx.state.logLines.map(line => typeof line === 'string' ? line : line.text || line.message || '').join('\n');
    const report = await ctx.api.getSupportReport(name, log);
    if (!view.el.isConnected) return;
    view.body.innerHTML = '<p>Account data and common credentials and local paths are excluded or redacted. Review the text before sharing because mod-generated logs may contain other personal information.</p><textarea class="input feature-report" aria-label="Support report preview" readonly spellcheck="false"></textarea>';
    view.body.querySelector('textarea').value = report;
    actions(view.body, [['Copy report', () => ctx.api.copyText(report)], ['Save report', () => ctx.api.saveSupportReport(report), true]]);
  } catch (error) { view.body.textContent = errorText(error); }
}

function waitFor(selector, timeout = 5000) {
  return new Promise(resolve => {
    const started = Date.now();
    const poll = () => {
      const target = typeof selector === 'function' ? selector() : document.querySelector(selector);
      if (target && target.getClientRects().length) return resolve(target);
      if (Date.now() - started >= timeout) return resolve(null);
      setTimeout(poll, 80);
    };
    poll();
  });
}

async function startOnboarding() {
  const claim = await ctx.api.claimOnboarding();
  if (!claim.show) return;
  await ctx.loadSettings();
  const ensureAccountMenu = () => {
    if (!document.getElementById('account-menu')) document.getElementById('account-row')?.click();
  };
  const ensureCreateModal = () => {
    if (document.getElementById('modal-overlay')?.hidden) ctx.openCreateModal();
  };
  const closeCreateModal = () => {
    if (!document.getElementById('modal-overlay')?.hidden) document.getElementById('modal-close-btn')?.click();
  };
  const openFirstInstance = tab => {
    const first = ctx.state.instances[0];
    if (!first) return;
    ctx.selectInstance(first.name);
    ctx.switchInstanceTab(tab);
  };
  const steps = [
    { prepare: () => document.getElementById('account-menu')?.remove(), target: '#account-row', title: 'Start with your account', copy: 'Click your profile to add a Microsoft account or an offline profile. You can keep several accounts here and switch between them.', action: 'Click the highlighted profile', advanceOnClick: true },
    { prepare: ensureAccountMenu, target: () => document.querySelector('#account-menu [data-act="signin"], #account-menu [data-act="offline"]'), title: 'Choose how you play', copy: 'Microsoft sign-in uses the Minecraft license on your account. Offline profiles are useful for local play. Choose either option, or skip this step and add one later.', action: 'Click an account option', advanceOnClick: true },
    { prepare: () => { closeCreateModal(); ctx.switchView('home'); }, target: '#hero-create-btn', title: 'Create your first instance', copy: 'An instance keeps one Minecraft setup isolated: its version, loader, mods, worlds, and settings. Click New instance to begin.', action: 'Click New instance', advanceOnClick: true },
    { prepare: ensureCreateModal, target: '.profile-grid', title: 'Pick the kind of setup', copy: 'Vanilla is clean Minecraft. Performance installs a tuned Fabric setup. Custom lets you choose Fabric, Quilt, Forge, or NeoForge yourself.', action: 'Choose a profile' },
    { prepare: ensureCreateModal, target: '#modal-name', title: 'Name your instance', copy: 'Give it a name you will recognize. You can also choose a separate drive, icon, banner, Minecraft version, and loader below.', action: 'Type an instance name' },
    { prepare: ensureCreateModal, target: '#modal-version', title: 'Choose Minecraft carefully', copy: 'Mods must match both this Minecraft version and the loader. Pine remembers these choices and filters compatible content later.', action: 'Choose a version' },
    { prepare: ensureCreateModal, target: '#modal-create-btn', title: 'Build the instance', copy: 'Click Create when the setup looks right. Pine creates its files now; the game and correct Java runtime download when you first launch.', action: 'Click Create', advanceOnClick: true, waitAfterClick: true, onSkip: closeCreateModal },
    { prepare: () => { closeCreateModal(); ctx.switchView('discover'); }, target: '.tabbar-item[data-view="discover"]', title: 'Discover compatible content', copy: 'Discover is where you find mods, modpacks, resource packs, data packs, and shaders. Pine asks which instance should receive an item before installing it.', action: 'Open Discover', advanceOnClick: true },
    { prepare: () => ctx.switchView('discover'), target: '#search-input', title: 'Search, filter, install', copy: 'Search for a mod, then filter by loader and Minecraft version. Open a result and choose your instance. If Minecraft is running, Pine safely queues the mod for the next launch.', action: 'Try a search' },
    { prepare: () => ctx.switchView('library'), target: '.tabbar-item[data-view="library"]', title: 'Your instances live here', copy: 'Library holds every setup. Open an instance to manage its content, worlds, backups, logs, and per-instance options.', action: 'Open Library', advanceOnClick: true },
    { prepare: () => openFirstInstance('content'), target: () => ctx.state.instances.length ? document.querySelector('#instance-tabs [data-tab="content"]') : null, title: 'Manage installed mods', copy: 'Content lists what this instance owns. Add content here, disable a mod without deleting it, update supported files, or remove them.', action: 'Content for this instance' },
    { prepare: () => openFirstInstance('content'), target: () => ctx.state.instances.length ? document.querySelector('#instance-tabs [data-tab="settings"]') : null, title: 'Override instance settings', copy: 'Instance Settings changes memory, Java, resolution, and launch options for only this setup. Global defaults stay untouched.', action: 'Open instance Settings', advanceOnClick: true },
    { prepare: () => ctx.switchView('settings'), target: '.tabbar-item[data-view="settings"]', title: 'Launcher settings', copy: 'This is where Pine keeps global behavior, Java and memory defaults, appearance, Discord presence, storage, and updates.', action: 'Open Settings', advanceOnClick: true },
    { prepare: () => ctx.switchView('settings'), target: '.settings-nav [data-cat="appearance"]', title: 'Make Pine yours', copy: 'Appearance changes the accent color and motion preferences. Click it to preview the controls.', action: 'Open Appearance', advanceOnClick: true },
    { prepare: () => ctx.switchView('settings'), target: '.settings-nav [data-cat="updates"]', title: 'Keep Pine current', copy: 'Updates shows your installed version, checks for a new release, downloads it, and installs it when you are ready.', action: 'Open Updates', advanceOnClick: true },
    { prepare: () => ctx.switchView('home'), target: '#destinations-header, .hero-card', title: 'Jump back into the game', copy: 'After you play, frequently visited worlds and servers appear on Home. Server cards show live player count, version, and ping. The monitor icon creates a desktop shortcut using the world or server image.', action: 'Finish', final: true },
  ];

  const layer = document.createElement('div');
  layer.className = 'tour-layer';
  layer.innerHTML = '<div class="tour-spotlight" aria-hidden="true"></div><section class="tour-coach" role="dialog" aria-modal="true" aria-labelledby="tour-title"><div class="tour-progress" aria-hidden="true"></div><span class="tour-kicker"></span><h2 id="tour-title"></h2><p></p><span class="tour-instruction"></span><div class="tour-actions"><button class="tour-skip" type="button">Skip tour</button><div><button class="btn btn-ghost tour-back" type="button">Back</button><button class="btn btn-primary tour-next" type="button">Next</button></div></div></section>';
  document.body.append(layer);
  const spotlight = layer.querySelector('.tour-spotlight');
  const coach = layer.querySelector('.tour-coach');
  const next = layer.querySelector('.tour-next');
  const back = layer.querySelector('.tour-back');
  let index = 0;
  let target = null;
  let removeTargetListener = () => {};
  let transitionVersion = 0;
  let transitioning = false;
  let finished = false;

  const place = () => {
    if (!target?.isConnected) return;
    const rect = target.getBoundingClientRect();
    const pad = 10;
    spotlight.style.cssText = `left:${rect.left - pad}px;top:${rect.top - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px`;
    const box = coach.getBoundingClientRect();
    const gap = 22;
    let left = rect.right + gap;
    let top = rect.top + rect.height / 2 - box.height / 2;
    if (left + box.width > innerWidth - 20) left = rect.left - box.width - gap;
    if (left < 20) {
      left = Math.min(Math.max(20, rect.left), innerWidth - box.width - 20);
      top = rect.bottom + gap;
      if (top + box.height > innerHeight - 20) top = rect.top - box.height - gap;
    }
    coach.style.left = `${Math.max(20, Math.min(left, innerWidth - box.width - 20))}px`;
    coach.style.top = `${Math.max(20, Math.min(top, innerHeight - box.height - 20))}px`;
  };

  const finish = async status => {
    if (finished) return;
    finished = true;
    removeTargetListener();
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey);
    layer.remove();
    await ctx.api.finishOnboarding(status);
  };

  const show = async (requested, direction = 1) => {
    const version = ++transitionVersion;
    removeTargetListener();
    removeTargetListener = () => {};
    transitioning = true;
    index = Math.max(0, Math.min(requested, steps.length - 1));
    const step = steps[index];
    await step.prepare?.();
    const nextTarget = await waitFor(step.target);
    if (version !== transitionVersion || finished) return;
    if (!nextTarget) {
      const fallback = index + direction;
      if (fallback >= 0 && fallback < steps.length) return show(fallback, direction);
      transitioning = false;
      return;
    }
    target = nextTarget;
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    await new Promise(resolve => setTimeout(resolve, 180));
    if (version !== transitionVersion || finished) return;
    layer.querySelector('.tour-kicker').textContent = `STEP ${index + 1} OF ${steps.length}`;
    layer.querySelector('h2').textContent = step.title;
    layer.querySelector('p').textContent = step.copy;
    const instruction = layer.querySelector('.tour-instruction');
    instruction.textContent = step.advanceOnClick ? `↗ ${step.action}` : '';
    instruction.hidden = !step.advanceOnClick;
    layer.querySelector('.tour-progress').innerHTML = steps.map((_, dot) => `<i class="${dot === index ? 'active' : dot < index ? 'done' : ''}"></i>`).join('');
    next.disabled = false;
    next.textContent = step.final ? 'Finish' : step.advanceOnClick ? 'Do this later' : 'Next';
    back.hidden = index === 0;
    requestAnimationFrame(place);
    transitioning = false;
    const boundTarget = target;
    let clickPending = false;
    const clicked = async event => {
      if (!step.advanceOnClick || transitioning || clickPending || version !== transitionVersion || event.target.closest?.('.tour-coach')) return;
      if (step.waitAfterClick) {
        clickPending = true;
        next.disabled = true;
        next.textContent = 'Creating…';
        const completed = await waitFor(() => {
          const modal = document.getElementById('modal-overlay');
          if (modal?.hidden) return document.body;
          const idle = document.getElementById('modal-progress')?.hidden && !document.getElementById('modal-create-btn')?.disabled;
          return idle && Date.now() - clicked.started > 700 ? document.documentElement : null;
        }, 120000);
        if (version !== transitionVersion || finished) return;
        if (completed === document.documentElement) {
          clickPending = false;
          next.disabled = false;
          next.textContent = 'Do this later';
          return;
        }
      }
      show(index + 1, 1);
    };
    const listener = event => { clicked.started = Date.now(); clicked(event); };
    boundTarget.addEventListener('click', listener);
    removeTargetListener = () => boundTarget.removeEventListener('click', listener);
  };

  next.onclick = () => {
    if (transitioning) return;
    const step = steps[index];
    if (step.final) return finish('completed');
    step.onSkip?.();
    show(index + 1, 1);
  };
  back.onclick = () => { if (!transitioning) show(index - 1, -1); };
  layer.querySelector('.tour-skip').onclick = () => finish('skipped');
  const onKey = event => {
    if (event.key === 'Escape') finish('skipped');
    if (event.key === 'ArrowRight') next.click();
    if (event.key === 'ArrowLeft' && !back.hidden) back.click();
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', place);
  show(0);
}
