import { jsPDF } from 'jspdf';
import { Document, Paragraph, TextRun, Packer, AlignmentType } from 'docx';

// ── Primary domain for each skill ────────────────────────────────────────
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

  // Languages
  javascript: 'language', typescript: 'language',
  java: 'language', python: 'language', go: 'language', golang: 'language',
  kotlin: 'language', swift: 'language', rust: 'language', 'c#': 'language',
  'c++': 'language', c: 'language', sql: 'language', bash: 'language',
  scala: 'language', html: 'language', css: 'language', html5: 'language',
  css3: 'language', r: 'language', php: 'language', ruby: 'language',
  'bash scripting': 'language', 'shell scripting': 'language', groovy: 'language',
  dart: 'language', elixir: 'language', haskell: 'language',

  // Backend
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

  // Resilience
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

  // Messaging
  kafka: 'messaging', 'apache kafka': 'messaging', rabbitmq: 'messaging',
  activemq: 'messaging', sqs: 'messaging', pulsar: 'messaging',
  'azure service bus': 'messaging', sns: 'messaging', nats: 'messaging',

  // DevOps
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

  // Monitoring
  prometheus: 'monitoring', grafana: 'monitoring', elk: 'monitoring',
  datadog: 'monitoring', splunk: 'monitoring', 'new relic': 'monitoring',
  kibana: 'monitoring', logstash: 'monitoring', zipkin: 'monitoring',
  jaeger: 'monitoring',
};

// Domain → keywords in sub-category line labels
const DOMAIN_LABEL_KEYWORDS = {
  frontend:   ['frontend', 'front-end', 'front end', 'ui', 'client', 'web ui', 'web frontend'],
  backend:    ['backend', 'back-end', 'back end', 'server', 'server-side', 'api', 'microservice'],
  language:   ['language', 'lang', 'programming', 'scripting', 'coding', 'technologies used'],
  database:   ['database', 'data', 'db', 'storage', 'rdbms', 'nosql', 'data store'],
  messaging:  ['messaging', 'message', 'queue', 'broker', 'event', 'streaming'],
  devops:     ['devops', 'tool', 'build', 'ci', 'cd', 'other', 'ops', 'version control',
               'automation', 'infrastructure', 'scm', 'project management', 'container', 'orchestration'],
  cloud:      ['cloud', 'aws', 'azure', 'gcp', 'infrastructure', 'platform', 'cloud platform'],
  testing:    ['testing', 'test', 'qa', 'quality', 'unit test', 'integration test'],
  monitoring: ['monitoring', 'observability', 'logging', 'metrics', 'alerting', 'tracing'],
  resilience: ['resilience', 'fault', 'pattern', 'reliability', 'design pattern'],
};

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

function stripAddedMarker(line) {
  return line.replace(/^\[ADDED-LINE\]/, '');
}

function inferDomainFromSiblings(line) {
  const lower = line.toLowerCase();
  const domainCounts = {};
  for (const [key, domain] of Object.entries(SKILL_DOMAIN)) {
    const re = new RegExp(`(?<![a-z0-9])${key.replace(/[.+[\]()]/g, '\\$&')}(?![a-z0-9])`, 'i');
    if (re.test(lower)) {
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    }
  }
  const entries = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const [topDomain, topCount] = entries[0];
  const secondCount = entries[1]?.[1] || 0;
  if (topCount >= 2 || topCount > secondCount) return topDomain;
  return null;
}

// Returns ALL domains a line belongs to (handles compound labels like "Languages & Backend:")
function getLineDomains(line) {
  const lower = line.toLowerCase();
  const labelMatch = lower.match(/^([a-z][a-z\s\/&0-9]+?)\s*[:|-]/);
  const domains = new Set();

  if (labelMatch) {
    const label = labelMatch[1].trim();
    for (const [domain, keywords] of Object.entries(DOMAIN_LABEL_KEYWORDS)) {
      if (keywords.some(kw => label.includes(kw))) {
        domains.add(domain);
      }
    }
  }

  if (domains.size === 0) {
    const inf = inferDomainFromSiblings(line);
    if (inf) domains.add(inf);
  }

  return domains;
}

