// Pure Theme Studio presets, defaults, and CSS compiler (shared by renderer & Node tests).

import { getThemeById, normalizeThemeId, normalizeUiStyleId } from './themes.js';

export const CSS_SNIPPETS = Object.freeze([
  Object.freeze({
    id: 'crystal-glass',
    name: 'Crystal Glass',
    code: `/* Ultra-translucent glass surfaces */\n.instance-card, .settings-card, .hero-card, .mod-card, .world-card {\n  background: rgba(255, 255, 255, 0.03) !important;\n  backdrop-filter: blur(42px) saturate(200%) !important;\n  border: 1px solid rgba(255, 255, 255, 0.2) !important;\n  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.28) !important;\n}\n`,
  }),
  Object.freeze({
    id: 'neon-borders',
    name: 'Accent Rims',
    code: `/* Accent-tinted borders across cards and bars */\n.topbar, .tabbar, .instance-card, .settings-card, .hero-card {\n  border: 1px solid var(--accent) !important;\n  box-shadow: 0 0 18px var(--accent-dim), inset 0 0 12px var(--accent-dim) !important;\n}\n`,
  }),
  Object.freeze({
    id: 'hover-lift-3d',
    name: 'Card Hover Lift',
    code: `/* Subtle elevation lift on card hover */\n.instance-card, .mod-card, .world-card, .settings-card {\n  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease !important;\n}\n.instance-card:hover, .mod-card:hover, .world-card:hover {\n  transform: translateY(-4px) !important;\n  box-shadow: 0 20px 44px rgba(0, 0, 0, 0.55) !important;\n}\n`,
  }),
  Object.freeze({
    id: 'minimal-flat',
    name: 'Matte Flat',
    code: `/* Zero-blur matte surfaces */\n*, *::before, *::after {\n  backdrop-filter: none !important;\n  -webkit-backdrop-filter: none !important;\n}\n.topbar, .tabbar, .instance-card, .settings-card, .hero-card {\n  background: color-mix(in srgb, var(--bg-0) 88%, #ffffff) !important;\n}\n`,
  }),
  Object.freeze({
    id: 'gradient-headings',
    name: 'Gradient Titles',
    code: `/* Accent gradient fill on headings */\nh1, h2, .page-title, .settings-card-title, .brand-name {\n  background: var(--accent-grad) !important;\n  -webkit-background-clip: text !important;\n  background-clip: text !important;\n  -webkit-text-fill-color: transparent !important;\n}\n`,
  }),
  Object.freeze({
    id: 'cyberspace-grid',
    name: 'Cobalt Rims',
    code: `/* Crisp cobalt card borders and elevation */\n.instance-card, .settings-card, .hero-card, .mod-card, .world-card {\n  border: 1px solid rgba(59, 130, 246, 0.38) !important;\n  box-shadow: 0 14px 36px rgba(2, 6, 18, 0.7), inset 0 1px 0 rgba(147, 197, 253, 0.22) !important;\n}\n`,
  }),
]);

export const BORDER_PRESETS = Object.freeze([
  Object.freeze({
    id: 'glass-rim',
    name: 'Hairline',
    width: 1,
    style: 'solid',
    color: '#ffffff',
    radius: 14,
    shadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.12)',
  }),
  Object.freeze({
    id: 'neon-glow',
    name: 'Accent',
    width: 1,
    style: 'solid',
    color: '#00f0ff',
    radius: 12,
    shadow: '0 0 16px rgba(0, 240, 255, 0.32)',
  }),
  Object.freeze({
    id: 'cyber-double',
    name: 'Double',
    width: 3,
    style: 'double',
    color: '#ff5cb9',
    radius: 6,
    shadow: '0 0 10px rgba(255, 92, 185, 0.24)',
  }),
  Object.freeze({
    id: 'pill-outline',
    name: 'Pill',
    width: 1,
    style: 'solid',
    color: '#ffffff',
    radius: 9999,
    shadow: 'none',
  }),
  Object.freeze({
    id: 'dashed-bracket',
    name: 'Dashed',
    width: 1,
    style: 'dashed',
    color: '#60a5fa',
    radius: 8,
    shadow: 'none',
  }),
  Object.freeze({
    id: 'deep-frost',
    name: 'Elevated',
    width: 1,
    style: 'solid',
    color: '#ffffff',
    radius: 18,
    shadow: '0 14px 36px rgba(0, 0, 0, 0.45)',
  }),
  Object.freeze({
    id: 'amber-hazard',
    name: 'Amber',
    width: 2,
    style: 'solid',
    color: '#f59e0b',
    radius: 6,
    shadow: '0 0 14px rgba(245, 158, 11, 0.3)',
  }),
  Object.freeze({
    id: 'borderless',
    name: 'None',
    width: 0,
    style: 'none',
    color: '#000000',
    radius: 0,
    shadow: 'none',
  }),
]);

