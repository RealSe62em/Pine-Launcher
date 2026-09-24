'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { readSavedServersStrict } = require('./discord-presence');

function nbtString(value) {
  const body = Buffer.from(String(value ?? ''), 'utf8');
  if (body.length > 65535) throw new Error('Server list text is too long');
  const size = Buffer.allocUnsafe(2);
  size.writeUInt16BE(body.length);
  return Buffer.concat([size, body]);
}

function named(type, name, payload) {
  return Buffer.concat([Buffer.from([type]), nbtString(name), payload]);
}

function byte(value) {
  const result = Buffer.allocUnsafe(1);
  result.writeInt8(Number(value) || 0);
  return result;
}

function compound(server) {
  const fields = [
    named(8, 'name', nbtString(server.name)),
    named(8, 'ip', nbtString(server.ip)),
  ];
  if (typeof server.icon === 'string' && server.icon.length <= 2 * 1024 * 1024) fields.push(named(8, 'icon', nbtString(server.icon)));
  if (server.acceptTextures !== undefined) fields.push(named(1, 'acceptTextures', byte(server.acceptTextures)));
  if (server.hidden !== undefined) fields.push(named(1, 'hidden', byte(server.hidden)));
  return Buffer.concat([...fields, Buffer.from([0])]);
}

function encodeServersDat(servers) {
  const children = servers.map(compound);
  const count = Buffer.allocUnsafe(4);
  count.writeInt32BE(children.length);
  const list = Buffer.concat([Buffer.from([10]), count, ...children]);
  const root = Buffer.concat([Buffer.from([10]), nbtString(''), named(9, 'servers', list), Buffer.from([0])]);
  return zlib.gzipSync(root);
}

function comparableAddress(value) {
  return String(value || '').trim().replace(/^minecraft:\/\//i, '').replace(/:25565$/i, '').toLowerCase();
}

function locateServersList(raw) {
  let offset = 0;
  const take = size => {
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > raw.length) throw new Error('Invalid servers.dat NBT length');
    const start = offset;
    offset += size;
    return start;
  };
  const uint8 = () => raw.readUInt8(take(1));
  const int32 = () => raw.readInt32BE(take(4));
  const string = () => {
    const length = raw.readUInt16BE(take(2));
    return raw.toString('utf8', take(length), offset);
  };
  const skipPayload = (type, depth = 0) => {
    if (depth > 64) throw new Error('servers.dat NBT is too deeply nested');
    if (type === 0) return;
    if (type === 1) return void take(1);
    if (type === 2) return void take(2);
    if (type === 3 || type === 5) return void take(4);
    if (type === 4 || type === 6) return void take(8);
    if (type === 7 || type === 11 || type === 12) {
      const length = int32();
      if (length < 0 || length > 10_000_000) throw new Error('Invalid servers.dat NBT array');
      return void take(length * (type === 7 ? 1 : type === 11 ? 4 : 8));
    }
    if (type === 8) return void string();
    if (type === 9) {
      const childType = uint8();
      const length = int32();
      if (length < 0 || length > 100_000) throw new Error('Invalid servers.dat NBT list');
      for (let index = 0; index < length; index++) skipPayload(childType, depth + 1);
      return;
    }
    if (type === 10) {
      for (let fields = 0; fields < 100_000; fields++) {
        const childType = uint8();
        if (childType === 0) return;
        string();
        skipPayload(childType, depth + 1);
      }
      throw new Error('Invalid servers.dat NBT compound');
    }
    throw new Error(`Unsupported servers.dat NBT tag ${type}`);
  };

  if (uint8() !== 10) throw new Error('servers.dat root is not an NBT compound');
  string();
  for (let fields = 0; fields < 100_000; fields++) {
    const type = uint8();
    if (type === 0) break;
    const name = string();
    if (name !== 'servers') { skipPayload(type, 1); continue; }
    if (type !== 9) throw new Error('servers.dat server list has an invalid type');
    const childType = uint8();
    if (childType !== 10) throw new Error('servers.dat server entries have an invalid type');
    const countOffset = offset;
    const count = int32();
    if (count < 0 || count > 100_000) throw new Error('servers.dat has an invalid server count');
    for (let index = 0; index < count; index++) skipPayload(childType, 1);
    return { count, countOffset, listEnd: offset };
  }
  throw new Error('servers.dat does not contain a server list');
}

