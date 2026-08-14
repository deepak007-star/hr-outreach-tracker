'use strict';

/**
 * No-API skill matcher — the always-available fallback tier for
 * embeddingMatch.js. Three passes per skill, first hit wins:
 *   1. exact token match against the posting text
 *   2. known synonym/alias match ("js" <-> "javascript")
 *   3. fuzzy bigram (Dice coefficient) closeness, for typo/format variants
 *      the synonym list doesn't cover ("Reactjs" vs "React.js")
 */

// Common abbreviation/alias pairs. Keys and values are both lowercase,
// space-normalized single tokens or short phrases — extend freely.
const SKILL_SYNONYMS = {
  js: 'javascript', javascript: 'js',
  ts: 'typescript', typescript: 'ts',
  py: 'python', python: 'py',
  k8s: 'kubernetes', kubernetes: 'k8s',
  'node.js': 'node', node: 'node.js', nodejs: 'node',
  'react.js': 'react', reactjs: 'react',
  'vue.js': 'vue', vuejs: 'vue',
  postgres: 'postgresql', postgresql: 'postgres', psql: 'postgresql',
  mongo: 'mongodb', mongodb: 'mongo',
  'ci/cd': 'cicd', cicd: 'ci/cd',
  ml: 'machine learning', 'machine learning': 'ml',
  ai: 'artificial intelligence', 'artificial intelligence': 'ai',
  nlp: 'natural language processing',
  k8: 'kubernetes',
  golang: 'go', go: 'golang',
  'c#': 'csharp', csharp: 'c#',
  'c++': 'cpp', cpp: 'c++',
  'spring boot': 'springboot', springboot: 'spring boot',
  aws: 'amazon web services', 'amazon web services': 'aws',
  gcp: 'google cloud', 'google cloud': 'gcp',
  db: 'database', database: 'db',
  oop: 'object oriented programming',
  api: 'rest api', 'rest api': 'api', restful: 'rest api',
  ux: 'user experience', ui: 'user interface',
  devops: 'dev ops',
  qa: 'quality assurance',
  sre: 'site reliability engineering',
  llm: 'large language model',
  genai: 'generative ai',
};

function normalize(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Bigram (2-char shingle) Dice coefficient — cheap, no dependency, tolerant
// of pluralization/punctuation/minor typos without needing a full edit-distance pass.
function bigrams(s) {
  const clean = s.replace(/[^a-z0-9]/g, '');
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}

function diceCoefficient(a, b) {
  const A = bigrams(normalize(a));
  const B = bigrams(normalize(b));
  if (!A.size || !B.size) return A.size === B.size ? 1 : 0;
  let overlap = 0;
  for (const bg of A) if (B.has(bg)) overlap++;
  return (2 * overlap) / (A.size + B.size);
}

const FUZZY_THRESHOLD = 0.6;

// A raw substring check ("text.includes(term)") is only safe for multi-word
// phrases ("spring boot") — for a single short token (e.g. synonym "ts",
// "go", "ai", "ml", "db") it false-positives constantly against ordinary
// English words ("Requirements" contains "ts", "background" contains "go").
// hayTokens is pre-split on non-alphanumeric chars, so a token match there
// is always a real whole-word hit.
function containsTerm(text, hayTokens, term) {
  if (!term) return false;
  if (term.includes(' ')) return text.includes(term); // multi-word phrase spans tokens — substring is the only option
  if (term.length <= 3) return hayTokens.has(term);    // short single token — whole-word only
  return hayTokens.has(term) || text.includes(term);   // longer single word — token match, or substring for plurals/suffixes
}

// Extract candidate "skill-like" phrases from free text: capitalized runs,
// slash/dot-joined tech words, and comma/pipe-separated list items — cheap
// heuristic, not a real NER pass, but enough to fuzzy-compare against.
function candidatePhrases(text) {
  const found = new Set();
  const t = text || '';
  for (const m of t.match(/\b[A-Za-z][A-Za-z0-9+.#/-]{1,24}\b/g) || []) found.add(normalize(m));
  return found;
}

/**
 * @param {string[]} userSkills  Raw skill strings from profiles.skills
 * @param {string} jobText       Posting title+description
 * @returns {{ percent: number, matched: string[], total: number }}
 */
function lightweightSkillMatch(userSkills, jobText) {
  const skills = (userSkills || []).filter(Boolean);
  if (!skills.length) return { percent: 0, matched: [], total: 0 };

  const text  = normalize(jobText);
  const hayTokens = new Set(text.match(/[a-z0-9+.#/-]+/g) || []);
  const candidates = candidatePhrases(jobText);
  const matched = [];

  for (const raw of skills) {
    const skill = normalize(raw);
    if (!skill) continue;

    // 1. exact token/phrase match
    if (containsTerm(text, hayTokens, skill)) { matched.push(raw); continue; }

    // 2. synonym match
    const syn = SKILL_SYNONYMS[skill];
    if (syn && containsTerm(text, hayTokens, syn)) { matched.push(raw); continue; }

    // 3. fuzzy closeness against candidate phrases in the posting
    let close = false;
    for (const cand of candidates) {
      if (diceCoefficient(skill, cand) >= FUZZY_THRESHOLD) { close = true; break; }
    }
    if (close) matched.push(raw);
  }

  return { percent: Math.round((matched.length / skills.length) * 100), matched, total: skills.length };
}

// Some existing profiles.skills rows are double-JSON-encoded (an older buggy
// write path stringified an already-stringified array) — a single JSON.parse
// on those returns a STRING, not an array, which throws on every downstream
// .filter()/.map() call. Unwrap up to twice; fall back to [] otherwise.
function parseSkills(raw) {
  let v = raw;
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v.filter(Boolean) : [];
}

module.exports = { lightweightSkillMatch, diceCoefficient, SKILL_SYNONYMS, parseSkills };
