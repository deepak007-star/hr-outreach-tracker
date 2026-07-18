import { jsPDF } from 'jspdf';
import { Document, Paragraph, TextRun, Packer, AlignmentType, BorderStyle } from 'docx';

// ── Primary domain for each skill ────────────────────────────────────────
// Used to prevent cross-domain misplacement (e.g. React → Backend line)
const SKILL_DOMAIN = {
  // Frontend
  react: 'frontend', angular: 'frontend', 'vue.js': 'frontend', vue: 'frontend',
  'next.js': 'frontend', 'nuxt.js': 'frontend', svelte: 'frontend', jquery: 'frontend',
  redux: 'frontend', 'tailwind css': 'frontend', bootstrap: 'frontend',
  'react native': 'frontend', gatsby: 'frontend',

  // Languages (separate from frontend/backend so they go to Language: line)
  javascript: 'language', typescript: 'language',
  java: 'language', python: 'language', go: 'language', golang: 'language',
  kotlin: 'language', swift: 'language', rust: 'language', 'c#': 'language',
  'c++': 'language', sql: 'language', bash: 'language', scala: 'language',
  html: 'language', css: 'language', r: 'language', php: 'language', ruby: 'language',

  // Backend
  'spring boot': 'backend', 'spring mvc': 'backend', 'spring data jpa': 'backend',
  'spring data redis': 'backend', 'spring batch': 'backend', 'spring security': 'backend',
  'spring aop': 'backend', spring: 'backend',
  hibernate: 'backend', jpa: 'backend',
  express: 'backend', nestjs: 'backend',
  django: 'backend', flask: 'backend', fastapi: 'backend',
  webflux: 'backend', 'project reactor': 'backend',
  graphql: 'backend', grpc: 'backend',

  // Resilience patterns
  resilience4j: 'resilience',
  'circuit breaker': 'resilience', saga: 'resilience', cqrs: 'resilience',

  // Database
  postgresql: 'database', postgres: 'database', mysql: 'database',
  'oracle db': 'database', oracle: 'database', mongodb: 'database',
  redis: 'database', cassandra: 'database', elasticsearch: 'database',
  dynamodb: 'database', db2: 'database', mariadb: 'database',
  sqlite: 'database', neo4j: 'database', hbase: 'database', hikaricp: 'database',

  // Messaging
  kafka: 'messaging', 'apache kafka': 'messaging', rabbitmq: 'messaging',
  activemq: 'messaging', sqs: 'messaging', pulsar: 'messaging',

  // DevOps/Tools
  jenkins: 'devops', maven: 'devops', gradle: 'devops',
  git: 'devops', github: 'devops', gitlab: 'devops',
  docker: 'devops', kubernetes: 'devops', terraform: 'devops',
  ansible: 'devops', helm: 'devops', linux: 'devops', nginx: 'devops',
  sonarqube: 'devops', 'github actions': 'devops', 'gitlab ci': 'devops',

  // Cloud
  aws: 'cloud', azure: 'cloud', gcp: 'cloud', 'google cloud': 'cloud',
  lambda: 'cloud', ec2: 'cloud', s3: 'cloud',

  // Testing
  junit: 'testing', mockito: 'testing', jest: 'testing',
  cypress: 'testing', selenium: 'testing', testng: 'testing', pytest: 'testing',

  // Monitoring
  prometheus: 'monitoring', grafana: 'monitoring', elk: 'monitoring',
  datadog: 'monitoring', splunk: 'monitoring',
};

// Domain → keywords that appear in sub-category line labels
const DOMAIN_LABEL_KEYWORDS = {
  frontend:   ['frontend', 'front-end', 'front end', 'ui', 'client', 'web ui'],
  backend:    ['backend', 'back-end', 'back end', 'server'],
  language:   ['language', 'lang', 'programming'],
  database:   ['database', 'data', 'db', 'storage', 'rdbms', 'nosql'],
  messaging:  ['messaging', 'message', 'queue', 'broker', 'event', 'streaming'],
  devops:     ['devops', 'tool', 'build', 'ci', 'cd', 'other', 'ops'],
  cloud:      ['cloud', 'aws', 'azure', 'gcp', 'infrastructure'],
  testing:    ['testing', 'test', 'qa', 'quality'],
  monitoring: ['monitoring', 'observability', 'logging'],
  resilience: ['resilience', 'fault', 'pattern', 'reliability'],
};

