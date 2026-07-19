// ── Small DOM/formatting helpers ─────────────────────────────
// Used across the renderer. No framework, no deps.
// ─────────────────────────────────────────────────────────────

// Tween a number shown in `el` from `from` to `to` over `ms`.
// Uses requestAnimationFrame, ease-out-soft. Cleans up on completion.
export function tweenNumber(el, from, to, ms = 480) {
  if (!el) return () => {};
  const start = performance.now();
  const c1 = 0.16, c2 = 1, c3 = 0.3, c4 = 1; // cubic-bezier(0.16, 1, 0.3, 1)
  let raf = 0;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    const v = Math.round(from + (to - from) * eased);
    el.textContent = formatNum(v);
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function formatNum(n) {
  if (n == null || isNaN(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(sec) {
  if (sec == null || sec < 0) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

export function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, ms = 200) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Stagger entrance: set --i on each element so the CSS can use
// animation-delay: calc(var(--i, 0) * 30ms).
export function stagger(els, baseIndex = 0) {
  els.forEach((el, i) => el.style.setProperty('--i', i + baseIndex));
}

// One-shot scale pop on an element, e.g. for "✓ saved" feedback.
export function pulseOnce(el) {
  if (!el) return;
  el.style.animation = 'none';
  // force reflow
  void el.offsetWidth;
  el.style.animation = 'pop 360ms cubic-bezier(0.34, 1.56, 0.64, 1)';
}

// Brief 1-shot success ring around an element.
export function successRing(el) {
  if (!el) return;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = 'success-pulse 800ms ease-out';
}

// Show a one-line toast in the top-right.
export function toast(message, kind = 'info', ms = 2800) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' toast-' + kind : '');
  el.innerHTML = `<span class="toast-dot"></span><span>${escHtml(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('fadeout');
    setTimeout(() => el.remove(), 240);
  }, ms);
}
