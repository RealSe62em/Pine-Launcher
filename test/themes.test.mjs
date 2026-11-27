import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME_ID,
  DEFAULT_UI_STYLE_ID,
  THEMES,
  UI_STYLES,
  getThemeById,
  getUiStyleById,
  normalizeThemeId,
  normalizeUiStyleId,
} from '../renderer/themes.js';
import {
  BORDER_PRESETS,
  CSS_SNIPPETS,
  TEXT_GRADIENT_PRESETS,
  compileCustomThemeCss,
  createEmptyCustomTheme,
  hexToRgba,
} from '../renderer/theme-studio-core.js';
import settingsPkg from '../lib/settings.js';

const { sanitizeCustomTheme, sanitizeCustomThemes } = settingsPkg;

test('defines Pine Dark as the first default theme followed by distinct themes', () => {
  assert.equal(THEMES.length, 7);
  assert.equal(THEMES[0].id, DEFAULT_THEME_ID);
  assert.equal(THEMES[0].name, 'Pine Dark (Default)');

  const ids = new Set(THEMES.map(theme => theme.id));
  assert.deepEqual([...ids], [
    'pine-dark',
    'evergreen',
    'nordic-frost',
    'obsidian-ember',
    'velvet-nebula',
    'mocha-sakura',
    'cobalt-matrix',
  ]);

  for (const theme of THEMES) {
    assert.match(theme.accent, /^#[0-9a-f]{6}$/i);
    assert.match(theme.accent2, /^#[0-9a-f]{6}$/i);
    assert.equal(theme.swatches.length, 4);
    assert.ok(theme.description.length > 20);
  }
});

test('normalizes and resolves theme IDs with safe fallback to pine-dark', () => {
  assert.equal(normalizeThemeId('  EVERGREEN '), 'evergreen');
  assert.equal(normalizeThemeId('velvet-nebula'), 'velvet-nebula');
  assert.equal(normalizeThemeId('cobalt-matrix'), 'cobalt-matrix');
  assert.equal(normalizeThemeId('unknown-theme'), 'pine-dark');
  assert.equal(normalizeThemeId(null), 'pine-dark');
  assert.equal(getThemeById('nordic-frost').shortName, 'Nordic Frost');
  assert.equal(getThemeById('cobalt-matrix').shortName, 'Cobalt Matrix');
  assert.equal(getThemeById('invalid').id, 'pine-dark');
});

test('defines Dynamic Island & Dock as the first default UI style followed by 5 unique UI/UX architectures', () => {
  assert.equal(UI_STYLES.length, 6);
  assert.equal(UI_STYLES[0].id, DEFAULT_UI_STYLE_ID);
  assert.equal(UI_STYLES[0].name, 'Dynamic Island & Dock (Default)');

  const ids = new Set(UI_STYLES.map(style => style.id));
  assert.deepEqual([...ids], [
    'pine-island',
    'command-sidebar',
    'zen-minimal',
    'editorial-glass',
    'cyber-hud',
    'arcade-bento',
  ]);

  for (const style of UI_STYLES) {
    assert.equal(style.highlights.length, 3);
    assert.ok(style.description.length > 20);
  }

  assert.equal(normalizeUiStyleId('  COMMAND-SIDEBAR '), 'command-sidebar');
  assert.equal(normalizeUiStyleId('cyber-hud'), 'cyber-hud');
  assert.equal(normalizeUiStyleId('invalid-style'), 'pine-island');
  assert.equal(getUiStyleById('arcade-bento').shortName, 'Tactile 3D Bento');
});

test('Visual Theme Studio compiles custom backgrounds, tokens, element rules, and live CSS', () => {
  assert.ok(CSS_SNIPPETS.length >= 5);
  assert.ok(BORDER_PRESETS.length >= 6);
  assert.ok(TEXT_GRADIENT_PRESETS.length >= 5);
  assert.equal(hexToRgba('#00f0ff', 0.5), 'rgba(0, 240, 255, 0.5)');

  const theme = createEmptyCustomTheme({
    name: 'Neon Studio Test',
    baseTheme: 'velvet-nebula',
    baseUiStyle: 'cyber-hud',
    tokens: {
      '--accent': '#00f0ff',
      '--r-lg': '24px',
    },
    background: {
      mode: 'gradient',
      color1: '#05070d',
      color2: '#1a0c2e',
      color3: '#0b2938',
      angle: 145,
      blur: 10,
      dim: 0.4,
    },
    elementRules: {
      '#topbar': {
        x: 20,
        y: -8,
        scale: 105,
        opacity: 85,
        bgColor: '#121826',
        bgOpacity: 65,
        backdropBlur: 24,
        width: '920px',
        borderRadius: '18px',
        order: 2,
        compactSpace: true,
      },
      '.hero-title': {
        textGradient: true,
        textGradColor1: '#00f0ff',
        textGradColor2: '#ff5cb9',
        textGradAngle: 120,
      },
      '.hero-subtitle': {
        hidden: true,
      },
    },
    customCss: '.custom-rule { letter-spacing: 0.1em; }',
  });

  const css = compileCustomThemeCss(theme);
  assert.match(css, /--accent:\s*#00f0ff\s*!important/);
  assert.match(css, /linear-gradient\(145deg/);
  assert.match(css, /#topbar\s*\{[\s\S]*?translate3d\(20px,\s*-8px,\s*0\)\s*scale\(1\.05\)/);
  assert.match(css, /backdrop-filter:\s*blur\(24px\)/);
  assert.match(css, /width:\s*920px\s*!important/);
  assert.match(css, /gap:\s*6px\s*!important/);
  assert.match(css, /\.hero-title\s*\{[\s\S]*?-webkit-background-clip:\s*text\s*!important/);
  assert.match(css, /\.hero-subtitle\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(css, /\.custom-rule\s*\{\s*letter-spacing:\s*0\.1em;\s*\}/);

  const staticTheme = createEmptyCustomTheme({
    tokens: { '--grid-speed': '0s' },
  });
  const staticCss = compileCustomThemeCss(staticTheme);
  assert.match(staticCss, /#app::after\s*\{\s*animation:\s*none\s*!important;\s*\}/);
});

test('sanitizeCustomThemes validates and preserves saved custom presets and text overrides', () => {
  const sanitized = sanitizeCustomThemes([
    {
      id: 'custom-alpha',
      name: 'My Custom Setup',
      baseTheme: 'nordic-frost',
      baseUiStyle: 'editorial-glass',
      tokens: { '--accent': '#38bdf8' },
      background: { mode: 'mesh', color1: '#070b14', color2: '#10243e', color3: '#1d1033' },
      elementRules: { '.card': { opacity: 0.9, backdropBlur: 18 } },
      textOverrides: { '#view-home h1': { text: 'Welcome Commander', deleted: false, label: 'h1' } },
      customCss: 'body { --test: 1; }',
    },
    null,
    'invalid',
  ]);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].id, 'custom-alpha');
  assert.equal(sanitized[0].name, 'My Custom Setup');
  assert.equal(sanitized[0].baseTheme, 'nordic-frost');
  assert.equal(sanitized[0].baseUiStyle, 'editorial-glass');
  assert.equal(sanitized[0].textOverrides['#view-home h1'].text, 'Welcome Commander');
  assert.equal( sanitizeCustomTheme(null), null);
});