// These domains are exclusive — React must NOT go to a Backend: line
const EXCLUSIVE_DOMAINS = new Set([
  'frontend', 'backend', 'language', 'database', 'messaging',
  'devops', 'testing', 'monitoring', 'resilience', 'cloud',
]);

function getSkillDomain(skill) {
  const lower = skill.toLowerCase().trim();
  if (SKILL_DOMAIN[lower]) return SKILL_DOMAIN[lower];
  for (const [key, domain] of Object.entries(SKILL_DOMAIN)) {
    if (lower.includes(key) || key.includes(lower)) return domain;
  }
  return null;
}

function getLineDomain(line) {
  const lower = line.toLowerCase();
  const labelMatch = lower.match(/^([a-z][a-z\s\/&0-9]+?)\s*[:|-]/);
  if (!labelMatch) return null;
  const label = labelMatch[1].trim();
  for (const [domain, keywords] of Object.entries(DOMAIN_LABEL_KEYWORDS)) {
    if (keywords.some(kw => label.includes(kw))) return domain;
  }
  return null;
}

function detectSeparator(line) {
  if (/ \| /.test(line)) return ' | ';
  if (/\s*•\s*/.test(line)) return ' • ';
  if (/\s*·\s*/.test(line)) return ' · ';
  return ', ';
}

// Returns score for placing skill on this line. -1 = incompatible.
function scoreLineForSkill(line, skillDomain) {
  if (!line.trim()) return -1;
  const lineDomain = getLineDomain(line);
  let score = 0;

  if (lineDomain && skillDomain) {
    if (lineDomain === skillDomain) {
      score += 100;
    } else if (
      EXCLUSIVE_DOMAINS.has(lineDomain) &&
      EXCLUSIVE_DOMAINS.has(skillDomain) &&
      lineDomain !== skillDomain
    ) {
      return -1; // Domain conflict
    }
  }

  // Bonus: line already has sibling skills in same domain
  if (skillDomain) {
    const lower = line.toLowerCase();
    for (const [existingKey, existingDomain] of Object.entries(SKILL_DOMAIN)) {
      if (existingDomain === skillDomain && lower.includes(existingKey)) {
        score += 20;
        break;
      }
    }
  }

  return score;
}

const SKILLS_HEADER_RE = /skill|technical|competenc|expertise|proficien|technologies|tech\s+stack/i;

function isTopLevelSection(line) {
  const t = line.trim();
  if (!t || t.length > 100) return false;
  if (/^[A-Za-z].+?\s*[:]\s*.{2,}/.test(t)) return false;
  if (/^[A-Za-z][A-Za-z\s\/&]+?\s*[-]\s*.{2,}/.test(t)) return false;
  if (t.length > 2 && t === t.toUpperCase() && /^[A-Z]/.test(t)) return true;
  return /^(experience|education|projects?|certifications?|work\s+experience|professional\s+experience|employment|summary|objective|references|awards|achievements|publications|volunteer|leadership|activities|honors)/i.test(t);
}

