'use strict';

const express  = require('express');
const crypto   = require('crypto');
const fs       = require('fs');
const https    = require('https');
const http     = require('http');
const db       = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getTransportForUser } = require('../services/mailTransport');
const { getResumeFile } = require('../services/resumeFiles');
const sanitizeHtml = require('sanitize-html');
const { extractContacts } = require('../lib/contactExtract');
const { cleanContactName, guessFirstNameFromEmail } = require('../lib/nameUtils');
const { keywordTokens } = require('../agents/relevanceFilter');
const { lightweightSkillMatch } = require('../lib/skillMatch');

// Shared HTML-safe subset (same as email.js)
const EMAIL_HTML_OPTS = {
  allowedTags: ['b','i','u','s','strong','em','del','ins','br','hr','p','div','span','ul','ol','li','blockquote','h1','h2','h3','a'],
  allowedAttributes: { '*': ['style','class'], 'a': ['href','target','rel'] },
  allowedSchemes: ['http','https','mailto'],
  disallowedTagsMode: 'discard',
};

const BACKGROUND_THRESHOLD = 5;

// Per-contact variable substitution supporting many common formats
function renderFeedTemplate(tpl, contact, profile) {
  const p = profile || {};
  // cleanContactName handles email-as-name, role keywords, full-name → first-name
  // at render time — covers contacts imported before the name-cleaning fix
  const firstName = cleanContactName(contact.name, contact.email);
  const skillsStr = Array.isArray(p.skills) ? p.skills.join(', ') : (p.skills || '');

  function sub(text, patterns, value) {
    let r = text;
    for (const pat of patterns) r = r.replace(pat, value || '');
    return r;
  }

  let result = tpl;
  // {{name}} → first name only (skips email-address values)
  result = sub(result, [
    /\{\{name\}\}/gi, /\{name\}/gi, /\[name\]/gi,
    /\{\{HR_?[Nn]ame\}\}/g, /\{HR_?[Nn]ame\}/g,
    /\{\{[Hh]iring_?[Mm]anager\}\}/g, /\{\{[Rr]ecipient_?[Nn]ame\}\}/g,
    /\{\{[Ff]ull_?[Nn]ame\}\}/g,
  ], firstName);
  result = sub(result, [/\{\{[Ff]irst_?[Nn]ame\}\}/g, /\{[Ff]irst_?[Nn]ame\}/g], firstName);
  result = sub(result, [
    /\{\{company\}\}/gi, /\{company\}/gi, /\[company\]/gi,
    /\{\{[Cc]ompany_?[Nn]ame\}\}/g,
  ], contact.company || '');
  result = sub(result, [/\{\{title\}\}/gi, /\{title\}/gi, /\{\{role\}\}/gi, /\{role\}/gi], contact.title || '');
  result = sub(result, [/\{\{email\}\}/gi, /\{email\}/gi], contact.email || '');
  // Profile vars
  result = sub(result, [/\{\{your_name\}\}/gi, /\{your_name\}/gi],         p.full_name        || '');
  result = sub(result, [/\{\{current_title\}\}/gi],                         p.current_title    || '');
  result = sub(result, [/\{\{experience\}\}/gi],                            p.total_experience || '');
  result = sub(result, [/\{\{notice_period\}\}/gi],                         p.notice_period    || '');
  result = sub(result, [/\{\{location\}\}/gi],                              p.location         || '');
  result = sub(result, [/\{\{linkedin_url\}\}/gi],                          p.linkedin_url     || '');
  result = sub(result, [/\{\{phone\}\}/gi],                                 p.phone            || '');
  result = sub(result, [/\{\{skills\}\}/gi],                                skillsStr);
  // Strip remaining tokens
  result = result.replace(/\{\{[\s\S]*?\}\}/g, '');
  result = result.replace(/\{[A-Za-z_]\w*\}/g, '');
  // Clean up greeting when name was empty: "Hi ," → "Hi,"
  result = result.replace(/\bHi\s+,/g, 'Hi,');
  return result;
}

