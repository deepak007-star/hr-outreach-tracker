import { jsPDF } from 'jspdf';
import { Document, Paragraph, TextRun, Packer, AlignmentType, BorderStyle } from 'docx';

// ── Primary domain for each skill ────────────────────────────────────────
// Used to prevent cross-domain misplacement (e.g. React → Backend line)
const SKILL_DOMAIN = {
  // Frontend
  react: 'frontend', 'react.js': 'frontend', angular: 'frontend',
  'vue.js': 'frontend', vue: 'frontend',
  'next.js': 'frontend', 'nuxt.js': 'frontend', svelte: 'frontend', jquery: 'frontend',
  redux: 'frontend', 'redux toolkit': 'frontend', 'react query': 'frontend',
  'tailwind css': 'frontend', tailwind: 'frontend', bootstrap: 'frontend',
  'material ui': 'frontend', 'material-ui': 'frontend', mui: 'frontend',
  'ant design': 'frontend', 'chakra ui': 'frontend',
  'styled-components': 'frontend', emotion: 'frontend',
  'react native': 'frontend', gatsby: 'frontend', electron: 'frontend',
  'vue router': 'frontend', vuex: 'frontend', pinia: 'frontend',

  // Languages (separate from frontend/backend so they go to Language: line)
  javascript: 'language', typescript: 'language',
  java: 'language', python: 'language', go: 'language', golang: 'language',
  kotlin: 'language', swift: 'language', rust: 'language', 'c#': 'language',
  'c++': 'language', c: 'language', sql: 'language', bash: 'language',
  scala: 'language', html: 'language', css: 'language', html5: 'language',
  css3: 'language', r: 'language', php: 'language', ruby: 'language',
  'bash scripting': 'language', 'shell scripting': 'language', groovy: 'language',
  dart: 'language', elixir: 'language', haskell: 'language',

  // Backend frameworks & patterns
  'spring boot': 'backend', 'spring mvc': 'backend', 'spring data jpa': 'backend',
  'spring data redis': 'backend', 'spring batch': 'backend', 'spring security': 'backend',
  'spring aop': 'backend', spring: 'backend', 'spring cloud': 'backend',
  'spring cloud gateway': 'backend', 'spring webflux': 'backend',
  hibernate: 'backend', jpa: 'backend',
  express: 'backend', 'express.js': 'backend', nestjs: 'backend',
  django: 'backend', flask: 'backend', fastapi: 'backend',
  webflux: 'backend', 'project reactor': 'backend',
  graphql: 'backend', grpc: 'backend', 'rest api': 'backend', restful: 'backend',
  'node.js': 'backend', node: 'backend',
  'asp.net': 'backend', '.net': 'backend', dotnet: 'backend', 'asp.net core': 'backend',
  laravel: 'backend', symfony: 'backend', rails: 'backend', 'ruby on rails': 'backend',
  microservices: 'backend', 'micro services': 'backend',
  jwt: 'backend', oauth: 'backend', oauth2: 'backend', 'oauth 2.0': 'backend',
  lombok: 'backend', mapstruct: 'backend',
  eureka: 'backend', zuul: 'backend', ribbon: 'backend',
  'hibernate validator': 'backend',

  // Resilience patterns
  resilience4j: 'resilience',
  'circuit breaker': 'resilience', saga: 'resilience', cqrs: 'resilience',
  'event sourcing': 'resilience', 'bulkhead': 'resilience',

  // Database
  postgresql: 'database', postgres: 'database', mysql: 'database',
  'oracle db': 'database', oracle: 'database', mongodb: 'database',
  redis: 'database', cassandra: 'database', elasticsearch: 'database',
  dynamodb: 'database', db2: 'database', mariadb: 'database',
  sqlite: 'database', neo4j: 'database', hbase: 'database', hikaricp: 'database',
  'sql server': 'database', mssql: 'database',
  cockroachdb: 'database', couchdb: 'database', firebase: 'database',
  'firebase firestore': 'database', supabase: 'database',

  // Messaging / Streaming
  kafka: 'messaging', 'apache kafka': 'messaging', rabbitmq: 'messaging',
  activemq: 'messaging', sqs: 'messaging', pulsar: 'messaging',
  'azure service bus': 'messaging', sns: 'messaging', nats: 'messaging',

  // DevOps / Tools / Build
  jenkins: 'devops', maven: 'devops', gradle: 'devops',
  git: 'devops', github: 'devops', gitlab: 'devops', bitbucket: 'devops',
  docker: 'devops', kubernetes: 'devops', terraform: 'devops',
  ansible: 'devops', helm: 'devops', linux: 'devops', unix: 'devops',
  nginx: 'devops', sonarqube: 'devops', sonar: 'devops',
  'github actions': 'devops', 'gitlab ci': 'devops', 'circle ci': 'devops', circleci: 'devops',
  webpack: 'devops', vite: 'devops', babel: 'devops',
  swagger: 'devops', openapi: 'devops',
  jira: 'devops', confluence: 'devops', trello: 'devops',
  agile: 'devops', scrum: 'devops', kanban: 'devops',
  nexus: 'devops', artifactory: 'devops',
  liquibase: 'devops', flyway: 'devops',
  powershell: 'devops', 'ci/cd': 'devops',
  'apache httpd': 'devops', 'apache tomcat': 'devops', tomcat: 'devops',

  // Cloud
  aws: 'cloud', azure: 'cloud', gcp: 'cloud', 'google cloud': 'cloud',
  lambda: 'cloud', ec2: 'cloud', s3: 'cloud', rds: 'cloud',
  ecs: 'cloud', eks: 'cloud', cloudfront: 'cloud', 'route 53': 'cloud',
  'azure devops': 'cloud', 'azure functions': 'cloud',
  gke: 'cloud', bigquery: 'cloud', 'cloud run': 'cloud',
  cloudwatch: 'monitoring', 'aws cloudwatch': 'monitoring',

  // Testing
  junit: 'testing', mockito: 'testing', jest: 'testing',
  cypress: 'testing', selenium: 'testing', testng: 'testing',
  pytest: 'testing', postman: 'testing', supertest: 'testing',
  'testing library': 'testing', vitest: 'testing', playwright: 'testing',
  cucumber: 'testing', 'karate framework': 'testing',

  // Monitoring / Observability
  prometheus: 'monitoring', grafana: 'monitoring', elk: 'monitoring',
  datadog: 'monitoring', splunk: 'monitoring', 'new relic': 'monitoring',
  kibana: 'monitoring', logstash: 'monitoring', zipkin: 'monitoring',
  jaeger: 'monitoring',
};

