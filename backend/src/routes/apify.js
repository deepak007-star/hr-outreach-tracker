const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');
const jwt = require('jsonwebtoken');
const { requireAuth, requireAdmin, SECRET } = require('../middleware/auth');
const { check: rlCheck, record: rlRecord } = require('../middleware/rateLimiter');

// Validates token if present but never blocks (for rate-limit-aware optional auth)
function softAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) { try { req.user = jwt.verify(token, SECRET); } catch {} }
  next();
}

const router = express.Router();
const APIFY  = 'https://api.apify.com/v2';

async function getSettings() {
  const get = async key => (await db.prepare('SELECT value FROM settings WHERE key = ?').get(key))?.value || '';
  const searchQueriesRaw = await get('apify_search_queries');
  let searchQueries;
  try { searchQueries = JSON.parse(searchQueriesRaw || '[]'); } catch { searchQueries = []; }
  return {
    apiKey:       await get('apify_api_key'),
    actorId:      await get('apify_actor_id'),
    searchQueries,
    maxPosts:    parseInt((await get('apify_max_posts'))    || '150'),
    postedLimit: (await get('apify_posted_limit')) || '24h',
    sortBy:      (await get('apify_sort_by'))      || 'relevance',
  };
}

// ── GET /api/apify/settings (admin only) ───────────────────────────────────
router.get('/settings', requireAuth, requireAdmin, async (_, res) => {
  const s = await getSettings();
  res.json({
    apiKey:        s.apiKey ? '••••••••' + s.apiKey.slice(-4) : '',
    hasApiKey:     !!s.apiKey,
    actorId:       s.actorId,
    searchQueries: s.searchQueries,
    maxPosts:      s.maxPosts,
    postedLimit:   s.postedLimit,
    sortBy:        s.sortBy,
  });
});

