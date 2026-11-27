// ── Pine Theme Studio & Live Inspector ───────────────────────
// Live inspector for customizing colors, layouts, backgrounds, per-element
// styles, custom CSS/JSON, and reusable .pine-theme.json presets.

import { THEMES, UI_STYLES, getThemeById, getUiStyleById, normalizeThemeId, normalizeUiStyleId } from './themes.js';
import {
  CSS_SNIPPETS,
  BORDER_PRESETS,
  TEXT_GRADIENT_PRESETS,
  createEmptyCustomTheme,
  hexToRgba,
  compileCustomThemeCss,
} from './theme-studio-core.js';

export {
  CSS_SNIPPETS,
  BORDER_PRESETS,
  TEXT_GRADIENT_PRESETS,
  createEmptyCustomTheme,
  hexToRgba,
  compileCustomThemeCss,
};

const STUDIO_PAGES = Object.freeze([
  { id: 'home', label: 'Home' },
  { id: 'discover', label: 'Discover' },
  { id: 'library', label: 'Library' },
  { id: 'instance', label: 'Instance' },
  { id: 'stats', label: 'Stats' },
  { id: 'settings', label: 'Settings' },
  { id: 'skins', label: 'Skins & Capes' },
]);

function parseIntSafe(value, fallback) {
  if (value === '' || value == null) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? String(value).toLowerCase() : fallback;
}

