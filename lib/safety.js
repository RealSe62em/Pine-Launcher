const path = require('path');

const SAFE_INSTANCE_NAME_RE = /^[a-zA-Z0-9_\- .]+$/;
const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function safeInstanceName(value) {
  if (typeof value !== 'string') throw new Error('Invalid name');
  const name = value.trim();
  if (!name || name.length > 120) throw new Error(name ? 'Name too long' : 'Invalid name');
  if (!SAFE_INSTANCE_NAME_RE.test(name)) throw new Error('Name contains invalid characters');
  if (name === '.' || name === '..' || name.endsWith('.') || WINDOWS_RESERVED_NAME_RE.test(name)) {
    throw new Error('Name is reserved by Windows');
  }
  return name;
}

function resolveSafePath(base, ...parts) {
  const root = path.resolve(base);
  const resolved = path.resolve(base, ...parts);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function safeRemoteFilename(filename) {
  if (typeof filename !== 'string' || !filename.trim()) throw new Error('Invalid download filename');
  const safe = path.basename(filename.trim());
  if (safe !== filename.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(safe)) throw new Error('Unsafe download filename');
  return safe;
}

module.exports = { resolveSafePath, safeRemoteFilename, safeInstanceName };

