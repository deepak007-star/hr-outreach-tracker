'use strict';

// Auto proxy sourcing for the Job Intel scraper.
//
// Pulls candidate proxies from several free, frequently-updated sources, then
// VALIDATES each one (real HTTP request through http/https proxies; TCP reach
// for socks) and caches only the working ones into the `proxy_auto_cache`
// setting as a newline-separated `proto://ip:port` list. The orchestrator merges
// this cache with the manual `proxy_list` before every scrape, so the pool stays
// large and fresh without manual upkeep.
//
// Free proxies are inherently short-lived and mostly dead — validation + a big
// candidate pool + frequent refresh is what turns them into usable yield. For
// materially better reliability, add a Webshare API key (free tier) in the
// auto-proxy config, or switch the scraper to an official search API.

const http = require('http');
const net  = require('net');
const axios = require('axios');

const NOW = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ── Default config ────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  enabled:           true,
  maxCandidates:     1000,   // cap before validation to bound run time
  concurrency:       100,    // parallel validations
  validateTimeoutMs: 6000,
  refreshIntervalMin: 45,    // background refresh cadence
  webshareApiKey:    '',     // optional — https://proxy.webshare.io free tier
  sources: {                 // toggle individual free sources
    proxyscrape: true,
    geonode:     true,
    monosans:    true,
    thespeedx:   true,
  },
};

// Plain-text (ip:port per line) and JSON sources. GitHub raw lists are refreshed
// every ~30 min by their maintainers and are the most reliable free option.
function buildSources(cfg) {
  const s = [];
  const on = k => cfg.sources?.[k] !== false;
  if (on('proxyscrape')) {
    for (const proto of ['http', 'socks4', 'socks5']) {
      s.push({ name: `proxyscrape-${proto}`, proto, kind: 'text',
        url: `https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=${proto}&proxy_format=ipport&format=text&timeout=10000` });
    }
  }
  if (on('monosans')) {
    for (const proto of ['http', 'socks4', 'socks5']) {
      s.push({ name: `monosans-${proto}`, proto, kind: 'text',
        url: `https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/${proto}.txt` });
    }
  }
  if (on('thespeedx')) {
    for (const proto of ['http', 'socks4', 'socks5']) {
      s.push({ name: `thespeedx-${proto}`, proto, kind: 'text',
        url: `https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/${proto}.txt` });
    }
  }
  if (on('geonode')) {
    s.push({ name: 'geonode', proto: 'auto', kind: 'geonode',
      url: 'https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc' });
  }
  if (cfg.webshareApiKey) {
    s.push({ name: 'webshare', proto: 'http', kind: 'webshare',
      url: 'https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100' });
  }
  return s;
}

const IPPORT = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})$/;

// ── Fetch candidates from all enabled sources ──────────────────────────────────
async function fetchCandidates(cfg) {
  const sources = buildSources(cfg);
  const perSource = {};
  const all = new Set();

  await Promise.all(sources.map(async src => {
    try {
      const headers = { 'User-Agent': 'Mozilla/5.0' };
      if (src.kind === 'webshare') headers.Authorization = `Token ${cfg.webshareApiKey}`;
      const resp = await axios.get(src.url, { timeout: 15000, headers, responseType: src.kind === 'text' ? 'text' : 'json', validateStatus: s => s < 500 });
      let urls = [];

      if (src.kind === 'text') {
        urls = String(resp.data).split(/\r?\n/).map(l => l.trim())
          .filter(l => IPPORT.test(l)).map(l => `${src.proto}://${l}`);
      } else if (src.kind === 'geonode') {
        for (const row of (resp.data?.data || [])) {
          const proto = (row.protocols?.[0] || 'http').toLowerCase();
          if (row.ip && row.port) urls.push(`${proto}://${row.ip}:${row.port}`);
        }
      } else if (src.kind === 'webshare') {
        for (const row of (resp.data?.results || [])) {
          if (row.proxy_address && row.port) {
            const auth = row.username ? `${row.username}:${row.password}@` : '';
            urls.push(`http://${auth}${row.proxy_address}:${row.port}`);
          }
        }
      }
      perSource[src.name] = urls.length;
      urls.forEach(u => all.add(u));
    } catch (e) {
      perSource[src.name] = `err: ${e.message.slice(0, 40)}`;
    }
  }));

  let list = [...all];
  // Shuffle so the candidate cap samples across sources, then cap
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  if (list.length > cfg.maxCandidates) list = list.slice(0, cfg.maxCandidates);
  return { candidates: list, perSource, totalFetched: all.size };
}