// ── Main resume modifier ──────────────────────────────────────────────────
export function modifyResume(text, skillsToAdd) {
  if (!skillsToAdd.length || !text) return text;

  const lines = text.split('\n');
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.length > 100) continue;
    if (SKILLS_HEADER_RE.test(t) && t.length < 80 && !isTopLevelSection(lines[i + 1] || '')) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    const res = [...lines];
    res.push('', 'SKILLS', `[ADDED-LINE]${skillsToAdd.join(', ')}`, '');
    return res.join('\n');
  }

  let sectionEnd = sectionStart + 1;
  while (sectionEnd < lines.length && !isTopLevelSection(lines[sectionEnd])) {
    sectionEnd++;
  }

  const result = [...lines];

  for (const skill of skillsToAdd) {
    const skillDomain = getSkillDomain(skill);

    let bestIdx = -1;
    let bestScore = 0;

    for (let i = sectionStart + 1; i < sectionEnd; i++) {
      if (!result[i].trim()) continue;
      const sc = scoreLineForSkill(result[i], skillDomain);
      if (sc > bestScore) { bestScore = sc; bestIdx = i; }
    }

    if (bestIdx >= 0 && bestScore > 0) {
      const sep = detectSeparator(result[bestIdx]);
      result[bestIdx] = result[bestIdx].trimEnd() + sep + `[ADDED]${skill}`;
    } else {
      // No matching domain line — create a new sub-category line
      const domainLabel = skillDomain
        ? skillDomain.charAt(0).toUpperCase() + skillDomain.slice(1)
        : 'Other';
      const lastNonBlank = (() => {
        for (let i = sectionEnd - 1; i >= sectionStart; i--) {
          if (result[i].trim()) return i;
        }
        return sectionStart;
      })();
      result.splice(lastNonBlank + 1, 0, `[ADDED-LINE]${domainLabel}: [ADDED]${skill}`);
      sectionEnd++;
    }
  }

  return result.join('\n');
}

export function cleanResumeText(text) {
  return text
    .replace(/\[ADDED-LINE\]/g, '')
    .replace(/\[ADDED\]/g, '');
}

// ── Line type detector for formatting ────────────────────────────────────
function classifyLine(line, lineIdx, allLines) {
  const t = line.trim();
  if (!t) return 'blank';

  // Determine position among non-blank lines
  let nonBlankPos = 0;
  for (let i = 0; i < lineIdx; i++) {
    if (allLines[i].trim()) nonBlankPos++;
  }

  // First non-blank → name
  if (nonBlankPos === 0) return 'name';

  // Second non-blank → subtitle/tagline
  if (nonBlankPos === 1) return 'subtitle';

  // 3rd or 4th non-blank lines that look like contact info
  if (nonBlankPos <= 3 && (t.includes('|') || t.includes('@') || /\d{7,}/.test(t) ||
    /linkedin|leetcode|github|portfolio/i.test(t))) {
    return 'contact';
  }

  // ALL CAPS standalone line (section header)
  if (t.length > 2 && t === t.toUpperCase() && /^[A-Z]/.test(t) &&
    !t.includes(':') && t.length < 80) {
    return 'section';
  }

  // Sub-category label line: "Label: content" or "label - content"
  if (/^[A-Za-z][A-Za-z\s\/&0-9]+?\s*:\s*.{1,}/.test(t)) return 'subcategory';
  if (/^[A-Za-z][A-Za-z\s\/&0-9]+?\s+-\s+.{1,}/.test(t) &&
    !t.startsWith('•') && !t.startsWith('-')) return 'subcategory';

  // Bullet point
  if (/^[•▪▸►\-–]\s/.test(t)) return 'bullet';

  return 'body';
}

