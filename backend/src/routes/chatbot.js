const router   = require('express').Router();
const Groq     = require('groq-sdk');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const database = require('../db/database');
const { randomUUID } = require('crypto');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Maximum recent messages to include in context
const MAX_HISTORY = 12;

// ── Core system prompt about the app ────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `You are VartaBot, the friendly AI assistant for HR Outreach Tracker — a personal job-search CRM for job seekers.

## About This App

HR Outreach Tracker is a powerful job-search CRM that helps users:
- **Track HR/recruiter contacts**: Add people, track conversation status from New → Interview
- **Send personalized outreach emails**: Using templates with variables like {name}, {company}
- **Scrape fresh jobs**: Auto-pulls from LinkedIn, Naukri, Foundit, Internshala, remote boards daily at 7 AM IST
- **Resume tools**: ATS scoring, resume templates (10+ designs), resume vault with version history
- **Gmail integration**: Connect Gmail via OAuth to send & track email opens/replies
- **Job analysis**: Upload/paste job descriptions; get ATS match score against your resume
- **LinkedIn posts**: Browse hiring posts from LinkedIn with extracted HR contacts

## Plans & Pricing
| Plan | Price | Contacts | Emails/Day |
|------|-------|----------|------------|
| Guest | Free | 5 (limited view) | — |
| Demo | Free | 10 | 10/day |
| Basic | ₹299/mo | 100 | 50/day |
| Advanced | ₹599/mo | Unlimited | 200/day |

Upgrade by clicking "Plans" in the top navigation, then selecting your plan and paying securely via Razorpay (supports UPI, Cards, Net Banking, Wallets).

## Navigation Guide
- **Home tab** (house icon): Dashboard — activity calendar, email stats, quick stats overview
- **Contacts tab** (users icon): Your main CRM table with sub-tabs:
  - **My Contacts**: Add/edit/delete HR contacts, filter by status, bulk-email
  - **Cold Email**: Cold outreach workflow and email sequences
  - **Job Links**: Live job feed scraped from job boards
- **Templates tab** (file icon): Create/edit email templates; use {name}, {company}, {title}, {your_name} variables
- **Jobs tab** (target icon): Analyze job descriptions — paste a JD or URL for instant ATS match score
- **Profile tab** (user icon): Edit your profile, upload resume, manage resume versions

## Common Tasks

### Adding a Contact
1. Go to Contacts tab → My Contacts
2. Click the blue "+ Add Contact" button (top-right of the table)
3. Fill in name, email, company, title, notes
4. Click Save — contact appears in your table

### Sending an Email
1. Tick one or more contacts in the Contacts table
2. Click the "Compose" button that appears in the action bar
3. Choose a template (or write custom), preview it, then send
4. Status auto-updates to "Sent"; opens/replies tracked if Gmail is connected

### Connecting Gmail (Recommended)
1. Click your avatar/name in the top-right header
2. Click "Connect Gmail" or go to Settings → Gmail
3. Authorize with your Google account
4. All outreach now sends from your real Gmail address with full open/reply tracking

### Creating Email Templates
1. Go to Templates tab
2. Click "+ New Template"
3. Use variables: {name} = contact name, {company} = company, {title} = job title, {your_name} = your name
4. Click Save and set as default if you like

### Importing Contacts
1. Contacts tab → My Contacts → click "Import" button
2. Upload a CSV or Excel file (columns: name, email, company, title, status)
3. Review and confirm — contacts are added in bulk

### Job Analysis (ATS Scoring)
1. Go to Jobs tab
2. Paste or enter a job description URL
3. Your resume (from Profile) is matched against it
4. Get a % match score and suggestions

## Contact Status Workflow
New → Drafted → Sent → Opened → Replied → Interview → Rejected (or Do Not Contact)

## Troubleshooting

**"Could not reach backend" error**: Make sure the backend server is running on port 3001. Run 'cd backend && npm run dev' in the project folder.

**Gmail not sending**: Check if Gmail is connected (Settings → Gmail). If token expired, disconnect and reconnect.

**No jobs in the feed**: The daily scrape runs at 7 AM IST. You can manually trigger a scrape via Admin Panel (admin users only).

