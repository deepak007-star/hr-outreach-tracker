'use strict';

/**
 * Deterministic tech-stack categorizer for job_postings — lets the frontend
 * filter "Java" vs "Python" vs "DevOps" etc. instead of one undifferentiated
 * list. Specific stacks are checked before generic role-only buckets so
 * e.g. "Senior Software Development Engineer - Java" tags as `java`, not
 * `general` (which would otherwise win on raw token-count alone).
 */

const SPECIFIC = [
  { key: 'java',          label: 'Java',             tokens: ['java', 'jsp', 'jakarta', 'j2ee', 'spring', 'hibernate', 'jdbc', 'jpa'] },
  { key: 'python',        label: 'Python',           tokens: ['python', 'django', 'flask', 'fastapi', 'pyspark'] },
  { key: 'ai_ml',         label: 'AI / ML',          tokens: ['ai', 'ml', 'genai', 'llm', 'nlp', 'machine', 'learning', 'artificial', 'intelligence', 'deep'] },
  { key: 'devops_cloud',  label: 'DevOps / Cloud',   tokens: ['devops', 'kubernetes', 'docker', 'terraform', 'jenkins', 'sre', 'reliability', 'aws', 'azure', 'gcp', 'cloud', 'infrastructure', 'cicd', 'ci/cd'] },
  { key: 'data',          label: 'Data Engineering', tokens: ['data', 'etl', 'pipeline', 'analytics', 'warehouse', 'spark', 'hadoop'] },
  { key: 'frontend',      label: 'Frontend',         tokens: ['react', 'angular', 'vue', 'frontend', 'javascript', 'typescript', 'html', 'css', 'next.js', 'ui'] },
  { key: 'mern_node',     label: 'MERN / Node.js',   tokens: ['mern', 'node', 'node.js', 'express', 'mongodb'] },
  { key: 'qa',            label: 'QA / Automation',  tokens: ['sdet', 'automation', 'tester', 'qa', 'test'] },
];

const GENERIC = [
  { key: 'fullstack', label: 'Full Stack',   tokens: ['full', 'stack', 'fullstack'] },
  { key: 'backend',   label: 'Backend',      tokens: ['backend', 'microservices', 'api', 'rest'] },
  { key: 'general',   label: 'General / SDE', tokens: ['sde', 'software', 'engineer', 'developer'] },
];

const ALL_CATEGORIES = [...SPECIFIC, ...GENERIC];
const CATEGORY_LABELS = Object.fromEntries(ALL_CATEGORIES.map(c => [c.key, c.label]));

function tokenize(str) {
  return (str || '').toLowerCase().match(/[a-z0-9+.#/]+/g) || [];
}

function pickBest(list, haySet) {
  let best = null, bestScore = 0;
  for (const cat of list) {
    const score = cat.tokens.reduce((n, t) => n + (haySet.has(t) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

function categorize(job) {
  const haySet = new Set(tokenize(`${job.title || ''} ${job.description || ''}`.slice(0, 1500)));
  const best = pickBest(SPECIFIC, haySet) || pickBest(GENERIC, haySet);
  return best ? best.key : 'general';
}

module.exports = { categorize, CATEGORY_LABELS, ALL_CATEGORIES };