// Domain → keywords that appear in sub-category line labels
const DOMAIN_LABEL_KEYWORDS = {
  frontend:   ['frontend', 'front-end', 'front end', 'ui', 'client', 'web ui', 'web frontend'],
  backend:    ['backend', 'back-end', 'back end', 'server', 'server-side', 'api', 'microservice'],
  language:   ['language', 'lang', 'programming', 'scripting', 'coding', 'technologies used'],
  database:   ['database', 'data', 'db', 'storage', 'rdbms', 'nosql', 'data store'],
  messaging:  ['messaging', 'message', 'queue', 'broker', 'event', 'streaming'],
  devops:     ['devops', 'tool', 'build', 'ci', 'cd', 'other', 'ops', 'version control',
               'automation', 'infrastructure', 'scm', 'project management'],
  cloud:      ['cloud', 'aws', 'azure', 'gcp', 'infrastructure', 'platform', 'cloud platform'],
  testing:    ['testing', 'test', 'qa', 'quality', 'unit test', 'integration test'],
  monitoring: ['monitoring', 'observability', 'logging', 'metrics', 'alerting', 'tracing'],
  resilience: ['resilience', 'fault', 'pattern', 'reliability', 'design pattern'],
};

// These domains are exclusive — React must NOT go to a Backend: line
const EXCLUSIVE_DOMAINS = new Set([
  'frontend', 'backend', 'language', 'database', 'messaging',
  'devops', 'testing', 'monitoring', 'resilience', 'cloud',
]);

export function getSkillDomain(skill) {
  const lower = skill.toLowerCase().trim();
  if (SKILL_DOMAIN[lower]) return SKILL_DOMAIN[lower];
  for (const [key, domain] of Object.entries(SKILL_DOMAIN)) {
    if (lower.includes(key) || key.includes(lower)) return domain;
  }
  return null;
}

// Strip the [ADDED-LINE] marker so scoring functions work on already-inserted lines
function stripAddedMarker(line) {
  return line.replace(/^\[ADDED-LINE\]/, '');
}

// Infer domain from existing skills already present on a line (fallback when label doesn't match)
function inferDomainFromSiblings(line) {
  const lower = line.toLowerCase();
  const domainCounts = {};
  for (const [key, domain] of Object.entries(SKILL_DOMAIN)) {
    // Only count whole-word-ish matches to avoid false positives (e.g. "go" matching "logo")
    const re = new RegExp(`(?<![a-z0-9])${key.replace(/[.+[\]()]/g, '\\$&')}(?![a-z0-9])`, 'i');
    if (re.test(lower)) {
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    }
  }
  const entries = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const [topDomain, topCount] = entries[0];
  const secondCount = entries[1]?.[1] || 0;
  // Confident if top domain has at least 2 skills OR clearly dominates
  if (topCount >= 2 || topCount > secondCount) return topDomain;
  return null;
}

