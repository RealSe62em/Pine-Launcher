'use strict';

const {
  DiscordPresence,
  parseGamePresenceLine,
  serverDisplayAddress,
} = require('./discord-presence');

const DEFAULT_APPLICATION_ID = '1536830830499078275';
const DEFAULT_SERVER_URL = 'https://discord.gg/XT3HNASPVs';

function loaderLabel(instance) {
  const loader = instance?.loader && instance.loader !== 'vanilla'
    ? instance.loader.charAt(0).toUpperCase() + instance.loader.slice(1)
    : 'Vanilla';
  return `Minecraft ${instance?.gameVersion || ''} · ${loader}`.trim();
}

function createPresenceController({
  applicationId = DEFAULT_APPLICATION_ID,
  serverUrl = DEFAULT_SERVER_URL,
  logger,
  readSettings,
  PresenceClass = DiscordPresence,
  parseGameLine = parseGamePresenceLine,
  displayServerAddress = serverDisplayAddress,
} = {}) {
  if (typeof readSettings !== 'function') throw new TypeError('readSettings must be a function');

  const presence = new PresenceClass(applicationId, { logger });
  const buttons = Object.freeze([{ label: 'Join Pine Discord', url: serverUrl }]);
  let context = { type: 'launcher' };

  function activityBase() {
    return {
      detailsUrl: serverUrl,
      stateUrl: serverUrl,
      largeImageKey: 'icon',
      largeImageText: 'Pine Launcher',
      largeImageUrl: serverUrl,
      buttons,
    };
  }

  function refresh(settings = readSettings() || {}) {
    const enabled = settings.discordPresence !== false;
    presence.setEnabled(enabled);
    if (!enabled) return;

    if (context.type === 'launching') {
      presence.setActivity({
        ...activityBase(),
        details: settings.discordShowInstance !== false ? `Launching ${context.instance.name}` : 'Launching Minecraft',
        state: loaderLabel(context.instance),
        startTimestamp: context.startTimestamp,
      });
      return;
    }

    if (context.type === 'game') {
      let state = loaderLabel(context.instance);
      if (context.mode === 'singleplayer') state = 'Singleplayer world';
      if (context.mode === 'multiplayer' && settings.discordShowServer !== false) state = `On ${context.serverName}`;
      presence.setActivity({
        ...activityBase(),
        details: settings.discordShowInstance !== false ? `Playing ${context.instance.name}` : 'Playing Minecraft',
        state,
        startTimestamp: context.startTimestamp,
      });
      return;
    }

    presence.setActivity({
      ...activityBase(),
      details: 'Browsing instances',
      state: 'Ready to play',
    });
  }

  function setContext(nextContext, settings) {
    context = nextContext;
    refresh(settings);
  }

  function updateFromGameLine(line, instance, settings, startTimestamp) {
    const event = parseGameLine(line);
    if (!event) return null;
    if (event.type === 'multiplayer') {
      const serverName = displayServerAddress(event.address, event.port);
      setContext({ type: 'game', instance, mode: 'multiplayer', serverName, startTimestamp }, settings);
    } else if (event.type === 'singleplayer') {
      setContext({ type: 'game', instance, mode: 'singleplayer', startTimestamp }, settings);
    } else {
      setContext({ type: 'game', instance, mode: 'menu', startTimestamp }, settings);
    }
    return event;
  }

  return {
    refresh,
    setContext,
    updateFromGameLine,
    destroy: () => presence.destroy(),
  };
}

module.exports = {
  DEFAULT_SERVER_URL,
  createPresenceController,
  loaderLabel,
};