function appendServerToDat(fileBuffer, server) {
  const compressed = fileBuffer[0] === 0x1f && fileBuffer[1] === 0x8b;
  const raw = compressed ? zlib.gunzipSync(fileBuffer) : fileBuffer;
  const list = locateServersList(raw);
  const count = Buffer.allocUnsafe(4);
  count.writeInt32BE(list.count + 1);
  const patched = Buffer.concat([
    raw.subarray(0, list.countOffset),
    count,
    raw.subarray(list.countOffset + 4, list.listEnd),
    compound(server),
    raw.subarray(list.listEnd),
  ]);
  return compressed ? zlib.gzipSync(patched) : patched;
}

function backupServerList(file) {
  fs.copyFileSync(file, `${file}.pine-backup`);
  const historyDir = path.join(path.dirname(file), '.pine-server-backups');
  fs.mkdirSync(historyDir, { recursive: true });
  fs.copyFileSync(file, path.join(historyDir, `servers-${new Date().toISOString().replace(/[:.]/g, '-')}.dat`));
  const history = fs.readdirSync(historyDir).filter(name => /^servers-.*\.dat$/.test(name)).sort().reverse();
  for (const stale of history.slice(10)) fs.rmSync(path.join(historyDir, stale), { force: true });
}

function recoverServerListFromBackup(instanceDir, backupName = 'servers.dat.pine-backup') {
  const file = path.join(instanceDir, 'servers.dat');
  const backupFile = path.join(instanceDir, path.basename(backupName));
  if (!fs.existsSync(file) || !fs.existsSync(backupFile)) throw new Error('A recoverable Pine server-list backup was not found');
  const current = readSavedServersStrict(instanceDir);
  const backup = readSavedServersStrict(instanceDir, path.basename(backupFile));
  let output = fs.readFileSync(backupFile);
  const restored = new Set(backup.map(server => comparableAddress(server.ip)));
  for (const server of current) {
    if (restored.has(comparableAddress(server.ip))) continue;
    output = appendServerToDat(output, server);
    restored.add(comparableAddress(server.ip));
  }
  const temporary = `${file}.${process.pid}.${Date.now()}.recovery.tmp`;
  const preservedCurrent = `${file}.pre-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    fs.writeFileSync(temporary, output);
    const verified = readSavedServersStrict(instanceDir, path.basename(temporary));
    if (verified.length !== restored.size) throw new Error('Pine could not verify the recovered server list');
    fs.copyFileSync(file, preservedCurrent);
    fs.renameSync(temporary, file);
    return { before: current.length, recovered: verified.length, preservedCurrent };
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function addServerToInstance(instanceDir, input) {
  const name = String(input?.name || input?.ip || '').replace(/[\r\n\0]+/g, ' ').trim().slice(0, 100);
  const ip = String(input?.ip || '').trim().slice(0, 255);
  if (!name || !ip) throw new Error('Server name and address are required');
  const file = path.join(instanceDir, 'servers.dat');
  const exists = fs.existsSync(file);
  const existing = exists ? readSavedServersStrict(instanceDir) : [];
  const match = existing.find(server => comparableAddress(server.ip) === comparableAddress(ip));
  if (match) {
    return { name: match.name || name, ip: match.ip, added: false, total: existing.length, unchanged: true };
  }
  const server = { name, ip, acceptTextures: 0, hidden: 0 };
  fs.mkdirSync(instanceDir, { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    const output = exists ? appendServerToDat(fs.readFileSync(file), server) : encodeServersDat([server]);
    fs.writeFileSync(temporary, output);
    const verified = readSavedServersStrict(instanceDir, path.basename(temporary));
    if (verified.length !== existing.length + 1 || !verified.some(item => comparableAddress(item.ip) === comparableAddress(ip))) {
      throw new Error('Pine could not verify the updated server list');
    }
    if (exists) backupServerList(file);
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
  return { name, ip, added: true, total: existing.length + 1 };
}

module.exports = { addServerToInstance, appendServerToDat, comparableAddress, encodeServersDat, locateServersList, recoverServerListFromBackup };
