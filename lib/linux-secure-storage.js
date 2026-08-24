'use strict';

function configureLinuxSecureStorage(app, platform = process.platform) {
  if (platform !== 'linux') return false;
  if (!app?.commandLine || typeof app.commandLine.appendSwitch !== 'function') return false;

  // Chromium only recognizes a small set of desktop names when choosing a
  // password store. Custom Wayland environments such as Caelestia/Hyprland can
  // therefore fall back to basic_text even when Secret Service is available.
  // Preserve an explicit user override, otherwise request libsecret before the
  // Electron ready event so safeStorage can use the desktop keyring.
  if (typeof app.commandLine.hasSwitch === 'function' && app.commandLine.hasSwitch('password-store')) {
    return false;
  }
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
  return true;
}

module.exports = { configureLinuxSecureStorage };
