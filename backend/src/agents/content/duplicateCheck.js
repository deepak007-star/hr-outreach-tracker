'use strict';
const db = require('../../db/database');
const { embedTexts, cosineSimilarity } = require('../../lib/embeddingMatch');

// Stricter than embeddingMatch.js's own SIMILARITY_THRESHOLD (0.5, tuned for
// partial skill-in-posting matches) — this is a full-text near-duplicate
// check, so only flag genuinely repetitive content, not merely related.
const DUPLICATE_SIMILARITY_THRESHOLD = 0.88;

/**
 * Flags a candidate as too similar to something already approved/published
 * for this user. Fails OPEN: if embeddings aren't available (no Groq key,
 * rate-limited, circuit-broken) this returns false rather than blocking
 * generation — there's no cheaper fallback matcher worth building for
 * full-text near-duplication in Phase 1.
 */
async function isDuplicate(candidateText, userId) {
  const priorRows = await db.prepare(
    `SELECT content FROM content_posts
     WHERE user_id = ? AND status IN ('approved', 'scheduled', 'published')
     ORDER BY created_at DESC LIMIT 20`
  ).all(userId);
  if (!priorRows.length) return false;

  const vectors = await embedTexts([candidateText, ...priorRows.map(r => r.content)]);
  if (!vectors) return false;

  const [candidateVec, ...priorVecs] = vectors;
  return priorVecs.some(v => cosineSimilarity(candidateVec, v) >= DUPLICATE_SIMILARITY_THRESHOLD);
}

module.exports = { isDuplicate, DUPLICATE_SIMILARITY_THRESHOLD };
