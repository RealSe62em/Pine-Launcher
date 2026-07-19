// ── Launch stage classifier ─────────────────────────────────
// Pure functions: take a MCLC data/log line and return what the
// renderer should display. No DOM, no globals — trivially testable.
// ─────────────────────────────────────────────────────────────

const STAGE_LABELS = {
  authenticating: 'Authenticating with Microsoft',
  libraries:      'Downloading libraries',
  assets:         'Downloading assets',
  natives:        'Reconstructing natives',
  building:       'Building launch arguments',
  launching:      'Starting Minecraft',
  done:           'Playing',
  error:          'Launch failed',
  closed:         'Minecraft closed',
};

const STAGE_ORDER = [
  'authenticating',
  'libraries',
  'assets',
  'natives',
  'building',
  'launching',
  'done',
];

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage;
}

export function stageIndex(stage) {
  return STAGE_ORDER.indexOf(stage);
}

// Classify a single MCLC data/log line. Returns one of the stages
// in STAGE_ORDER, falling back to whatever stage the caller was on
// when no transition keyword matches.
export function classifyLine(line, currentStage = 'authenticating') {
  if (typeof line !== 'string') return currentStage;
  const t = line.toLowerCase();
  if (/login|authentic|refresh|msa|xbl|xsts/.test(t))        return 'authenticating';
  if (/launching|loading native|gl info|client thread\/info/.test(t)) return 'launching';
  if (/building|forge.*install|installing forge|extracted|extracting/.test(t)) {
    if (/extracting|extracted|native/.test(t))              return 'natives';
    return 'building';
  }
  if (/downloading\s+asset/.test(t))                          return 'assets';
  if (/downloading\s+(library|forge)/.test(t))                return 'libraries';
  if (/downloading\s+native/.test(t))                         return 'natives';
  if (/libraries|library\./.test(t))                          return 'libraries';
  if (/assets|asset\./.test(t))                               return 'assets';
  if (/forge.*version|building/.test(t))                      return 'building';
  return currentStage;
}

// Parse "Downloading X (1.4 MB)" / "Downloading Y (10 KB)" style
// strings into structured info. Returns null if the line isn't a
// download line.
export function parseDownloadLine(line) {
  if (typeof line !== 'string') return null;
  const re = /Downloading\s+(?:library|asset|native)\s+(.+?)\s*\((\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\)/i;
  const m = line.match(re);
  if (!m) return null;
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  const size = parseFloat(m[2]) * (units[m[3].toUpperCase()] || 1);
  return { file: m[1], bytes: size };
}

// "Downloading libraries" → "Libraries" — show the user a
// shortened version of the file name in the progress bar.
export function shortFile(name) {
  if (!name) return '';
  if (name.length <= 40) return name;
  return name.slice(0, 18) + '…' + name.slice(-18);
}
