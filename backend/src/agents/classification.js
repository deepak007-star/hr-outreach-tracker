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
      model:      'llama-3.3-70b-versatile',
      max_tokens: 100,
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