// ── PUT /api/apify/settings (admin only) ───────────────────────────────────
router.put('/settings', requireAuth, requireAdmin, async (req, res) => {
  const set = async (k, v) => {
    if (v !== undefined && v !== null)
      await db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `).run(k, String(v));
  };
  await set('apify_actor_id',       req.body.actorId);
  await set('apify_max_posts',      req.body.maxPosts);
  await set('apify_posted_limit',   req.body.postedLimit);
  await set('apify_sort_by',        req.body.sortBy);
  if (Array.isArray(req.body.searchQueries))
    await set('apify_search_queries', JSON.stringify(req.body.searchQueries));
  // Only overwrite API key if a non-masked value is provided
  if (req.body.apiKey && !req.body.apiKey.startsWith('••••'))
    await set('apify_api_key', req.body.apiKey);
  res.json({ success: true });
});

// ── Parse a raw Apify post item into DB-ready fields ─────────────────────
const TECH_KEYWORDS = [
  'Java', 'Python', 'JavaScript', 'TypeScript', 'Go', 'Golang', 'Kotlin', 'Swift',
  'Rust', 'C#', 'C++', 'PHP', 'Ruby', 'Scala', 'SQL',
  'Spring Boot', 'Spring MVC', 'Spring', 'Django', 'Flask', 'FastAPI',
  'Express', 'NestJS', 'Rails', 'Hibernate', 'JPA',
  'React', 'Angular', 'Vue', 'Next.js', 'Nuxt', 'Svelte',
  'Node.js', 'Node',
  'MongoDB', 'MySQL', 'PostgreSQL', 'Postgres', 'Redis', 'Cassandra',
  'DynamoDB', 'Oracle', 'SQLite', 'Elasticsearch', 'HBase', 'DB2',
  'Kafka', 'Apache Kafka', 'RabbitMQ', 'ActiveMQ', 'SQS',
  'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins',
  'GitHub Actions', 'GitLab CI', 'CI/CD', 'Maven', 'Gradle',
  'AWS', 'Azure', 'GCP', 'Google Cloud',
  'GraphQL', 'gRPC', 'REST', 'Microservices',
  'Hadoop', 'Spark', 'Flink', 'Airflow',
  'Prometheus', 'Grafana', 'ELK', 'Datadog',
  'TensorFlow', 'PyTorch', 'LangChain', 'ML', 'AI',
  'MERN', 'MEAN', 'Full Stack', 'FullStack',
  'Resilience4j', 'HikariCP',
];

const HIRING_PATTERNS = [
  /we'?re hiring/i, /we are hiring/i, /#hiring\b/i,
  /looking for\b/i, /\bopen position/i, /join our team/i,
  /\bapply now\b/i, /send (your )?resume/i, /\bapply at\b/i,
  /immediate (join|open)/i, /\bvacancy\b/i, /job opening/i,
  /\brecruiting\b/i, /\bopportunity\b/i,
];

function parseApifyPost(item) {
  const content = item.content || item.description || '';
  const lines   = content.split('\n').map(l => l.trim()).filter(Boolean);

  // Title: first non-emoji, non-hashtag line capped at 120 chars
  let title = (lines[0] || '').replace(/^[\s🚀💼📢🔥✨🎯⚡📍💡🏢🌟🔔]+/, '').trim().slice(0, 120);

  // Company: from contentAttributes (most reliable) or text extraction
  const compAttr = (item.contentAttributes || []).find(a => a.type === 'COMPANY_NAME');
  let company = compAttr?.company?.name || '';
  if (!company) {
    const cm = content.match(/(?:at|@|from|by|company[:\s]+)\s+([A-Z][A-Za-z0-9\s&.,'-]{2,40}?)(?:\s+is|\s+are|\s*[|•\n])/);
    company = cm?.[1]?.trim() || '';
  }

  // Location: look for 📍 or "Location:" patterns
  const locMatch = content.match(/📍\s*([^\n•|,]+)|[Ll]ocation\s*[:\-]\s*([^\n•|,]+)/);
  const location = ((locMatch?.[1] || locMatch?.[2] || '').trim()).slice(0, 100);

  // Job type
  const jtMatch = content.match(/\b(full[\s-]?time|part[\s-]?time|remote|hybrid|on[\s-]?site|onsite|contract|freelance|internship|wfh)\b/i);
  const jobType = jtMatch?.[0]?.toLowerCase() || '';

  // Tech stack: case-insensitive keyword scan
  const contentLower = content.toLowerCase();
  const techStack = TECH_KEYWORDS.filter(t => {
    const tl = t.toLowerCase();
    // word-boundary-aware check
    const re = new RegExp(`(?<![a-z])${tl.replace(/[.+]/g, '\\$&')}(?![a-z])`, 'i');
    return re.test(content);
  });

  // Hiring detection
  const isHiring = HIRING_PATTERNS.some(p => p.test(content));

  // Confidence score (0–1)
  let score = 0;
  if (/\bhiring\b/i.test(content))            score += 0.25;
  if (/\bapply\b/i.test(content))             score += 0.15;
  if (/\bresume\b|\bcv\b/i.test(content))     score += 0.15;
  if (/\bexperience\b/i.test(content))        score += 0.10;
  if (location)                                score += 0.10;
  if (techStack.length >= 2)                   score += 0.15;
  else if (techStack.length === 1)             score += 0.05;
  if (/📍/.test(content))                     score += 0.05;
  if (company)                                 score += 0.05;
  score = Math.min(1, score);

  return {
    id:              item.id || crypto.randomUUID(),
    raw_json:        JSON.stringify(item),
    title,
    description:     content,
    company_name:    company,
    author_name:     item.author?.name || '',
    author_headline: item.author?.info || item.author?.headline || '',
    author_linkedin: item.author?.linkedinUrl || '',
    location,
    job_type:        jobType,
    tech_stack:      JSON.stringify(techStack),
    post_url:        item.linkedinUrl || item.postUrl || item.shareLinkedinUrl || '',
    posted_at:       item.postedAt?.date || '',
    likes:           item.engagement?.likes    || 0,
    comments:        item.engagement?.comments || 0,
    is_hiring:       isHiring ? 1 : 0,
    confidence_score: score,
  };
}

// ── Standalone scrape logic (used by route + auto-fetch) ──────────────────
async function performScrape(overrides = {}) {
  const s = await getSettings();
  if (!s.apiKey)  return { error: 'Apify API key not set.' };
  if (!s.actorId) return { error: 'Actor ID not set.' };

  const input = {
    searchQueries: overrides.searchQueries?.length ? overrides.searchQueries : s.searchQueries,
    maxPosts:      overrides.maxPosts    || s.maxPosts,
    postedLimit:   overrides.postedLimit || s.postedLimit,
    sortBy:        overrides.sortBy      || s.sortBy,
    scrapeComments:  false,
    scrapeReactions: false,
  };

  // Start actor run
  const runRes = await fetch(
    `${APIFY}/acts/${encodeURIComponent(s.actorId)}/runs`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(input),
    }
  );

  if (!runRes.ok) {
    const txt = await runRes.text();
    return { error: `Apify error (${runRes.status}): ${txt.slice(0, 300)}` };
  }

  const runData   = await runRes.json();
  const runId     = runData.data?.id;
  const datasetId = runData.data?.defaultDatasetId;
  if (!runId) return { error: 'Apify did not return a run ID.' };

  // Poll for completion (max 3 minutes)
  let status   = 'RUNNING';
  const tStart = Date.now();
  while (['RUNNING', 'READY', 'CREATED'].includes(status)) {
    if (Date.now() - tStart > 180_000)
      return { error: 'Apify run timed out (3 min). Try fewer queries.' };
    await new Promise(r => setTimeout(r, 4000));
    const poll = await fetch(`${APIFY}/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${s.apiKey}` },
    });
    status = (await poll.json()).data?.status;
  }

  if (status !== 'SUCCEEDED')
    return { error: `Apify run ended with status: ${status}` };

  // Fetch dataset items (limit=2000 to capture full run output)
  const itemsRes = await fetch(
    `${APIFY}/datasets/${datasetId}/items?format=json&clean=true&limit=2000`,
    { headers: { Authorization: `Bearer ${s.apiKey}` } }
  );
  const raw   = await itemsRes.json();
  const items = Array.isArray(raw) ? raw : (raw.items || raw.jobs || []);

  // Upsert — accumulate posts, never delete history
  let imported = 0;

  const stmt = db.prepare(`
    INSERT INTO linkedin_posts
      (id, raw_json, title, description, company_name, author_name,
       author_headline, author_linkedin, location, job_type, tech_stack,
       post_url, posted_at, likes, comments, is_hiring, confidence_score)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (id) DO UPDATE SET
      raw_json = EXCLUDED.raw_json, title = EXCLUDED.title, description = EXCLUDED.description,
      company_name = EXCLUDED.company_name, author_name = EXCLUDED.author_name,
      author_headline = EXCLUDED.author_headline, author_linkedin = EXCLUDED.author_linkedin,
      location = EXCLUDED.location, job_type = EXCLUDED.job_type, tech_stack = EXCLUDED.tech_stack,
      post_url = EXCLUDED.post_url, posted_at = EXCLUDED.posted_at, likes = EXCLUDED.likes,
      comments = EXCLUDED.comments, is_hiring = EXCLUDED.is_hiring, confidence_score = EXCLUDED.confidence_score
  `);

  for (const item of items) {
    try {
      const p = parseApifyPost(item);
      await stmt.run(
        p.id, p.raw_json, p.title, p.description, p.company_name,
        p.author_name, p.author_headline, p.author_linkedin,
        p.location, p.job_type, p.tech_stack, p.post_url,
        p.posted_at, p.likes, p.comments, p.is_hiring, p.confidence_score,
      );
      imported++;
    } catch (e) {
      console.error('Failed to insert post:', e.message);
    }
  }

  return { imported, total: items.length };
}

// ── POST /api/apify/scrape (admin only) ───────────────────────────────────
router.post('/scrape', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await performScrape(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });

    // Record last scrape time
    await db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `).run('apify_last_scrape', new Date().toISOString());

    res.json({ success: true, imported: result.imported, total: result.total });
  } catch (err) {
    console.error('Apify scrape error:', err);
    res.status(500).json({ error: err.message || 'Scrape failed' });
  }
});

