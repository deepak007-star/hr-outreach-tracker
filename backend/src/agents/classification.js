'use strict';
const db = require('../db/database');

async function getGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'groq_api_key'").get().catch(() => null);
  return row?.value || null;
}

/**
 * LLM-powered relevance classifier.
 * cfg.keywords: string[] — the user's target job titles / keywords
 * cfg.seniority: string[] — e.g. ['entry', 'mid', 'senior']
 * cfg.locations: string[] — preferred locations
 *
 * Returns { is_relevant, seniority, confidence, reason }
 * Falls back to null (skip classification) if Groq unavailable.
 */
async function classifyJob(job, cfg) {
  const keywords  = cfg?.keywords?.join(', ') || '';
  if (!keywords) return { is_relevant: 1, seniority: 'any', classification_confidence: 0.5, classification_reason: 'No target profile configured — defaulting to relevant' };

  const key = await getGroqKey();
  if (!key) return null;

  const { default: Groq } = await import('groq-sdk').catch(() => ({ default: null }));
  if (!Groq) return null;

  try {
    const groq  = new Groq({ apiKey: key });
    const snip  = (job.description || '').slice(0, 800);
    const locHint = cfg.locations?.length ? `Preferred locations: ${cfg.locations.join(', ')}.` : '';
    const prompt = `You are a job relevance classifier. Target profile: looking for roles matching "${keywords}". ${locHint}

Job posting:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description snippet: ${snip}

Classify this job. Respond with valid JSON only (no explanation):
{"is_relevant":true,"seniority":"entry|mid|senior|lead|any","confidence":0.0,"reason":"brief reason under 20 words"}`;

    const chat = await groq.chat.completions.create({
      model:      'openai/gpt-oss-120b', // Groq retired the llama-3.x lineup — verified live against the current /v1/models list
      // gpt-oss-120b spends part of the budget on internal reasoning before
      // writing output; too-small a cap fails outright with forced JSON mode
      // instead of truncating (see candidateGenerator.js). Live-verified:
      // 300 still failed with an empty failed_generation (ran out of budget
      // before writing anything) — 1200 gives real headroom for this short
      // a JSON reply.
      max_tokens: 1200,
      response_format: { type: 'json_object' }, // forces strictly valid JSON — see agents/content/topicGenerator.js's comment
      messages:   [{ role: 'user', content: prompt }],
    });
    const text = chat.choices?.[0]?.message?.content?.trim() || '';
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return {
      is_relevant:                 json.is_relevant ? 1 : 0,
      seniority:                   json.seniority   || 'any',
      classification_confidence:   parseFloat(json.confidence) || 0,
      classification_reason:       (json.reason || '').slice(0, 200),
    };
  } catch (e) {
    console.warn('[Classification] LLM call failed:', e.message);
    return null;
  }
}

module.exports = { classifyJob };
