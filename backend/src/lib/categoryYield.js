'use strict';
const db = require('../db/database');

const SETTINGS_KEY = 'job_intel_category_yield';

async function getStats() {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SETTINGS_KEY).catch(() => null);
  try { return JSON.parse(row?.value || '{}'); } catch { return {}; }
}

async function saveStats(stats) {
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `).run(SETTINGS_KEY, JSON.stringify(stats));
}

/**
 * Merge a run's per-category {scanned, withEmail} tallies into the persisted
 * stats in one read-modify-write. This is the real feedback signal
 * weightedCategoryPick() learns from — a category that keeps producing no
 * emails quietly gets searched less often (but never zero, see epsilon
 * below). Call once per pipeline run with the full tally, not once per job
 * — per-job calls would race (concurrent read-modify-write on the same
 * settings row loses increments).
 */
async function recordBatch(tally) {
  if (!tally || !Object.keys(tally).length) return;
  try {
    const stats = await getStats();
    for (const [cat, delta] of Object.entries(tally)) {
      const s = stats[cat] || { scanned: 0, withEmail: 0 };
      s.scanned   += delta.scanned   || 0;
      s.withEmail += delta.withEmail || 0;
      stats[cat] = s;
    }
    await saveStats(stats);
  } catch (e) {
    console.warn('[categoryYield] recordBatch failed (non-fatal):', e.message);
  }
}

const OUTCOME_KEY = 'job_intel_category_outcome';

/**
 * Recompute per-category OUTCOME quality — of the job-intel contacts a
 * category has actually produced, how many were worth having (replied) vs
 * a dead end (bounced)? This is a different signal than scanned/withEmail
 * above (which only measures "did this category produce an email at all") —
 * a category could have a great email-yield rate but mostly bounce or never
 * get a reply, and this is what would surface that. Uses the category LABEL
 * already written as the first tag by orchestrator.js's syncJobIntelContacts,
 * translated back to the short key via categorize.js's LABEL_TO_KEY.
 */
async function refreshOutcomeWeights() {
  try {
    const { LABEL_TO_KEY } = require('../agents/categorize');
    const rows = await db.prepare(`
      SELECT c.tags, c.email_deliverable, cus.status
      FROM contacts c
      LEFT JOIN contact_user_state cus ON cus.contact_id = c.id
      WHERE c.email_source = 'job-intel'
    `).all();

    const outcome = {};
    for (const r of rows) {
      let tags = [];
      try { tags = JSON.parse(r.tags || '[]'); } catch {}
      const cat = LABEL_TO_KEY[tags[0]];
      if (!cat) continue;
      const o = outcome[cat] || (outcome[cat] = { contacted: 0, replied: 0, bounced: 0 });
      const status = r.status || 'New';
      if (!['New', 'Drafted'].includes(status)) o.contacted++;
      if (['Replied', 'Interview'].includes(status)) o.replied++;
      if (['hard_bounce', 'flagged'].includes(r.email_deliverable)) o.bounced++;
    }
    await db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `).run(OUTCOME_KEY, JSON.stringify(outcome));
    return outcome;
  } catch (e) {
    console.warn('[categoryYield] refreshOutcomeWeights failed (non-fatal):', e.message);
    return {};
  }
}

async function getOutcomeWeights() {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(OUTCOME_KEY).catch(() => null);
  let outcome = {};
  try { outcome = JSON.parse(row?.value || '{}'); } catch {}
  const weights = {};
  for (const [cat, o] of Object.entries(outcome)) {
    const replyRate     = (o.replied + 1) / (o.contacted + 2);         // Laplace-smoothed
    const bouncePenalty = o.contacted > 0 ? Math.max(0, 1 - o.bounced / o.contacted) : 1;
    weights[cat] = replyRate * bouncePenalty;
  }
  return weights;
}

/**
 * Laplace-smoothed yield rate per category — (withEmail+1)/(scanned+2) so an
 * unseen or barely-seen category starts near 0.5 (unbiased) instead of 0,
 * and a single lucky/unlucky run can't swing the weight to an extreme.
 * Blended with the outcome-quality signal above (weight to 30%, since outcome
 * data is much sparser — most categories will have zero replies for a long
 * time and shouldn't dominate the pick until there's real signal).
 */
async function getYieldWeights() {
  const stats   = await getStats();
  const outcome = await getOutcomeWeights();
  const weights = {};
  for (const [cat, s] of Object.entries(stats)) {
    const emailYield = (s.withEmail + 1) / (s.scanned + 2);
    weights[cat] = outcome[cat] != null ? emailYield * 0.7 + outcome[cat] * 0.3 : emailYield;
  }
  return weights;
}

/**
 * Epsilon-greedy pick from a list of categories, weighted by yield.
 * `epsilon` fraction of picks are uniform-random regardless of weight, so a
 * category can never be permanently starved by an early bad run — mirrors
 * "never fully trust a belief" rather than a one-shot commit.
 */
function weightedCategoryPick(categories, weights, epsilon = 0.3) {
  if (!categories.length) return null;
  if (Math.random() < epsilon) return categories[Math.floor(Math.random() * categories.length)];

  const scored = categories.map(c => ({ c, w: weights[c] != null ? weights[c] : 0.5 }));
  const total  = scored.reduce((sum, x) => sum + x.w, 0);
  if (total <= 0) return categories[Math.floor(Math.random() * categories.length)];

  let r = Math.random() * total;
  for (const { c, w } of scored) {
    r -= w;
    if (r <= 0) return c;
  }
  return scored[scored.length - 1].c;
}

/**
 * Builds a `windowSize` keyword window from `allKeywords`, biased toward
 * categories with a higher historical email yield, while still rotating
 * through every keyword within whichever category gets picked (via
 * lib/keywordRotation.js's nextWindow, keyed per-category so one favored
 * category doesn't just keep re-searching its first entry).
 */
async function pickWeightedKeywordWindow(allKeywords, windowSize, rotationPrefix) {
  if (!Array.isArray(allKeywords) || !allKeywords.length || windowSize <= 0) return [];
  const { categorize } = require('../agents/categorize');
  const { nextWindow }  = require('./keywordRotation');

  const buckets = {};
  for (const kw of allKeywords) {
    const cat = categorize({ title: kw, description: '' });
    (buckets[cat] = buckets[cat] || []).push(kw);
  }
  const categories = Object.keys(buckets);
  const weights     = await getYieldWeights();

  const picked = [];
  const seen   = new Set();
  let guard = 0;
  while (picked.length < windowSize && guard < windowSize * 20) {
    guard++;
    const cat = weightedCategoryPick(categories, weights);
    if (!cat) break;
    const [kw] = await nextWindow(`${rotationPrefix}_${cat}`, buckets[cat], 1);
    if (kw && !seen.has(kw)) { seen.add(kw); picked.push(kw); }
  }
  return picked;
}

module.exports = {
  recordBatch, getYieldWeights, weightedCategoryPick, pickWeightedKeywordWindow, SETTINGS_KEY,
  refreshOutcomeWeights, getOutcomeWeights, OUTCOME_KEY,
};