// Kept as alias for any remaining call sites
const guessNameFromEmail = guessFirstNameFromEmail;

// Resolve attachment (mirrors email.js resolveAttachment, no google-drive dep here)
async function resolveFeedAttachment(attachment, userId) {
  if (!attachment?.type) return [];
  try {
    if (attachment.type === 'profile') {
      const profile = await db.prepare(
        'SELECT resume_file_path, resume_mime_type, resume_filename, resume_file_id FROM profiles WHERE user_id = ?'
      ).get(userId);
      const blob = await getResumeFile(profile?.resume_file_id, userId);
      if (blob) {
        return [{ filename: profile.resume_filename || blob.filename || 'resume', content: blob.data, contentType: blob.mime_type || profile.resume_mime_type || 'application/octet-stream' }];
      }
      if (profile?.resume_file_path && fs.existsSync(profile.resume_file_path)) {
        return [{ filename: profile.resume_filename || 'resume', path: profile.resume_file_path, contentType: profile.resume_mime_type || 'application/octet-stream' }];
      }
    } else if (attachment.type === 'vault' && attachment.vaultId) {
      const version = await db.prepare(
        'SELECT file_path, mime_type, label, resume_text, file_id FROM resume_versions WHERE id = ? AND user_id = ?'
      ).get(attachment.vaultId, userId);
      const blob = await getResumeFile(version?.file_id, userId);
      if (blob) {
        const ext = blob.mime_type?.includes('pdf') ? '.pdf' : blob.mime_type?.includes('word') ? '.docx' : '';
        return [{ filename: (version.label || 'resume') + ext, content: blob.data, contentType: blob.mime_type || version.mime_type || 'application/octet-stream' }];
      }
      if (version?.file_path && fs.existsSync(version.file_path)) {
        const ext = version.mime_type?.includes('pdf') ? '.pdf' : version.mime_type?.includes('word') ? '.docx' : '';
        return [{ filename: (version.label || 'resume') + ext, path: version.file_path, contentType: version.mime_type || 'application/octet-stream' }];
      }
      // Fallback: file missing on disk but resume text exists — send as .txt
      if (version?.resume_text?.trim()) {
        return [{ filename: (version.label || 'resume') + '.txt', content: Buffer.from(version.resume_text, 'utf8'), contentType: 'text/plain' }];
      }
    } else if (attachment.type === 'local' && attachment.data) {
      return [{ filename: attachment.filename || 'resume', content: Buffer.from(attachment.data, 'base64'), contentType: attachment.mimeType || 'application/octet-stream' }];
    }
  } catch (e) {
    console.warn('[feed-email] resolveAttachment failed (non-fatal):', e.message);
  }
  return [];
}