function getLineDomain(line) {
  const lower = line.toLowerCase();
  const labelMatch = lower.match(/^([a-z][a-z\s\/&0-9]+?)\s*[:|-]/);
  if (labelMatch) {
    const label = labelMatch[1].trim();
    for (const [domain, keywords] of Object.entries(DOMAIN_LABEL_KEYWORDS)) {
      if (keywords.some(kw => label.includes(kw))) return domain;
    }
  }
  // Fallback: infer from sibling skills already on the line
  return inferDomainFromSiblings(line);
}

function detectSeparator(line) {
  if (/ \| /.test(line)) return ' | ';
  if (/\s*•\s*/.test(line)) return ' • ';
  if (/\s*·\s*/.test(line)) return ' · ';
  return ', ';
}

// Returns score for placing skill on this line. Negative = incompatible.
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
      return -1; // Domain conflict — hard block
    }
  }

  // Bonus: line already has sibling skills in the same domain
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
// Key invariant: skills are grouped by domain BEFORE any lines are touched.
// This guarantees one insertion per domain (and one "Others:" for all
// unclassified skills) no matter how many skills need to be added.
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
    // No skills section found — append one
    const res = [...lines];
    res.push('', 'SKILLS', `[ADDED-LINE]Others: ${skillsToAdd.map(s => `[ADDED]${s}`).join(', ')}`, '');
    return res.join('\n');
  }

  let sectionEnd = sectionStart + 1;
  while (sectionEnd < lines.length && !isTopLevelSection(lines[sectionEnd])) {
    sectionEnd++;
  }

  const result = [...lines];

  // ── Group skills by domain BEFORE touching any lines ──────────────────
  // This is the core invariant: one line insertion per domain group,
  // so we never get 3 "Others:" rows for 3 unclassified skills.
  const byDomain = new Map();
  for (const skill of skillsToAdd) {
    const domain = getSkillDomain(skill) ?? 'unclassified';
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(skill);
  }

  // Checks if there's already an "Others / Misc / General" catch-all line
  function findOthersLine() {
    for (let i = sectionStart + 1; i < sectionEnd; i++) {
      const stripped = stripAddedMarker(result[i]).toLowerCase();
      const labelMatch = stripped.match(/^([a-z][a-z\s\/&0-9]+?)\s*[:|-]/);
      if (!labelMatch) continue;
      const label = labelMatch[1].trim();
      if (/\b(other|misc|general|additional|extra|general purpose)\b/.test(label)) return i;
    }
    return -1;
  }

  for (const [domain, skills] of byDomain) {
    const isUnclassified = domain === 'unclassified';
    const skillDomain    = isUnclassified ? null : domain;

    // Build comma-separated added-marker string
    const markedSkills = skills.map(s => `[ADDED]${s}`);

    let bestIdx   = -1;
    let bestScore = 0;

    if (isUnclassified) {
      // For unclassified skills, prefer any existing Others/Misc line over a new one
      bestIdx   = findOthersLine();
      bestScore = bestIdx >= 0 ? 1 : 0;
    } else {
      // Strip [ADDED-LINE] prefix when scanning so already-inserted domain lines are visible
      for (let i = sectionStart + 1; i < sectionEnd; i++) {
        const raw     = result[i];
        if (!raw.trim()) continue;
        const stripped = stripAddedMarker(raw);
        const sc      = scoreLineForSkill(stripped, skillDomain);
        if (sc > bestScore) { bestScore = sc; bestIdx = i; }
      }
    }

    if (bestIdx >= 0 && bestScore > 0) {
      // Append ALL skills in this domain group to the best matching line
      const sep = detectSeparator(stripAddedMarker(result[bestIdx]));
      result[bestIdx] = result[bestIdx].trimEnd() + sep + markedSkills.join(sep);
    } else {
      // No matching line — insert ONE new line for the entire group
      const domainLabel = isUnclassified
        ? 'Others'
        : skillDomain.charAt(0).toUpperCase() + skillDomain.slice(1);

      const lastNonBlank = (() => {
        for (let i = sectionEnd - 1; i >= sectionStart; i--) {
          if (result[i].trim()) return i;
        }
        return sectionStart;
      })();

      result.splice(lastNonBlank + 1, 0, `[ADDED-LINE]${domainLabel}: ${markedSkills.join(', ')}`);
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
