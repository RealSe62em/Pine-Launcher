export const DEFAULT_THEME_ID = 'pine-dark';
export const DEFAULT_UI_STYLE_ID = 'pine-island';

export const THEMES = Object.freeze([
  Object.freeze({
    id: 'pine-dark',
    name: 'Pine Dark (Default)',
    shortName: 'Pine Dark',
    badge: 'Default · OLED Glass',
    description: 'True black OLED canvas with iOS-inspired frosted glass layers, crisp specular edges, and neon rose highlights.',
    accent: '#ff5cb9',
    accent2: '#ff8bcb',
    swatches: Object.freeze(['#000000', '#121218', '#ff5cb9', '#64d2ff']),
    preview: Object.freeze({
      bg: '#000000',
      aura: 'radial-gradient(circle at 20% 20%, rgba(94,92,230,0.32), transparent 60%), radial-gradient(circle at 82% 78%, rgba(255,92,185,0.28), transparent 60%)',
      surface: 'rgba(255, 255, 255, 0.08)',
      stroke: 'rgba(255, 255, 255, 0.16)',
      text: '#ffffff',
      muted: 'rgba(255, 255, 255, 0.56)',
    }),
  }),
  Object.freeze({
    id: 'evergreen',
    name: 'Evergreen Canopy',
    shortName: 'Evergreen Canopy',
    badge: 'Botanical · Deep Forest',
    description: 'Misty Pacific Northwest pine-needle charcoal, smoked jade glass surfaces, and bioluminescent emerald accents.',
    accent: '#10b981',
    accent2: '#34d399',
    swatches: Object.freeze(['#050c09', '#0e2219', '#10b981', '#a7f3d0']),
    preview: Object.freeze({
      bg: '#050c09',
      aura: 'radial-gradient(circle at 18% 22%, rgba(16,185,129,0.34), transparent 62%), radial-gradient(circle at 84% 76%, rgba(52,211,153,0.22), transparent 58%)',
      surface: 'rgba(20, 56, 40, 0.45)',
      stroke: 'rgba(110, 231, 183, 0.24)',
      text: '#ecfdf5',
      muted: 'rgba(167, 243, 208, 0.62)',
    }),
  }),
  Object.freeze({
    id: 'nordic-frost',
    name: 'Nordic Frost',
    shortName: 'Nordic Frost',
    badge: 'Glacial · Fjord Slate',
    description: 'Scandinavian polar slate canvas with crystalline ice-blue frosted glass, crisp glacier rims, and aurora sky accents.',
    accent: '#38bdf8',
    accent2: '#7dd3fc',
    swatches: Object.freeze(['#070e18', '#112238', '#38bdf8', '#818cf8']),
    preview: Object.freeze({
      bg: '#070e18',
      aura: 'radial-gradient(circle at 22% 18%, rgba(56,189,248,0.34), transparent 60%), radial-gradient(circle at 80% 80%, rgba(129,140,248,0.26), transparent 60%)',
      surface: 'rgba(36, 70, 112, 0.42)',
      stroke: 'rgba(125, 211, 252, 0.26)',
      text: '#f0f9ff',
      muted: 'rgba(186, 230, 253, 0.62)',
    }),
  }),
  Object.freeze({
    id: 'obsidian-ember',
    name: 'Obsidian Ember',
    shortName: 'Obsidian Ember',
    badge: 'Industrial · Volcanic Carbon',
    description: 'Forged basalt and Nether-inspired matte carbon surfaces with architectural corners and molten copper-amber glow.',
    accent: '#f97316',
    accent2: '#fbbf24',
    swatches: Object.freeze(['#0c0705', '#21130d', '#f97316', '#fbbf24']),
    preview: Object.freeze({
      bg: '#0c0705',
      aura: 'radial-gradient(circle at 20% 24%, rgba(249,115,22,0.34), transparent 60%), radial-gradient(circle at 82% 78%, rgba(251,191,36,0.22), transparent 58%)',
      surface: 'rgba(62, 34, 23, 0.48)',
      stroke: 'rgba(251, 146, 60, 0.26)',
      text: '#fff7ed',
      muted: 'rgba(253, 186, 116, 0.62)',
    }),
  }),
  Object.freeze({
    id: 'velvet-nebula',
    name: 'Velvet Nebula',
    shortName: 'Velvet Nebula',
    badge: 'Atmospheric · Cosmic Dusk',
    description: 'Deep midnight-amethyst ink with plush velvet-plum glass cards, dual-tone orchid/cyan rim light, and synthwave violet accents.',
    accent: '#a855f7',
    accent2: '#ec4899',
    swatches: Object.freeze(['#090414', '#1d0e36', '#a855f7', '#22d3ee']),
    preview: Object.freeze({
      bg: '#090414',
      aura: 'radial-gradient(circle at 18% 20%, rgba(168,85,247,0.36), transparent 60%), radial-gradient(circle at 82% 78%, rgba(34,211,238,0.24), transparent 60%)',
      surface: 'rgba(58, 26, 104, 0.44)',
      stroke: 'rgba(192, 132, 252, 0.28)',
      text: '#faf5ff',
      muted: 'rgba(216, 180, 254, 0.62)',
    }),
  }),
  Object.freeze({
    id: 'mocha-sakura',
    name: 'Kyoto Sakura',
    shortName: 'Kyoto Sakura',
    badge: 'Cozy · Warm Espresso',
    description: 'Warm roasted-espresso base paired with soft rose-cream matte glass, gentle pill geometry, and blossom coral-pink accents.',
    accent: '#f472b6',
    accent2: '#fb7185',
    swatches: Object.freeze(['#120d11', '#261a23', '#f472b6', '#fda4af']),
    preview: Object.freeze({
      bg: '#120d11',
      aura: 'radial-gradient(circle at 22% 20%, rgba(244,114,182,0.32), transparent 60%), radial-gradient(circle at 80% 78%, rgba(251,113,133,0.22), transparent 60%)',
      surface: 'rgba(80, 52, 68, 0.44)',
      stroke: 'rgba(249, 168, 212, 0.24)',
      text: '#fdf2f8',
      muted: 'rgba(244, 180, 212, 0.64)',
    }),
  }),
  Object.freeze({
    id: 'cobalt-matrix',
    name: 'Cobalt Matrix',
    shortName: 'Cobalt Matrix',
    badge: 'Competitive · Cyberspace Grid',
    description: 'Deep midnight cobalt canvas with an illuminated 3D cyberspace perspective grid, electric blue accents, and tactical glass cards.',
    accent: '#2563eb',
    accent2: '#60a5fa',
    swatches: Object.freeze(['#060b17', '#0f2448', '#2563eb', '#60a5fa']),
    preview: Object.freeze({
      bg: '#060b17',
      aura: 'radial-gradient(circle at 50% 50%, rgba(37, 99, 235, 0.35), transparent 65%), linear-gradient(rgba(59, 130, 246, 0.15) 1px, transparent 1px)',
      surface: 'rgba(15, 36, 72, 0.48)',
      stroke: 'rgba(96, 165, 250, 0.35)',
      text: '#f8fafc',
      muted: 'rgba(147, 197, 253, 0.65)',
    }),
  }),
]);

