'use strict';

const fs = require('fs');
const path = require('path');

class ValidationCache {
  constructor(cacheFile, { maxEntries = 5000 } = {}) {
    this.cacheFile = cacheFile;
    this.maxEntries = maxEntries;
    this.dirty = false;
    this.entries = this.#read();
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      return parsed?.version === 1 && parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
    } catch {
      return {};
    }
  }

  #key(file, identity) {
    return `${path.resolve(file).toLowerCase()}\0${identity || ''}`;
  }

  isValid(file, identity, validator) {
    let stat;
    try {
      stat = fs.statSync(file);
      if (!stat.isFile() || stat.size <= 0) return false;
    } catch {
      return false;
    }
    const key = this.#key(file, identity);
    const cached = this.entries[key];
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      cached.usedAt = Date.now();
      return true;
    }
    let valid = false;
    try { valid = validator(file, stat) === true; } catch { valid = false; }
    if (valid) {
      this.entries[key] = { size: stat.size, mtimeMs: stat.mtimeMs, usedAt: Date.now() };
    } else {
      delete this.entries[key];
    }
    this.dirty = true;
    return valid;
  }

  forget(file) {
    const prefix = `${path.resolve(file).toLowerCase()}\0`;
    for (const key of Object.keys(this.entries)) {
      if (key.startsWith(prefix)) delete this.entries[key];
    }
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    const ordered = Object.entries(this.entries)
      .sort((a, b) => (b[1].usedAt || 0) - (a[1].usedAt || 0))
      .slice(0, this.maxEntries);
    this.entries = Object.fromEntries(ordered);
    fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
    const temporary = `${this.cacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, entries: this.entries }));
    fs.renameSync(temporary, this.cacheFile);
    this.dirty = false;
  }
}

module.exports = { ValidationCache };
