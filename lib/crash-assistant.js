'use strict';

const fs = require('fs');
const path = require('path');

const DIAGNOSTIC_LOCATIONS = [
  ['logs/latest.log', 0],
  ['logs/debug.log', 1],
  ['crash-reports', 2],
  ['', 3],
];

function collectInstanceDiagnostics(instanceDir, suppliedLog = '', options = {}) {
  const root = path.resolve(String(instanceDir || ''));
  const maxFileBytes = Math.min(2 * 1024 * 1024, Math.max(4096, Number(options.maxFileBytes) || 768 * 1024));
  const maxTotalBytes = Math.min(8 * 1024 * 1024, Math.max(maxFileBytes, Number(options.maxTotalBytes) || 3 * 1024 * 1024));
  const candidates = [];
  const addFile = (file, priority) => {
    try {
      const resolved = path.resolve(file);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return;
      const stat = fs.lstatSync(resolved);
      if (!stat.isFile() || stat.isSymbolicLink()) return;
      candidates.push({ file: resolved, priority, modified: stat.mtimeMs, size: stat.size });
    } catch {}
  };
  for (const [relative, priority] of DIAGNOSTIC_LOCATIONS) {
    const target = path.join(root, relative);
    if (relative === 'logs/latest.log' || relative === 'logs/debug.log') addFile(target, priority);
    else if (relative === 'crash-reports') {
      try {
        for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
          if (entry.isFile() && /\.(?:txt|log)$/i.test(entry.name)) addFile(path.join(target, entry.name), priority);
        }
      } catch {}
    } else {
      try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (entry.isFile() && /^(?:hs_err_pid\d+\.log|launcher_log\.txt)$/i.test(entry.name)) addFile(path.join(root, entry.name), priority);
        }
      } catch {}
    }
  }
  candidates.sort((a, b) => a.priority - b.priority || b.modified - a.modified);
  const sections = [];
  let total = Buffer.byteLength(String(suppliedLog || ''), 'utf8');
  if (String(suppliedLog || '').trim()) sections.push(`===== Pine launch output =====\n${String(suppliedLog)}`);
  const sources = [];
  for (const candidate of candidates) {
    if (total >= maxTotalBytes || sources.length >= 6) break;
    const bytes = Math.min(candidate.size, maxFileBytes, maxTotalBytes - total);
    if (bytes <= 0) continue;
    const handle = fs.openSync(candidate.file, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      fs.readSync(handle, buffer, 0, bytes, Math.max(0, candidate.size - bytes));
      const relative = path.relative(root, candidate.file).split(path.sep).join('/');
      const body = buffer.toString('utf8').replace(/^\uFFFD+/, '');
      sections.push(`===== ${relative} =====\n${body}`);
      sources.push(relative);
      total += bytes;
    } finally { fs.closeSync(handle); }
  }
  return { log: sections.join('\n\n').slice(-maxTotalBytes), sources };
}

const RULES = [
  { id: 'memory', confidence: 'high', title: 'Minecraft ran out of memory', pattern: /OutOfMemoryError|Java heap space|GC overhead limit exceeded|Could not reserve enough space for object heap/i, explanation: 'Minecraft exhausted the memory available to Java, or Java could not reserve the configured amount.', actions: ['Increase the instance maximum memory', 'Remove unusually heavy resource packs or mods and retry'] },
  { id: 'duplicate-mod', confidence: 'high', title: 'Duplicate mod IDs were detected', pattern: /duplicate mod|duplicate.*mod id|ModResolutionException.*duplicate|Found duplicate mods/i, explanation: 'Two installed files appear to provide the same mod identity.', actions: ['Disable the older duplicate mod file', 'Open Content and remove the duplicate before retrying'] },
  { id: 'dependency', confidence: 'high', title: 'A required dependency is missing', pattern: /requires.*(?:which is missing|not installed)|missing (?:mandatory )?dependenc|could not find required mod|depends on .+ which is not available/i, explanation: 'An installed mod depends on another mod or library that is not present.', actions: ['Install the dependency named in the error', 'Check the mod page for its required dependencies'] },
  { id: 'loader', confidence: 'high', title: 'A mod targets the wrong loader or game version', pattern: /wrong (?:minecraft version|loader)|incompatible mod set|not compatible with.*(?:fabric|forge|quilt|neoforge)|requires.*minecraft|ModLoadingException.*version/i, explanation: 'At least one installed mod does not match this instance’s Minecraft or loader version.', actions: ['Review compatibility warnings in Content', 'Install the correct build of the mod'] },
  { id: 'java', confidence: 'high', title: 'The Java version is incompatible', pattern: /UnsupportedClassVersionError|class file version \d+|requires Java \d+|only recognizes class file versions|JNI error.*Java/i, explanation: 'Minecraft or a mod was compiled for a different Java release.', actions: ['Use Pine’s managed Java runtime', 'Remove a mod built for a newer Java or Minecraft version'] },
  { id: 'mixin', confidence: 'medium', title: 'A mod mixin failed', pattern: /MixinApplyError|MixinTransformerError|InvalidMixinException|mixin.*(?:failed|critical injection failure)|InjectionError/i, explanation: 'A mod could not safely modify Minecraft code. The nearby mod name is usually the best suspect.', actions: ['Disable the mod named near the first mixin error and retry', 'Check that every mod matches this Minecraft and loader version'] },
  { id: 'graphics', confidence: 'medium', title: 'Minecraft could not initialize graphics', pattern: /OpenGL error|GLFW error|Pixel format not accelerated|Failed to create window|driver does not appear to support OpenGL|WGL: The driver does not appear/i, explanation: 'The graphics driver or an overlay prevented Minecraft from creating its game window.', actions: ['Update the GPU driver from the manufacturer', 'Disable overlays and remove graphics mods temporarily'] },
  { id: 'corrupt', confidence: 'medium', title: 'A game or mod file may be corrupted', pattern: /ZipException|invalid LOC header|unexpected end of ZLIB|checksum.*(?:failed|mismatch)|corrupt(?:ed)? (?:jar|zip|file)|zip END header not found/i, explanation: 'A downloaded archive could not be read or did not pass integrity checks.', actions: ['Run instance repair', 'Remove the named file and let Pine download it again'] },
];

