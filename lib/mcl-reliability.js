'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

function fileSha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function installMclReliabilityPatches({ fetchImpl = globalThis.fetch, maxConcurrentDownloads = 3 } = {}) {
  const downloadLimit = Math.max(1, Math.min(8, Number.parseInt(maxConcurrentDownloads, 10) || 3));
  let activeDownloads = 0;
  const waitingDownloads = [];
  const acquireDownloadSlot = () => new Promise(resolve => {
    const enter = () => {
      activeDownloads += 1;
      resolve(() => {
        activeDownloads -= 1;
        waitingDownloads.shift()?.();
      });
    };
    if (activeDownloads < downloadLimit) enter();
    else waitingDownloads.push(enter);
  });
  const Handler = require('minecraft-launcher-core/components/handler');
  if (Handler.prototype.__pineReliabilityPatched) return;

  Object.defineProperty(Handler.prototype, '__pineReliabilityPatched', { value: true });

  Handler.prototype.checkJava = function checkJava(java) {
    return new Promise((resolve) => {
      execFile(java, ['-version'], { timeout: 5000, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) return resolve({ run: false, message: error });
        const output = `${stderr || ''}${stdout || ''}`;
        const version = output.match(/(?:version\s+["']?)(\d+(?:\.\d+)*)/i)?.[1] || 'unknown';
        this.client.emit('debug', `[MCLC]: Using Java version ${version}`);
        resolve({ run: true });
      });
    });
  };

  Handler.prototype.downloadAsync = async function downloadAsync(url, directory, name, retry = true, type) {
    fs.mkdirSync(directory, { recursive: true });
    if (path.basename(name) !== name) throw new Error('Unsafe download filename: ' + name);

    const destination = path.join(directory, name);
    const attempts = retry ? 4 : 1;
    const releaseSlot = await acquireDownloadSlot();
    let lastError;

    try {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const temporary = destination + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.part';
        let reader;
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(this.options.timeout || 50000) });
          if (!response.ok) throw new Error(('HTTP ' + response.status + ' ' + (response.statusText || '')).trim());

          const total = Number.parseInt(response.headers.get('content-length') || '0', 10) || 0;
          const stream = fs.createWriteStream(temporary, { flags: 'wx' });
          reader = response.body?.getReader();
          if (!reader) throw new Error('Download response had no body');

          let received = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = Buffer.from(value);
              if (!stream.write(chunk)) await new Promise((resolve, reject) => {
                stream.once('drain', resolve);
                stream.once('error', reject);
              });
              received += chunk.length;
              this.client.emit('download-status', { name, type, current: received, total });
            }
            stream.end();
            await new Promise((resolve, reject) => {
              stream.once('finish', resolve);
              stream.once('error', reject);
            });
          } catch (error) {
            stream.destroy();
            throw error;
          }

          if (total && received !== total) throw new Error('Incomplete download (' + received + '/' + total + ' bytes)');
          fs.rmSync(destination, { force: true });
          fs.renameSync(temporary, destination);
          this.client.emit('download', name);
          return { failed: false, asset: null };
        } catch (error) {
          lastError = error;
          try { await reader?.cancel(); } catch {}
          fs.rmSync(temporary, { force: true });
          this.client.emit('debug', '[MCLC]: Download failed (' + attempt + '/' + attempts + ') for ' + url + ': ' + error.message);
          if (attempt < attempts) {
            const resourcePressure = /ERR_INSUFFICIENT_RESOURCES/i.test(String(error?.message || error));
            const delay = resourcePressure ? attempt * 2000 : attempt * 750;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
    } finally {
      releaseSlot();
    }

    const detail = lastError?.message || 'unknown error';
    if (/ERR_INSUFFICIENT_RESOURCES/i.test(detail)) {
      throw new Error('Windows temporarily ran out of network resources while downloading ' + name + '. Pine reduced concurrent downloads and retried, but Windows is still refusing new connections. Close other download-heavy apps and try again.');
    }
    throw new Error('Failed to download ' + name + ': ' + detail);
  };
  Handler.prototype.getVersion = async function getVersion() {
    const versionJsonPath = this.options.overrides.versionJson
      || path.join(this.options.directory, `${this.options.version.number}.json`);
    if (fs.existsSync(versionJsonPath)) {
      this.version = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
      return this.version;
    }

    const cache = this.options.cache ? path.join(this.options.cache, 'json') : path.join(this.options.root, 'cache', 'json');
    fs.mkdirSync(cache, { recursive: true });
    const manifestResponse = await fetchImpl(`${this.options.overrides.url.meta}/mc/game/version_manifest.json`, {
      signal: AbortSignal.timeout(this.options.timeout || 50000),
    });
    if (!manifestResponse.ok) throw new Error(`Minecraft metadata returned HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const desired = manifest.versions?.find(version => version.id === this.options.version.number);
    if (!desired?.url) throw new Error(`Failed to find Minecraft ${this.options.version.number} in the version manifest`);

    const versionResponse = await fetchImpl(desired.url, { signal: AbortSignal.timeout(this.options.timeout || 50000) });
    if (!versionResponse.ok) throw new Error(`Minecraft version metadata returned HTTP ${versionResponse.status}`);
    this.version = await versionResponse.json();
    fs.writeFileSync(path.join(cache, `${this.options.version.number}.json`), JSON.stringify(this.version, null, 2));
    return this.version;
  };

  const originalDownloadToDirectory = Handler.prototype.downloadToDirectory;
  Handler.prototype.downloadToDirectory = async function verifiedDownloadToDirectory(directory, libraries, eventName) {
    for (const library of libraries || []) {
      const artifact = library?.downloads?.artifact;
      if (!artifact?.path || !artifact.sha1) continue;
      const target = path.join(directory, ...artifact.path.split('/'));
      try {
        if (fs.existsSync(target) && fileSha1(target) !== artifact.sha1) {
          this.client.emit('debug', `[MCLC]: Removing library with a bad checksum: ${artifact.path}`);
          fs.rmSync(target, { force: true });
        }
      } catch {
        fs.rmSync(target, { force: true });
      }
    }
    const result = await originalDownloadToDirectory.call(this, directory, libraries, eventName);
    for (const library of libraries || []) {
      const artifact = library?.downloads?.artifact;
      if (!artifact?.path || !artifact.sha1) continue;
      const target = path.join(directory, ...artifact.path.split('/'));
      if (fs.existsSync(target) && fileSha1(target) === artifact.sha1) continue;
      fs.rmSync(target, { force: true });
      const url = artifact.url || (library.url ? `${library.url}${artifact.path}` : null);
      if (!url) throw new Error(`Library checksum failed and no retry URL was available: ${artifact.path}`);
      await this.downloadAsync(url, path.dirname(target), path.basename(target), true, eventName);
      if (fileSha1(target) !== artifact.sha1) {
        fs.rmSync(target, { force: true });
        throw new Error(`Library checksum failed after retry: ${artifact.path}`);
      }
    }
    return result;
  };
}

module.exports = { installMclReliabilityPatches, fileSha1 };