// ── GET /api/apify/posts ───────────────────────────────────────────────────
router.get('/posts', requireAuth, async (req, res) => {
  const { search, hiring_only } = req.query;
  const wheres = [];
  const params = [];

  if (search) {
    wheres.push('(title ILIKE ? OR description ILIKE ? OR company_name ILIKE ? OR author_name ILIKE ? OR tech_stack ILIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }
  if (hiring_only === 'true') wheres.push('is_hiring = 1');

  let sql = 'SELECT * FROM linkedin_posts';
  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
  sql += ' ORDER BY confidence_score DESC, scraped_at DESC';

  const rows = await db.prepare(sql).all(...params);
  const posts = rows.map(p => ({
    ...p,
    tech_stack: (() => { try { return JSON.parse(p.tech_stack || '[]'); } catch { return []; } })(),
  }));
  res.json(posts);
});

const VALID_POST_STATUSES = new Set(['new', 'saved', 'applied', 'skipped', 'interviewing', 'rejected']);

// ── PATCH /api/apify/posts/:id/status ─────────────────────────────────────
router.patch('/posts/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;

  if (!VALID_POST_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  if (status === 'applied') {
    const uid    = req.user.userId;
    const result = rlCheck(uid, 'apply');
    if (!result.allowed) {
      const resetStr = result.resetAt
        ? ` Resets at ${result.resetAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`
        : '';
      return res.status(429).json({
        error: `Job application limit reached: ${result.max} per 3 hours.${resetStr}`,
        rateLimitInfo: { ...result, type: 'apply' },
      });
    }
    rlRecord(uid, 'apply');
  }

  await db.prepare('UPDATE linkedin_posts SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// ── DELETE /api/apify/posts — admin-only manual clear ─────────────────────
router.delete('/posts', requireAuth, requireAdmin, async (_, res) => {
  await db.exec('DELETE FROM linkedin_posts');
  res.json({ success: true });
});

module.exports = router;
module.exports.performScrape = performScrape;
module.exports.getSettings   = getSettings;