export const TEXT_GRADIENT_PRESETS = Object.freeze([
  Object.freeze({ id: 'neon-cyan-pink', name: 'Cyan Rose', color1: '#38bdf8', color2: '#f472b6', angle: 135 }),
  Object.freeze({ id: 'amber-crimson', name: 'Warm Sunset', color1: '#f59e0b', color2: '#ef4444', angle: 135 }),
  Object.freeze({ id: 'aurora-mint', name: 'Emerald', color1: '#10b981', color2: '#06b6d4', angle: 135 }),
  Object.freeze({ id: 'electric-violet', name: 'Indigo', color1: '#8b5cf6', color2: '#3b82f6', angle: 135 }),
  Object.freeze({ id: 'gold-coral', name: 'Gold', color1: '#fde047', color2: '#ea580c', angle: 135 }),
  Object.freeze({ id: 'frost-ice', name: 'Silver Ice', color1: '#ffffff', color2: '#38bdf8', angle: 135 }),
]);

export function createEmptyCustomTheme(overrides = {}) {
  const baseThemeId = normalizeThemeId(overrides.baseTheme || 'pine-dark');
  const baseUiStyleId = normalizeUiStyleId(overrides.baseUiStyle || 'pine-island');
  const preset = getThemeById(baseThemeId);
  return {
    id: overrides.id || `custom-${Date.now().toString(36)}`,
    name: overrides.name || 'Untitled Theme',
    description: overrides.description || '',
    baseTheme: baseThemeId,
    baseUiStyle: baseUiStyleId,
    updatedAt: overrides.updatedAt || Date.now(),
    tokens: {
      '--bg-0': preset.swatches[0] || '#000000',
      '--accent': preset.accent || '#ff5cb9',
      '--accent-2': preset.accent2 || '#ff8bcb',
      '--grid-speed': '14s',
      '--glass-blur-raised': '20px',
      '--glass-blur-modal': '60px',
      '--r-lg': '22px',
      '--content-max': '1280px',
      ...(overrides.tokens || {}),
    },
    background: {
      mode: 'default',
      color1: preset.swatches[0] || '#000000',
      color2: preset.swatches[1] || '#121218',
      color3: preset.accent || '#ff5cb9',
      angle: 135,
      imageUrl: '',
      blur: 0,
      dim: 35,
      saturate: 100,
      brightness: 100,
      size: 'cover',
      pattern: 'grid',
      patternOpacity: 12,
      ...(overrides.background || {}),
    },
    elementRules: { ...(overrides.elementRules || {}) },
    textOverrides: { ...(overrides.textOverrides || {}) },
    customCss: typeof overrides.customCss === 'string' ? overrides.customCss : '',
  };
}

