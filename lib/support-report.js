'use strict';
const { redactSensitiveLog } = require('./crash-assistant');
function buildSupportReport({ launcherVersion, platform, instance, java, memory, mods, diagnostics, health }) {
  // Explicit allowlist: no account store, environment variables, JVM arguments,
  // custom filesystem roots, or raw launcher settings are exported.
  const report = {
    format: 1, product: 'Pine Launcher support report', createdAt: new Date().toISOString(),
    launcherVersion, platform,
    instance: { gameVersion: instance.gameVersion, loader: instance.loader, loaderVersion: instance.loaderVersion },
    java: { major: java?.major || null }, memory,
    mods: mods.map(mod => ({ filename: mod.filename, projectId: mod.projectId, installedVersion: mod.installedVersion, disabled: Boolean(mod.disabled) })),
    health: health.issues.map(({ code, title, detail }) => ({ code, title, detail })),
    sources: diagnostics.sources, log: redactSensitiveLog(diagnostics.log, 2 * 1024 * 1024),
  };
  return redactSensitiveLog(JSON.stringify(report, null, 2), 4 * 1024 * 1024);
}
module.exports = { buildSupportReport };