function detectSeparator(line) {
  if (/ \| /.test(line)) return ' | ';
  if (/\s*•\s*/.test(line)) return ' • ';
  if (/\s*·\s*/.test(line)) return ' · ';
  return ', ';
}

// Score how well a skill fits on a given line. Negative = incompatible.
function scoreLineForSkill(line, skillDomain) {
  if (!line.trim()) return -1;
  const lineDomains = getLineDomains(line);

  if (!skillDomain || lineDomains.size === 0) return 0;

  let score = 0;

  if (lineDomains.has(skillDomain)) {
    score += 100;
  } else if (EXCLUSIVE_DOMAINS.has(skillDomain)) {
    // Only block if ALL line domains conflict — compound labels (e.g. "Languages & Backend:") should
    // accept skills from any of their constituent domains
    const allConflict = [...lineDomains].every(d => EXCLUSIVE_DOMAINS.has(d) && d !== skillDomain);
    if (allConflict) return -1;
  }

  // Bonus: line already has a sibling skill in the same domain
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

// ── Text normalization ─────────────────────────────────────────────────────────
// Joins continuation lines that were artificially split by PDF layout/word-wrap.
// Only joins when the join is unambiguous: previous ends with comma/slash/pipe,
// or the current line starts with a lowercase letter (definite mid-sentence).
export function normalizeResumeText(raw) {
  if (!raw?.trim()) return raw || '';

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trimEnd();
    const t = l.trim();

    if (!t) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }

    // Drop lines that are only a page number
    if (/^\s*\d+\s*$/.test(t)) continue;

    // Does this line clearly open a new logical unit?
    const startsNew =
      /^[A-Z][A-Z\s\/&0-9]+$/.test(t) ||                         // ALL-CAPS section header
      /^[•▪▸►\-–]\s/.test(t) ||                                   // Bullet point
      /^[A-Za-z][A-Za-z\s\/&0-9\/]+?\s*:\s*\S/.test(t);           // "Label: content"

    // Try to join with the previous non-empty line
    if (!startsNew && out.length > 0 && out[out.length - 1] !== '') {
      const prev = out[out.length - 1].trimEnd();
      const shouldJoin =
        prev.endsWith(',') ||
        prev.endsWith('/') ||
        prev.endsWith('|') ||
        prev.endsWith('&') ||
        /^[a-z]/.test(t);    // starts with lowercase → unambiguous continuation

      if (shouldJoin) {
        out[out.length - 1] = prev + ' ' + t;
        continue;
      }
    }

    out.push(l);
  }

  // Collapse consecutive blank lines to one
  const final = [];
  let wasBlank = false;
  for (const line of out) {
    if (line === '') {
      if (!wasBlank) final.push(line);
      wasBlank = true;
    } else {
      wasBlank = false;
      final.push(line);
    }
  }

  return final.join('\n').trim();
}

