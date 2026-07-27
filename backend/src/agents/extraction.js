'use strict';
const { extractContacts, hasOutreachIntent } = require('../lib/contactExtract');
const db = require('../db/database');

// ── Groq LLM fallback ────────────────────────────────────────────────────────

async function getGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'groq_api_key'").get().catch(() => null);
  return row?.value || null;
}

async function llmExtract(description) {
  const key = await getGroqKey();
  if (!key) return null;

  const { default: Groq } = await import('groq-sdk').catch(() => ({ default: null }));
  if (!Groq) return null;

  try {
    const groq  = new Groq({ apiKey: key });
    const snip  = description.slice(0, 1200);
    const chat  = await groq.chat.completions.create({
      model:      'llama-3.1-8b-instant',
      max_tokens: 120,
      messages:   [{
        role:    'user',
        content: `Extract direct HR contact information from this job description (email addresses, contact person name). Respond with valid JSON only, no explanation:\n{"found":false,"emails":[],"contact_name":null}\n\nJob description:\n${snip}`,
      }],
    });
    const text = chat.choices?.[0]?.message?.content?.trim() || '';
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    if (json.found && (json.emails?.length || json.contact_name)) return json;
  } catch (_) {}
  return null;
}

/**
 * Run regex extraction first; fall back to LLM only if:
 * - Regex found nothing
 * - But description shows outreach signals (resume/apply/contact mentions)
 *
 * Fast path: internal DB sources (scraped_jobs) may already have contact_email
 * extracted by the scraper — use that directly without re-running regex/LLM.
 */
async function extractFromJob(job) {
  // Fast path: scraper already extracted the email — trust it, skip regex/LLM
  if (job._pre_contact_email) {
    const emails = new Set([job._pre_contact_email]);
    if (job._pre_all_contacts) {
      try {
        const parsed = JSON.parse(job._pre_all_contacts);
        if (Array.isArray(parsed.emails)) parsed.emails.forEach(e => emails.add(e));
      } catch (_) {}
    }
    return {
      extracted_emails:       JSON.stringify([...emails].filter(Boolean)),
      extracted_contact_name: null,
      extraction_method:      'pre-extracted',
    };
  }

  const text   = job.description || '';
  const result = extractContacts(text);

  if (result.emails.length) {
    return {
      extracted_emails:       JSON.stringify(result.emails),
      // For LinkedIn posts use author name as contact name when regex finds the email
      extracted_contact_name: job._author_name || null,
      extraction_method:      'regex',
    };
  }

  if (hasOutreachIntent(text)) {
    const llmResult = await llmExtract(text);
    if (llmResult?.emails?.length) {
      return {
        extracted_emails:       JSON.stringify(llmResult.emails),
        extracted_contact_name: llmResult.contact_name || job._author_name || null,
        extraction_method:      'llm',
      };
    }
  }

  return {
    extracted_emails:       '[]',
    extracted_contact_name: null,
    extraction_method:      null,
  };
}

module.exports = { extractFromJob };
