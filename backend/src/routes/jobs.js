const express = require('express');
const multer  = require('multer');
const path    = require('path');
const os      = require('os');
const fs      = require('fs');
const { scrapeLimiter } = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Helpers ────────────────────────────────────────────────────────────────

function stripHtml(html) {
  // Drop script / style / nav blocks entirely
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  html = html.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  html = html.replace(/<header[\s\S]*?<\/header>/gi, '');
  // Block-level tags → newline
  html = html.replace(/<\/?(p|div|h[1-6]|li|br|tr|section|article)[^>]*>/gi, '\n');
  // Strip remaining tags
  html = html.replace(/<[^>]+>/g, ' ');
  // Decode common entities
  html = html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#\d+;/g, ' ');
  // Collapse whitespace
  return html.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ── POST /api/jobs/scrape ──────────────────────────────────────────────────
router.post('/scrape', scrapeLimiter, async (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'A valid URL is required.' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return res.status(400).json({
        error: `Site returned HTTP ${response.status}. Paste the job description manually.`,
      });
    }

    const html  = await response.text();
    const title = (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i) || [])[1]?.trim() || 'Job Post';

    // Try to get the most relevant section
    const cheerio = require('cheerio');
    const $       = cheerio.load(html);
    $('script, style, nav, footer, header, [role="navigation"], .sidebar, .cookie, .ad').remove();

    const mainSelectors = [
      '[data-automation-id]',           // Workday
      '.job-description',
      '#job-description',
      '.description',
      '.posting-description',
      '.job-details',
      '.jobsearch-jobDescriptionText', // Indeed
      '[class*="description"]',
      'main',
      'article',
      '[role="main"]',
    ];

    let content = '';
    for (const sel of mainSelectors) {
      const el = $(sel).first();
      if (el.length && el.text().trim().length > 200) {
        content = el.text();
        break;
      }
    }
    if (!content) content = $('body').text();

    content = content.replace(/\s+/g, ' ').replace(/ \n/g, '\n').trim();
    if (content.length > 10000) content = content.slice(0, 10000);

    res.json({ title: title.replace(/\s*[-|].*$/, '').trim(), content, url });
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError' || err.code === 'UND_ERR_CONNECT_TIMEOUT';
    res.status(400).json({
      error: isTimeout
        ? 'Request timed out. Paste the job description manually.'
        : `Could not fetch the URL (${err.message.slice(0, 120)}). Paste the job description manually.`,
    });
  }
});

// ── POST /api/jobs/parse-resume ────────────────────────────────────────────
router.post('/parse-resume', requireAuth, upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const filePath = req.file.path;
  const ext      = path.extname(req.file.originalname || '').toLowerCase();
  const cleanup  = () => { try { fs.unlinkSync(filePath); } catch {} };

  try {
    let text = '';

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data   = await pdfParse(buffer);
      text = data.text;
    } else if (ext === '.docx' || ext === '.doc') {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } else if (ext === '.txt') {
      text = fs.readFileSync(filePath, 'utf8');
    } else {
      cleanup();
      return res.status(400).json({ error: 'Unsupported file type. Upload a PDF, DOCX, or TXT file.' });
    }

    cleanup();
    res.json({ text: text.replace(/\r\n/g, '\n').trim() });
  } catch (err) {
    cleanup();
    res.status(500).json({ error: `Failed to parse resume: ${err.message}` });
  }
});

module.exports = router;
