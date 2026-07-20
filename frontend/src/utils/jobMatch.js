import { extractSkills } from '../data/techSkills';

// Lightweight skill-overlap match % for scoring a whole feed of job cards —
// simpler than atsUtils.js's analyzeAts(), which is tuned for a single-post
// deep-dive (contact info, section headers, quantification) that don't apply
// to a bulk feed.
export function computeJobMatch(post, profileSkills = []) {
  if (!profileSkills.length) return { matchPercent: null, matchedSkills: [] };

  const jobSkills = new Set([
    ...extractSkills(post.description || ''),
    ...(Array.isArray(post.tech_stack) ? post.tech_stack : []),
  ]);
  if (!jobSkills.size) return { matchPercent: null, matchedSkills: [] };

  const resumeSkillsLower = new Set(profileSkills.map(s => String(s).toLowerCase()));
  const matchedSkills = [...jobSkills].filter(s => resumeSkillsLower.has(s.toLowerCase()));

  return {
    matchPercent: Math.round((matchedSkills.length / jobSkills.size) * 100),
    matchedSkills,
  };
}