export function hexToRgba(hex, alpha = 1) {
  const clean = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(255, 255, 255, ${alpha})`;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const clamped = Math.max(0, Math.min(1, Number(alpha)));
  return `rgba(${r}, ${g}, ${b}, ${Number(clamped.toFixed(3))})`;
}

export function compileCustomThemeCss(customTheme) {
  if (!customTheme || typeof customTheme !== 'object') return '';
  const lines = [];

  const tokens = customTheme.tokens || {};
  const tokenEntries = Object.entries(tokens).filter(([k, v]) => k.startsWith('--') && v !== '' && v != null);
  if (tokenEntries.length > 0) {
    lines.push('html[data-custom-theme="active"] {');
    for (const [k, v] of tokenEntries) {
      lines.push(`  ${k}: ${v} !important;`);
    }
    if (tokens['--accent'] && /^#[0-9a-f]{6}$/i.test(tokens['--accent'])) {
      const acc = tokens['--accent'];
      const acc2 = /^#[0-9a-f]{6}$/i.test(tokens['--accent-2'] || '') ? tokens['--accent-2'] : acc;
      lines.push(`  --accent-dim: ${hexToRgba(acc, 0.22)} !important;`);
      lines.push(`  --accent-glow: 0 0 24px ${hexToRgba(acc, 0.38)} !important;`);
      lines.push(`  --accent-grad: linear-gradient(135deg, ${acc} 0%, ${acc2} 100%) !important;`);
    }
    lines.push('}');
  }
  if (tokens['--grid-speed'] === '0s' || tokens['--grid-speed'] === '0') {
    lines.push('html[data-custom-theme="active"] #app::after { animation: none !important; }');
  }

  const bg = customTheme.background || {};
  if (bg.mode && bg.mode !== 'default') {
    const blurPx = Math.max(0, Math.min(80, Number(bg.blur) || 0));
    const dimPct = Math.max(0, Math.min(98, Number(bg.dim) || 0)) / 100;
    const satPct = Math.max(0, Math.min(300, Number(bg.saturate ?? 100)));
    const brightPct = Math.max(10, Math.min(200, Number(bg.brightness ?? 100)));
    if (bg.mode === 'solid' && bg.color1) {
      lines.push(`html[data-custom-theme="active"] body { background: ${bg.color1} !important; }`);
      lines.push(`html[data-custom-theme="active"] body::before { background: none !important; }`);
    } else if (bg.mode === 'gradient') {
      const angle = Number.isFinite(Number(bg.angle)) ? Number(bg.angle) : 135;
      const c1 = bg.color1 || '#090d16';
      const c2 = bg.color2 || '#1a103c';
      const c3 = bg.color3 || '#0f292e';
      lines.push(`html[data-custom-theme="active"] body { background: ${c1} !important; }`);
      lines.push(`html[data-custom-theme="active"] body::before {`);
      lines.push(`  inset: 0 !important;`);
      lines.push(`  background: linear-gradient(${angle}deg, ${c1} 0%, ${c2} 52%, ${c3} 100%) !important;`);
      lines.push(`  filter: blur(${blurPx}px) saturate(${satPct}%) brightness(${brightPct}%) !important;`);
      lines.push(`}`);
    } else if (bg.mode === 'mesh') {
      const c1 = bg.color1 || '#5e5ce6';
      const c2 = bg.color2 || '#ff5cb9';
      const c3 = bg.color3 || '#10b981';
      lines.push(`html[data-custom-theme="active"] body::before {`);
      lines.push(`  inset: -20% !important;`);
      lines.push(`  background: radial-gradient(ellipse 65% 55% at 18% 18%, ${hexToRgba(c1, 0.34)}, transparent 65%), radial-gradient(ellipse 60% 55% at 84% 78%, ${hexToRgba(c2, 0.30)}, transparent 65%), radial-gradient(ellipse 55% 50% at 50% 48%, ${hexToRgba(c3, 0.24)}, transparent 65%) !important;`);
      lines.push(`  filter: blur(${Math.max(40, blurPx || 55)}px) saturate(${satPct}%) brightness(${brightPct}%) !important;`);
      lines.push(`}`);
    } else if (bg.mode === 'image' && bg.imageUrl) {
      const safeUrl = String(bg.imageUrl).replace(/["\\]/g, '');
      const bgSize = ['cover', 'contain', 'auto'].includes(bg.size) ? bg.size : 'cover';
      lines.push(`html[data-custom-theme="active"] body::before {`);
      lines.push(`  inset: -24px !important;`);
      lines.push(`  background-image: linear-gradient(rgba(0, 0, 0, ${dimPct}), rgba(0, 0, 0, ${dimPct})), url("${safeUrl}") !important;`);
      lines.push(`  background-size: ${bgSize} !important;`);
      lines.push(`  background-position: center center !important;`);
      lines.push(`  background-repeat: ${bgSize === 'auto' ? 'repeat' : 'no-repeat'} !important;`);
      lines.push(`  filter: blur(${blurPx}px) saturate(${satPct}%) brightness(${brightPct}%) !important;`);
      lines.push(`}`);
    } else if (bg.mode === 'pattern') {
      const c1 = bg.color1 || '#080b11';
      const c3 = bg.color3 || '#38bdf8';
      const patAlpha = Math.max(0.02, Math.min(0.6, (Number(bg.patternOpacity) || 12) / 100));
      const stroke = hexToRgba(c3, patAlpha);
      lines.push(`html[data-custom-theme="active"] body { background: ${c1} !important; }`);
      if (bg.pattern === 'dots') {
        lines.push(`html[data-custom-theme="active"] body::after { opacity: 1 !important; mix-blend-mode: normal !important; background-image: radial-gradient(${stroke} 1.25px, transparent 1.25px) !important; background-size: 22px 22px !important; }`);
      } else if (bg.pattern === 'scanlines') {
        lines.push(`html[data-custom-theme="active"] body::after { opacity: 1 !important; mix-blend-mode: normal !important; background-image: repeating-linear-gradient(0deg, ${stroke} 0px, ${stroke} 1px, transparent 1px, transparent 4px) !important; background-size: 100% 4px !important; }`);
      } else {
        lines.push(`html[data-custom-theme="active"] body::after { opacity: 1 !important; mix-blend-mode: normal !important; background-image: linear-gradient(${stroke} 1px, transparent 1px), linear-gradient(90deg, ${stroke} 1px, transparent 1px) !important; background-size: 28px 28px !important; }`);
      }
    }
  }

  const rules = customTheme.elementRules || {};
  for (const [selector, rule] of Object.entries(rules)) {
    if (!selector || !rule || typeof rule !== 'object') continue;
    const props = [];
    if (rule.display === 'none' || rule.hidden === true) props.push('display: none !important;');
    if (rule.compactSpace === true) {
      props.push('margin: 0 !important;');
      props.push('padding: 8px !important;');
      props.push('gap: 6px !important;');
    }
    const tx = Number(rule.x) || 0;
    const ty = Number(rule.y) || 0;
    const scale = rule.scale != null && rule.scale !== '' ? Number(rule.scale) / 100 : 1;
    const rot = Number(rule.rotate) || 0;
    if (tx !== 0 || ty !== 0 || scale !== 1 || rot !== 0) {
      props.push(`transform: translate3d(${tx}px, ${ty}px, 0) scale(${scale}) rotate(${rot}deg) !important;`);
    }
    if (rule.width) props.push(`width: ${rule.width} !important;`);
    if (rule.height) props.push(`height: ${rule.height} !important;`);
    if (rule.padding) props.push(`padding: ${rule.padding} !important;`);
    if (rule.margin) props.push(`margin: ${rule.margin} !important;`);
    if (rule.gap && !rule.compactSpace) props.push(`gap: ${rule.gap} !important;`);
    if (rule.opacity != null && rule.opacity !== '' && Number(rule.opacity) !== 100) {
      props.push(`opacity: ${Math.max(0, Math.min(100, Number(rule.opacity))) / 100} !important;`);
    }
    if (rule.bgColor) {
      const alpha = rule.bgOpacity != null && rule.bgOpacity !== '' ? Number(rule.bgOpacity) / 100 : 1;
      props.push(`background: ${hexToRgba(rule.bgColor, alpha)} !important;`);
    } else if (rule.bgOpacity != null && rule.bgOpacity !== '') {
      const pct = Math.max(0, Math.min(100, Number(rule.bgOpacity)));
      props.push(`background: color-mix(in srgb, var(--glass-surface-raised) ${pct}%, transparent) !important;`);
    }
    if (rule.backdropBlur != null && rule.backdropBlur !== '') {
      const blur = Math.max(0, Math.min(100, Number(rule.backdropBlur)));
      props.push(`backdrop-filter: blur(${blur}px) !important;`);
      props.push(`-webkit-backdrop-filter: blur(${blur}px) !important;`);
    }
    if (rule.textGradient && rule.textGradColor1 && rule.textGradColor2) {
      const angle = Number(rule.textGradAngle) || 135;
      props.push(`background: linear-gradient(${angle}deg, ${rule.textGradColor1} 0%, ${rule.textGradColor2} 100%) !important;`);
      props.push(`-webkit-background-clip: text !important;`);
      props.push(`background-clip: text !important;`);
      props.push(`-webkit-text-fill-color: transparent !important;`);
      props.push(`color: transparent !important;`);
      props.push(`display: inline-block !important;`);
    } else if (rule.textColor) {
      props.push(`color: ${rule.textColor} !important;`);
    }
    if (rule.fontSize) props.push(`font-size: ${rule.fontSize} !important;`);
    if (rule.fontWeight) props.push(`font-weight: ${rule.fontWeight} !important;`);
    if (rule.letterSpacing) props.push(`letter-spacing: ${rule.letterSpacing} !important;`);
    if (rule.textAlign) props.push(`text-align: ${rule.textAlign} !important;`);
    if (rule.textTransform) props.push(`text-transform: ${rule.textTransform} !important;`);
    if (rule.fontFamily) props.push(`font-family: ${rule.fontFamily} !important;`);
    if (rule.borderRadius != null && rule.borderRadius !== '') {
      const rVal = /^\d+$/.test(String(rule.borderRadius)) ? `${rule.borderRadius}px` : rule.borderRadius;
      props.push(`border-radius: ${rVal} !important;`);
    }
    if (rule.borderWidth != null && rule.borderWidth !== '') {
      const bw = Number(rule.borderWidth) || 0;
      const bs = rule.borderStyle || 'solid';
      const bc = rule.borderColor || 'var(--glass-stroke)';
      props.push(`border: ${bw}px ${bs} ${bc} !important;`);
    } else if (rule.borderColor) {
      props.push(`border-color: ${rule.borderColor} !important;`);
    }
    if (rule.boxShadow) props.push(`box-shadow: ${rule.boxShadow} !important;`);
    if (rule.order != null && rule.order !== '') props.push(`order: ${Number(rule.order) || 0} !important;`);
    if (rule.zIndex != null && rule.zIndex !== '') props.push(`z-index: ${Number(rule.zIndex) || 1} !important;`);
    if (props.length > 0) {
      lines.push(`html[data-custom-theme="active"] ${selector} {\n  ${props.join('\n  ')}\n}`);
    }
  }

  if (customTheme.customCss && customTheme.customCss.trim()) {
    lines.push('/* ── Custom User CSS ── */');
    lines.push(customTheme.customCss);
  }

  return lines.join('\n');
}
