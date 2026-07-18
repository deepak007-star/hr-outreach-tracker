const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');

const router = express.Router();

const SEEDS = [
  {
    name: 'Cold Outreach — Backend Developer',
    subject: 'Hi {{name}}, exploring backend roles at {{company}}',
    body: `Hi {{name}},

I came across {{company}} and was genuinely impressed by the engineering work you're doing. I'm a backend developer with 4.5 years of experience in Java / Spring Boot, Kafka, and Redis — currently exploring senior backend opportunities.

I'd love a quick 15-minute chat to see if there's a fit. Would you be open to connecting this week?

Best regards`,
  },
  {
    name: 'Follow-up (No Response)',
    subject: 'Following up — {{name}} / {{company}}',
    body: `Hi {{name}},

I wanted to follow up on my earlier message. I'm still very interested in {{company}} and believe my background — 4.5 years across Java, Spring Boot, Kafka, Kubernetes, and cloud — could add real value to your team.

Would you have 15 minutes for a quick call?

Thank you for your time,`,
  },
  {
    name: 'Referral Request',
    subject: 'Referral request for {{company}}',
    body: `Hi {{name}},

I saw you work at {{company}} — I'm very interested in joining as a Senior Backend Engineer. I have 4.5 years of experience building scalable services with Java, Spring Boot, Kafka, and AWS.

Would you be able to refer me for any open backend roles? I'm happy to share my resume.

Thank you so much!`,
  },
  {
    name: 'Direct Application',
    subject: 'Application — Senior Backend Engineer @ {{company}}',
    body: `Hi {{name}},

I'm reaching out to express my interest in backend engineering opportunities at {{company}}. My background:
• 4.5 years building production Java/Spring Boot services
• Designed event-driven systems with Apache Kafka (2M+ msgs/day)
• Led Redis caching layer reducing API latency by 40%
• Cloud: AWS, Docker, Kubernetes, CI/CD

I would love to contribute to {{company}}'s engineering team. Please find my resume attached.

Looking forward to hearing from you!`,
  },
];

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM email_templates').get()?.c || 0;
  if (count > 0) return;
  const ins = db.prepare('INSERT INTO email_templates (id, name, subject, body, is_default) VALUES (?, ?, ?, ?, 1)');
  SEEDS.forEach(t => ins.run(crypto.randomUUID(), t.name, t.subject, t.body));
}

// GET /api/email-templates
router.get('/', (req, res) => {
  seedIfEmpty();
  res.json(db.prepare('SELECT * FROM email_templates ORDER BY is_default DESC, created_at ASC').all());
});

// POST /api/email-templates
router.post('/', (req, res) => {
  const { name, subject = '', body = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO email_templates (id, name, subject, body) VALUES (?, ?, ?, ?)').run(id, name.trim(), subject, body);
  res.status(201).json({ id, name, subject, body, is_default: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
});

// PUT /api/email-templates/:id
router.put('/:id', (req, res) => {
  const { name, subject = '', body = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  db.prepare(`UPDATE email_templates SET name = ?, subject = ?, body = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name.trim(), subject, body, req.params.id);
  res.json({ success: true });
});

// DELETE /api/email-templates/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