// ── Main resume modifier ──────────────────────────────────────────────────────
export function modifyResume(rawText, skillsToAdd) {
  if (!skillsToAdd.length || !rawText) return rawText;

  // Normalize first so PDF continuation lines are joined before we try to match sections
  const text  = normalizeResumeText(rawText);
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
    res.push('', 'SKILLS', `[ADDED-LINE]Others: ${skillsToAdd.map(s => `[ADDED]${s}`).join(', ')}`, '');
    return res.join('\n');
  }

  let sectionEnd = sectionStart + 1;
  while (sectionEnd < lines.length && !isTopLevelSection(lines[sectionEnd])) {
    sectionEnd++;
  }

  const result = [...lines];

  // Determine content start: if the header line itself is a subcategory (e.g. "Technical Skills: Java, Python")
  // include it in the search so skills can be appended to it directly.
  const headerText = stripAddedMarker(lines[sectionStart]).trim();
  const headerIsSubcategory = /^[A-Za-z][A-Za-z\s\/&0-9]+?\s*:\s*.{1,}/.test(headerText);
  const contentStart = headerIsSubcategory ? sectionStart : sectionStart + 1;

  // Detect whether the section already uses labeled sub-lines ("Label: content")
  const hasLabeledLines = result.slice(contentStart, sectionEnd).some(line => {
    const stripped = stripAddedMarker(line).trim();
    return /^[A-Za-z][A-Za-z\s\/&0-9]+?\s*:\s*.{1,}/.test(stripped);
  });

  // Group skills by domain BEFORE touching any lines — one insertion per domain
  const byDomain = new Map();
  for (const skill of skillsToAdd) {
    const domain = getSkillDomain(skill) ?? 'unclassified';
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(skill);
  }

  function findOthersLine() {
    for (let i = contentStart; i < sectionEnd; i++) {
      const stripped = stripAddedMarker(result[i]).toLowerCase();
      const labelMatch = stripped.match(/^([a-z][a-z\s\/&0-9]+?)\s*[:|-]/);
      if (!labelMatch) continue;
      const label = labelMatch[1].trim();
      if (/\b(other|misc|general|additional|extra)\b/.test(label)) return i;
    }
    return -1;
  }

  for (const [domain, skills] of byDomain) {
    const isUnclassified = domain === 'unclassified';
    const skillDomain    = isUnclassified ? null : domain;
    const markedSkills   = skills.map(s => `[ADDED]${s}`);

    let bestIdx   = -1;
    let bestScore = 0;

    if (isUnclassified) {
      bestIdx   = findOthersLine();
      bestScore = bestIdx >= 0 ? 1 : 0;
    } else {
      for (let i = contentStart; i < sectionEnd; i++) {
        const raw     = result[i];
        if (!raw.trim()) continue;
        const stripped = stripAddedMarker(raw);
        const sc      = scoreLineForSkill(stripped, skillDomain);
        if (sc > bestScore) { bestScore = sc; bestIdx = i; }
      }
    }

    if (bestIdx >= 0 && bestScore > 0) {
      const sep = detectSeparator(stripAddedMarker(result[bestIdx]));
      result[bestIdx] = result[bestIdx].trimEnd() + sep + markedSkills.join(sep);
    } else {
      // No matching line — insert a new one at the end of the section
      const lastNonBlank = (() => {
        for (let i = sectionEnd - 1; i >= contentStart; i--) {
          if (result[i].trim()) return i;
        }
        return contentStart;
      })();

      if (hasLabeledLines) {
        // Section uses labels → match the style with a new labeled line
        const domainLabel = isUnclassified
          ? 'Others'
          : skillDomain.charAt(0).toUpperCase() + skillDomain.slice(1);
        result.splice(lastNonBlank + 1, 0, `[ADDED-LINE]${domainLabel}: ${markedSkills.join(', ')}`);
      } else {
        // Flat/unlabeled section → insert without domain label to preserve style
        result.splice(lastNonBlank + 1, 0, `[ADDED-LINE]${markedSkills.join(', ')}`);
      }
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

// ── PDF build (shared by download + vault upload) ───────────────────────────────
// Returns a jsPDF doc so callers can either .save() it or take .output('blob').
export function buildResumePdfDoc(rawText) {
  // Normalize then strip markers so continuation lines are joined before rendering
  const text  = cleanResumeText(normalizeResumeText(rawText));
  const lines = text.split('\n');
  const doc   = new jsPDF({ unit: 'mm', format: 'a4' });
  const MARGIN = 15;
  const PW     = 210 - MARGIN * 2;
  const PAGE_H = 297 - MARGIN;
  const FS     = 10;
  const LH     = 5;
  const BLH    = 2.5;
  let y = MARGIN;

  function checkY() { if (y + LH > PAGE_H) { doc.addPage(); y = MARGIN; } }

  const firstNonBlank = lines.findIndex(l => l.trim());

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) { y += BLH; return; }
    checkY();

    // Name
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

    // ALL-CAPS section header
    const isSection = t.length > 2 && t === t.toUpperCase() && /^[A-Z]/.test(t) && !t.includes(':');
    if (isSection) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      const wrapped = doc.splitTextToSize(t, PW);
      wrapped.forEach(wl => { checkY(); doc.text(wl, MARGIN, y); y += LH; });
      return;
    }

    // Sub-category "Label: rest" — bold label, normal rest
    const colonIdx = t.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30 && /^[A-Za-z][A-Za-z\s\/&0-9]+$/.test(t.slice(0, colonIdx))) {
      const label  = t.slice(0, colonIdx + 1);
      const rest   = t.slice(colonIdx + 1);
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

    // Everything else — plain normal text
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(50, 50, 50);
    const indent = line.length - line.trimStart().length;
    const x = MARGIN + Math.min(indent * 1.5, 12);
    const wrapped = doc.splitTextToSize(t, PW - (x - MARGIN));
    wrapped.forEach(wl => { checkY(); doc.text(wl, x, y); y += LH; });
  });

  return doc;
}