**Template variables not working**: Make sure you used curly braces: {name}, {company}. No spaces inside braces.

**Import not working**: Your CSV must have at minimum an "email" column. Use comma-separated values.

## Your Role
- Help users navigate the app confidently
- Answer questions about features, pricing, plans
- Collect feedback when users seem frustrated or unsure
- If a user reports a bug or issue, acknowledge it, note it, and suggest workarounds
- If you don't know something, say "I'm not sure about that — please check the settings or email support"
- Always be warm, concise, and practical
- After helping, ask if there's anything else you can assist with
- Support contact: vishalbaliyan90901@gmail.com`;

// Build the dynamic system prompt with custom knowledge + recent feedback issues
async function buildSystemPrompt() {
  let prompt = BASE_SYSTEM_PROMPT;

  // Add custom knowledge base entries
  try {
    const knowledge = await database.prepare(
      "SELECT category, question, answer FROM chatbot_knowledge WHERE is_active = 1 ORDER BY category, created_at DESC LIMIT 30"
    ).all();
    if (knowledge.length > 0) {
      prompt += '\n\n## Additional Knowledge Base\n';
      const byCategory = {};
      for (const k of knowledge) {
        if (!byCategory[k.category]) byCategory[k.category] = [];
        byCategory[k.category].push(`Q: ${k.question}\nA: ${k.answer}`);
      }
      for (const [cat, items] of Object.entries(byCategory)) {
        prompt += `\n### ${cat}\n${items.join('\n\n')}`;
      }
    }
  } catch {}

  // Add recent low-rating feedback issues to help the bot avoid them
  try {
    const badFeedback = await database.prepare(
      "SELECT summary FROM chat_feedback WHERE rating <= 2 AND summary IS NOT NULL AND summary != '' ORDER BY created_at DESC LIMIT 8"
    ).all();
    if (badFeedback.length > 0) {
      const issues = badFeedback.map(f => `- ${f.summary}`).join('\n');
      prompt += `\n\n## Known User Pain Points (improve on these)\n${issues}`;
    }
  } catch {}

  return prompt;
}

// ── GET /api/chatbot/history ─────────────────────────────────────────────────
router.get('/history', requireAuth, async (req, res) => {
  try {
    const session = await database.prepare(
      'SELECT * FROM chat_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1'
    ).get(req.user.userId);

    if (!session) return res.json({ messages: [], sessionId: null });

    const messages = await database.prepare(
      'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
    ).all(session.id);

    res.json({ messages, sessionId: session.id });
  } catch (e) {
    console.error('[Chatbot] History error:', e.message);
    res.status(500).json({ error: 'Failed to load chat history' });
  }
});

// ── POST /api/chatbot/message ────────────────────────────────────────────────
router.post('/message', requireAuth, async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

  if (!process.env.GROQ_API_KEY) {
    console.error('[Chatbot] GROQ_API_KEY is not set — VartaBot cannot respond');
    return res.status(503).json({ error: 'VartaBot is temporarily unavailable. Please try again later or contact support.' });
  }

  try {
    // Get or create session
    let session;
    if (sessionId) {
      session = await database.prepare(
        'SELECT * FROM chat_sessions WHERE id = ? AND user_id = ? AND ended_at IS NULL'
      ).get(sessionId, req.user.userId);
    }
    if (!session) {
      const newId = randomUUID();
      await database.prepare(
        'INSERT INTO chat_sessions (id, user_id) VALUES (?, ?)'
      ).run(newId, req.user.userId);
      session = { id: newId };
    }

    // Get message history for context
    const history = await database.prepare(
      'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
    ).all(session.id);

    // Store user message
    await database.prepare(
      'INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
    ).run(randomUUID(), session.id, 'user', message.trim());

    // Build Groq messages
    const systemPrompt = await buildSystemPrompt();
    const recentHistory = history.slice(-MAX_HISTORY);
    const groqMessages  = [
      { role: 'system', content: systemPrompt },
      ...recentHistory.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message.trim() },
    ];

    // Call Groq
    const completion = await groq.chat.completions.create({
      model:      GROQ_MODEL,
      messages:   groqMessages,
      max_tokens: 1024,
      temperature: 0.65,
    });

    const reply = completion.choices[0]?.message?.content
      || "I'm sorry, I couldn't process that. Please try again.";

    // Store assistant reply
    const assistantMsgId = randomUUID();
    await database.prepare(
      'INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
    ).run(assistantMsgId, session.id, 'assistant', reply);

    res.json({ reply, sessionId: session.id, messageId: assistantMsgId });
  } catch (e) {
    console.error('[Chatbot] Message error:', e.status, e.message);
    if (e.status === 429) {
      return res.status(429).json({ error: 'AI service is busy. Please wait a moment and try again.' });
    }
    if (e.status === 401 || e.status === 403) {
      return res.status(503).json({ error: 'Groq API key is invalid or expired. Please update GROQ_API_KEY in backend/.env and restart the server.' });
    }
    if (e.status === 404) {
      return res.status(503).json({ error: `AI model "${GROQ_MODEL}" is not available. Set GROQ_MODEL in backend/.env to a supported model (e.g. llama-3.3-70b-versatile).` });
    }
    res.status(500).json({ error: 'Failed to get AI response. Please try again.' });
  }
});

