'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
class DownloadManager {
  constructor(onChange = () => {}) { this.jobs = new Map(); this.onChange = onChange; }
  list() { return [...this.jobs.values()].map(({ id, label, kind, status, received, total, error, startedAt }) => ({ id, label, kind, status, received, total, error, startedAt })); }
  emit() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.onChange(this.list()); }, 100);
    this.timer.unref?.();
  }
  async run(destination, perform) {
    const job = { id: crypto.randomUUID(), destination, label: path.basename(destination), kind: /(?:java|runtime|jdk|jre)/i.test(destination) ? 'Java' : /(?:pack|\.mrpack)/i.test(destination) ? 'Modpack / content' : /(?:mods|staging)/i.test(destination) ? 'Content' : 'Game files', status: 'downloading', received: 0, total: 0, error: '', startedAt: Date.now(), abort: new AbortController() };
    this.jobs.set(job.id, job);
    for (const [id, old] of this.jobs) {
      if (this.jobs.size <= 200) break;
      if (['downloaded', 'installed', 'queued', 'cancelled'].includes(old.status)) this.jobs.delete(id);
    }
    this.emit();
    const check = async () => {
      while (job.status === 'paused') await new Promise(resolve => { job.wake = resolve; });
      if (job.abort.signal.aborted) throw Object.assign(new Error('Download cancelled'), { code: 'DOWNLOAD_CANCELLED' });
    };
    const control = { signal: job.abort.signal, checkpoint: check, progress: (received, total) => { job.received = received; job.total = total || 0; this.emit(); } };
    try {
      for (;;) {
        await check();
        try {
          const result = await perform(control);
          await check();
          job.status = 'downloaded'; job.error = ''; this.emit();
          return result;
        } catch (error) {
          if (job.abort.signal.aborted) throw Object.assign(new Error('Download cancelled'), { code: 'DOWNLOAD_CANCELLED' });
          job.status = 'failed'; job.error = String(error.message || error).slice(0, 300); this.emit();
          // Keep the owning installation alive, so Retry resumes the real
          // operation instead of downloading an orphaned file after rollback.
          await new Promise(resolve => { job.wake = resolve; });
          await check();
          job.status = 'downloading'; job.error = ''; this.emit();
        }
      }
    } catch (error) { job.status = 'cancelled'; this.emit(); throw error; }
  }
  control(id, action) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Download no longer exists');
    if (action === 'pause' && job.status === 'downloading') job.status = 'paused';
    else if (action === 'resume' && job.status === 'paused') { job.status = 'downloading'; job.wake?.(); }
    else if (action === 'retry' && job.status === 'failed') { job.status = 'downloading'; job.wake?.(); }
    else if (action === 'cancel' && ['downloading', 'paused', 'failed'].includes(job.status)) { job.status = 'cancelled'; job.abort.abort(); job.wake?.(); }
    else throw new Error('This action is unavailable for the current download');
    this.emit();
  }
  markUnder(directory, status) {
    for (const job of this.jobs.values()) if (job.destination.startsWith(directory + path.sep) && (job.status === 'downloaded' || (status === 'installed' && job.status === 'queued'))) job.status = status;
    this.emit();
  }
  get active() { return [...this.jobs.values()].some(job => ['downloading', 'paused', 'failed'].includes(job.status)); }
}
module.exports = { DownloadManager };
