'use strict';
const db = require('../db/database');

/**
 * Rotates through a large keyword/title list a fixed-size window per call,
 * persisting an offset in `settings` so successive pipeline runs sample a
 * different slice instead of always hitting the same first N items — which
 * is what happens when a 100+ keyword list is fed through call sites that
 * `.slice(0, 5)` or `.slice(0, 15)` for rate-limit reasons. Over many runs
 * this cycles through the entire list instead of only ever using the first
 * few entries.
 *
 * @param {string} rotationKey  Stable key identifying this rotation (e.g. 'adzuna').
 * @param {string[]} allItems   The full candidate list.
 * @param {number} windowSize   How many items to return this call.
 */
async function nextWindow(rotationKey, allItems, windowSize) {
  if (!Array.isArray(allItems) || !allItems.length) return [];
  if (allItems.length <= windowSize) return allItems;

  const settingKey = `job_intel_rotation_${rotationKey}`;
  const row    = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(settingKey).catch(() => null);
  const offset = ((parseInt(row?.value, 10) || 0) % allItems.length + allItems.length) % allItems.length;

  const window = [];
  for (let i = 0; i < windowSize; i++) window.push(allItems[(offset + i) % allItems.length]);

  const nextOffset = (offset + windowSize) % allItems.length;
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(settingKey, String(nextOffset)).catch(() => {});

  return window;
}

module.exports = { nextWindow };
