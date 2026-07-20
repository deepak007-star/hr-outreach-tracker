const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/database');

const router = express.Router();

const SEEDS = [
  {
    name: 'Cold Outreach — Backend Developer',
    category: 'cold-outreach',
    tags: ['backend', 'java', 'spring boot', 'node.js', 'python', 'microservices', 'api'],
    subject: 'Hi {{name}} — Backend Engineer exploring opportunities at {{company}}',
    body: `Hi {{name}},

I came across {{company}} and was genuinely impressed by the engineering work you're doing.

I'm a {{current_title}} with {{experience}} of experience — specialising in {{skills}}.

I'd love a quick 15-minute chat to explore whether there's a backend engineering fit.
Notice Period: {{notice_period}} | Location: {{location}}

Best regards,
{{your_name}}
{{phone}} | {{linkedin_url}}`,
  },
  {
    name: 'Cold Outreach — Python Developer',
    category: 'cold-outreach',
    tags: ['python', 'backend', 'django', 'fastapi', 'flask', 'data'],
    subject: 'Hi {{name}} — Python Developer reaching out about {{company}}',
    body: `Hi {{name}},

I'm a {{current_title}} with {{experience}} of hands-on experience building scalable systems in Python (Django, FastAPI, Flask).

Your work at {{company}} caught my attention, particularly the engineering challenges you're solving.

Key skills: {{skills}}
Location: {{location}} | Notice Period: {{notice_period}}

Would love a quick chat if you have openings on the backend team.

Best regards,
{{your_name}}
{{phone}} | {{linkedin_url}}`,
  },
  {
    name: 'Cold Outreach — Full Stack Developer',
    category: 'cold-outreach',
    tags: ['fullstack', 'full stack', 'react', 'node.js', 'java', 'angular', 'vue'],
    subject: 'Hi {{name}} — Full Stack Engineer interested in {{company}}',
    body: `Hi {{name}},

I'm a {{current_title}} with {{experience}} of end-to-end development experience — from building RESTful APIs to crafting polished UIs.

I've been following {{company}}'s product and am excited about the direction you're heading.

My stack: {{skills}}
Location: {{location}} | Open to: {{preferred_location}} | Notice: {{notice_period}}

Would love 15 minutes to explore any full-stack openings.

Best regards,
{{your_name}}
{{phone}} | {{linkedin_url}}`,
  },
  {
    name: 'Cold Outreach — Frontend Developer',
    category: 'cold-outreach',
    tags: ['frontend', 'react', 'vue', 'angular', 'javascript', 'typescript', 'ui'],
    subject: 'Hi {{name}} — Frontend Engineer exploring {{company}} roles',
    body: `Hi {{name}},

I'm {{your_name}}, a {{current_title}} with {{experience}} of experience building performant, accessible UIs.

Skills: {{skills}}

I admire the product quality at {{company}} and would love to contribute to your frontend team.

Location: {{location}} | Preferred: {{preferred_location}} | Notice: {{notice_period}}
LinkedIn: {{linkedin_url}}

Would you be open to a quick call?

Best,
{{your_name}}
{{phone}}`,
  },
  {
    name: 'Cold Outreach — Data Engineer',
    category: 'cold-outreach',
    tags: ['data engineer', 'data', 'spark', 'kafka', 'airflow', 'etl', 'pipeline', 'sql'],
    subject: 'Hi {{name}} — Data Engineer interested in {{company}}',
    body: `Hi {{name}},

I'm a {{current_title}} with {{experience}} building robust data pipelines and analytics platforms.

My expertise includes: {{skills}}

I'm particularly excited about the data engineering challenges at {{company}} and would love to bring my experience to your team.

Location: {{location}} | Notice Period: {{notice_period}}
LinkedIn: {{linkedin_url}} | Phone: {{phone}}

Open for a quick intro call?

Best regards,
{{your_name}}`,
  },
  {
    name: 'Cold Outreach — DevOps / SRE Engineer',
    category: 'cold-outreach',
    tags: ['devops', 'sre', 'kubernetes', 'docker', 'aws', 'gcp', 'azure', 'ci/cd', 'terraform'],
    subject: 'Hi {{name}} — DevOps Engineer exploring {{company}} opportunities',
    body: `Hi {{name}},

I'm a {{current_title}} with {{experience}} of experience in cloud infrastructure, CI/CD automation, and site reliability engineering.

Core skills: {{skills}}

I've been following {{company}}'s engineering work and your infrastructure direction excites me.

Location: {{location}} | Notice Period: {{notice_period}}
LinkedIn: {{linkedin_url}}

Would love to connect and explore any DevOps/SRE roles on your team.

Best,
{{your_name}}
{{phone}}`,
  },
  {
    name: 'Cold Outreach — ML / AI Engineer',
    category: 'cold-outreach',
    tags: ['ml', 'ai', 'machine learning', 'deep learning', 'python', 'pytorch', 'tensorflow', 'nlp', 'llm'],
    subject: 'Hi {{name}} — ML Engineer exploring AI roles at {{company}}',
    body: `Hi {{name}},

I'm a {{current_title}} with {{experience}} of experience building and deploying machine learning systems in production.

My expertise: {{skills}}

I'm particularly interested in the AI/ML work at {{company}} and believe I could add real value to your team.

Location: {{location}} | Notice Period: {{notice_period}}
LinkedIn: {{linkedin_url}} | Phone: {{phone}}

Would you be open to a brief exploratory call?

Best regards,
{{your_name}}`,
  },
  {
    name: 'Cold Outreach — Entry Level / Fresher',
    category: 'cold-outreach',
    tags: ['fresher', 'entry level', 'graduate', 'junior', 'trainee', 'intern'],
    subject: 'Hi {{name}} — Fresh Graduate interested in {{company}} opportunities',
    body: `Hi {{name}},

I'm {{your_name}}, a recent Computer Science graduate actively looking for my first software engineering role.

I've built projects using {{skills}} and am eager to grow in a great team environment like {{company}}.

I'm based in {{location}} and open to {{preferred_location}} opportunities.
LinkedIn: {{linkedin_url}}

I'd love the opportunity to speak with you briefly about any entry-level or trainee positions.

Thank you for your time!
{{your_name}}
{{phone}}`,
  },
  {
    name: 'Profile-Based Cold Outreach',
    category: 'cold-outreach',
    tags: ['generic', 'profile', 'personalized', 'general'],
    subject: 'Hi {{name}} — {{current_title}} open to {{company}} opportunities',
    body: `Hi {{name}},

I'm {{your_name}}, a {{current_title}} with {{experience}} of experience — currently exploring new opportunities and came across {{company}}.

Technical Skills:
{{skills}}

Current Location: {{location}}
Preferred Locations: {{preferred_location}}
Notice Period: {{notice_period}}
LinkedIn: {{linkedin_url}}
Phone: {{phone}}

I'd love to connect and explore if there's a fit for any {{role}} roles on your team.

Best regards,
{{your_name}}`,
  },
  {
    name: 'Follow-up (No Response)',
    category: 'follow-up',
    tags: ['follow up', 'no response', 'reminder', 'second email'],
    subject: 'Following up — {{your_name}} / {{company}}',
    body: `Hi {{name}},

I wanted to follow up on my earlier message. I'm still very interested in {{company}} and believe my background as a {{current_title}} ({{experience}}, {{skills}}) could add real value to your team.

Would you have 15 minutes for a quick call this week?

Thank you for your time,
{{your_name}}
{{phone}} | {{linkedin_url}}`,
  },
  {
    name: 'Follow-up — Short Nudge',
    category: 'follow-up',
    tags: ['follow up', 'short', 'nudge', 'quick', 'brief'],
    subject: 'Quick follow-up — {{your_name}}',
    body: `Hi {{name}},

Just a quick note to follow up on my previous message about {{role}} opportunities at {{company}}.

Still very interested — happy to share more details or jump on a quick call if helpful.

Best,
{{your_name}}
{{phone}}`,
  },
  {
    name: 'Referral Request',
    category: 'referral',
    tags: ['referral', 'refer', 'connection', 'recommendation', 'internal'],
    subject: 'Referral request for {{company}} — {{your_name}}',
    body: `Hi {{name}},

I noticed you work at {{company}} — I'm very interested in joining as a {{current_title}}.

I have {{experience}} of experience with {{skills}}, and I believe I'd be a strong fit for backend engineering roles there.

Would you be able to refer me for any open positions? I'm happy to share my resume.

Notice Period: {{notice_period}} | Location: {{location}}
LinkedIn: {{linkedin_url}}

Thank you so much!
{{your_name}}
{{phone}}`,
  },
  {
    name: 'Direct Application',
    category: 'direct-apply',
    tags: ['apply', 'application', 'direct', 'job application', 'resume'],
    subject: 'Application — {{current_title}} @ {{company}}',
    body: `Hi {{name}},

I'm reaching out to express my interest in {{role}} opportunities at {{company}}. Here's a quick summary:

Experience: {{experience}} as a {{current_title}}
Skills: {{skills}}

Key Highlights:
• Designed and maintained production-grade services
• Experience with scalable event-driven architectures
• Cloud deployment and containerization

Location: {{location}} | Preferred: {{preferred_location}}
Notice Period: {{notice_period}}
LinkedIn: {{linkedin_url}} | Phone: {{phone}}

Please find my resume attached. I'd love to contribute to {{company}}'s engineering team.

Best regards,
{{your_name}}`,
  },
  {
    name: 'Networking — LinkedIn Connect',
    category: 'networking',
    tags: ['networking', 'connect', 'linkedin', 'introduction', 'relationship'],
    subject: 'Connecting — {{your_name}}, {{current_title}}',
    body: `Hi {{name}},

I'm {{your_name}}, a {{current_title}} with {{experience}} of experience in {{skills}}.

I came across your profile and would love to connect — I'm keen to learn more about the work at {{company}} and explore if there are any opportunities where I could contribute.

Location: {{location}} | LinkedIn: {{linkedin_url}}

Would love to connect!

Best,
{{your_name}}`,
  },
  {
    name: 'Thank You After Interview',
    category: 'networking',
    tags: ['thank you', 'interview', 'post-interview', 'follow up', 'appreciation'],
    subject: 'Thank you — {{name}} / {{company}}',
    body: `Hi {{name}},

Thank you so much for taking the time to speak with me today. I really enjoyed learning about the engineering culture and challenges at {{company}}.

Our conversation reinforced my enthusiasm for the {{role}} role. I'm confident my experience in {{skills}} and {{experience}} as a {{current_title}} align well with what you're looking for.

Please don't hesitate to reach out if you need any additional information.

Looking forward to hearing from you!

Best regards,
{{your_name}}
{{phone}} | {{linkedin_url}}`,
  },
  {
    name: 'Java Backend — Direct Outreach (Personal)',
    category: 'cold-outreach',
    tags: ['java', 'spring boot', 'backend', 'microservices', 'kafka', 'redis', 'personal', 'direct'],
    subject: 'Java Backend Developer — Reaching out to {{company}}',
    body: `Hi there,

Hope you're doing well. I'm a Java Backend Developer with 5 years of experience, currently looking to make a move, and wanted to reach out directly in case there's a suitable opening on your side.

A quick summary of my background:
Core stack: Java, Spring Boot, Microservices, Hibernate/JPA, Spring Security, Spring Batch, Spring AI
System design: HLD & LLD, Design Patterns, Distributed Architecture, Scalable Systems
Data & messaging: PostgreSQL, MongoDB, DynamoDB, Redis, Kafka, RabbitMQ
Infra & tooling: Docker, Kubernetes, AWS, Grafana
Testing: JUnit, Mockito

My official notice period is {{notice_period}}, I'm based in {{location}}, and open to relocation or remote roles.
I've attached my resume for reference — if there's any suitable Java Backend Developer opening currently or coming up, I'd really appreciate you keeping me in mind. Happy to jump on a quick call at your convenience.

LinkedIn: {{linkedin_url}}
Thanks & regards,
{{your_name}}
{{phone}}`,
  },
];