export function computeElementSelector(el, mode = 'specific') {
  if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) {
    return 'body';
  }
  if (mode === 'class') {
    const meaningful = [...el.classList].filter(
      cls => !['active', 'selected', 'visible', 'open', 'hidden', 'is-scrolling', 'theme-studio-hover', 'theme-studio-selected'].includes(cls),
    );
    if (meaningful.length > 0) {
      return `.${CSS.escape(meaningful[0])}`;
    }
  }
  if (el.id && !el.id.startsWith('theme-studio')) {
    return `#${CSS.escape(el.id)}`;
  }
  if (el.dataset?.view && el.classList.contains('tabbar-item')) {
    return `.tabbar-item[data-view="${CSS.escape(el.dataset.view)}"]`;
  }
  if (el.dataset?.cat && el.closest('.settings-nav')) {
    return `.settings-nav button[data-cat="${CSS.escape(el.dataset.cat)}"]`;
  }
  if (el.dataset?.cat && el.classList.contains('settings-pane')) {
    return `.settings-pane[data-cat="${CSS.escape(el.dataset.cat)}"]`;
  }

  const parts = [];
  let current = el;
  let depth = 0;
  while (current && current.nodeType === 1 && current !== document.body && depth < 5) {
    if (current.id && !current.id.startsWith('theme-studio')) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    let part = current.tagName.toLowerCase();
    const classes = [...current.classList]
      .filter(cls => !['active', 'selected', 'visible', 'open', 'hidden', 'is-scrolling', 'theme-studio-hover', 'theme-studio-selected'].includes(cls))
      .slice(0, 2);
    if (classes.length) {
      part += classes.map(c => `.${CSS.escape(c)}`).join('');
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(child => child.tagName === current.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    current = parent;
    depth += 1;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

export function describeElementLabel(el) {
  if (!el || el.nodeType !== 1) return 'Element';
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = [...el.classList].filter(c => !c.startsWith('theme-studio'))[0];
  if (cls) return `${tag}.${cls}`;
  return tag;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Compress uploaded image files into a data URL safely below Pine's 2 MB settings cap.
 */
function compressImageFileToDataUrl(file, maxEdge = 1920, maxChars = 1_500_000) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      if (!rawUrl) return reject(new Error('Image file was empty'));
      if (rawUrl.length <= maxChars || file.type === 'image/gif') {
        if (rawUrl.length > 1_950_000) {
          return reject(new Error('Image is larger than 1.5 MB. Please use a smaller file or paste an image URL.'));
        }
        return resolve(rawUrl);
      }
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image format'));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.height || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(rawUrl.slice(0, maxChars));
        ctx.drawImage(img, 0, 0, width, height);
        for (const quality of [0.85, 0.72, 0.58]) {
          const encoded = canvas.toDataURL('image/webp', quality);
          if (encoded.length <= maxChars) return resolve(encoded);
        }
        const fallback = canvas.toDataURL('image/jpeg', 0.65);
        if (fallback.length <= 1_950_000) return resolve(fallback);
        reject(new Error('Image is still too large after compression. Choose a smaller wallpaper.'));
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Find the safest text node to edit inside an element without destroying child SVG icons.
 */
function findEditableTextNode(el) {
  if (!el) return null;
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
      return node;
    }
  }
  if (el.children.length === 0) return el;
  const textSpan = [...el.children].find(c => ['SPAN', 'B', 'STRONG', 'SMALL'].includes(c.tagName) && c.children.length === 0 && !c.querySelector('svg'));
  return textSpan || null;
}

export function initThemeStudioController({
  getState,
  saveSettings,
  applyAppearance,
  switchView,
  toast,
  copyText,
}) {
  let studioOpen = false;
  let inspectMode = true;
  let activeTab = 'inspector';
  let targetScope = 'specific';
  let selectedElement = null;
  let selectedSelector = '';
  let draftTheme = createEmptyCustomTheme();
  let savedSnapshotJson = '';
  let undoStack = [];
  let redoStack = [];
  let dragState = null;
  let mutationObserver = null;
  let applyingTextOverrides = false;
  let showGridLines = false;
  let snapToGrid = true;
  let gridSize = 16;
  let copiedStyle = null;
  let marqueeState = null;
  let openGroups = new Set(['fill', 'typography']);

  function isDirty() {
    if (!studioOpen) return false;
    return JSON.stringify(draftTheme) !== savedSnapshotJson;
  }

  function refreshDirtyIndicator() {
    const dot = document.getElementById('ts-dirty-dot');
    if (dot) dot.hidden = !isDirty();
  }

  function getStyleTag() {
    let tag = document.getElementById('pine-custom-theme-style');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'pine-custom-theme-style';
      document.head.appendChild(tag);
    }
    return tag;
  }

  function restoreAllTextOverrides() {
    document.querySelectorAll('[data-pine-orig-text]').forEach(el => {
      if (el.dataset.pineOrigText != null) {
        const target = findEditableTextNode(el);
        if (target && target !== el) target.textContent = el.dataset.pineOrigText;
        else el.textContent = el.dataset.pineOrigText;
      }
      delete el.dataset.pineOrigText;
      delete el.dataset.pineTextSelector;
    });
  }

  function applyTextOverridesToDom(themeObj) {
    if (applyingTextOverrides) return;
    applyingTextOverrides = true;
    try {
      const overrides = themeObj?.textOverrides || {};
      document.querySelectorAll('[data-pine-orig-text]').forEach(el => {
        const sel = el.dataset.pineTextSelector;
        if (!sel || !overrides[sel]) {
          const target = findEditableTextNode(el);
          if (target && target !== el) target.textContent = el.dataset.pineOrigText;
          else el.textContent = el.dataset.pineOrigText;
          delete el.dataset.pineOrigText;
          delete el.dataset.pineTextSelector;
        }
      });
      for (const [selector, entry] of Object.entries(overrides)) {
        if (!selector || !entry) continue;
        let nodes = [];
        try { nodes = [...document.querySelectorAll(selector)]; } catch { continue; }
        for (const el of nodes) {
          if (el.closest('#theme-studio-dock') || el.closest('#theme-studio-fab')) continue;
          const target = findEditableTextNode(el);
          if (!target) {
            if (el.children.length > 0 && !entry.forceContainer) continue;
            if (el.dataset.pineOrigText == null) el.dataset.pineOrigText = el.textContent;
            el.dataset.pineTextSelector = selector;
            const desired = entry.deleted ? '' : String(entry.text ?? '');
            if (el.textContent !== desired) el.textContent = desired;
            continue;
          }
          if (el.dataset.pineOrigText == null) {
            el.dataset.pineOrigText = target.textContent;
          }
          el.dataset.pineTextSelector = selector;
          const desired = entry.deleted ? '' : String(entry.text ?? '');
          if (target.textContent !== desired) {
            target.textContent = desired;
          }
        }
      }
    } finally {
      applyingTextOverrides = false;
    }
  }

  function getGridSpeedNum() {
    const tok = draftTheme?.tokens?.['--grid-speed'];
    if (tok != null) {
      const parsed = Number.parseInt(tok, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    const s = getState()?.settings;
    if (s?.gridSpeed != null) {
      const parsed = Number.parseInt(s.gridSpeed, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 14;
  }

  function setGridSpeed(seconds, recordUndo = true) {
    const sec = Math.max(0, Math.min(60, Number(seconds) || 0));
    if (recordUndo) pushUndoSnapshot();
    draftTheme.tokens = draftTheme.tokens || {};
    draftTheme.tokens['--grid-speed'] = `${sec}s`;
    const s = getState()?.settings;
    if (s) s.gridSpeed = sec;
    if (sec === 0) {
      document.documentElement.style.setProperty('--grid-speed', '0s', 'important');
      document.documentElement.dataset.gridSpeed = '0';
    } else {
      document.documentElement.style.setProperty('--grid-speed', `${sec}s`, 'important');
      delete document.documentElement.dataset.gridSpeed;
    }
    syncLiveTheme();
  }

  function ensureMutationObserver() {
    if (mutationObserver) return;
    const appRoot = document.getElementById('app') || document.body;
    let timer = null;
    mutationObserver = new MutationObserver(() => {
      if (applyingTextOverrides) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const active = getEffectiveCustomTheme();
        if (active) applyTextOverridesToDom(active);
      }, 60);
    });
    mutationObserver.observe(appRoot, { childList: true, subtree: true });
  }

  function getEffectiveCustomTheme() {
    if (studioOpen && draftTheme) return draftTheme;
    const s = getState().settings || {};
    if (!s.activeCustomThemeId || !Array.isArray(s.customThemes)) return null;
    return s.customThemes.find(item => item.id === s.activeCustomThemeId) || null;
  }

  function syncLiveTheme() {
    ensureMutationObserver();
    const active = getEffectiveCustomTheme();
    const styleTag = getStyleTag();
    if (!active) {
      styleTag.textContent = '';
      delete document.documentElement.dataset.customTheme;
      restoreAllTextOverrides();
      refreshDirtyIndicator();
      return;
    }
    document.documentElement.dataset.customTheme = 'active';
    document.documentElement.dataset.theme = normalizeThemeId(active.baseTheme);
    document.documentElement.dataset.uiStyle = normalizeUiStyleId(active.baseUiStyle);
    styleTag.textContent = compileCustomThemeCss(active);
    applyTextOverridesToDom(active);
    updateSelectionOverlayPosition();
    refreshDirtyIndicator();
  }

  function pushUndoSnapshot() {
    undoStack.push(deepClone(draftTheme));
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
    const undoBtn = document.getElementById('ts-undo-btn');
    const redoBtn = document.getElementById('ts-redo-btn');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = true;
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(deepClone(draftTheme));
    draftTheme = undoStack.pop();
    syncLiveTheme();
    renderStudioPanel();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(deepClone(draftTheme));
    draftTheme = redoStack.pop();
    syncLiveTheme();
    renderStudioPanel();
  }

  function ensureStudioElements() {
    if (!document.getElementById('theme-studio-highlight')) {
      const hl = document.createElement('div');
      hl.id = 'theme-studio-highlight';
      hl.className = 'theme-studio-overlay-box is-hover';
      hl.hidden = true;
      hl.innerHTML = `<span class="theme-studio-overlay-tag" id="theme-studio-hover-tag"></span>`;
      document.body.appendChild(hl);
    }
    if (!document.getElementById('theme-studio-selection')) {
      const sel = document.createElement('div');
      sel.id = 'theme-studio-selection';
      sel.className = 'theme-studio-overlay-box is-selected';
      sel.hidden = true;
      sel.innerHTML = `
        <span class="theme-studio-overlay-tag" id="theme-studio-select-tag"></span>
        <div class="theme-studio-handle is-move" data-studio-handle="move" title="Drag to move">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
          </svg>
        </div>
        <div class="theme-studio-handle is-resize" data-studio-handle="resize" title="Drag to resize"></div>
      `;
      document.body.appendChild(sel);
      sel.querySelector('[data-studio-handle="move"]')?.addEventListener('pointerdown', startMoveDrag);
      sel.querySelector('[data-studio-handle="resize"]')?.addEventListener('pointerdown', startResizeDrag);
    }
    if (!document.getElementById('theme-studio-grid')) {
      const grid = document.createElement('div');
      grid.id = 'theme-studio-grid';
      grid.className = 'theme-studio-grid';
      grid.hidden = true;
      document.body.appendChild(grid);
    }
    if (!document.getElementById('theme-studio-marquee')) {
      const mq = document.createElement('div');
      mq.id = 'theme-studio-marquee';
      mq.className = 'theme-studio-marquee';
      mq.hidden = true;
      document.body.appendChild(mq);
    }
    if (!document.getElementById('theme-studio-dock')) {
      const dock = document.createElement('aside');
      dock.id = 'theme-studio-dock';
      dock.className = 'theme-studio-dock';
      dock.setAttribute('aria-label', 'Theme Studio');
      dock.hidden = true;
      document.body.appendChild(dock);
    }
  }

  function updateOverlayBox(boxEl, tagEl, targetEl, labelText) {
    if (!boxEl) return;
    if (!studioOpen || !targetEl || !targetEl.isConnected) {
      boxEl.hidden = true;
      return;
    }
    const rect = targetEl.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      boxEl.hidden = true;
      return;
    }
    boxEl.hidden = false;
    boxEl.style.top = `${Math.round(rect.top)}px`;
    boxEl.style.left = `${Math.round(rect.left)}px`;
    boxEl.style.width = `${Math.round(rect.width)}px`;
    boxEl.style.height = `${Math.round(rect.height)}px`;
    if (tagEl && labelText) tagEl.textContent = labelText;
  }

  function updateSelectionOverlayPosition() {
    const selBox = document.getElementById('theme-studio-selection');
    const selTag = document.getElementById('theme-studio-select-tag');
    if (!studioOpen || !selectedElement || !selectedElement.isConnected) {
      if (selBox) selBox.hidden = true;
      return;
    }
    updateOverlayBox(selBox, selTag, selectedElement, describeElementLabel(selectedElement));
  }

  function startMoveDrag(event) {
    if (!selectedElement || !selectedSelector) return;
    event.preventDefault();
    event.stopPropagation();
    pushUndoSnapshot();
    const rule = draftTheme.elementRules[selectedSelector] || {};
    dragState = {
      type: 'move',
      startX: event.clientX,
      startY: event.clientY,
      baseX: Number(rule.x) || 0,
      baseY: Number(rule.y) || 0,
    };
    window.addEventListener('pointermove', onPointerDragMove);
    window.addEventListener('pointerup', onPointerDragEnd, { once: true });
  }

  function startResizeDrag(event) {
    if (!selectedElement || !selectedSelector) return;
    event.preventDefault();
    event.stopPropagation();
    pushUndoSnapshot();
    const rect = selectedElement.getBoundingClientRect();
    dragState = {
      type: 'resize',
      startX: event.clientX,
      startY: event.clientY,
      baseW: Math.round(rect.width),
      baseH: Math.round(rect.height),
    };
    window.addEventListener('pointermove', onPointerDragMove);
    window.addEventListener('pointerup', onPointerDragEnd, { once: true });
  }

  function onPointerDragMove(event) {
    if (!dragState || !selectedSelector) return;
    const dx = Math.round(event.clientX - dragState.startX);
    const dy = Math.round(event.clientY - dragState.startY);
    const existing = draftTheme.elementRules[selectedSelector] || { label: describeElementLabel(selectedElement) };
    if (dragState.type === 'move') {
      let curX = dragState.baseX + dx;
      let curY = dragState.baseY + dy;
      if (snapToGrid) {
        curX = Math.round(curX / gridSize) * gridSize;
        curY = Math.round(curY / gridSize) * gridSize;
      }
      existing.x = curX;
      existing.y = curY;
      const selTag = document.getElementById('theme-studio-select-tag');
      if (selTag) selTag.textContent = `${curX}, ${curY} px`;
    } else if (dragState.type === 'resize') {
      let curW = Math.max(24, dragState.baseW + dx);
      let curH = Math.max(18, dragState.baseH + dy);
      if (snapToGrid) {
        curW = Math.max(gridSize, Math.round(curW / gridSize) * gridSize);
        curH = Math.max(gridSize, Math.round(curH / gridSize) * gridSize);
      }
      existing.width = `${curW}px`;
      existing.height = `${curH}px`;
      const selTag = document.getElementById('theme-studio-select-tag');
      if (selTag) selTag.textContent = `${curW} × ${curH}`;
    }
    draftTheme.elementRules[selectedSelector] = existing;
    syncLiveTheme();
  }

  function onPointerDragEnd() {
    window.removeEventListener('pointermove', onPointerDragMove);
    dragState = null;
    updateSelectionOverlayPosition();
    renderStudioPanel();
  }

  function isStudioInternalNode(node) {
    if (!node || node.nodeType !== 1) return true;
    return Boolean(
      node.closest('#theme-studio-dock') ||
      node.closest('#theme-studio-highlight') ||
      node.closest('#theme-studio-selection') ||
      node.closest('#theme-studio-grid') ||
      node.closest('#theme-studio-marquee') ||
      node.closest('.window-controls'),
    );
  }

  function onCanvasPointerDown(event) {
    if (!studioOpen || !inspectMode || dragState || event.button !== 0) return;
    const target = event.target;
    if (!target || isStudioInternalNode(target)) return;
    if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(target.tagName)) return;

    marqueeState = {
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      marqueeEl: document.getElementById('theme-studio-marquee'),
    };
    window.addEventListener('pointermove', onMarqueePointerMove);
    window.addEventListener('pointerup', onMarqueePointerUp, { once: true });
  }

  function onMarqueePointerMove(event) {
    if (!marqueeState) return;
    const dx = event.clientX - marqueeState.startX;
    const dy = event.clientY - marqueeState.startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      marqueeState.moved = true;
      const el = marqueeState.marqueeEl;
      if (el) {
        el.hidden = false;
        el.style.left = `${Math.min(event.clientX, marqueeState.startX)}px`;
        el.style.top = `${Math.min(event.clientY, marqueeState.startY)}px`;
        el.style.width = `${Math.abs(dx)}px`;
        el.style.height = `${Math.abs(dy)}px`;
      }
    }
  }

  function onMarqueePointerUp(event) {
    window.removeEventListener('pointermove', onMarqueePointerMove);
    if (!marqueeState) return;
    const { startX, startY, moved, marqueeEl } = marqueeState;
    marqueeState = null;
    if (marqueeEl) marqueeEl.hidden = true;
    if (!moved) return;

    const left = Math.min(event.clientX, startX);
    const top = Math.min(event.clientY, startY);
    const width = Math.abs(event.clientX - startX);
    const height = Math.abs(event.clientY - startY);
    if (width < 12 && height < 12) return;

    const rect = { left, top, right: left + width, bottom: top + height };
    const matched = [];
    for (const el of document.querySelectorAll('#content *')) {
      if (isStudioInternalNode(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      if (!(b.right < rect.left || b.left > rect.right || b.bottom < rect.top || b.top > rect.bottom)) {
        matched.push(el);
      }
    }
    if (matched.length > 0) {
      selectElementForInspection(matched[0]);
    } else {
      const container = document.elementFromPoint(startX, startY);
      if (container && !isStudioInternalNode(container)) selectElementForInspection(container);
    }
  }

  function onGlobalPointerMove(event) {
    if (!studioOpen || !inspectMode || dragState || marqueeState) return;
    const target = event.target;
    const hlBox = document.getElementById('theme-studio-highlight');
    const hlTag = document.getElementById('theme-studio-hover-tag');
    if (!target || target.nodeType !== 1 || isStudioInternalNode(target)) {
      if (hlBox) hlBox.hidden = true;
      return;
    }
    updateOverlayBox(hlBox, hlTag, target, describeElementLabel(target));
  }

  function onGlobalClickCapture(event) {
    if (!studioOpen || !inspectMode) return;
    const target = event.target;
    if (!target || target.nodeType !== 1 || isStudioInternalNode(target)) return;
    event.preventDefault();
    event.stopPropagation();
    selectElementForInspection(target);
  }

  function copySelectedStyle() {
    if (!selectedElement || !selectedSelector) return;
    const rule = draftTheme.elementRules[selectedSelector];
    if (!rule || Object.keys(rule).length === 0) {
      toast?.('No style overrides on this element', 'info');
      return;
    }
    copiedStyle = deepClone(rule);
    toast?.(`Copied style from ${describeElementLabel(selectedElement)}`, 'info');
    renderStudioPanel();
  }

  function pasteCopiedStyle() {
    if (!selectedElement || !selectedSelector || !copiedStyle) return;
    pushUndoSnapshot();
    const existing = draftTheme.elementRules[selectedSelector] || {};
    draftTheme.elementRules[selectedSelector] = {
      ...existing,
      ...deepClone(copiedStyle),
      label: describeElementLabel(selectedElement),
    };
    syncLiveTheme();
    renderStudioPanel();
    toast?.(`Pasted style onto ${describeElementLabel(selectedElement)}`, 'success');
  }

  function onGlobalKeyDown(event) {
    if (!studioOpen) return;
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '');
    if (event.key === 'Escape' && !inInput) {
      event.preventDefault();
      if (selectedElement) {
        selectedElement = null;
        selectedSelector = '';
        updateSelectionOverlayPosition();
        renderStudioPanel();
      } else {
        requestCloseStudio();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !inInput) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !inInput) {
      event.preventDefault();
      redo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && !inInput && selectedSelector) {
      event.preventDefault();
      copySelectedStyle();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !inInput && selectedSelector) {
      event.preventDefault();
      pasteCopiedStyle();
      return;
    }
    if (event.key === 'Delete' && !inInput && selectedElement && selectedSelector) {
      event.preventDefault();
      pushUndoSnapshot();
      const rule = draftTheme.elementRules[selectedSelector] || { label: describeElementLabel(selectedElement) };
      rule.display = rule.display === 'none' ? '' : 'none';
      draftTheme.elementRules[selectedSelector] = rule;
      syncLiveTheme();
      renderStudioPanel();
    }
  }

  function selectElementForInspection(el) {
    if (!el || el.nodeType !== 1) return;
    selectedElement = el;
    selectedSelector = computeElementSelector(el, targetScope);
    activeTab = 'inspector';
    updateSelectionOverlayPosition();
    renderStudioPanel();
  }

  function getDirectTextContent(el) {
    if (!el) return '';
    if (el.dataset?.pineOrigText != null && draftTheme.textOverrides[selectedSelector]) {
      const ov = draftTheme.textOverrides[selectedSelector];
      return ov.deleted ? '' : String(ov.text ?? '');
    }
    const node = findEditableTextNode(el);
    return (node ? node.textContent : el.textContent || '').trim();
  }

  function updateElementRuleField(field, value, { recordUndo = true } = {}) {
    if (!selectedSelector) return;
    if (recordUndo) pushUndoSnapshot();
    const current = draftTheme.elementRules[selectedSelector] || {
      label: describeElementLabel(selectedElement),
    };
    if (value === '' || value == null || value === false) {
      delete current[field];
    } else {
      current[field] = value;
    }
    const keys = Object.keys(current).filter(k => k !== 'label');
    if (keys.length === 0) {
      delete draftTheme.elementRules[selectedSelector];
    } else {
      draftTheme.elementRules[selectedSelector] = current;
    }
    syncLiveTheme();
  }

  function openStudio(themeToEdit = null) {
    ensureStudioElements();
    const s = getState().settings || {};
    if (themeToEdit) {
      draftTheme = createEmptyCustomTheme(deepClone(themeToEdit));
    } else {
      const existingActive = Array.isArray(s.customThemes)
        ? s.customThemes.find(t => t.id === s.activeCustomThemeId)
        : null;
      if (existingActive) {
        draftTheme = createEmptyCustomTheme(deepClone(existingActive));
      } else {
        draftTheme = createEmptyCustomTheme({
          baseTheme: s.theme || 'pine-dark',
          baseUiStyle: s.uiStyle || 'pine-island',
          tokens: {
            '--accent': s.accentColor || getThemeById(s.theme).accent,
          },
        });
      }
    }
    savedSnapshotJson = JSON.stringify(draftTheme);
    undoStack = [];
    redoStack = [];
    studioOpen = true;
    document.documentElement.classList.add('theme-studio-open');
    const dock = document.getElementById('theme-studio-dock');
    if (dock) dock.hidden = false;
    syncLiveTheme();
    renderStudioPanel();
  }

  function closeStudio() {
    studioOpen = false;
    selectedElement = null;
    selectedSelector = '';
    document.documentElement.classList.remove('theme-studio-open');
    ['theme-studio-dock', 'theme-studio-highlight', 'theme-studio-selection', 'theme-studio-grid', 'theme-studio-marquee'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    syncLiveTheme();
    applyAppearance?.();
  }

  function requestCloseStudio() {
    if (!isDirty()) {
      closeStudio();
      return;
    }
    const existing = document.getElementById('ts-close-confirm');
    if (existing) {
      existing.hidden = false;
      return;
    }
    renderStudioPanel(true);
  }

  async function saveCurrentPreset() {
    const s = getState().settings || {};
    const list = Array.isArray(s.customThemes) ? [...s.customThemes] : [];
    draftTheme.name = String(draftTheme.name || 'Untitled Theme').trim() || 'Untitled Theme';
    draftTheme.updatedAt = Date.now();
    const existingIdx = list.findIndex(item => item.id === draftTheme.id);
    const savedCopy = deepClone(draftTheme);
    if (existingIdx >= 0) list[existingIdx] = savedCopy;
    else list.unshift(savedCopy);
    s.customThemes = list;
    s.activeCustomThemeId = savedCopy.id;
    s.theme = normalizeThemeId(savedCopy.baseTheme);
    s.uiStyle = normalizeUiStyleId(savedCopy.baseUiStyle);
    if (savedCopy.tokens?.['--accent']) {
      s.accentColor = savedCopy.tokens['--accent'];
    }
    await saveSettings();
    savedSnapshotJson = JSON.stringify(draftTheme);
    syncLiveTheme();
    renderStudioPanel();
    toast?.(`Saved "${savedCopy.name}"`, 'success');
  }

  function exportThemeJson(themeObj = draftTheme) {
    const payload = JSON.stringify(themeObj, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeFile = String(themeObj.name || 'pine-theme')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pine-theme';
    a.href = url;
    a.download = `${safeFile}.pine-theme.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast?.(`Exported ${safeFile}.pine-theme.json`, 'success');
  }

  async function importThemeFromJsonString(jsonText) {
    let parsed;
    try { parsed = JSON.parse(jsonText); } catch {
      toast?.('Invalid theme JSON file', 'error');
      return null;
    }
    if (!parsed || typeof parsed !== 'object') {
      toast?.('Theme JSON must be an object', 'error');
      return null;
    }
    const imported = createEmptyCustomTheme({
      ...parsed,
      id: `custom-${Date.now().toString(36)}`,
      name: parsed.name ? String(parsed.name) : 'Imported Theme',
      updatedAt: Date.now(),
    });
    const s = getState().settings || {};
    const list = Array.isArray(s.customThemes) ? [...s.customThemes] : [];
    list.unshift(deepClone(imported));
    s.customThemes = list;
    s.activeCustomThemeId = imported.id;
    s.theme = normalizeThemeId(imported.baseTheme);
    s.uiStyle = normalizeUiStyleId(imported.baseUiStyle);
    draftTheme = imported;
    savedSnapshotJson = JSON.stringify(draftTheme);
    await saveSettings();
    syncLiveTheme();
    if (studioOpen) renderStudioPanel();
    toast?.(`Imported "${imported.name}"`, 'success');
    return imported;
  }

  function triggerImportFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      await importThemeFromJsonString(await file.text());
    });
    input.click();
  }

  function renderColorControl(label, attrs, value) {
    const hex = safeHex(value, '#161622');
    return `
      <label class="ts-field">
        <span class="ts-field-head"><span>${esc(label)}</span><code class="ts-val" data-hex-out>${hex.toUpperCase()}</code></span>
        <span class="ts-color-chip">
          <span class="ts-color-dot" style="background:${hex}"></span>
          <input type="color" class="ts-color-native" value="${hex}" ${attrs}>
          <span class="ts-color-hex">${hex.toUpperCase()}</span>
        </span>
      </label>
    `;
  }

  function renderRangeControl(label, attrs, min, max, step, value, unit = '') {
    return `
      <label class="ts-field">
        <span class="ts-field-head"><span>${esc(label)}</span><span class="ts-val" data-unit="${esc(unit)}">${esc(value)}${esc(unit)}</span></span>
        <input type="range" class="ts-range" min="${min}" max="${max}" step="${step}" value="${value}" ${attrs}>
      </label>
    `;
  }

  function groupMarkup(id, title, bodyHtml) {
    const isOpen = openGroups.has(id);
    return `
      <details class="ts-group" data-ts-group="${esc(id)}"${isOpen ? ' open' : ''}>
        <summary class="ts-group-head">
          <span>${esc(title)}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="ts-group-body">${bodyHtml}</div>
      </details>
    `;
  }

  function renderInspectorTab() {
    const rule = (selectedSelector && draftTheme.elementRules[selectedSelector]) || {};
    const textOv = (selectedSelector && draftTheme.textOverrides[selectedSelector]) || null;
    const ruleEntries = Object.entries(draftTheme.elementRules || {});
    const textEntries = Object.entries(draftTheme.textOverrides || {});

    if (!selectedElement || !selectedSelector) {
      return `
        <div class="ts-empty">
          <div class="ts-empty-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/></svg>
          </div>
          <strong>Select an element</strong>
          <p>Click any component in the launcher to edit its surface, border, spacing, typography, or text.</p>
        </div>
        ${renderModifiedElementsList(ruleEntries, textEntries)}
      `;
    }

    const currentText = getDirectTextContent(selectedElement);
    const radiusNum = parseIntSafe(rule.borderRadius, 14);
    const blurNum = parseIntSafe(rule.backdropBlur, 20);
    const opacityNum = parseIntSafe(rule.opacity, 100);
    const bgOpacityNum = parseIntSafe(rule.bgOpacity, 100);
    const borderWidthNum = parseIntSafe(rule.borderWidth, 0);

    return `
      <div class="ts-target">
        <div class="ts-target-top">
          <span class="ts-target-chip" title="${esc(selectedSelector)}">${esc(describeElementLabel(selectedElement))}</span>
          <div class="ts-seg ts-seg-sm">
            <button type="button" class="${targetScope === 'specific' ? 'active' : ''}" data-ts-scope="specific">Single</button>
            <button type="button" class="${targetScope === 'class' ? 'active' : ''}" data-ts-scope="class">Class</button>
          </div>
        </div>
        <code class="ts-selector">${esc(selectedSelector)}</code>
        <div class="ts-action-bar">
          <button type="button" class="ts-chip-btn" id="ts-select-parent" title="Select parent">Parent</button>
          <button type="button" class="ts-chip-btn" id="ts-select-child" title="Select first child">Child</button>
          <button type="button" class="ts-chip-btn" id="ts-copy-style" title="Copy style (Ctrl+C)">Copy</button>
          <button type="button" class="ts-chip-btn" id="ts-paste-style" ${copiedStyle ? '' : 'disabled'} title="Paste style (Ctrl+V)">Paste</button>
          <button type="button" class="ts-chip-btn" id="ts-toggle-hide">${rule.display === 'none' || rule.hidden ? 'Show' : 'Hide'}</button>
          <button type="button" class="ts-chip-btn is-danger" id="ts-reset-element">Reset</button>
        </div>
      </div>

      ${groupMarkup('fill', 'Fill & Glass', `
        <div class="ts-grid-2">
          ${renderColorControl('Surface', 'data-rule-field="bgColor"', rule.bgColor || '#161622')}
          ${renderRangeControl('Surface Alpha', 'data-rule-field="bgOpacity"', 0, 100, 1, bgOpacityNum, '%')}
          ${renderRangeControl('Opacity', 'data-rule-field="opacity"', 0, 100, 1, opacityNum, '%')}
          ${renderRangeControl('Backdrop Blur', 'data-rule-field="backdropBlur"', 0, 80, 1, blurNum, 'px')}
        </div>
      `)}

      ${groupMarkup('border', 'Border & Shadow', `
        <div class="ts-grid-2">
          ${renderRangeControl('Radius', 'data-rule-field="borderRadius"', 0, 64, 1, radiusNum, 'px')}
          ${renderRangeControl('Width', 'data-rule-field="borderWidth"', 0, 10, 1, borderWidthNum, 'px')}
          ${renderColorControl('Color', 'data-rule-field="borderColor"', rule.borderColor || '#ffffff')}
          <label class="ts-field">
            <span class="ts-field-head"><span>Shadow</span></span>
            <input type="text" class="input ts-input" value="${esc(rule.boxShadow || '')}" placeholder="0 8px 24px #0006" data-rule-field="boxShadow">
          </label>
        </div>
        <div class="ts-preset-grid">
          ${BORDER_PRESETS.map(bp => `
            <button type="button" class="ts-chip-btn" data-border-preset="${esc(bp.id)}">${esc(bp.name)}</button>
          `).join('')}
        </div>
      `)}

      ${groupMarkup('typography', 'Typography', `
        <div class="ts-grid-2">
          ${renderColorControl('Color', 'data-rule-field="textColor"', rule.textColor || '#ffffff')}
          <label class="ts-field">
            <span class="ts-field-head"><span>Size</span></span>
            <input type="text" class="input ts-input" value="${esc(rule.fontSize || '')}" placeholder="14px" data-rule-field="fontSize">
          </label>
          <label class="ts-field">
            <span class="ts-field-head"><span>Weight</span></span>
            <select class="input ts-input" data-rule-field="fontWeight">
              <option value="">Default</option>
              <option value="400" ${rule.fontWeight === '400' ? 'selected' : ''}>Regular</option>
              <option value="600" ${rule.fontWeight === '600' ? 'selected' : ''}>SemiBold</option>
              <option value="700" ${rule.fontWeight === '700' ? 'selected' : ''}>Bold</option>
              <option value="800" ${rule.fontWeight === '800' ? 'selected' : ''}>ExtraBold</option>
            </select>
          </label>
          <label class="ts-field">
            <span class="ts-field-head"><span>Transform</span></span>
            <select class="input ts-input" data-rule-field="textTransform">
              <option value="">Default</option>
              <option value="uppercase" ${rule.textTransform === 'uppercase' ? 'selected' : ''}>Uppercase</option>
              <option value="lowercase" ${rule.textTransform === 'lowercase' ? 'selected' : ''}>Lowercase</option>
              <option value="capitalize" ${rule.textTransform === 'capitalize' ? 'selected' : ''}>Capitalize</option>
            </select>
          </label>
        </div>
        <div class="ts-subbox">
          <div class="ts-row-between">
            <span class="ts-sublabel">Gradient fill</span>
            <label class="snapshot-inline settings-toggle-inline" style="margin:0;">
              <input type="checkbox" id="ts-text-gradient-toggle" ${rule.textGradient ? 'checked' : ''}>
              <span class="check-visual"></span>
            </label>
          </div>
          ${rule.textGradient ? `
            <div class="ts-grid-2" style="margin-top:8px;">
              ${renderColorControl('Start', 'id="ts-text-grad-c1"', rule.textGradColor1 || '#38bdf8')}
              ${renderColorControl('End', 'id="ts-text-grad-c2"', rule.textGradColor2 || '#f472b6')}
            </div>
            <div style="margin-top:8px;">
              ${renderRangeControl('Angle', 'id="ts-text-grad-angle"', 0, 360, 5, parseIntSafe(rule.textGradAngle, 135), '°')}
            </div>
            <div class="ts-swatch-row">
              ${TEXT_GRADIENT_PRESETS.map(gp => `
                <button type="button" class="ts-grad-swatch" data-text-grad-preset="${esc(gp.id)}" style="background:linear-gradient(${gp.angle}deg,${gp.color1},${gp.color2})" title="${esc(gp.name)}"></button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `)}

      ${groupMarkup('position', 'Position & Transform', `
        <div class="ts-grid-2">
          ${renderRangeControl('X Offset', 'data-rule-field="x"', -600, 600, 1, parseIntSafe(rule.x, 0), 'px')}
          ${renderRangeControl('Y Offset', 'data-rule-field="y"', -600, 600, 1, parseIntSafe(rule.y, 0), 'px')}
          ${renderRangeControl('Scale', 'data-rule-field="scale"', 25, 220, 1, parseIntSafe(rule.scale, 100), '%')}
          ${renderRangeControl('Rotate', 'data-rule-field="rotate"', -180, 180, 1, parseIntSafe(rule.rotate, 0), '°')}
          <label class="ts-field">
            <span class="ts-field-head"><span>Order</span></span>
            <input type="number" min="-20" max="20" step="1" class="input ts-input" value="${rule.order ?? ''}" placeholder="0" data-rule-field="order">
          </label>
          <label class="ts-field">
            <span class="ts-field-head"><span>Z-Index</span></span>
            <input type="number" min="-10" max="999" step="1" class="input ts-input" value="${rule.zIndex ?? ''}" placeholder="auto" data-rule-field="zIndex">
          </label>
        </div>
      `)}

      ${groupMarkup('size', 'Size & Spacing', `
        <div class="ts-grid-2">
          <label class="ts-field">
            <span class="ts-field-head"><span>Width</span></span>
            <input type="text" class="input ts-input" value="${esc(rule.width || '')}" placeholder="auto" data-rule-field="width">
          </label>
          <label class="ts-field">
            <span class="ts-field-head"><span>Height</span></span>
            <input type="text" class="input ts-input" value="${esc(rule.height || '')}" placeholder="auto" data-rule-field="height">
          </label>
          <label class="ts-field">
            <span class="ts-field-head"><span>Padding</span></span>
            <input type="text" class="input ts-input" value="${esc(rule.padding || '')}" placeholder="12px 16px" data-rule-field="padding">
          </label>
          <label class="ts-field">
            <span class="ts-field-head"><span>Margin</span></span>
            <input type="text" class="input ts-input" value="${esc(rule.margin || '')}" placeholder="0px" data-rule-field="margin">
          </label>
        </div>
        <div class="ts-row-between" style="margin-top:8px;">
          <span class="ts-sublabel">Compact spacing</span>
          <label class="snapshot-inline settings-toggle-inline" style="margin:0;">
            <input type="checkbox" id="ts-compact-space-toggle" ${rule.compactSpace ? 'checked' : ''}>
            <span class="check-visual"></span>
          </label>
        </div>
      `)}

      ${groupMarkup('text', 'Text Content', `
        <input type="text" id="ts-element-text" class="input ts-input" value="${esc(currentText)}" placeholder="Element text…">
        <div class="ts-action-bar" style="margin-top:6px;">
          <button type="button" class="btn btn-secondary ts-btn-sm" id="ts-apply-text">Update</button>
          <button type="button" class="ts-chip-btn is-danger" id="ts-delete-text">Clear text</button>
          ${textOv ? `<button type="button" class="ts-chip-btn" id="ts-restore-text">Restore</button>` : ''}
        </div>
      `)}

      ${renderModifiedElementsList(ruleEntries, textEntries)}
    `;
  }

  function renderModifiedElementsList(ruleEntries, textEntries) {
    const total = ruleEntries.length + textEntries.length;
    if (!total) return '';
    return `
      <div class="ts-panel">
        <div class="ts-panel-label">Overrides (${total})</div>
        <div class="ts-list">
          ${ruleEntries.map(([sel, r]) => `
            <div class="ts-list-row">
              <button type="button" class="ts-list-main" data-jump-selector="${esc(sel)}">
                <code>${esc(sel)}</code>
                <small>${r.display === 'none' ? 'Hidden' : 'Style'}</small>
              </button>
              <button type="button" class="ts-icon-btn ts-icon-sm" data-remove-rule="${esc(sel)}" title="Remove override">×</button>
            </div>
          `).join('')}
          ${textEntries.map(([sel, t]) => `
            <div class="ts-list-row">
              <button type="button" class="ts-list-main" data-jump-selector="${esc(sel)}">
                <code>${esc(sel)}</code>
                <small>${t.deleted ? 'Text cleared' : `Text: "${esc(String(t.text).slice(0, 18))}"`}</small>
              </button>
              <button type="button" class="ts-icon-btn ts-icon-sm" data-remove-text="${esc(sel)}" title="Restore text">×</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderBaseAndBackgroundTab() {
    const bg = draftTheme.background || {};
    const tok = draftTheme.tokens || {};
    const mode = bg.mode || 'default';
    const cardBlur = parseIntSafe(tok['--glass-blur-raised'], 20);
    const dockBlur = parseIntSafe(tok['--glass-blur-modal'], 60);
    const radiusLg = parseIntSafe(tok['--r-lg'], 22);
    const maxW = parseIntSafe(tok['--content-max'], 1280);
    const speed = getGridSpeedNum();

    return `
      <div class="ts-panel">
        <div class="ts-panel-label">Base Preset</div>
        <div class="ts-grid-2">
          <label class="ts-field">
            <span class="ts-field-head"><span>Color Theme</span></span>
            <select class="input ts-input" id="ts-base-theme">
              ${THEMES.map(t => `<option value="${esc(t.id)}" ${t.id === draftTheme.baseTheme ? 'selected' : ''}>${esc(t.shortName)}</option>`).join('')}
            </select>
          </label>
          <label class="ts-field">
            <span class="ts-field-head"><span>Layout</span></span>
            <select class="input ts-input" id="ts-base-uistyle">
              ${UI_STYLES.map(u => `<option value="${esc(u.id)}" ${u.id === draftTheme.baseUiStyle ? 'selected' : ''}>${esc(u.shortName)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>

      <div class="ts-panel">
        <div class="ts-panel-label">Background</div>
        <label class="ts-field">
          <span class="ts-field-head"><span>Style</span></span>
          <select class="input ts-input" id="ts-bg-mode">
            <option value="default" ${mode === 'default' ? 'selected' : ''}>Theme Default</option>
            <option value="solid" ${mode === 'solid' ? 'selected' : ''}>Solid Color</option>
            <option value="gradient" ${mode === 'gradient' ? 'selected' : ''}>Linear Gradient</option>
            <option value="mesh" ${mode === 'mesh' ? 'selected' : ''}>Ambient Mesh</option>
            <option value="image" ${mode === 'image' ? 'selected' : ''}>Wallpaper Image</option>
            <option value="pattern" ${mode === 'pattern' ? 'selected' : ''}>Subtle Pattern</option>
          </select>
        </label>

        ${mode === 'default' ? `<p class="ts-note">Using the base theme's built-in canvas.</p>` : ''}

        ${mode === 'solid' ? `
          <div style="margin-top:8px;">
            ${renderColorControl('Canvas Color', 'id="ts-bg-c1"', bg.color1 || '#000000')}
          </div>
        ` : ''}

        ${mode === 'gradient' || mode === 'mesh' ? `
          <div class="ts-grid-3" style="margin-top:8px;">
            ${renderColorControl('Color 1', 'id="ts-bg-c1"', bg.color1 || '#090d16')}
            ${renderColorControl('Color 2', 'id="ts-bg-c2"', bg.color2 || '#1a103c')}
            ${renderColorControl('Color 3', 'id="ts-bg-c3"', bg.color3 || '#0f292e')}
          </div>
          ${mode === 'gradient' ? `<div style="margin-top:8px;">${renderRangeControl('Angle', 'id="ts-bg-angle"', 0, 360, 5, parseIntSafe(bg.angle, 135), '°')}</div>` : ''}
          <div class="ts-grid-2" style="margin-top:8px;">
            ${renderRangeControl('Blur', 'id="ts-bg-blur"', 0, 60, 1, parseIntSafe(bg.blur, 0), 'px')}
            ${renderRangeControl('Saturation', 'id="ts-bg-saturate"', 0, 240, 1, parseIntSafe(bg.saturate, 100), '%')}
            ${renderRangeControl('Brightness', 'id="ts-bg-brightness"', 20, 180, 1, parseIntSafe(bg.brightness, 100), '%')}
          </div>
        ` : ''}

        ${mode === 'image' ? `
          <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">
            <input type="text" class="input ts-input" id="ts-bg-image-url" value="${esc(bg.imageUrl || '')}" placeholder="Image URL or upload…">
            <div class="ts-action-bar">
              <button type="button" class="btn btn-secondary ts-btn-sm" id="ts-bg-upload-btn">Upload image</button>
              <select class="input ts-input" id="ts-bg-size" style="width:110px;">
                <option value="cover" ${bg.size === 'cover' ? 'selected' : ''}>Cover</option>
                <option value="contain" ${bg.size === 'contain' ? 'selected' : ''}>Contain</option>
                <option value="auto" ${bg.size === 'auto' ? 'selected' : ''}>Tile</option>
              </select>
            </div>
          </div>
          <div class="ts-grid-2" style="margin-top:8px;">
            ${renderRangeControl('Dim', 'id="ts-bg-dim"', 0, 95, 1, parseIntSafe(bg.dim, 35), '%')}
            ${renderRangeControl('Blur', 'id="ts-bg-blur"', 0, 60, 1, parseIntSafe(bg.blur, 0), 'px')}
            ${renderRangeControl('Saturation', 'id="ts-bg-saturate"', 0, 240, 1, parseIntSafe(bg.saturate, 100), '%')}
            ${renderRangeControl('Brightness', 'id="ts-bg-brightness"', 20, 180, 1, parseIntSafe(bg.brightness, 100), '%')}
          </div>
        ` : ''}

        ${mode === 'pattern' ? `
          <div class="ts-grid-2" style="margin-top:8px;">
            ${renderColorControl('Base', 'id="ts-bg-c1"', bg.color1 || '#080b11')}
            ${renderColorControl('Lines', 'id="ts-bg-c3"', bg.color3 || '#38bdf8')}
            <label class="ts-field">
              <span class="ts-field-head"><span>Pattern</span></span>
              <select class="input ts-input" id="ts-bg-pattern">
                <option value="grid" ${bg.pattern === 'grid' ? 'selected' : ''}>Grid</option>
                <option value="dots" ${bg.pattern === 'dots' ? 'selected' : ''}>Dots</option>
                <option value="scanlines" ${bg.pattern === 'scanlines' ? 'selected' : ''}>Scanlines</option>
              </select>
            </label>
            ${renderRangeControl('Opacity', 'id="ts-bg-pat-opacity"', 2, 60, 1, parseIntSafe(bg.patternOpacity, 12), '%')}
          </div>
        ` : ''}
      </div>

      <div class="ts-panel">
        <div class="ts-panel-label">Global Tokens</div>
        <div class="ts-grid-2">
          ${renderColorControl('Canvas', 'data-token="--bg-0"', tok['--bg-0'] || '#000000')}
          ${renderColorControl('Accent', 'data-token="--accent"', tok['--accent'] || '#ff5cb9')}
          ${renderColorControl('Accent 2', 'data-token="--accent-2"', tok['--accent-2'] || '#ff8bcb')}
          ${renderColorControl('Text', 'data-token="--text-hi"', tok['--text-hi'] || '#ffffff')}
          ${renderRangeControl('Card Blur', 'data-token-px="--glass-blur-raised"', 0, 80, 1, cardBlur, 'px')}
          ${renderRangeControl('Dock Blur', 'data-token-px="--glass-blur-modal"', 0, 100, 1, dockBlur, 'px')}
          ${renderRangeControl('Radius', 'data-token-px="--r-lg"', 0, 42, 1, radiusLg, 'px')}
          ${renderRangeControl('Max Width', 'data-token-px="--content-max"', 960, 1800, 20, maxW, 'px')}
        </div>
      </div>

      <div class="ts-panel">
        <div class="ts-panel-label">Horizon Grid Motion</div>
        <label class="ts-field">
          <span class="ts-field-head"><span>Cycle Speed</span><span class="ts-val" id="ts-grid-speed-val">${speed === 0 ? 'Off' : `${speed}s`}</span></span>
          <input type="range" class="ts-range" min="0" max="30" step="1" value="${speed}" id="ts-grid-speed-slider">
        </label>
        <div class="ts-action-bar" style="margin-top:6px;">
          <button type="button" class="ts-chip-btn ${speed === 0 ? 'active' : ''}" data-grid-speed-preset="0">Off</button>
          <button type="button" class="ts-chip-btn ${speed === 22 ? 'active' : ''}" data-grid-speed-preset="22">Crawl</button>
          <button type="button" class="ts-chip-btn ${speed === 14 ? 'active' : ''}" data-grid-speed-preset="14">Slow</button>
          <button type="button" class="ts-chip-btn ${speed === 8 ? 'active' : ''}" data-grid-speed-preset="8">Normal</button>
          <button type="button" class="ts-chip-btn ${speed === 3 ? 'active' : ''}" data-grid-speed-preset="3">Fast</button>
        </div>
      </div>
    `;
  }

  function renderCodeTab() {
    return `
      <div class="ts-panel">
        <div class="ts-panel-label">Snippets</div>
        <div class="ts-action-bar">
          ${CSS_SNIPPETS.map(snip => `<button type="button" class="ts-chip-btn" data-css-snippet="${esc(snip.id)}">+ ${esc(snip.name)}</button>`).join('')}
        </div>
      </div>

      <div class="ts-panel">
        <div class="ts-panel-label">Custom CSS</div>
        <textarea id="ts-custom-css" class="input ts-code-editor" rows="9" spellcheck="false" placeholder="/* Applied live */\n.topbar { ... }">${esc(draftTheme.customCss || '')}</textarea>
      </div>

      <div class="ts-panel">
        <div class="ts-panel-label">Theme JSON</div>
        <textarea id="ts-json-code" class="input ts-code-editor" rows="9" spellcheck="false">${esc(JSON.stringify(draftTheme, null, 2))}</textarea>
        <div class="ts-action-bar" style="margin-top:6px;">
          <button type="button" class="btn btn-primary ts-btn-sm" id="ts-apply-json">Apply JSON</button>
          <button type="button" class="btn btn-secondary ts-btn-sm" id="ts-copy-json">Copy</button>
        </div>
      </div>
    `;
  }

  function renderPresetsTab() {
    const s = getState().settings || {};
    const saved = Array.isArray(s.customThemes) ? s.customThemes : [];
    return `
      <div class="ts-panel">
        <div class="ts-panel-label">Details</div>
        <label class="ts-field">
          <span class="ts-field-head"><span>Name</span></span>
          <input type="text" id="ts-preset-name-input" class="input ts-input" value="${esc(draftTheme.name || '')}" placeholder="Theme name">
        </label>
        <label class="ts-field" style="margin-top:6px;">
          <span class="ts-field-head"><span>Note</span></span>
          <input type="text" id="ts-preset-desc-input" class="input ts-input" value="${esc(draftTheme.description || '')}" placeholder="Optional description">
        </label>
        <div class="ts-action-bar" style="margin-top:8px;">
          <button type="button" class="btn btn-primary ts-btn-sm" id="ts-save-preset-btn">Save</button>
          <button type="button" class="btn btn-secondary ts-btn-sm" id="ts-save-as-new-btn">Duplicate</button>
          <button type="button" class="ts-chip-btn" id="ts-export-file-btn">Export</button>
          <button type="button" class="ts-chip-btn" id="ts-import-file-btn">Import</button>
        </div>
      </div>

      <div class="ts-panel">
        <div class="ts-panel-label">Saved Presets (${saved.length})</div>
        ${saved.length === 0 ? `<p class="ts-note">No saved themes yet.</p>` : `
          <div class="ts-list">
            ${saved.map(item => {
              const isCurrent = s.activeCustomThemeId === item.id;
              const acc = safeHex(item.tokens?.['--accent'], getThemeById(item.baseTheme).accent);
              return `
                <div class="ts-list-row ${isCurrent ? 'is-active' : ''}">
                  <span class="ts-preset-dot" style="background:${acc}"></span>
                  <div class="ts-list-main">
                    <strong>${esc(item.name)}</strong>
                    <small>${esc(getThemeById(item.baseTheme).shortName)} · ${esc(getUiStyleById(item.baseUiStyle).shortName)}</small>
                  </div>
                  <div class="ts-row-actions">
                    <button type="button" class="ts-chip-btn ${isCurrent ? 'active' : ''}" data-preset-apply="${esc(item.id)}">${isCurrent ? 'Active' : 'Use'}</button>
                    <button type="button" class="ts-chip-btn" data-preset-load="${esc(item.id)}">Edit</button>
                    <button type="button" class="ts-icon-btn ts-icon-sm" data-preset-export="${esc(item.id)}" title="Export">↓</button>
                    <button type="button" class="ts-icon-btn ts-icon-sm is-danger" data-preset-delete="${esc(item.id)}" title="Delete">×</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  function renderStudioPanel(showClosePrompt = false) {
    const dock = document.getElementById('theme-studio-dock');
    if (!dock || !studioOpen) return;
    const currentView = getState()?.currentView || 'home';

    dock.innerHTML = `
      <div class="ts-header">
        <div class="ts-header-top">
          <div class="ts-title-wrap">
            <strong>Theme Studio</strong>
            <span class="ts-dirty-dot" id="ts-dirty-dot" title="Unsaved changes"${isDirty() ? '' : ' hidden'}></span>
          </div>
          <div class="ts-header-actions">
            <button type="button" class="ts-icon-btn" id="ts-undo-btn" title="Undo (Ctrl+Z)" ${undoStack.length ? '' : 'disabled'}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            </button>
            <button type="button" class="ts-icon-btn" id="ts-redo-btn" title="Redo (Ctrl+Y)" ${redoStack.length ? '' : 'disabled'}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
            </button>
            <button type="button" class="ts-icon-btn" id="ts-reset-all-btn" title="Reset draft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
            </button>
            <button type="button" class="ts-icon-btn" id="ts-close-btn" title="Close (Esc)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="ts-toolbar">
          <div class="ts-seg">
            <button type="button" class="${inspectMode ? 'active' : ''}" id="ts-mode-inspect">Inspect</button>
            <button type="button" class="${!inspectMode ? 'active' : ''}" id="ts-mode-navigate">Browse</button>
          </div>
          <select class="input ts-page-select" id="ts-page-select" aria-label="Jump to page">
            ${STUDIO_PAGES.map(p => `<option value="${p.id}" ${p.id === currentView ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
          <button type="button" class="ts-icon-btn ${showGridLines ? 'active' : ''}" id="ts-toggle-grid" title="Toggle alignment grid">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
          </button>
          <button type="button" class="ts-icon-btn ${snapToGrid ? 'active' : ''}" id="ts-toggle-snap" title="Snap to ${gridSize}px grid (click to toggle)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 15-3-3 6.7-6.7a4 4 0 0 1 5.6 0l2.4 2.4a4 4 0 0 1 0 5.6L11 20l-3-3"/><path d="m9 9 4 4"/></svg>
          </button>
        </div>

        <div class="ts-tabs" role="tablist">
          <button type="button" class="ts-tab ${activeTab === 'inspector' ? 'active' : ''}" data-ts-tab="inspector">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            <span>Inspect</span>
          </button>
          <button type="button" class="ts-tab ${activeTab === 'base' ? 'active' : ''}" data-ts-tab="base">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
            <span>Theme</span>
          </button>
          <button type="button" class="ts-tab ${activeTab === 'code' ? 'active' : ''}" data-ts-tab="code">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            <span>Code</span>
          </button>
          <button type="button" class="ts-tab ${activeTab === 'presets' ? 'active' : ''}" data-ts-tab="presets">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/></svg>
            <span>Presets</span>
          </button>
        </div>
      </div>

      ${showClosePrompt ? `
        <div class="ts-close-confirm" id="ts-close-confirm">
          <span>You have unsaved theme changes.</span>
          <div class="ts-action-bar">
            <button type="button" class="btn btn-primary ts-btn-sm" id="ts-confirm-save-close">Save &amp; Close</button>
            <button type="button" class="ts-chip-btn is-danger" id="ts-confirm-discard">Discard</button>
            <button type="button" class="ts-chip-btn" id="ts-confirm-cancel">Keep editing</button>
          </div>
        </div>
      ` : ''}

      <div class="ts-body">
        ${activeTab === 'inspector' ? renderInspectorTab() : ''}
        ${activeTab === 'base' ? renderBaseAndBackgroundTab() : ''}
        ${activeTab === 'code' ? renderCodeTab() : ''}
        ${activeTab === 'presets' ? renderPresetsTab() : ''}
      </div>

      <div class="ts-footer">
        <input type="text" id="ts-quick-name" class="input ts-input" value="${esc(draftTheme.name || '')}" placeholder="Theme name…">
        <button type="button" class="btn btn-primary ts-btn-sm" id="ts-quick-save">Save</button>
      </div>
    `;

    bindStudioPanelEvents(dock);
  }

  /**
   * Bind a continuous input (range or color) so undo records ONCE per gesture instead of every tick.
   */
  function bindContinuousControl(control, onLiveUpdate) {
    let gestureUndoPushed = false;
    const ensureGestureUndo = () => {
      if (!gestureUndoPushed) {
        gestureUndoPushed = true;
        pushUndoSnapshot();
      }
    };
    control.addEventListener('pointerdown', ensureGestureUndo);
    control.addEventListener('keydown', ensureGestureUndo);
    control.addEventListener('input', (e) => {
      ensureGestureUndo();
      onLiveUpdate(e.target.value, e);
      const field = control.closest('.ts-field');
      if (control.type === 'range') {
        const valEl = field?.querySelector('.ts-val');
        if (valEl) valEl.textContent = `${e.target.value}${valEl.dataset.unit || ''}`;
      } else if (control.type === 'color') {
        const hex = String(e.target.value || '').toUpperCase();
        const dot = field?.querySelector('.ts-color-dot');
        const hexLabel = field?.querySelector('.ts-color-hex');
        const valEl = field?.querySelector('[data-hex-out]');
        if (dot) dot.style.background = e.target.value;
        if (hexLabel) hexLabel.textContent = hex;
        if (valEl) valEl.textContent = hex;
      }
    });
    control.addEventListener('change', () => {
      gestureUndoPushed = false;
    });
  }

  function bindStudioPanelEvents(dock) {
    dock.querySelector('#ts-close-btn')?.addEventListener('click', requestCloseStudio);
    dock.querySelector('#ts-confirm-save-close')?.addEventListener('click', async () => {
      await saveCurrentPreset();
      closeStudio();
    });
    dock.querySelector('#ts-confirm-discard')?.addEventListener('click', closeStudio);
    dock.querySelector('#ts-confirm-cancel')?.addEventListener('click', () => renderStudioPanel(false));

    dock.querySelector('#ts-undo-btn')?.addEventListener('click', undo);
    dock.querySelector('#ts-redo-btn')?.addEventListener('click', redo);
    dock.querySelector('#ts-reset-all-btn')?.addEventListener('click', () => {
      pushUndoSnapshot();
      draftTheme = createEmptyCustomTheme({
        id: draftTheme.id,
        name: draftTheme.name,
        baseTheme: draftTheme.baseTheme,
        baseUiStyle: draftTheme.baseUiStyle,
      });
      syncLiveTheme();
      renderStudioPanel();
      toast?.('Draft reset', 'info');
    });

    dock.querySelector('#ts-toggle-grid')?.addEventListener('click', () => {
      showGridLines = !showGridLines;
      const gridEl = document.getElementById('theme-studio-grid');
      if (gridEl) {
        gridEl.hidden = !showGridLines;
        gridEl.style.backgroundSize = `${gridSize}px ${gridSize}px`;
      }
      renderStudioPanel();
    });
    dock.querySelector('#ts-toggle-snap')?.addEventListener('click', () => {
      snapToGrid = !snapToGrid;
      renderStudioPanel();
    });

    dock.querySelector('#ts-page-select')?.addEventListener('change', async (e) => {
      const viewId = e.target.value;
      if (viewId === 'skins') {
        let modal = document.querySelector('.modal.skin-studio');
        if (!modal) {
          await window.__pineOpenSkinStudio?.();
          await new Promise(r => setTimeout(r, 150));
          modal = document.querySelector('.modal.skin-studio');
        }
        if (modal) selectElementForInspection(modal);
      } else {
        switchView?.(viewId);
      }
      setTimeout(() => syncLiveTheme(), 50);
    });

    dock.querySelector('#ts-quick-name')?.addEventListener('input', e => {
      draftTheme.name = e.target.value;
      refreshDirtyIndicator();
    });
    dock.querySelector('#ts-quick-save')?.addEventListener('click', saveCurrentPreset);

    dock.querySelector('#ts-mode-inspect')?.addEventListener('click', () => {
      inspectMode = true;
      renderStudioPanel();
    });
    dock.querySelector('#ts-mode-navigate')?.addEventListener('click', () => {
      inspectMode = false;
      const hlBox = document.getElementById('theme-studio-highlight');
      if (hlBox) hlBox.hidden = true;
      renderStudioPanel();
    });

    dock.querySelectorAll('[data-ts-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tsTab;
        renderStudioPanel();
      });
    });

    dock.querySelectorAll('[data-ts-group]').forEach(details => {
      details.addEventListener('toggle', () => {
        const id = details.dataset.tsGroup;
        if (details.open) openGroups.add(id);
        else openGroups.delete(id);
      });
    });

    // Inspector tab bindings
    dock.querySelectorAll('[data-ts-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        targetScope = btn.dataset.tsScope;
        if (selectedElement) {
          selectedSelector = computeElementSelector(selectedElement, targetScope);
          updateSelectionOverlayPosition();
          renderStudioPanel();
        }
      });
    });

    dock.querySelector('#ts-select-parent')?.addEventListener('click', () => {
      if (selectedElement?.parentElement && selectedElement.parentElement !== document.body) {
        selectElementForInspection(selectedElement.parentElement);
      }
    });
    dock.querySelector('#ts-select-child')?.addEventListener('click', () => {
      const firstChild = [...(selectedElement?.children || [])].find(c => !isStudioInternalNode(c));
      if (firstChild) selectElementForInspection(firstChild);
    });
    dock.querySelector('#ts-toggle-hide')?.addEventListener('click', () => {
      if (!selectedSelector) return;
      const cur = draftTheme.elementRules[selectedSelector]?.display;
      updateElementRuleField('display', cur === 'none' ? '' : 'none');
      renderStudioPanel();
    });
    dock.querySelector('#ts-reset-element')?.addEventListener('click', () => {
      if (!selectedSelector) return;
      pushUndoSnapshot();
      delete draftTheme.elementRules[selectedSelector];
      delete draftTheme.textOverrides[selectedSelector];
      syncLiveTheme();
      renderStudioPanel();
    });
    dock.querySelector('#ts-copy-style')?.addEventListener('click', copySelectedStyle);
    dock.querySelector('#ts-paste-style')?.addEventListener('click', pasteCopiedStyle);

    dock.querySelector('#ts-compact-space-toggle')?.addEventListener('change', e => {
      updateElementRuleField('compactSpace', e.target.checked);
    });

    dock.querySelectorAll('[data-border-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = BORDER_PRESETS.find(p => p.id === btn.dataset.borderPreset);
        if (!preset || !selectedSelector) return;
        pushUndoSnapshot();
        const rule = draftTheme.elementRules[selectedSelector] || { label: describeElementLabel(selectedElement) };
        rule.borderWidth = preset.width;
        rule.borderStyle = preset.style;
        rule.borderColor = preset.color;
        rule.borderRadius = preset.radius;
        rule.boxShadow = preset.shadow;
        draftTheme.elementRules[selectedSelector] = rule;
        syncLiveTheme();
        renderStudioPanel();
      });
    });

    dock.querySelector('#ts-text-gradient-toggle')?.addEventListener('change', e => {
      pushUndoSnapshot();
      const checked = e.target.checked;
      const rule = draftTheme.elementRules[selectedSelector] || { label: describeElementLabel(selectedElement) };
      rule.textGradient = checked;
      if (checked) {
        rule.textGradColor1 = rule.textGradColor1 || '#38bdf8';
        rule.textGradColor2 = rule.textGradColor2 || '#f472b6';
        rule.textGradAngle = rule.textGradAngle ?? 135;
      }
      draftTheme.elementRules[selectedSelector] = rule;
      syncLiveTheme();
      renderStudioPanel();
    });
    const gradC1 = dock.querySelector('#ts-text-grad-c1');
    if (gradC1) bindContinuousControl(gradC1, val => updateElementRuleField('textGradColor1', val, { recordUndo: false }));
    const gradC2 = dock.querySelector('#ts-text-grad-c2');
    if (gradC2) bindContinuousControl(gradC2, val => updateElementRuleField('textGradColor2', val, { recordUndo: false }));
    const gradAngle = dock.querySelector('#ts-text-grad-angle');
    if (gradAngle) bindContinuousControl(gradAngle, val => updateElementRuleField('textGradAngle', Number(val) || 135, { recordUndo: false }));

    dock.querySelectorAll('[data-text-grad-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gp = TEXT_GRADIENT_PRESETS.find(p => p.id === btn.dataset.textGradPreset);
        if (!gp || !selectedSelector) return;
        pushUndoSnapshot();
        const rule = draftTheme.elementRules[selectedSelector] || { label: describeElementLabel(selectedElement) };
        rule.textGradient = true;
        rule.textGradColor1 = gp.color1;
        rule.textGradColor2 = gp.color2;
        rule.textGradAngle = gp.angle;
        draftTheme.elementRules[selectedSelector] = rule;
        syncLiveTheme();
        renderStudioPanel();
      });
    });

    dock.querySelector('#ts-apply-text')?.addEventListener('click', () => {
      if (!selectedSelector) return;
      const val = dock.querySelector('#ts-element-text')?.value ?? '';
      pushUndoSnapshot();
      draftTheme.textOverrides[selectedSelector] = {
        text: val,
        deleted: false,
        forceContainer: false,
        label: describeElementLabel(selectedElement),
      };
      syncLiveTheme();
      renderStudioPanel();
    });
    dock.querySelector('#ts-delete-text')?.addEventListener('click', () => {
      if (!selectedSelector) return;
      pushUndoSnapshot();
      draftTheme.textOverrides[selectedSelector] = {
        text: '',
        deleted: true,
        forceContainer: false,
        label: describeElementLabel(selectedElement),
      };
      syncLiveTheme();
      renderStudioPanel();
    });
    dock.querySelector('#ts-restore-text')?.addEventListener('click', () => {
      if (!selectedSelector) return;
      pushUndoSnapshot();
      delete draftTheme.textOverrides[selectedSelector];
      syncLiveTheme();
      renderStudioPanel();
    });

    dock.querySelectorAll('[data-rule-field]').forEach(control => {
      const field = control.dataset.ruleField;
      if (control.type === 'range' || control.type === 'color') {
        bindContinuousControl(control, val => updateElementRuleField(field, val, { recordUndo: false }));
      } else {
        const eventName = control.tagName === 'SELECT' ? 'change' : 'input';
        control.addEventListener(eventName, e => updateElementRuleField(field, e.target.value));
      }
    });

    dock.querySelectorAll('[data-jump-selector]').forEach(btn => {
      btn.addEventListener('click', () => {
        try {
          const el = document.querySelector(btn.dataset.jumpSelector);
          if (el) selectElementForInspection(el);
        } catch {}
      });
    });
    dock.querySelectorAll('[data-remove-rule]').forEach(btn => {
      btn.addEventListener('click', () => {
        pushUndoSnapshot();
        delete draftTheme.elementRules[btn.dataset.removeRule];
        syncLiveTheme();
        renderStudioPanel();
      });
    });
    dock.querySelectorAll('[data-remove-text]').forEach(btn => {
      btn.addEventListener('click', () => {
        pushUndoSnapshot();
        delete draftTheme.textOverrides[btn.dataset.removeText];
        syncLiveTheme();
        renderStudioPanel();
      });
    });

    // Theme & Background tab bindings
    dock.querySelector('#ts-base-theme')?.addEventListener('change', e => {
      pushUndoSnapshot();
      const preset = getThemeById(e.target.value);
      draftTheme.baseTheme = preset.id;
      draftTheme.tokens['--bg-0'] = preset.swatches[0];
      draftTheme.tokens['--accent'] = preset.accent;
      draftTheme.tokens['--accent-2'] = preset.accent2;
      syncLiveTheme();
      renderStudioPanel();
    });
    dock.querySelector('#ts-base-uistyle')?.addEventListener('change', e => {
      pushUndoSnapshot();
      draftTheme.baseUiStyle = getUiStyleById(e.target.value).id;
      syncLiveTheme();
      renderStudioPanel();
    });
    dock.querySelector('#ts-bg-mode')?.addEventListener('change', e => {
      pushUndoSnapshot();
      draftTheme.background.mode = e.target.value;
      syncLiveTheme();
      renderStudioPanel();
    });
    dock.querySelector('#ts-bg-image-url')?.addEventListener('input', e => {
      draftTheme.background.imageUrl = e.target.value;
      syncLiveTheme();
    });
    dock.querySelector('#ts-bg-size')?.addEventListener('change', e => {
      pushUndoSnapshot();
      draftTheme.background.size = e.target.value;
      syncLiveTheme();
    });
    dock.querySelector('#ts-bg-upload-btn')?.addEventListener('click', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await compressImageFileToDataUrl(file);
          pushUndoSnapshot();
          draftTheme.background.mode = 'image';
          draftTheme.background.imageUrl = dataUrl;
          syncLiveTheme();
          renderStudioPanel();
          toast?.('Wallpaper applied', 'success');
        } catch (err) {
          toast?.(err.message || 'Could not load image', 'error', 5000);
        }
      });
      fileInput.click();
    });
    dock.querySelector('#ts-bg-pattern')?.addEventListener('change', e => {
      pushUndoSnapshot();
      draftTheme.background.pattern = e.target.value;
      syncLiveTheme();
    });

    const patOpacity = dock.querySelector('#ts-bg-pat-opacity');
    if (patOpacity) bindContinuousControl(patOpacity, val => { draftTheme.background.patternOpacity = Number(val); syncLiveTheme(); });
    const bgAngle = dock.querySelector('#ts-bg-angle');
    if (bgAngle) bindContinuousControl(bgAngle, val => { draftTheme.background.angle = Number(val); syncLiveTheme(); });
    ['c1', 'c2', 'c3'].forEach((k, idx) => {
      const el = dock.querySelector(`#ts-bg-${k}`);
      if (el) bindContinuousControl(el, val => { draftTheme.background[`color${idx + 1}`] = val; syncLiveTheme(); });
    });
    ['blur', 'dim', 'saturate', 'brightness'].forEach(field => {
      const el = dock.querySelector(`#ts-bg-${field}`);
      if (el) bindContinuousControl(el, val => { draftTheme.background[field] = Number(val); syncLiveTheme(); });
    });
    dock.querySelectorAll('[data-token]').forEach(input => {
      bindContinuousControl(input, val => { draftTheme.tokens[input.dataset.token] = val; syncLiveTheme(); });
    });
    dock.querySelectorAll('[data-token-px]').forEach(input => {
      bindContinuousControl(input, val => { draftTheme.tokens[input.dataset.tokenPx] = `${val}px`; syncLiveTheme(); });
    });

    const speedSlider = dock.querySelector('#ts-grid-speed-slider');
    if (speedSlider) {
      bindContinuousControl(speedSlider, val => {
        const num = Number(val) || 0;
        setGridSpeed(num, false);
        const valEl = dock.querySelector('#ts-grid-speed-val');
        if (valEl) valEl.textContent = num === 0 ? 'Off' : `${num}s`;
      });
    }
    dock.querySelectorAll('[data-grid-speed-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        setGridSpeed(Number(btn.dataset.gridSpeedPreset) || 0);
        renderStudioPanel();
      });
    });

    // Code tab bindings
    dock.querySelectorAll('[data-css-snippet]').forEach(btn => {
      btn.addEventListener('click', () => {
        const snip = CSS_SNIPPETS.find(s => s.id === btn.dataset.cssSnippet);
        if (!snip) return;
        pushUndoSnapshot();
        draftTheme.customCss = `${draftTheme.customCss ? draftTheme.customCss + '\n' : ''}${snip.code}`;
        syncLiveTheme();
        renderStudioPanel();
      });
    });
    dock.querySelector('#ts-custom-css')?.addEventListener('input', e => {
      draftTheme.customCss = e.target.value;
      syncLiveTheme();
    });
    dock.querySelector('#ts-apply-json')?.addEventListener('click', () => {
      const raw = dock.querySelector('#ts-json-code')?.value || '';
      try {
        const parsed = JSON.parse(raw);
        pushUndoSnapshot();
        draftTheme = createEmptyCustomTheme({ ...parsed, id: draftTheme.id });
        syncLiveTheme();
        renderStudioPanel();
        toast?.('Applied JSON', 'success');
      } catch {
        toast?.('Invalid JSON syntax', 'error');
      }
    });
    dock.querySelector('#ts-copy-json')?.addEventListener('click', async () => {
      await copyText?.(JSON.stringify(draftTheme, null, 2));
      toast?.('Copied theme JSON', 'success');
    });

    // Presets tab bindings
    dock.querySelector('#ts-preset-name-input')?.addEventListener('input', e => {
      draftTheme.name = e.target.value;
      const bottomName = dock.querySelector('#ts-quick-name');
      if (bottomName) bottomName.value = e.target.value;
      refreshDirtyIndicator();
    });
    dock.querySelector('#ts-preset-desc-input')?.addEventListener('input', e => {
      draftTheme.description = e.target.value;
      refreshDirtyIndicator();
    });
    dock.querySelector('#ts-save-preset-btn')?.addEventListener('click', saveCurrentPreset);
    dock.querySelector('#ts-save-as-new-btn')?.addEventListener('click', async () => {
      draftTheme.id = `custom-${Date.now().toString(36)}`;
      draftTheme.name = `${draftTheme.name || 'Custom Theme'} Copy`;
      await saveCurrentPreset();
    });
    dock.querySelector('#ts-export-file-btn')?.addEventListener('click', () => exportThemeJson(draftTheme));
    dock.querySelector('#ts-import-file-btn')?.addEventListener('click', triggerImportFilePicker);

    dock.querySelectorAll('[data-preset-apply]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.presetApply;
        const s = getState().settings || {};
        const found = (s.customThemes || []).find(t => t.id === id);
        if (!found) return;
        s.activeCustomThemeId = found.id;
        s.theme = normalizeThemeId(found.baseTheme);
        s.uiStyle = normalizeUiStyleId(found.baseUiStyle);
        draftTheme = createEmptyCustomTheme(deepClone(found));
        savedSnapshotJson = JSON.stringify(draftTheme);
        await saveSettings();
        syncLiveTheme();
        renderStudioPanel();
      });
    });
    dock.querySelectorAll('[data-preset-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.presetLoad;
        const s = getState().settings || {};
        const found = (s.customThemes || []).find(t => t.id === id);
        if (!found) return;
        draftTheme = createEmptyCustomTheme(deepClone(found));
        savedSnapshotJson = JSON.stringify(draftTheme);
        activeTab = 'base';
        syncLiveTheme();
        renderStudioPanel();
      });
    });
    dock.querySelectorAll('[data-preset-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        const found = (getState().settings?.customThemes || []).find(t => t.id === btn.dataset.presetExport);
        if (found) exportThemeJson(found);
      });
    });
    dock.querySelectorAll('[data-preset-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.presetDelete;
        const s = getState().settings || {};
        s.customThemes = (s.customThemes || []).filter(t => t.id !== id);
        if (s.activeCustomThemeId === id) s.activeCustomThemeId = null;
        await saveSettings();
        syncLiveTheme();
        renderStudioPanel();
        toast?.('Deleted preset', 'info');
      });
    });
  }

  ensureStudioElements();
  window.addEventListener('pointerdown', onCanvasPointerDown, true);
  window.addEventListener('pointermove', onGlobalPointerMove, true);
  window.addEventListener('click', onGlobalClickCapture, true);
  window.addEventListener('keydown', onGlobalKeyDown, true);
  window.addEventListener('resize', updateSelectionOverlayPosition);
  document.getElementById('content')?.addEventListener('scroll', updateSelectionOverlayPosition, { passive: true });

  return {
    openStudio,
    closeStudio,
    syncLiveTheme,
    isOpen: () => studioOpen,
    getDraftTheme: () => draftTheme,
    exportThemeJson,
    importThemeFromJsonString,
    triggerImportFilePicker,
  };
}
