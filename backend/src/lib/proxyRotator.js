'use strict';
/**
 * Proxy pool manager — round-robin with TCP health checks.
 *
 * Proxy URL formats accepted:
 *   http://host:port
 *   http://user:pass@host:port
 *   socks5://host:port   (Playwright supports socks5 natively)
 *
 * Orchestrator usage (has DB access):
 *   const proxyRotator = require('../lib/proxyRotator');
 *   await proxyRotator.loadFromDB();
 *   const url = proxyRotator.next();  // null if none configured
 *
 * Child-process scraper usage (no DB):
 *   proxyRotator.loadFromEnv();       // reads PROXY_URLS env var (comma-sep)
 *   const url = proxyRotator.next();
 */

const net = require('net');

const MAX_FAILURES = 3;

class ProxyRotator {
  constructor() {
    this._pool = []; // [{url, failures, lastUsed}]
    this._idx  = 0;
  }

  /** Load from newline-separated string (used by orchestrator after reading DB). */
  loadFromString(str) {
    const urls = (str || '').split('\n')
      .map(l => l.trim())
      .filter(l => l && /^(http|socks[45]):\/\//i.test(l));

    const existing = new Map(this._pool.map(p => [p.url, p]));
    this._pool = urls.map(url => existing.get(url) || { url, failures: 0, lastUsed: 0 });
    return this._pool.length;
  }

  /** Load from PROXY_URLS env var (comma-separated). For child processes. */
  loadFromEnv() {
    const raw = process.env.PROXY_URLS || '';
    if (!raw.trim()) return 0;
    return this.loadFromString(raw.split(',').join('\n'));
  }

  /** Next available proxy URL, or null when pool is empty or all dead. */
  next() {
    const alive = this._pool.filter(p => p.failures < MAX_FAILURES);
    if (!alive.length) {
      if (!this._pool.length) return null;
      // All proxies failed — reset failure counts and restart rotation
      this._pool.forEach(p => { p.failures = 0; });
      return this._pool[0].url;
    }
    this._idx  = this._idx % alive.length;
    const proxy = alive[this._idx];
    this._idx  = (this._idx + 1) % alive.length;
    proxy.lastUsed = Date.now();
    return proxy.url;
  }

  markFailed(url) {
    const p = this._pool.find(x => x.url === url);
    if (!p) return;
    p.failures++;
    if (p.failures >= MAX_FAILURES) {
      const safe = url.replace(/:[^:@]+@/, ':***@');
      console.warn(`[proxy] ${safe} marked dead after ${p.failures} failures`);
    }
  }

  markSuccess(url) {
    const p = this._pool.find(x => x.url === url);
    if (p) p.failures = 0;
  }

  get size() {
    return this._pool.filter(p => p.failures < MAX_FAILURES).length;
  }

  get total() { return this._pool.length; }

  /** Comma-separated string of all proxy URLs (for passing to child processes). */
  toCsvEnv() {
    return this._pool.map(p => p.url).join(',');
  }

  /**
   * TCP-level reachability check for one proxy.
   * Returns { url, alive, latencyMs }.
   */
  checkOne(url, timeoutMs = 6000) {
    return new Promise(resolve => {
      const start = Date.now();
      try {
        // Strip protocol to get host:port
        const cleaned = url.replace(/^socks[45]:\/\//, 'http://');
        const u       = new URL(cleaned);
        const port    = parseInt(u.port) || (u.protocol === 'https:' ? 443 : 80);
        const socket  = net.createConnection({ host: u.hostname, port, timeout: timeoutMs }, () => {
          socket.destroy();
          resolve({ url, alive: true,  latencyMs: Date.now() - start });
        });
        socket.on('error',   () => resolve({ url, alive: false, latencyMs: Date.now() - start }));
        socket.on('timeout', () => { socket.destroy(); resolve({ url, alive: false, latencyMs: Date.now() - start }); });
      } catch {
        resolve({ url, alive: false, latencyMs: Date.now() - start });
      }
    });
  }

  /** Health-check all proxies concurrently, mark dead ones. Returns summary. */
  async healthCheckAll(timeoutMs = 6000) {
    if (!this._pool.length) return { total: 0, alive: 0, dead: 0, latencies: [] };
    const results = await Promise.all(this._pool.map(p => this.checkOne(p.url, timeoutMs)));
    results.forEach(r => {
      if (!r.alive) {
        const p = this._pool.find(x => x.url === r.url);
        if (p) p.failures = MAX_FAILURES; // immediately mark dead
      }
    });
    const aliveList = results.filter(r => r.alive);
    return {
      total:    results.length,
      alive:    aliveList.length,
      dead:     results.length - aliveList.length,
      latencies: aliveList.map(r => r.latencyMs).sort((a, b) => a - b),
    };
  }
}

module.exports = new ProxyRotator(); // singleton — safe for in-process orchestrator use