async function seedTemplates() {
  for (const t of SEEDS) {
    const existing = await db.prepare('SELECT id FROM email_templates WHERE name = ?').get(t.name);
    if (!existing) {
      await db.prepare(
        'INSERT INTO email_templates (id, name, subject, body, category, tags, is_default) VALUES (?, ?, ?, ?, ?, ?, 1)'
      ).run(crypto.randomUUID(), t.name, t.subject, t.body, t.category || 'general', JSON.stringify(t.tags || []));
    } else {
      // Update category/tags for existing system seeds without overwriting user-edited subject/body
      await db.prepare(
        'UPDATE email_templates SET category = ?, tags = ? WHERE id = ? AND is_default = 1'
      ).run(t.category || 'general', JSON.stringify(t.tags || []), existing.id);
    }
  }
}

let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  await seedTemplates();
}

// GET /api/email-templates
router.get('/', async (req, res) => {
  await ensureSeeded();
  const rows = await db.prepare('SELECT * FROM email_templates ORDER BY is_default DESC, created_at ASC').all();
  rows.forEach(r => {
    try { r.attachment_json = r.attachment_json ? JSON.parse(r.attachment_json) : null; } catch { r.attachment_json = null; }
  });
  res.json(rows);
});

// POST /api/email-templates
router.post('/', async (req, res) => {
  const { name, subject = '', body = '', category = 'general', tags = [], attachment_json } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = crypto.randomUUID();
  const attachJson = attachment_json && attachment_json.type !== 'local' ? JSON.stringify(attachment_json) : null;
  await db.prepare(
    'INSERT INTO email_templates (id, name, subject, body, category, tags, attachment_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name.trim(), subject, body, category, JSON.stringify(Array.isArray(tags) ? tags : []), attachJson);
  const parsed = attachJson ? JSON.parse(attachJson) : null;
  res.status(201).json({ id, name: name.trim(), subject, body, category, tags, is_default: 0, attachment_json: parsed });
});

// PUT /api/email-templates/:id
router.put('/:id', async (req, res) => {
  const { name, subject = '', body = '', category = 'general', tags = [], attachment_json } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const updatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const attachJson = attachment_json && attachment_json.type !== 'local' ? JSON.stringify(attachment_json) : null;
  await db.prepare(
    'UPDATE email_templates SET name = ?, subject = ?, body = ?, category = ?, tags = ?, attachment_json = ?, updated_at = ? WHERE id = ?'
  ).run(name.trim(), subject, body, category, JSON.stringify(Array.isArray(tags) ? tags : []), attachJson, updatedAt, req.params.id);
  res.json({ success: true });
});

// DELETE /api/email-templates/:id
router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