export const UI_STYLES = Object.freeze([
  Object.freeze({
    id: 'pine-island',
    name: 'Dynamic Island & Dock (Default)',
    shortName: 'Dynamic Island & Dock',
    badge: 'Default · Spatial iOS Glass',
    layoutType: 'island-dock',
    description: 'Floating Dynamic Island top bar, centered bottom pill dock, fluid spring physics, and curved translucent glass cards.',
    highlights: Object.freeze(['Floating Island', 'Bottom Pill Dock', '22px Glass Curves']),
  }),
  Object.freeze({
    id: 'command-sidebar',
    name: 'Studio Sidebar & Pro Deck',
    shortName: 'Studio Sidebar',
    badge: 'Desktop Pro · Left Navigation Rail',
    layoutType: 'left-sidebar',
    description: 'Full-height left navigation sidebar with labeled rows, docked full-width header, wider workspace canvas, and top segmented settings tabs.',
    highlights: Object.freeze(['Left Sidebar Rail', 'Docked Header', 'Widescreen Canvas']),
  }),
  Object.freeze({
    id: 'zen-minimal',
    name: 'Zen Floating Icon Rail',
    shortName: 'Zen Icon Rail',
    badge: 'Ultralight · Compact Side Dock',
    layoutType: 'icon-rail',
    description: 'Tucks navigation into a compact vertical icon dock along the left edge, removing bottom chrome for maximum vertical breathing room.',
    highlights: Object.freeze(['Left Icon Pill', 'Zero Bottom Chrome', 'Borderless Airy Cards']),
  }),
  Object.freeze({
    id: 'editorial-glass',
    name: 'Panorama Cinema Top-Deck',
    shortName: 'Panorama Top-Deck',
    badge: 'Widescreen · Dual Top Bar',
    layoutType: 'top-deck',
    description: 'Moves main navigation into a sleek top sub-deck directly beneath a full-bleed header, freeing the entire lower viewport.',
    highlights: Object.freeze(['Top Sub-Deck Nav', 'Unobstructed Bottom', 'Deep Cinema Blur']),
  }),
  Object.freeze({
    id: 'cyber-hud',
    name: 'Tactical Mecha HUD',
    shortName: 'Tactical Mecha HUD',
    badge: 'Sci-Fi · Chamfered Brutalist',
    layoutType: 'cyber-hud',
    description: 'Chamfered angled polygon corners, technical monospace uppercase typography, blueprint grid backdrop, and illuminated HUD edge brackets.',
    highlights: Object.freeze(['Chamfered Corners', 'Monospace HUD Type', 'Blueprint Grid']),
  }),
  Object.freeze({
    id: 'arcade-bento',
    name: 'Tactile 3D Bento Console',
    shortName: 'Tactile 3D Bento',
    badge: 'Playful · Physical Keycap UI',
    layoutType: 'arcade-bento',
    description: 'Chunky 2px card borders, physical 3D keycap elevation shadows that press down on click, and ultra-rounded Bento modules.',
    highlights: Object.freeze(['3D Keycap Press', '2px Crisp Borders', 'Bento Geometry']),
  }),
]);

const THEME_MAP = new Map(THEMES.map(theme => [theme.id, theme]));
const UI_STYLE_MAP = new Map(UI_STYLES.map(style => [style.id, style]));

export function normalizeThemeId(value) {
  const id = String(value || '').trim().toLowerCase();
  return THEME_MAP.has(id) ? id : DEFAULT_THEME_ID;
}

export function getThemeById(value) {
  return THEME_MAP.get(normalizeThemeId(value)) || THEMES[0];
}

export function normalizeUiStyleId(value) {
  const id = String(value || '').trim().toLowerCase();
  return UI_STYLE_MAP.has(id) ? id : DEFAULT_UI_STYLE_ID;
}

export function getUiStyleById(value) {
  return UI_STYLE_MAP.get(normalizeUiStyleId(value)) || UI_STYLES[0];
}
