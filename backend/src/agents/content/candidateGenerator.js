'use strict';
const db = require('../../db/database');

async function getGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'groq_api_key'").get().catch(() => null);
  return row?.value || null;
}

const VARIANT_LABELS = ['A', 'B', 'C', 'D', 'E'];

/**
 * Generates n distinct post drafts for one topic. Returns [] (never throws)
 * if Groq is unavailable or the call fails — caller just skips this topic.
 */
async function generateCandidates(topic, context, n = 3) {
  const key = await getGroqKey();
  if (!key) return [];

  const { default: Groq } = await import('groq-sdk').catch(() => ({ default: null }));
  if (!Groq) return [];

  try {
    const groq = new Groq({ apiKey: key });
    const prompt = `You are ghostwriting a LinkedIn post for this person:
${context.summaryForPrompt}

Topic: "${topic}"

Write ${n} distinctly different draft posts on this topic, in the first person, in a natural professional-but-human voice — no corporate buzzwords, no excessive emoji, no "I'm thrilled to announce" clichés. Each draft should be 80-200 words and ready to publish as-is.

Respond with valid JSON only: {"drafts": ["draft 1 text", "draft 2 text"]}`;

    const chat = await groq.chat.completions.create({
      model:      'llama-3.3-70b-versatile',
      max_tokens: 1500,
      messages:   [{ role: 'user', content: prompt }],
    });
    const text = chat.choices?.[0]?.message?.content?.trim() || '';
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const drafts = Array.isArray(json.drafts) ? json.drafts.filter(Boolean).slice(0, n) : [];
    return drafts.map((content, i) => ({ variant_label: VARIANT_LABELS[i] || String(i + 1), content }));
  } catch (e) {
    console.warn('[ContentAI] candidate generation failed:', e.message);
    return [];
  }
}

/**
 * "Make it more like me" / regenerate-with-instruction. Returns null (never
 * throws) on failure — caller keeps the existing content unchanged.
 */
async function regenerateCandidate(existingContent, instruction, context) {
  const key = await getGroqKey();
  if (!key) return null;

  const { default: Groq } = await import('groq-sdk').catch(() => ({ default: null }));
  if (!Groq) return null;

  try {
    const groq = new Groq({ apiKey: key });
    const prompt = `You are revising a LinkedIn draft post for this person:
${context.summaryForPrompt}

Current draft:
"""
${existingContent}
"""

Instruction for the revision: "${instruction || 'Make it sound more like me — keep the core message, adjust the tone and voice.'}"

Rewrite the post applying that instruction. Keep it 80-200 words, first person, ready to publish as-is. Respond with the revised post text ONLY — no surrounding quotes, no preamble, no explanation.`;

    const chat = await groq.chat.completions.create({
      model:      'llama-3.3-70b-versatile',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }],
    });
    const text = chat.choices?.[0]?.message?.content?.trim() || '';
    return text.replace(/^"+|"+$/g, '') || null;
  } catch (e) {
    console.warn('[ContentAI] regenerate failed:', e.message);
    return null;
  }
}

module.exports = { generateCandidates, regenerateCandidate };