function redactSensitiveLog(value, limit = 10 * 1024 * 1024) {
  return String(value || '')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '%USERPROFILE%')
    .replace(/\/(?:home|Users)\/[^/\s]+/g, '/home/%USER%')
    .replace(/\b(?:access_token|refresh_token|authorization|client_token|xsts_token|identityToken)\b[=: ]+\s*(?:Bearer\s+)?[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b[A-F0-9]{8}-[A-F0-9]{4}-[1-5][A-F0-9]{3}-[89AB][A-F0-9]{3}-[A-F0-9]{12}\b/gi, '[redacted-uuid]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]')
    .replace(/\b(?:Setting user|Player Name|Username)\s*[:=]\s*[^\s,;]+/gi, match => `${match.split(/[:=]/)[0]}: [redacted-user]`)
    .replace(/\b(?:Connecting to|Server address|Connected to)\s+((?:\d{1,3}\.){3}\d{1,3}|[a-z0-9.-]+\.[a-z]{2,})(?::\d{1,5})?/gi, match => match.replace(/((?:\d{1,3}\.){3}\d{1,3}|[a-z0-9.-]+\.[a-z]{2,})(?::\d{1,5})?/i, '[redacted-server]'))
    .slice(-Math.max(1, Number(limit) || 1));
}

function cleanEvidence(value) {
  return redactSensitiveLog(value, 700);
}

function suspectFromLog(text, mods = []) {
  const enabled = (Array.isArray(mods) ? mods : []).filter(mod => !mod.disabled && mod.filename);
  let best = null;
  for (const mod of enabled) {
    const names = [mod.filename, mod.filename.replace(/\.jar$/i, ''), mod.projectId, mod.title]
      .filter(value => typeof value === 'string' && value.length >= 3);
    let score = 0;
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hits = text.match(new RegExp(escaped, 'gi'))?.length || 0;
      score = Math.max(score, hits);
    }
    if (/mixin|caused by|suspected mod|failure message/i.test(text) && score) score += 1;
    if (!best || score > best.score) best = { ...mod, score };
  }
  if (!best || best.score < 2) return null;
  return { filename: best.filename, title: best.title || best.filename.replace(/\.jar$/i, ''), projectId: best.projectId || null };
}

function diagnoseCrash(log, context = {}) {
  const text = String(log || '').slice(-2 * 1024 * 1024);
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (const rule of RULES) {
    const index = lines.findIndex(line => rule.pattern.test(line));
    if (index < 0) continue;
    findings.push({ id: rule.id, confidence: rule.confidence, title: rule.title, explanation: rule.explanation, actions: rule.actions, evidence: cleanEvidence(lines.slice(Math.max(0, index - 2), index + 3).join('\n')) });
  }
  const suspectMod = suspectFromLog(text, context.mods);
  if (suspectMod) {
    findings.unshift({
      id: 'suspected-mod', confidence: 'medium', title: `${suspectMod.title} is the likely crashing mod`,
      explanation: 'This mod appears repeatedly around the first relevant failure. Pine cannot prove causation, so disabling it is safer than deleting it.',
      actions: ['Disable this mod and retry', 'Restore it from Content if the crash continues'],
      evidence: cleanEvidence(lines.filter(line => line.toLowerCase().includes(suspectMod.filename.replace(/\.jar$/i, '').toLowerCase())).slice(0, 3).join('\n')),
    });
  }
  return {
    instance: String(context.instance || ''), gameVersion: String(context.gameVersion || ''), loader: String(context.loader || ''),
    currentMemoryMb: Number(context.currentMemoryMb) || 0, recommendedMemoryMb: Number(context.recommendedMemoryMb) || 0,
    suspectMod, findings,
    summary: findings.length ? `${findings[0].title}${findings.length > 1 ? ` and ${findings.length - 1} other likely issue${findings.length === 2 ? '' : 's'}` : ''}.` : 'Pine could not identify a common cause from this log. The first exception or “Caused by” section may still help support.',
  };
}

module.exports = { cleanEvidence, collectInstanceDiagnostics, diagnoseCrash, redactSensitiveLog, RULES, suspectFromLog };