async function getSentToday(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = await db.prepare(
    "SELECT COUNT(*) as c FROM email_log WHERE LEFT(sent_at, 10) = ? AND user_id = ? AND delivery_status = 'sent'"
  ).get(today, userId);
  return parseInt(row?.c || 0);
}
async function getDailyCap() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'daily_send_cap'").get();
  return parseInt(row?.value || '20');
}
function sanitizeHeaderValue(val) {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[\r\n\t"<>]/g, '').trim();
}

const router = express.Router();

// ─── GET /api/scraped-jobs ────────────────────────────────────────────────────
// Query params: category, since (1d|3d|7d|24d|30d), limit, page, search, scraper

// Tokenizes `phrase` (stripping generic role words like "developer"/"senior" —
// see agents/relevanceFilter.js) and returns a SQL fragment requiring ALL of
// its tokens to appear (in any order, any of the given columns) — e.g.
// "Java Backend Engineer" no longer needs to appear as one literal substring
// (which real job titles almost never do — "Backend Developer (Java)" or
// "SDE 2 - Java" wouldn't match "%Java Backend Engineer%"), just each
// distinguishing word present somewhere.
function allTokensClause(phrase, columns, params) {
  const toks = keywordTokens(phrase);
  if (!toks.length) return null;
  const perToken = toks.map(t => {
    params.push(...columns.map(() => `%${t}%`));
    return `(${columns.map(c => `${c} ILIKE ?`).join(' OR ')})`;
  });
  return `(${perToken.join(' AND ')})`;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      category,
      since    = '7d',
      limit    = '50',
      page     = '1',
      search,
      scraper,
      profile_titles,
      profile_skills,
      min_match,
    } = req.query;

    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const pageNum  = Math.max(parseInt(page) || 1, 1);
    const offset   = (pageNum - 1) * limitNum;
    const minMatchNum = Math.min(Math.max(parseInt(min_match) || 0, 0), 100);

    // Compute cutoff timestamp based on 'since' param
    function sinceToCutoff(s) {
      const now = Date.now();
      const map = { '1d': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30 };
      const days = map[s] || 7;
      return new Date(now - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    }

    const cutoff = sinceToCutoff(since);
    const params = [cutoff];
    // Filter on scraped_at (last confirmed still-live), not created_at
    // (first-ever-discovered) — a job re-scraped/reconfirmed today but
    // first seen weeks ago should still show up in a "last 7 days" view.
    let q = 'SELECT * FROM scraped_jobs WHERE scraped_at >= ?';

    if (category) { q += ' AND job_category = ?'; params.push(category); }
    if (scraper)  { q += ' AND scraper_type = ?';  params.push(scraper); }

    let skills = [];
    if (search) {
      // Manual search box: token-AND across title/company/location/tags —
      // same relaxation as the profile filter below, just for free-typed text.
      const clause = allTokensClause(search, ['title', 'company', 'location', 'tags'], params);
      if (clause) q += ` AND ${clause}`;
    } else if (profile_titles || profile_skills) {
      // Profile filter: relevant if title/description/tags match ALL the
      // distinguishing tokens of ANY one preferred title (job_title_1/2/3,
      // current_title — same "keyword set" matching agents/relevanceFilter.js
      // uses for Job Intel), OR mention any one of the profile's skills.
      let titles = [];
      try { titles = JSON.parse(profile_titles || '[]'); } catch {}
      try { skills = JSON.parse(profile_skills || '[]'); } catch {}

      const groups = [];
      for (const t of titles.filter(Boolean)) {
        const clause = allTokensClause(t, ['title', 'description', 'tags'], params);
        if (clause) groups.push(clause);
      }
      for (const skill of skills.filter(Boolean).slice(0, 15)) {
        const s = `%${String(skill).toLowerCase()}%`;
        params.push(s, s, s);
        groups.push('(title ILIKE ? OR description ILIKE ? OR tags ILIKE ?)');
      }
      if (groups.length) q += ` AND (${groups.join(' OR ')})`;
    }

    // Skill-match scoring: only meaningful against the profile-driven feed
    // (not a manual keyword search) and only when the caller actually has
    // skills to score against. Pulls a bounded candidate window (same
    // "personal-scale, re-rank in JS" pattern as job-intelligence.js's
    // /contacts route) instead of scoring the whole table, computes a
    // percent match per job (lib/skillMatch.js — same scorer Job Intel
    // uses), optionally drops anything below min_match, then re-sorts by
    // match% so the most relevant jobs surface first instead of just the
    // most recent ones.
    if (!search && skills.length) {
      const CANDIDATE_CAP = 1000;
      const candidateQ = q + ' ORDER BY created_at DESC, id ASC LIMIT ?';
      const candidateRows = await db.prepare(candidateQ).all(...params, CANDIDATE_CAP);

      const scored = candidateRows.map(job => {
        const { percent, matched } = lightweightSkillMatch(skills, `${job.title || ''} ${job.description || ''}`);
        return { ...job, match_percent: percent, matched_skills: matched };
      });
      const filtered = minMatchNum > 0 ? scored.filter(j => j.match_percent >= minMatchNum) : scored;
      filtered.sort((a, b) => b.match_percent - a.match_percent || new Date(b.created_at) - new Date(a.created_at));

      const total = filtered.length;
      const jobs  = filtered.slice(offset, offset + limitNum);
      return res.json({
        jobs,
        total,
        page:  pageNum,
        limit: limitNum,
        since,
        pages: Math.max(1, Math.ceil(total / limitNum)),
        candidate_capped: candidateRows.length >= CANDIDATE_CAP,
      });
    }

    const countQ  = q.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countRow = await db.prepare(countQ).get(...params);
    const total    = parseInt(countRow?.total || 0);

    q += ' ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const rows = await db.prepare(q).all(...params);

    res.json({
      jobs:  rows,
      total,
      page:  pageNum,
      limit: limitNum,
      since,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/scraped-jobs/stats ──────────────────────────────────────────────

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const d30 = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const d7  = new Date(Date.now() - 7  * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

    const [total, last30, last7, byCategory] = await Promise.all([
      db.prepare('SELECT COUNT(*) as c FROM scraped_jobs').get(),
      db.prepare('SELECT COUNT(*) as c FROM scraped_jobs WHERE created_at >= ?').get(d30),
      db.prepare('SELECT COUNT(*) as c FROM scraped_jobs WHERE created_at >= ?').get(d7),
      db.prepare('SELECT job_category, COUNT(*) as c FROM scraped_jobs GROUP BY job_category').all(),
    ]);

    res.json({
      total:    parseInt(total?.c || 0),
      last30:   parseInt(last30?.c || 0),
      last7:    parseInt(last7?.c || 0),
      byCategory: Object.fromEntries((byCategory || []).map(r => [r.job_category, parseInt(r.c)])),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/scraped-jobs/purge (admin) ─────────────────────────────────────

router.post('/purge', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { retention_days } = req.body;
    const days = Math.max(parseInt(retention_days) || 30, 1);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

    const result = await db.prepare('DELETE FROM scraped_jobs WHERE created_at < ?').run(cutoff);

    // Update last_purge in settings
    const purgeRow = await db.prepare("SELECT value FROM settings WHERE key = 'purge_config'").get();
    let cfg = {};
    try { cfg = JSON.parse(purgeRow?.value || '{}'); } catch {}
    cfg.last_purge = new Date().toISOString().slice(0, 10);
    cfg.retention_days = days;
    await db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
      .run('purge_config', JSON.stringify(cfg));

    res.json({ deleted: result.changes, cutoff, retention_days: days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/scraped-jobs/feed-contacts ──────────────────────────────────────
// HR email/phone contacts for cold outreach from three sources:
//   1. scraped_jobs scraper_type='linkedin-feed' — explicit contact_email
//   2. linkedin_posts (Apify)  — emails extracted live from description
//   3. scraped_jobs scraper_type='naukri' — contacts extracted at scrape-time
//      OR re-extracted live from descriptions for pre-existing rows
//
// Query params: since (7d|14d|30d|90d), limit, page, search, source (all|linkedin|naukri)

router.get('/feed-contacts', requireAuth, async (req, res) => {
  try {
    const { since = '30d', limit = '200', page = '1', search, source = 'all' } = req.query;
    const limitNum = Math.min(parseInt(limit) || 100, 500);
    const pageNum  = Math.max(parseInt(page)  || 1,   1);
    const offset   = (pageNum - 1) * limitNum;

    const daysMap = { '1d': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30, '90d': 90 };
    const cutoff  = new Date(Date.now() - (daysMap[since] || 30) * 86_400_000)
      .toISOString().replace('T', ' ').slice(0, 19);

    let linkedinContacts = [];
    let apifyContacts    = [];
    let naukriContacts   = [];

    // ── 1. LinkedIn-feed Playwright scraper (explicit contact_email) ──────────
    if (source === 'all' || source === 'linkedin') {
      const scParams = [cutoff];
      let scQ = `SELECT id, title, company, location, description, link,
                        contact_email, contact_phone, google_form_link, whatsapp_link,
                        created_at, scraped_at, 'linkedin' as source
                 FROM scraped_jobs
                 WHERE scraper_type = 'linkedin-feed'
                   AND contact_email IS NOT NULL AND contact_email != ''
                   AND scraped_at >= ?`;
      if (search) {
        scQ += ` AND (title ILIKE ? OR company ILIKE ? OR contact_email ILIKE ? OR description ILIKE ?)`;
        const s = `%${search}%`; scParams.push(s, s, s, s);
      }
      scQ += ' ORDER BY created_at DESC LIMIT 2000';
      linkedinContacts = await db.prepare(scQ).all(...scParams);

      // ── 2. Apify linkedin_posts — extract emails from description live ──────
      try {
        const apParams = [cutoff];
        let apQ = `SELECT id::text as id, title, company_name as company, location,
                          description, post_url as link, author_name,
                          scraped_at as created_at, scraped_at
                   FROM linkedin_posts
                   WHERE description ~* '[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}'
                     AND scraped_at >= ?`;
        if (search) {
          apQ += ` AND (title ILIKE ? OR company_name ILIKE ? OR description ILIKE ?)`;
          const s = `%${search}%`; apParams.push(s, s, s);
        }
        apQ += ' ORDER BY scraped_at DESC LIMIT 2000';
        const apifyRaw = await db.prepare(apQ).all(...apParams);
        for (const post of apifyRaw) {
          const { contactEmail, contactPhone } = extractContacts(post.description || '');
          if (contactEmail) {
            apifyContacts.push({
              id:               `apify_${post.id}`,
              title:            post.title   || '',
              company:          post.company || post.author_name || '',
              location:         post.location || '',
              description:      post.description,
              link:             post.link    || '',
              contact_email:    contactEmail,
              contact_name:     post.author_name || '',
              contact_phone:    contactPhone,
              google_form_link: null,
              whatsapp_link:    null,
              created_at:       post.created_at,
              scraped_at:       post.scraped_at,
              source:           'linkedin',
            });
          }
        }
      } catch (e) {
        console.error('[feed-contacts] apify extraction failed:', e.message);
      }
    }

    // ── 3. Naukri scraped_jobs ────────────────────────────────────────────────
    // Rows where contact was extracted at scrape-time come back directly.
    // Older rows without contacts are re-processed live from description text.
    if (source === 'all' || source === 'naukri') {
      try {
        const nkParams = [cutoff];
        // First: rows that already have contact_email stored
        let nkQ = `SELECT id, title, company, location, description, link, apply_link,
                          contact_email, contact_phone, all_contacts,
                          google_form_link, whatsapp_link,
                          created_at, scraped_at, 'naukri' as source
                   FROM scraped_jobs
                   WHERE scraper_type = 'naukri'
                     AND scraped_at >= ?
                     AND (
                       (contact_email IS NOT NULL AND contact_email != '')
                       OR (contact_phone IS NOT NULL AND contact_phone != '')
                       OR description ~* '[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}'
                       OR description ~* '(?:\\+91|91|0)?[6-9][0-9]{9}'
                     )`;
        if (search) {
          nkQ += ` AND (title ILIKE ? OR company ILIKE ? OR description ILIKE ?)`;
          const s = `%${search}%`; nkParams.push(s, s, s);
        }
        nkQ += ' ORDER BY scraped_at DESC LIMIT 2000';
        const naukriRaw = await db.prepare(nkQ).all(...nkParams);

        for (const row of naukriRaw) {
          let email = row.contact_email || null;
          let phone = row.contact_phone || null;

          // Re-extract from description if the stored fields are empty
          if (!email && !phone) {
            const extracted = extractContacts(row.description || '');
            email = extracted.contactEmail;
            phone = extracted.contactPhone;
          }
          if (!email && !phone) continue;

          naukriContacts.push({
            id:               `naukri_${row.id}`,
            title:            row.title    || '',
            company:          row.company  || '',
            location:         row.location || '',
            description:      row.description,
            link:             row.apply_link || row.link || '',
            contact_email:    email,
            contact_name:     '',
            contact_phone:    phone,
            google_form_link: row.google_form_link || null,
            whatsapp_link:    row.whatsapp_link    || null,
            created_at:       row.created_at,
            scraped_at:       row.scraped_at,
            source:           'naukri',
          });
        }
      } catch (e) {
        console.error('[feed-contacts] naukri extraction failed:', e.message);
      }
    }

    // ── Merge: deduplicate on email, sort newest first ────────────────────────
    const seenEmails = new Set();
    const allSources = [...linkedinContacts, ...apifyContacts, ...naukriContacts];
    const merged = [];
    for (const c of allSources) {
      const key = c.contact_email?.toLowerCase();
      if (key && seenEmails.has(key)) continue;
      if (key) seenEmails.add(key);
      merged.push(c);
    }
    merged.sort((a, b) => (b.created_at || b.scraped_at || '').localeCompare(a.created_at || a.scraped_at || ''));

    const contacts = merged.slice(offset, offset + limitNum);

    // Mark which ones the current user has already emailed
    if (contacts.length) {
      const emails       = [...new Set(contacts.map(c => c.contact_email).filter(Boolean))];
      const placeholders = emails.map(() => '?').join(',');
      const emailed      = await db.prepare(
        `SELECT DISTINCT contact_email FROM gmail_tracked_emails WHERE user_id = ? AND contact_email IN (${placeholders})`
      ).all(req.user.userId, ...emails);
      const emailedSet = new Set(emailed.map(r => r.contact_email));
      contacts.forEach(c => { c.already_emailed = emailedSet.has(c.contact_email) ? 1 : 0; });
    }

    res.json({
      contacts,
      page:     pageNum,
      limit:    limitNum,
      total:    merged.length,
      counts: {
        linkedin: linkedinContacts.length + apifyContacts.length,
        naukri:   naukriContacts.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/scraped-jobs/send-feed-emails ──────────────────────────────────
// Sends one separate email per contact and records each in gmail_tracked_emails.
// Body: { subject, body, contacts: [{ email, name, company, title }] }

router.post('/send-feed-emails', requireAuth, async (req, res) => {
  try {
    // Accept both new format (template_subject/template_body with {{vars}}) and
    // legacy format (subject/body sent verbatim). New format does per-contact substitution.
    const {
      template_subject, template_body,
      subject: legacySubject, body: legacyBody,
      contacts, attachment,
    } = req.body;

    const subjectTpl = (template_subject || legacySubject || '').trim();
    const bodyTpl    = (template_body    || legacyBody    || '').trim();

    if (!Array.isArray(contacts) || !contacts.length)
      return res.status(400).json({ error: 'contacts[] required' });
    if (!subjectTpl || !bodyTpl)
      return res.status(400).json({ error: 'subject and body required' });

    const isAdmin    = req.user.role === 'admin';
    const cap        = isAdmin ? Infinity : await getDailyCap();
    const sentToday  = await getSentToday(req.user.userId);
    if (!isAdmin && sentToday >= cap)
      return res.status(429).json({ error: `Daily send cap of ${cap} reached. Try again tomorrow.` });

    const mail = await getTransportForUser(req.user.userId);
    if (!mail)
      return res.status(400).json({
        error: 'No email account connected. Connect Gmail or configure SMTP in Settings first.',
      });

    const { transport, fromEmail } = mail;
    const fromName = sanitizeHeaderValue(mail.fromName);
    let remaining  = isAdmin ? Infinity : cap - sentToday;
    const now      = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // Fetch sender profile for profile-var substitution
    const profile = await db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.userId).catch(() => null);

    // Resolve attachment once for all contacts
    const attachments = await resolveFeedAttachment(attachment || null, req.user.userId);
    const userId = req.user.userId;

    const doSend = async () => {
      const results = [];
      let rem = remaining;

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        const { email, name: rawName = '', company = '', title = '' } = contact;
        if (!email) { results.push({ email, ok: false, error: 'Missing email' }); continue; }
        if (rem <= 0) { results.push({ email, ok: false, error: 'Daily cap reached' }); continue; }

        const cRow = await db.prepare('SELECT id, name FROM contacts WHERE LOWER(email) = LOWER(?) AND user_id = ? LIMIT 1').get(email, userId);
        const name = cleanContactName(rawName || cRow?.name || '', email);

        const contactObj = { name, company, title, email };
        const renderedSubject = renderFeedTemplate(subjectTpl, contactObj, profile);
        const renderedBody    = renderFeedTemplate(bodyTpl,    contactObj, profile);

        const isHtml   = /<[a-zA-Z]/.test(renderedBody);
        const safeBody = isHtml ? sanitizeHtml(renderedBody, EMAIL_HTML_OPTS) : renderedBody;
        const textBody = isHtml
          ? safeBody.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
          : renderedBody;
        const htmlBody = isHtml
          ? `<div style="font-family:sans-serif;font-size:14px;line-height:1.7">${safeBody}</div>`
          : `<div style="font-family:sans-serif;font-size:14px;line-height:1.7">${
              renderedBody.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
            }</div>`;

        const safeName = sanitizeHeaderValue(name);
        const nowTs = new Date().toISOString().replace('T', ' ').slice(0, 19);
        try {
          await transport.sendMail({
            from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
            to:      safeName ? `"${safeName}" <${email}>` : email,
            subject: renderedSubject,
            text:    textBody,
            html:    htmlBody,
            ...(attachments.length > 0 ? { attachments } : {}),
          });

          await db.prepare(`
            INSERT INTO email_log (id, contact_id, user_id, subject, body_snapshot, delivery_status)
            VALUES (?, ?, ?, ?, ?, 'sent')
          `).run(crypto.randomUUID(), cRow?.id || null, userId, renderedSubject, textBody.slice(0, 500));

          await db.prepare(`
            INSERT INTO gmail_tracked_emails
              (id, user_id, contact_email, contact_name, subject, body_snippet, full_body, sent_at, email_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent')
            ON CONFLICT DO NOTHING
          `).run(crypto.randomUUID(), userId, email, safeName, renderedSubject, textBody.slice(0, 200), textBody, nowTs);

          if (rem !== Infinity) rem--;

          if (cRow?.id) {
            await db.prepare(`UPDATE contacts SET status = 'Sent', date_last_contacted = ? WHERE id = ? AND user_id = ?`)
              .run(nowTs, cRow.id, userId);
          }

          results.push({ email, ok: true });
        } catch (e) {
          results.push({ email, ok: false, error: e.message });
        }

        if (i < contacts.length - 1) await new Promise(r => setTimeout(r, 1000));
      }

      try {
        const { syncExcel } = require('../services/excelSync');
        const userContacts = await db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY date_added DESC').all(userId);
        await syncExcel(userContacts);
      } catch {}

      const sent = results.filter(r => r.ok).length;
      return { sent, total: results.length, results };
    };

    // Large batches run in background so the user can close the panel immediately
    if (contacts.length > BACKGROUND_THRESHOLD) {
      res.json({ queued: true, total: contacts.length });
      doSend()
        .then(({ sent, total, results: bg }) => {
          const failed = total - sent;
          return db.prepare(`INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'info', ?, ?)`)
            .run(crypto.randomUUID(), userId,
              `Feed emails done — ${sent}/${total} sent`,
              `${sent} delivered${failed > 0 ? `, ${failed} failed` : ''}. Check HR List for updated statuses.`);
        })
        .catch(e => console.error('[scraped-jobs/send-feed-emails] Background batch error:', e.message));
      return;
    }

    const { sent, total, results } = await doSend();
    res.json({ sent, total, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
