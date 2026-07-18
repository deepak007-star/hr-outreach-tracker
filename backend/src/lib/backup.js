'use strict';
/**
 * lib/backup.js — Backup for all scraped output
 *
 * backup/
 *   YYYY-MM-DD/
 *     linkedin/          <- output/linkedin/YYYY-MM-DD*
 *     linkedin-hr/       <- output/linkedin-hr/YYYY-MM-DD*
 *     linkedin-feed/     <- output/linkedin-feed/YYYY-MM-DD*
 *     naukri/            <- output/naukri/YYYY-MM-DD*
 *     general/           <- output/general/YYYY-MM-DD*
 *     legacy/            <- output/YYYY-MM-DD* (old root-level files)
 *     summary.json
 *   index.json
 *
 * Usage:
 *   node lib/backup.js           — backup today only
 *   node lib/backup.js --all     — full historical backup (all dates)
 *   node lib/backup.js 2026-07-17 — backup a specific date
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..', '..'); // backend/
const OUT_DIR = path.join(__dirname, '..', 'output');
const BAK_DIR = path.join(ROOT, 'backup');

const SCRAPERS = ['linkedin', 'linkedin-hr', 'linkedin-feed', 'naukri', 'general'];
const DATE_RE  = /^(\d{4}-\d{2}-\d{2})/; // filename must start with YYYY-MM-DD

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fileDate(filename) {
  const m = filename.match(DATE_RE);
  return m ? m[1] : null;
}

function safeCopy(src, dest) {
  try { fs.copyFileSync(src, dest); return true; }
  catch (e) { console.warn(`  [skip] ${path.basename(src)}: ${e.message}`); return false; }
}

// ─── Discover all dates that have output files ────────────────────────────────

function discoverDates() {
  const dates = new Set();

  // 1. Files directly in output/ root (legacy format)
  if (fs.existsSync(OUT_DIR)) {
    fs.readdirSync(OUT_DIR).forEach(f => {
      const d = fileDate(f);
      if (d) dates.add(d);
    });
  }

  // 2. Files inside scraper subdirs
  for (const scraper of SCRAPERS) {
    const dir = path.join(OUT_DIR, scraper);
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir).forEach(f => {
      const d = fileDate(f);
      if (d) dates.add(d);
    });
  }

  return [...dates].sort();
}

// ─── Backup one date ──────────────────────────────────────────────────────────

function backupDate(day) {
  const dayDir  = path.join(BAK_DIR, day);
  fs.mkdirSync(dayDir, { recursive: true });

  const results = {};

  // 1. Scraper subdirs: output/<scraper>/YYYY-MM-DD*
  for (const scraper of SCRAPERS) {
    const srcDir = path.join(OUT_DIR, scraper);
    if (!fs.existsSync(srcDir)) continue;

    const files = fs.readdirSync(srcDir).filter(f => f.startsWith(day));
    if (!files.length) continue;

    const destDir = path.join(dayDir, scraper);
    fs.mkdirSync(destDir, { recursive: true });

    let copied = 0;
    for (const file of files) {
      if (safeCopy(path.join(srcDir, file), path.join(destDir, file))) copied++;
    }
    if (copied) results[scraper] = { files: copied, list: files };
  }

  // 2. Legacy root files: output/YYYY-MM-DD*
  const rootFiles = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter(f => f.startsWith(day) && fs.statSync(path.join(OUT_DIR, f)).isFile())
    : [];

  if (rootFiles.length) {
    const destDir = path.join(dayDir, 'legacy');
    fs.mkdirSync(destDir, { recursive: true });
    let copied = 0;
    for (const file of rootFiles) {
      if (safeCopy(path.join(OUT_DIR, file), path.join(destDir, file))) copied++;
    }
    if (copied) results['legacy'] = { files: copied, list: rootFiles };
  }

  const totalFiles = Object.values(results).reduce((s, r) => s + r.files, 0);

  const summary = {
    date:       day,
    backedUpAt: new Date().toISOString(),
    scrapers:   results,
    totalFiles,
  };

  fs.writeFileSync(path.join(dayDir, 'summary.json'), JSON.stringify(summary, null, 2));
  updateIndex(day, summary);

  return summary;
}

// ─── Update top-level index ───────────────────────────────────────────────────

function updateIndex(day, summary) {
  const indexFile = path.join(BAK_DIR, 'index.json');
  let index = {};
  if (fs.existsSync(indexFile)) {
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch (_) {}
  }
  index[day] = {
    totalFiles: summary.totalFiles,
    scrapers:   Object.keys(summary.scrapers),
    updatedAt:  summary.backedUpAt,
  };
  const sorted = Object.fromEntries(
    Object.entries(index).sort(([a], [b]) => b.localeCompare(a))
  );
  fs.writeFileSync(indexFile, JSON.stringify(sorted, null, 2));
}

// ─── Public API ───────────────────────────────────────────────────────────────

function runBackup(date) {
  return backupDate(date || todayStr());
}

function runFullBackup() {
  const dates = discoverDates();
  if (!dates.length) return { dates: [], totalFiles: 0 };

  let totalFiles = 0;
  const perDate  = {};
  for (const day of dates) {
    const summary = backupDate(day);
    perDate[day]  = summary.totalFiles;
    totalFiles   += summary.totalFiles;
    console.log(`  ${day} -> ${summary.totalFiles} file(s) [${Object.keys(summary.scrapers).join(', ')}]`);
  }
  return { dates, perDate, totalFiles };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const arg = process.argv[2];

  if (arg === '--all') {
    console.log('\nFull historical backup — scanning all dates in output/...\n');
    const result = runFullBackup();
    if (!result.totalFiles) {
      console.log('Nothing found in output/ to back up.');
    } else {
      console.log(`\nDone. ${result.totalFiles} file(s) backed up across ${result.dates.length} date(s).`);
      console.log(`Folder: ${BAK_DIR}`);
      console.log('Index : backup/index.json');
    }

  } else {
    const day = arg || todayStr();
    console.log(`\nBacking up output for ${day}...\n`);
    const summary = backupDate(day);
    if (!summary.totalFiles) {
      console.log('  Nothing to back up for this date yet.');
    } else {
      console.log(`Backed up ${summary.totalFiles} file(s) to backup/${day}/`);
      for (const [scraper, info] of Object.entries(summary.scrapers)) {
        console.log(`  ${scraper.padEnd(16)} ${info.files} file(s)`);
        info.list.forEach(f => console.log(`    - ${f}`));
      }
      console.log('\nIndex updated: backup/index.json');
    }
  }
}

module.exports = { runBackup, runFullBackup, discoverDates };
