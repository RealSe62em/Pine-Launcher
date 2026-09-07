'use strict';
const net = require('node:net');
const dns = require('node:dns').promises;
function parseAddress(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 255 || /[\s/\\\0]/.test(text)) throw new Error('Enter a server address such as play.example.com:25565');
  const match = text.startsWith('[') ? text.match(/^\[([^\]]+)\](?::(\d+))?$/) : text.match(/^([^:]+)(?::(\d+))?$/);
  if (!match || !/^[\w.:-]+$/.test(match[1])) throw new Error('Invalid server address. Put IPv6 addresses in brackets.');
  const port = Number(match[2] || 25565);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port');
  return { host: match[1], port, explicitPort: Boolean(match[2]), address: text };
}
function varint(value) {
  const bytes = []; value >>>= 0;
  do { let next = value & 127; value >>>= 7; if (value) next |= 128; bytes.push(next); } while (value);
  return Buffer.from(bytes);
}
function readVarint(buffer, start = 0) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (start + i >= buffer.length) return null;
    const byte = buffer[start + i]; value |= (byte & 127) << (i * 7);
    if (!(byte & 128)) return { value: value >>> 0, bytes: i + 1 };
  }
  throw new Error('Invalid server packet length');
}
function packet(body) { return Buffer.concat([varint(body.length), body]); }
function serverText(value) {
  if (typeof value === 'string') return value.replace(/§./g, '').slice(0, 300);
  if (value && typeof value === 'object') return serverText(String(value.text || '') + (value.extra || []).map(serverText).join(''));
  return '';
}
async function pingServer(address, { timeout = 5000 } = {}) {
  const parsed = parseAddress(address);
  let { host, port } = parsed;
  if (!parsed.explicitPort && !net.isIP(host)) {
    try {
      const records = await Promise.race([dns.resolveSrv(`_minecraft._tcp.${host}`), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('DNS timeout')), 1500); timer.unref?.(); })]);
      const target = records.sort((a, b) => a.priority - b.priority)[0];
      if (target) { host = target.name; port = target.port; }
    } catch {}
  }
  return new Promise(resolve => {
    let buffer = Buffer.alloc(0), status = null, pingAt = 0, finished = false;
    const socket = net.createConnection({ host, port });
    const done = value => { if (finished) return; finished = true; clearTimeout(timer); socket.destroy(); resolve(value); };
    const timer = setTimeout(() => done(status || { online: false, error: 'Server did not respond' }), timeout);
    socket.once('connect', () => {
      const hostname = Buffer.from(parsed.host);
      const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(parsed.port);
      socket.write(Buffer.concat([packet(Buffer.concat([varint(0), varint(767), varint(hostname.length), hostname, portBytes, varint(1)])), packet(varint(0))]));
    });
    socket.on('data', chunk => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 1024 * 1024) throw new Error('Oversized server response');
        for (;;) {
          const length = readVarint(buffer);
          if (!length) return;
          if (length.value > 1024 * 1024) throw new Error('Oversized server packet');
          if (buffer.length < length.bytes + length.value) return;
          const body = buffer.subarray(length.bytes, length.bytes + length.value);
          buffer = buffer.subarray(length.bytes + length.value);
          const id = readVarint(body);
          if (id?.value === 0 && !status) {
            const size = readVarint(body, id.bytes);
            if (!size || id.bytes + size.bytes + size.value > body.length) throw new Error('Incomplete status');
            const json = JSON.parse(body.subarray(id.bytes + size.bytes, id.bytes + size.bytes + size.value).toString('utf8'));
            status = { online: true, version: String(json.version?.name || '').slice(0, 100), players: Number(json.players?.online) || 0, maxPlayers: Number(json.players?.max) || 0, description: serverText(json.description), iconData: /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(json.favicon || '') && json.favicon.length < 100000 ? json.favicon : null, latencyMs: null };
            pingAt = Date.now(); const payload = Buffer.alloc(8); payload.writeBigInt64BE(BigInt(pingAt));
            socket.write(packet(Buffer.concat([varint(1), payload])));
          } else if (id?.value === 1 && status && body.length === 9 && body.readBigInt64BE(1) === BigInt(pingAt)) done({ ...status, latencyMs: Date.now() - pingAt });
        }
      } catch { done({ online: false, error: 'Server returned an invalid status' }); }
    });
    socket.on('error', () => done({ online: false, error: 'Server unavailable' }));
    socket.on('end', () => done(status || { online: false, error: 'Connection closed' }));
  });
}
module.exports = { parseAddress, varint, readVarint, serverText, pingServer };