export function downloadAsPdf(rawText, filename = 'modified_resume') {
  buildResumePdfDoc(rawText).save(`${filename}.pdf`);
}

// Formatted PDF as a Blob — used to store a modified/generated resume in the vault
// so its preview renders the real document instead of raw text.
export function resumeTextToPdfBlob(rawText) {
  return buildResumePdfDoc(rawText).output('blob');
}

// ── Word download ─────────────────────────────────────────────────────────────
export async function downloadAsWord(rawText, filename = 'modified_resume') {
  const text  = cleanResumeText(normalizeResumeText(rawText));
  const lines = text.split('\n');

  const SZ      = 20;
  const SZ_NAME = 28;

  function run(txt, bold = false, color = '222222') {
    return new TextRun({ text: txt, font: 'Calibri', size: SZ, bold, color });
  }

  const firstNonBlank = lines.findIndex(l => l.trim());

  const paragraphs = lines.map((line, i) => {
    const t = line.trim();
    if (!t) {
      return new Paragraph({ children: [run(' ')], spacing: { before: 0, after: 0, line: 240 } });
    }
    const spacing = { before: 0, after: 0, line: 240 };

    if (i === firstNonBlank) {
      return new Paragraph({
        alignment: AlignmentType.CENTER, spacing,
        children: [new TextRun({ text: t, font: 'Calibri', size: SZ_NAME, bold: true, color: '000000' })],
      });
    }

    const isSection = t.length > 2 && t === t.toUpperCase() && /^[A-Z]/.test(t) && !t.includes(':');
    if (isSection) {
      return new Paragraph({ spacing, children: [run(t, true, '000000')] });
    }

    const colonIdx = t.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30 && /^[A-Za-z][A-Za-z\s\/&0-9]+$/.test(t.slice(0, colonIdx))) {
      return new Paragraph({
        spacing,
        children: [
          run(t.slice(0, colonIdx + 1), true,  '000000'),
          run(t.slice(colonIdx + 1),    false, '374151'),
        ],
      });
    }

    const indent = line.length - line.trimStart().length;
    return new Paragraph({
      spacing,
      indent: indent > 0 ? { left: Math.min(indent * 90, 720) } : undefined,
      children: [run(t, false, '374151')],
    });
  });

  const docObj = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children: paragraphs,
    }],
  });

  const blob = await Packer.toBlob(docObj);
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `${filename}.docx` });
  a.click();
  URL.revokeObjectURL(url);
}