// ── POST /api/chatbot/feedback ───────────────────────────────────────────────
router.post('/feedback', requireAuth, async (req, res) => {
  const { sessionId, messageId, rating, summary } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5' });
  }
  try {
    await database.prepare(
      'INSERT INTO chat_feedback (id, user_id, session_id, message_id, rating, summary) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      randomUUID(), req.user.userId,
      sessionId || null, messageId || null,
      parseInt(rating), summary?.trim() || null
    );
    res.json({ success: true });
  } catch (e) {
    console.error('[Chatbot] Feedback error:', e.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// ── POST /api/chatbot/end-session ───────────────────────────────────────────
router.post('/end-session', requireAuth, async (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    await database.prepare(
      'UPDATE chat_sessions SET ended_at = ? WHERE id = ? AND user_id = ?'
    ).run(new Date().toISOString().slice(0, 19), sessionId, req.user.userId)
      .catch(() => {});
  }
  res.json({ success: true });
});

// ── GET /api/chatbot/feedback ────────────────────────────────────────────────
// Admin: view all feedback
router.get('/feedback', requireAuth, requireAdmin, async (req, res) => {
  try {
    const feedback = await database.prepare(`
      SELECT cf.*, u.email as user_email
      FROM chat_feedback cf
      JOIN users u ON u.id = cf.user_id
      ORDER BY cf.created_at DESC
      LIMIT 200
    `).all();
    res.json({ feedback });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/chatbot/stats ───────────────────────────────────────────────────
// Admin: quick stats
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [sessions, messages, feedback] = await Promise.all([
      database.prepare('SELECT COUNT(*) as n FROM chat_sessions').get(),
      database.prepare('SELECT COUNT(*) as n FROM chat_messages').get(),
      database.prepare('SELECT AVG(rating)::numeric(3,2) as avg, COUNT(*) as n FROM chat_feedback').get(),
    ]);
    res.json({
      totalSessions: sessions?.n || 0,
      totalMessages: messages?.n || 0,
      avgRating:     feedback?.avg || null,
      totalFeedback: feedback?.n  || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/chatbot/knowledge ──────────────────────────────────────────────
// Admin: add Q&A to the knowledge base
router.post('/knowledge', requireAuth, requireAdmin, async (req, res) => {
  const { category, question, answer } = req.body;
  if (!question?.trim() || !answer?.trim()) {
    return res.status(400).json({ error: 'question and answer are required' });
  }
  try {
    const id = randomUUID();
    await database.prepare(
      'INSERT INTO chatbot_knowledge (id, category, question, answer) VALUES (?, ?, ?, ?)'
    ).run(id, category?.trim() || 'general', question.trim(), answer.trim());
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/chatbot/knowledge ───────────────────────────────────────────────
router.get('/knowledge', requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = await database.prepare(
      'SELECT * FROM chatbot_knowledge ORDER BY category, created_at DESC'
    ).all();
    res.json({ knowledge: items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/chatbot/knowledge/:id ────────────────────────────────────────
router.delete('/knowledge/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await database.prepare('DELETE FROM chatbot_knowledge WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