// ── Validation ─────────────────────────────────────────────────────────────────
// http/https proxy: real GET through the proxy to a tiny endpoint.
function validateHttpProxy(proxyUrl, timeoutMs) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    try {
      const u = new URL(proxyUrl);
      const opts = {
        host: u.hostname, port: u.port || 80, method: 'GET',
        path: 'http://httpbin.org/ip',               // absolute-form → proxy fetches it
        headers: { Host: 'httpbin.org', 'User-Agent': 'Mozilla/5.0', Accept: '*/*' },
        timeout: timeoutMs,
      };
      if (u.username) opts.headers['Proxy-Authorization'] =
        'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
      const req = http.request(opts, res => {
        res.destroy();
        finish(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => finish(false));
      req.on('timeout', () => { req.destroy(); finish(false); });
      req.end();
    } catch { finish(false); }
  });
}

// socks proxy: TCP reachability (Playwright speaks socks natively).
function validateTcp(proxyUrl, timeoutMs) {
  return new Promise(resolve => {
    try {
      const u = new URL(proxyUrl.replace(/^socks[45]:\/\//, 'http://'));
      const socket = net.createConnection({ host: u.hostname, port: parseInt(u.port) || 1080, timeout: timeoutMs }, () => {
        socket.destroy(); resolve(true);
      });
      socket.on('error',   () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

async function validate(urls, { concurrency, timeoutMs }) {
  const alive = [];
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const url = urls[idx++];
      const isSocks = /^socks[45]:\/\//i.test(url);
      const ok = isSocks ? await validateTcp(url, timeoutMs) : await validateHttpProxy(url, timeoutMs);
      if (ok) alive.push(url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return alive;
}

// ── Config + cache helpers (DB-backed) ─────────────────────────────────────────
async function getConfig(db) {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'proxy_auto_config'`).get().catch(() => null);
  let cfg = {};
  try { cfg = JSON.parse(row?.value || '{}'); } catch {}
  return { ...DEFAULT_CONFIG, ...cfg, sources: { ...DEFAULT_CONFIG.sources, ...(cfg.sources || {}) } };
}

async function saveConfig(db, patch) {
  const cur = await getConfig(db);
  const next = { ...cur, ...patch, sources: { ...cur.sources, ...(patch.sources || {}) } };
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('proxy_auto_config', ?)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`).run(JSON.stringify(next));
  return next;
}

async function getCache(db) {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'proxy_auto_cache'`).get().catch(() => null);
  try { return JSON.parse(row?.value || '{}'); } catch { return {}; }
}

// Fetch → validate → cache. Returns stats. `db` is the app db proxy.
async function refresh(db) {
  const cfg = await getConfig(db);
  const started = Date.now();
  const { candidates, perSource, totalFetched } = await fetchCandidates(cfg);
  const alive = await validate(candidates, { concurrency: cfg.concurrency, timeoutMs: cfg.validateTimeoutMs });

  const cache = {
    ts: NOW(),
    proxies: alive,
    stats: {
      totalFetched,
      tested: candidates.length,
      validated: alive.length,
      perSource,
      durationMs: Date.now() - started,
    },
  };
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('proxy_auto_cache', ?)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`).run(JSON.stringify(cache));
  return cache;
}

// Return cached validated proxies, refreshing first if stale/empty (used by orchestrator).
async function getFreshProxies(db) {
  const cfg = await getConfig(db);
  if (!cfg.enabled) return { proxies: [], cfg };
  let cache = await getCache(db);
  const ageMin = cache.ts ? (Date.now() - new Date(cache.ts.replace(' ', 'T') + 'Z').getTime()) / 60000 : Infinity;
  if (!cache.proxies?.length || ageMin > cfg.refreshIntervalMin) {
    try { cache = await refresh(db); } catch (e) { console.warn('[proxyFetcher] refresh failed:', e.message); }
  }
  return { proxies: cache.proxies || [], cfg, stats: cache.stats, ts: cache.ts };
}

module.exports = { DEFAULT_CONFIG, fetchCandidates, validate, refresh, getConfig, saveConfig, getCache, getFreshProxies };
