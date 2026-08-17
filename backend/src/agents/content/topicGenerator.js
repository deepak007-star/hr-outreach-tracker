'use strict';
const db = require('../../db/database');

async function getGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'groq_api_key'").get().catch(() => null);
  return row?.value || null;
}

/**
 * LLM-driven topic ideation, grounded ONLY in the user's own profile/GitHub
 * signals (no external trend/news discovery — that's a deferred phase).
 * Returns [] (never throws) if Groq is unavailable or the call fails.
 */
async function generateTopics(context, count = 1) {
  const key = await getGroqKey();
  if (!key) return [];

  const { default: Groq } = await import('groq-sdk').catch(() => ({ default: null }));
  if (!Groq) return [];

  try {
    const groq = new Groq({ apiKey: key });
    const prompt = `You are a LinkedIn content strategist helping a professional decide what to post about.

Here is what we know about them:
${context.summaryForPrompt}

Suggest ${count} distinct, specific LinkedIn post topic ideas based ONLY on the information above (their own role, skills, and recent GitHub activity) — do NOT invent external news, trends, or events they haven't mentioned. Each topic should be concrete enough to write a full post from, not a vague theme.

Respond with valid JSON only (no explanation): {"topics": ["topic 1", "topic 2"]}`;

    const chat = await groq.chat.completions.create({
      model:      'openai/gpt-oss-120b', // Groq retired the llama-3.x lineup — verified live against the current /v1/models list
      max_tokens: 400,
      // Forces strictly valid JSON (no markdown fencing, no explanatory
      // wrapper text) instead of relying on the model reliably following a
      // prompt instruction — verified live that plain prompting alone
      // sometimes produces JSON the regex-extract-then-parse below can't
      // handle (LLM output isn't deterministic run to run).
      response_format: { type: 'json_object' },
      messages:   [{ role: 'user', content: prompt }],
    });
    const text = chat.choices?.[0]?.message?.content?.trim() || '';
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return Array.isArray(json.topics) ? json.topics.filter(Boolean).slice(0, count) : [];
  } catch (e) {
    console.warn('[ContentAI] topic generation failed:', e.message);
    return [];
  }
}

module.exports = { generateTopics };
