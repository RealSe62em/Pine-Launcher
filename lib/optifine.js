'use strict';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseOptiFineFilename(filename) {
  const clean = String(filename || '').trim();
  const match = clean.match(/^(preview_)?OptiFine_([^_]+)_HD_U_(.+)\.jar$/i);
  if (!match) return null;
  const build = match[3].replace(/_/g, ' ');
  return {
    filename: clean,
    gameVersion: match[2],
    build,
    preview: Boolean(match[1]) || /(?:^|\s)pre\d+/i.test(build),
    name: `OptiFine HD U ${build}`,
  };
}

function parseOptiFineCatalog(html) {
  const builds = [];
  const seen = new Set();
  const pattern = /(?:href\s*=\s*["'][^"']*)?adloadx\?f=([^&"'<>\s]+\.jar)/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    let filename;
    try { filename = decodeURIComponent(decodeHtml(match[1])); } catch { continue; }
    if (seen.has(filename)) continue;
    const parsed = parseOptiFineFilename(filename);
    if (!parsed) continue;
    seen.add(filename);
    builds.push(parsed);
  }
  return builds;
}

function resolveOptiFineDownloadUrl(html, expectedFilename) {
  const pattern = /href\s*=\s*["']([^"']*downloadx\?[^"']+)["']/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    let candidate;
    try { candidate = new URL(decodeHtml(match[1]), 'https://optifine.net/'); } catch { continue; }
    if (!['optifine.net', 'www.optifine.net'].includes(candidate.hostname) || candidate.protocol !== 'https:' || candidate.pathname !== '/downloadx') continue;
    if (candidate.searchParams.get('f') !== expectedFilename || !candidate.searchParams.get('x')) continue;
    return candidate.toString();
  }
  throw new Error('OptiFine did not provide a valid official download link');
}

module.exports = { parseOptiFineFilename, parseOptiFineCatalog, resolveOptiFineDownloadUrl };
