'use strict';
const { extractContacts, hasOutreachIntent, cleanExtractedEmail, filterHrEmails } = require('../lib/contactExtract');
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
      model:      'openai/gpt-oss-20b', // Groq retired the llama-3.x lineup — verified live; smaller/faster tier matches the old 8b-instant's role
      // Bumped from 120 — same reasoning-token headroom issue as the 120b
      // model's calls elsewhere (see candidateGenerator.js's comment).
      max_tokens: 300,
      response_format: { type: 'json_object' }, // forces strictly valid JSON — see agents/content/topicGenerator.js's comment
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
// Context handed to filterHrEmails. The description alone is too thin: the
// company-domain test ("is narvee.com the company this post is about?") needs
// the title/company fields, and the academic-posting test often only has
// "university" in the title or the apply URL slug.
function filterContext(job) {
  return [job.title, job.company, job.company_name, job.description, job.apply_url]
    .filter(Boolean).join(' ');
}

async function extractFromJob(job) {
  // Fast path: scraper already extracted the email — validate then use it.
  // Don't blindly trust the scraped value: it may have absorbed adjacent text
  // (e.g. user@company.com.aupostal) or be a WhatsApp number (91XX@wa.me).
  if (job._pre_contact_email) {
    const primary = cleanExtractedEmail(job._pre_contact_email);
    const emails  = new Set(primary ? [primary] : []);
    if (job._pre_all_contacts) {
      try {
        const parsed = JSON.parse(job._pre_all_contacts);
        if (Array.isArray(parsed.emails)) {
          parsed.emails.forEach(e => {
            const clean = cleanExtractedEmail(e);
            if (clean) emails.add(clean);
          });
        }
      } catch (_) {}
    }
    // Re-run the HR-vs-candidate filter even on pre-extracted values. Rows
    // scraped before that filter existed carry whole harvested comment threads
    // in _pre_all_contacts, and this fast path is exactly how they reached
    // job_postings (extraction_method 'pre-extracted') and then Contacts.
    const hrEmails = filterHrEmails([...emails], filterContext(job));
    if (hrEmails.length) {
      return {
        extracted_emails:       JSON.stringify(hrEmails),
        extracted_contact_name: null,
        extraction_method:      'pre-extracted',
      };
    }
    // Fast path yielded no valid emails — fall through to regex/LLM extraction
  }

  const text   = job.description || '';
  const result = extractContacts(text);

  // extractContacts already filtered, but only against the description it was
  // given — re-narrow with the full context so the company-domain and
  // academic-posting tests can see the title/company/URL too.
  const regexEmails = filterHrEmails(result.emails, filterContext(job));
  if (regexEmails.length) {
    return {
      extracted_emails:       JSON.stringify(regexEmails),
      // For LinkedIn posts use author name as contact name when regex finds the email
      extracted_contact_name: job._author_name || null,
      extraction_method:      'regex',
    };
  }

  if (hasOutreachIntent(text)) {
    const llmResult = await llmExtract(text);
    if (llmResult?.emails?.length) {
      // LLM can hallucinate plausible-looking emails — a format check alone isn't
      // enough. Only trust ones that actually appear verbatim in the source text.
      const lowerText  = text.toLowerCase();
      const validEmails = filterHrEmails(
        llmResult.emails
          .map(cleanExtractedEmail)
          .filter(Boolean)
          .filter(e => lowerText.includes(e)),
        filterContext(job),
      );
      if (validEmails.length) {
        // Same hallucination risk applies to the contact name — an LLM can
        // invent a plausible-sounding person who isn't actually named in the
        // posting. Only trust it if it appears verbatim in the source text;
        // otherwise fall back to the (regex-derived, not LLM-invented) author name.
        const nameOk = llmResult.contact_name && lowerText.includes(llmResult.contact_name.toLowerCase());
        return {
          extracted_emails:       JSON.stringify(validEmails),
          extracted_contact_name: nameOk ? llmResult.contact_name : (job._author_name || null),
          extraction_method:      'llm',
        };
      }
    }
  }

  // No email found (regex or LLM), but a real Indian phone number was found in
  // text that already showed outreach intent (WhatsApp-only hiring posts are
  // common) — keep the posting with a secondary contact channel instead of
  // discarding it. Never synced into the email-based Contacts table
  // (contacts.email is required), only surfaced for browsing in Job Intel.
  if (result.phones.length && hasOutreachIntent(text)) {
    return {
      extracted_emails:       '[]',
      extracted_contact_name: job._author_name || null,
      extraction_method:      'phone-only',
      contact_channel:        `whatsapp:${result.phones[0]}`,
    };
  }

  return {
    extracted_emails:       '[]',
    extracted_contact_name: null,
    extraction_method:      null,
  };
}

module.exports = { extractFromJob };