// ── PDF download ──────────────────────────────────────────────────────────
// Strips markers, renders with uniform font/line-height — no reformatting.
// Only bold is applied: ALL-CAPS section headers and "Label:" prefixes.
export function downloadAsPdf(text, filename = 'modified_resume') {
  const lines  = cleanResumeText(text).split('\n');
  const doc    = new jsPDF({ unit: 'mm', format: 'a4' });
  const MARGIN = 15;
  const PW     = 210 - MARGIN * 2;
  const PAGE_H = 297 - MARGIN;
  const FS     = 10;   // uniform font size (pt)
  const LH     = 5;    // uniform line height (mm)
  const BLH    = 3;    // blank-line height (mm)
  let y = MARGIN;

  function checkY() { if (y + LH > PAGE_H) { doc.addPage(); y = MARGIN; } }

  // First non-blank line index (the name)
  const firstNonBlank = lines.findIndex(l => l.trim());

  lines.forEach((line, i) => {
    const t = line.trim();

    if (!t) { y += BLH; return; }

    checkY();

    // Name line — slightly larger, centered, bold
    if (i === firstNonBlank) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      const wrapped = doc.splitTextToSize(t, PW);
      wrapped.forEach(wl => { checkY(); doc.text(wl, MARGIN + PW / 2, y, { align: 'center' }); y += LH + 1; });
      doc.setFontSize(FS);
      return;
    }

    doc.setFontSize(FS);

    // ALL-CAPS section header (no extra spacing — same line height as everything else)
    const isSection = t.length > 2 && t === t.toUpperCase() && /^[A-Z]/.test(t) && !t.includes(':');
    if (isSection) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      const wrapped = doc.splitTextToSize(t, PW);
      wrapped.forEach(wl => { checkY(); doc.text(wl, MARGIN, y); y += LH; });
      return;
    }

    // Sub-category "Label: rest" — label bold, rest normal, same line height
    const colonIdx = t.indexOf(':');
    if (colonIdx > 0 && colonIdx < 25 && /^[A-Za-z][A-Za-z\s\/&0-9]+$/.test(t.slice(0, colonIdx))) {
      const label = t.slice(0, colonIdx + 1);
      const rest  = t.slice(colonIdx + 1);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      const labelW = doc.getTextWidth(label);
      doc.text(label, MARGIN, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      const wrapped = doc.splitTextToSize(rest, PW - labelW);
      wrapped.forEach((wl, wi) => {
        if (wi > 0) { y += LH; checkY(); }
        doc.text(wl, MARGIN + labelW, y);
      });
      y += LH;
      return;
    }

    // Everything else — plain normal text, preserving leading whitespace as indent
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(50, 50, 50);
    const indent = line.length - line.trimStart().length;
    const x = MARGIN + Math.min(indent * 1.5, 12);
    const wrapped = doc.splitTextToSize(t, PW - (x - MARGIN));
    wrapped.forEach(wl => { checkY(); doc.text(wl, x, y); y += LH; });
  });

  doc.save(`${filename}.pdf`);
}

// ── Word download ─────────────────────────────────────────────────────────
// Strips markers, renders with uniform font/line-height — no reformatting.
export async function downloadAsWord(text, filename = 'modified_resume') {
  const lines = cleanResumeText(text).split('\n');

  // Single consistent run size for body text (20 half-pts = 10pt)
  const SZ      = 20;
  const SZ_NAME = 28;

  function run(txt, bold = false, color = '222222') {
    return new TextRun({ text: txt, font: 'Calibri', size: bold ? SZ : SZ, bold, color });
  }

  // First non-blank line index (the name)
  const firstNonBlank = lines.findIndex(l => l.trim());

  const paragraphs = lines.map((line, i) => {
    const t = line.trim();

    // Blank line — empty paragraph, zero spacing
    if (!t) {
      return new Paragraph({ children: [run(' ')], spacing: { before: 0, after: 0, line: 240 } });
    }

    // Shared spacing — ALL paragraphs get the same before/after
    const spacing = { before: 0, after: 0, line: 240 };

    // Name
    if (i === firstNonBlank) {
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing,
        children: [new TextRun({ text: t, font: 'Calibri', size: SZ_NAME, bold: true, color: '000000' })],
      });
    }

    // ALL-CAPS section header
    const isSection = t.length > 2 && t === t.toUpperCase() && /^[A-Z]/.test(t) && !t.includes(':');
    if (isSection) {
      return new Paragraph({
        spacing,
        children: [run(t, true, '000000')],
      });
    }

    // Sub-category "Label: rest"
    const colonIdx = t.indexOf(':');
    if (colonIdx > 0 && colonIdx < 25 && /^[A-Za-z][A-Za-z\s\/&0-9]+$/.test(t.slice(0, colonIdx))) {
      return new Paragraph({
        spacing,
        children: [
          run(t.slice(0, colonIdx + 1), true,  '000000'),
          run(t.slice(colonIdx + 1),    false, '374151'),
        ],
      });
    }

    // Everything else — plain text, preserve leading spaces as indent
    const indent = line.length - line.trimStart().length;
    return new Paragraph({
      spacing,
      indent: indent > 0 ? { left: Math.min(indent * 90, 720) } : undefined,
      children: [run(t, false, '374151')],
    });
  });

  const docObj = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } },
      },
      children: paragraphs,
    }],
  });

  const blob = await Packer.toBlob(docObj);
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `${filename}.docx` });
  a.click();
  URL.revokeObjectURL(url);
}
