const fs = require('fs');
const net = require('net');
const path = require('path');
const zlib = require('zlib');

const OPCODE_HANDSHAKE = 0;
const OPCODE_FRAME = 1;
const OPCODE_CLOSE = 2;
const OPCODE_PING = 3;
const OPCODE_PONG = 4;

function encodeFrame(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const frame = Buffer.allocUnsafe(8 + body.length);
  frame.writeInt32LE(opcode, 0);
  frame.writeInt32LE(body.length, 4);
  body.copy(frame, 8);
  return frame;
}

function activityText(value, fallback = '') {
  return String(value || fallback).replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128);
}

function normalizeServerAddress(value) {
  let input = String(value || '').trim().toLowerCase().replace(/^minecraft:\/\//, '').replace(/\.$/, '');
  if (input.startsWith('[')) {
    const end = input.indexOf(']');
    if (end >= 0) return input.slice(1, end);
  }
  if ((input.match(/:/g) || []).length === 1) input = input.replace(/:\d+$/, '');
  return input;
}

function isPrivateServerAddress(value) {
  const host = normalizeServerAddress(value);
  if (!host || host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function readNbt(buffer) {
  let offset = 0;
  const take = size => {
    if (offset + size > buffer.length) throw new Error('Invalid NBT length');
    const start = offset;
    offset += size;
    return start;
  };
  const string = () => {
    const length = buffer.readUInt16BE(take(2));
    return buffer.toString('utf8', take(length), offset);
  };
  const payload = type => {
    switch (type) {
      case 0: return null;
      case 1: return buffer.readInt8(take(1));
      case 2: return buffer.readInt16BE(take(2));
      case 3: return buffer.readInt32BE(take(4));
      case 4: return buffer.readBigInt64BE(take(8));
      case 5: return buffer.readFloatBE(take(4));
      case 6: return buffer.readDoubleBE(take(8));
      case 7: {
        const length = buffer.readInt32BE(take(4));
        return buffer.subarray(take(length), offset);
      }
      case 8: return string();
      case 9: {
        const childType = buffer.readUInt8(take(1));
        const length = buffer.readInt32BE(take(4));
        if (length < 0 || length > 100000) throw new Error('Invalid NBT list');
        return Array.from({ length }, () => payload(childType));
      }
      case 10: {
        const result = {};
        while (true) {
          const childType = buffer.readUInt8(take(1));
          if (childType === 0) break;
          result[string()] = payload(childType);
        }
        return result;
      }
      case 11: {
        const length = buffer.readInt32BE(take(4));
        return Array.from({ length }, () => buffer.readInt32BE(take(4)));
      }
      case 12: {
        const length = buffer.readInt32BE(take(4));
        return Array.from({ length }, () => buffer.readBigInt64BE(take(8)));
      }
      default: throw new Error(`Unsupported NBT tag ${type}`);
    }
  };
  const rootType = buffer.readUInt8(take(1));
  if (rootType === 0) return {};
  string();
  return payload(rootType);
}

function readSavedServers(instanceDir) {
  try {
    const file = fs.readFileSync(path.join(instanceDir, 'servers.dat'));
    const decoded = file[0] === 0x1f && file[1] === 0x8b ? zlib.gunzipSync(file) : file;
    const root = readNbt(decoded);
    return Array.isArray(root?.servers)
      ? root.servers.filter(item => item && typeof item.name === 'string' && typeof item.ip === 'string')
      : [];
  } catch {
    return [];
  }
}

function serverDisplayName(address, savedServers = []) {
  const normalized = normalizeServerAddress(address);
  const saved = savedServers.find(server => normalizeServerAddress(server.ip) === normalized);
  if (saved?.name) return activityText(saved.name, 'Multiplayer server');
  if (isPrivateServerAddress(normalized)) return 'Private server';
  return activityText(normalized, 'Multiplayer server');
}

function serverDisplayAddress(address, port) {
  let value = String(address || '').trim().replace(/^minecraft:\/\//i, '');
  if (!value) return 'Minecraft server';
  // Minecraft sometimes logs a resolved endpoint as hostname/IP. Keep the
  // address the player joined, but strip punctuation added by log messages.
  value = value.replace(/^\//, '').replace(/[),.;]+$/, '');
  const explicitDefaultPort = /:25565$/i.test(value) && !/^\[[^\]]+\]$/i.test(value);
  const numericPort = Number(port);
  // 25565 is Minecraft Java's standard port, so showing it adds noise.
  if (numericPort === 25565 || explicitDefaultPort) {
    value = value.replace(/:25565$/, '');
    if (/^\[[^\]]+\]$/.test(value)) value = value.slice(1, -1);
    return activityText(value, 'Minecraft server');
  }
  const hasPort = /^\[[^\]]+\]:\d+$/.test(value)
    || ((value.match(/:/g) || []).length === 1 && /:\d+$/.test(value));
  if (numericPort && !hasPort) {
    value = value.includes(':') ? `[${value}]:${numericPort}` : `${value}:${numericPort}`;
  }
  return activityText(value, 'Minecraft server');
}

function normalizeServerIcon(value) {
  let encoded = String(value || '').trim();
  if (!encoded) return null;
  encoded = encoded.replace(/^data:image\/png;base64,/i, '').replace(/\s+/g, '');
  if (!/^[a-z0-9+/]+={0,2}$/i.test(encoded) || encoded.length > 2 * 1024 * 1024) return null;
  try {
    const data = Buffer.from(encoded, 'base64');
    if (data.length < 8 || data.length > 1024 * 1024) return null;
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!data.subarray(0, 8).equals(pngSignature)) return null;
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

function parseGamePresenceLine(line) {
  const text = String(line || '');
  let match = text.match(/Connecting to\s+\[?([^\],\s]+)\]?,\s*(\d{1,5})/i);
  if (!match) match = text.match(/Connecting to\s+(?:\/)?(\[[^\]]+\]|[^\s,/:]+):(\d{1,5})/i);
  if (!match) match = text.match(/Connecting to\s+(?:[^\s/]+\/)?(?:\/)?(\[[^\]]+\]|[^\s,:]+)[,:]\s*(\d{1,5})/i);
  if (match) return { type: 'multiplayer', address: match[1].replace(/^\[|\]$/g, ''), port: Number(match[2]) };
  if (/Starting integrated (?:minecraft )?server|Preparing start region/i.test(text)) return { type: 'singleplayer' };
  if (/Disconnected|Connection closed|Stopping worker threads/i.test(text)) return { type: 'menu' };
  return null;
}

