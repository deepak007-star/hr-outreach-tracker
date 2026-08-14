'use strict';
const crypto = require('crypto');
const db = require('../db/database');

const EMBED_MODEL = 'nomic-embed-text-v1_5';

async function getGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'groq_api_key'").get().catch(() => null);
  return row?.value || null;
}

// Circuit breaker: if the embeddings call fails (wrong model access on this
// account/plan, rate limit, etc.) don't retry on every single request — that
// wastes a real network round-trip per call for a guaranteed failure. Back
// off for a while, then self-heal by trying again (e.g. if Groq later grants
// this account access to the model) without needing a server restart.
let _unavailableUntil = 0;
const BACKOFF_MS = 30 * 60 * 1000;

// One embedding call per distinct text list. Batches (array input) count as
// a single request. Returns null (never throws) on missing key, rate limit,
// or any API error — every caller treats null as "fall back to skillMatch.js".
async function embedTexts(texts) {
  const key = await getGroqKey();
  if (!key || !texts?.length) return null;
  if (Date.now() < _unavailableUntil) return null;

  const { default: Groq } = await import('groq-sdk').catch(() => ({ default: null }));
  if (!Groq) return null;

  try {
    const groq = new Groq({ apiKey: key });
    const res  = await groq.embeddings.create({ input: texts, model: EMBED_MODEL });
    const byIndex = new Array(texts.length).fill(null);
    for (const e of res.data || []) {
      if (Array.isArray(e.embedding)) byIndex[e.index] = e.embedding;
    }
    if (!byIndex.every(v => v)) return null;
    _unavailableUntil = 0; // confirmed working — clear any prior backoff
    return byIndex;
  } catch (e) {
    console.warn(`[embeddingMatch] embedTexts failed — backing off ${BACKOFF_MS / 60000}min (falling back to lightweight match):`, e.message);
    _unavailableUntil = Date.now() + BACKOFF_MS;
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// In-memory cache of per-user skill embeddings — skills change rarely, and
// /contacts can be polled/refreshed often, so re-embedding on every request
// would burn API calls for no benefit. Keyed by userId + a hash of the
// skills list so an edit invalidates it immediately (see the "does editing
// skills reset anything" question this was built to answer — yes, this
// cache self-invalidates the moment the skills list actually changes).
const _skillEmbedCache = new Map(); // userId -> { hash, vectors, ts }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h safety net even if skills never change

function skillsHash(skills) {
  return crypto.createHash('sha1').update(JSON.stringify(skills)).digest('hex');
}

/**
 * Returns one embedding vector per skill (same order as input), or null if
 * Groq isn't configured/available — caller falls back to skillMatch.js.
 */
async function getUserSkillEmbeddings(userId, skills) {
  if (!skills?.length) return null;
  const hash = skillsHash(skills);
  const cached = _skillEmbedCache.get(userId);
  if (cached && cached.hash === hash && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.vectors;
  }

  const vectors = await embedTexts(skills);
  if (vectors) _skillEmbedCache.set(userId, { hash, vectors, ts: Date.now() });
  return vectors;
}

const SIMILARITY_THRESHOLD = 0.5; // cosine similarity above which a skill counts as "present" in the posting

/**
 * Per-skill semantic match against a posting's precomputed embedding
 * (job_postings.embedding, set by orchestrator.js at store time).
 * Returns null if either side has no embedding available — caller falls
 * back to the lightweight matcher for that posting.
 */
function matchAgainstPostingEmbedding(userSkills, skillVectors, postingEmbedding) {
  if (!skillVectors || !postingEmbedding?.length) return null;
  const matched = [];
  userSkills.forEach((skill, i) => {
    const v = skillVectors[i];
    if (v && cosineSimilarity(v, postingEmbedding) >= SIMILARITY_THRESHOLD) matched.push(skill);
  });
  return { percent: Math.round((matched.length / userSkills.length) * 100), matched, total: userSkills.length };
}

module.exports = { embedTexts, cosineSimilarity, getUserSkillEmbeddings, matchAgainstPostingEmbedding, EMBED_MODEL };