class DiscordPresence {
  constructor(applicationId, { logger = () => {}, pipePrefix = '\\\\?\\pipe\\discord-ipc-', maxPipeIndex = 9 } = {}) {
    this.applicationId = String(applicationId || '');
    this.logger = logger;
    this.pipePrefix = pipePrefix;
    this.maxPipeIndex = maxPipeIndex;
    this.enabled = false;
    this.socket = null;
    this.ready = false;
    this.pendingActivity = null;
    this.readBuffer = Buffer.alloc(0);
    this.retryTimer = null;
    this.connecting = false;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled && this.applicationId);
    if (this.enabled) this.connect();
    else this.destroy();
  }

  connect() {
    if (!this.enabled || this.socket || this.connecting) return;
    this.connecting = true;
    this.tryPipe(0);
  }

  tryPipe(index) {
    if (!this.enabled || index > this.maxPipeIndex) return this.scheduleReconnect();
    const socket = net.createConnection(`${this.pipePrefix}${index}`);
    let settled = false;
    socket.once('connect', () => {
      settled = true;
      this.socket = socket;
      this.connecting = false;
      this.readBuffer = Buffer.alloc(0);
      socket.on('data', data => this.onData(data));
      socket.on('close', () => this.onDisconnect(socket));
      socket.on('error', () => {});
      socket.write(encodeFrame(OPCODE_HANDSHAKE, { v: 1, client_id: this.applicationId }));
    });
    socket.once('error', () => {
      if (settled) return;
      socket.destroy();
      this.tryPipe(index + 1);
    });
  }

  onData(data) {
    this.readBuffer = Buffer.concat([this.readBuffer, data]);
    while (this.readBuffer.length >= 8) {
      const opcode = this.readBuffer.readInt32LE(0);
      const length = this.readBuffer.readInt32LE(4);
      if (length < 0 || length > 1024 * 1024) return this.destroy();
      if (this.readBuffer.length < 8 + length) return;
      const body = this.readBuffer.subarray(8, 8 + length);
      this.readBuffer = this.readBuffer.subarray(8 + length);
      let payload;
      try { payload = JSON.parse(body.toString('utf8')); } catch { continue; }
      if (opcode === OPCODE_PING) this.socket?.write(encodeFrame(OPCODE_PONG, payload));
      if (opcode === OPCODE_CLOSE) {
        const socket = this.socket;
        this.socket = null;
        this.ready = false;
        try { socket?.destroy(); } catch {}
        return this.scheduleReconnect();
      }
      if (opcode === OPCODE_FRAME && payload?.evt === 'READY') {
        this.ready = true;
        this.logger('INFO', 'Discord Rich Presence connected');
        this.flush();
      }
    }
  }

  onDisconnect(socket) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.ready = false;
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    this.connecting = false;
    if (!this.enabled || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, 5000);
    this.retryTimer.unref?.();
  }

  setActivity(activity) {
    this.pendingActivity = activity ? {
      details: activityText(activity.details, 'Playing Minecraft'),
      state: activityText(activity.state),
      timestamps: activity.startTimestamp ? { start: Math.floor(activity.startTimestamp / 1000) } : undefined,
      assets: activity.largeImageKey ? {
        large_image: activityText(activity.largeImageKey),
        large_text: activityText(activity.largeImageText, 'Pine Launcher'),
      } : undefined,
    } : null;
    this.flush();
  }

  flush() {
    if (!this.enabled || !this.ready || !this.socket) return;
    const activity = this.pendingActivity && Object.fromEntries(
      Object.entries(this.pendingActivity).filter(([, value]) => value && (typeof value !== 'object' || Object.keys(value).length))
    );
    this.socket.write(encodeFrame(OPCODE_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: activity || null },
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }));
  }

  destroy() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.connecting = false;
    this.ready = false;
    const socket = this.socket;
    this.socket = null;
    try { socket?.destroy(); } catch {}
  }
}

module.exports = {
  DiscordPresence,
  activityText,
  encodeFrame,
  isPrivateServerAddress,
  normalizeServerAddress,
  parseGamePresenceLine,
  normalizeServerIcon,
  readNbt,
  readSavedServers,
  serverDisplayAddress,
  serverDisplayName,
};
