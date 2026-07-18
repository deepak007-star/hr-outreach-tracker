const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by','from',
  'is','are','was','were','be','been','being','have','has','had','do','does','did',
  'will','would','could','should','may','might','must','can','that','this','these',
  'those','it','its','we','you','they','he','she','our','your','their','my','all',
  'any','both','each','few','more','most','other','some','such','no','not','only',
  'same','so','than','too','very','as','if','up','out','about','into','through',
  'during','until','against','among','within','without','before','after','above',
  'below','between','across','what','who','how','when','where','which','while',
  'also','just','like','use','good','well','new','work','working','make','need',
  'able','team','great','join','get','take','look','used','based','include',
  'ensure','help','support','provide','build','using','looking','seeking',
]);

const ACTION_VERBS = [
  'achieved','architected','automated','built','collaborated','contributed',
  'coordinated','created','delivered','deployed','designed','developed','drove',
  'enabled','engineered','enhanced','established','executed','facilitated',
  'generated','implemented','improved','increased','integrated','launched','led',
  'managed','mentored','migrated','optimized','owned','reduced','refactored',
  'resolved','scaled','spearheaded','streamlined','transformed','shipped',
  'maintained','monitored','diagnosed','onboarded','accelerated','consolidated',
];

const SECTION_CHECKS = [
  { key: 'Summary',    re: /professional summary|summary|objective|profile/i,         pts: 2 },
  { key: 'Experience', re: /experience|work history|employment/i,                      pts: 3 },
  { key: 'Education',  re: /education|academic|qualification|degree/i,                 pts: 2 },
  { key: 'Skills',     re: /skill|technical skill|competenc|expertise|technologies/i,  pts: 3 },
];

function extractKeywords(text) {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([w]) => w);
}

export function analyzeAts(resumeText, jobDescription, jobSkills = [], resumeSkills = []) {
  if (!resumeText?.trim() || !jobDescription?.trim()) return null;
  const rLower = resumeText.toLowerCase();

  // 1. Keyword match — 40 pts
  const jobKws    = extractKeywords(jobDescription);
  const presentKw = jobKws.filter(k => rLower.includes(k));
  const missingKw = jobKws.filter(k => !rLower.includes(k));
  const kwScore   = jobKws.length ? Math.round((presentKw.length / jobKws.length) * 40) : 40;

  // 2. Skills match — 25 pts
  const matchedSkills = jobSkills.filter(s => resumeSkills.includes(s));
  const missingSkills = jobSkills.filter(s => !resumeSkills.includes(s));
  const skillScore    = jobSkills.length ? Math.round((matchedSkills.length / jobSkills.length) * 25) : 25;

  // 3. Contact info — 10 pts
  const hasEmail    = /\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/i.test(resumeText);
  const hasPhone    = /\b(\+?\d[\d\s\-()+]{6,})\b/.test(resumeText);
  const hasLinkedIn = /linkedin/i.test(resumeText);
  const contactScore = (hasEmail ? 4 : 0) + (hasPhone ? 3 : 0) + (hasLinkedIn ? 3 : 0);

  // 4. Sections — 10 pts
  const sections     = SECTION_CHECKS.map(s => ({ ...s, present: s.re.test(resumeText) }));
  const sectionScore = sections.reduce((acc, s) => acc + (s.present ? s.pts : 0), 0);

  // 5. Quantification — 10 pts
  const bullets    = resumeText.split('\n').filter(l => /^\s*[•▪▸►\-–]\s/.test(l));
  const quantified = bullets.filter(l => /\d/.test(l));
  const quantScore = bullets.length ? Math.round((quantified.length / bullets.length) * 10) : 5;

  // 6. Action verbs — 5 pts
  const usedVerbs  = ACTION_VERBS.filter(v => rLower.includes(v));
  const verbScore  = Math.min(5, Math.round((usedVerbs.length / 8) * 5));
  const unusedVerbs = ACTION_VERBS.filter(v => !rLower.includes(v));

  const overall = Math.min(100, kwScore + skillScore + contactScore + sectionScore + quantScore + verbScore);

  const suggestions = [];

  if (missingSkills.length > 0) {
    suggestions.push({
      id: 'skills', priority: 'high', impact: 25 - skillScore,
      title: `Add ${missingSkills.length} missing technical skill${missingSkills.length > 1 ? 's' : ''}`,
      description: 'Found in the job post but missing from your resume:',
      action: 'add_skills', items: missingSkills,
    });
  }
  if (missingKw.length > 3) {
    suggestions.push({
      id: 'keywords', priority: 'high', impact: 40 - kwScore,
      title: 'Use more job-specific keywords',
      description: 'These terms appear in the job post but not your resume — weave them into your experience or summary:',
      action: 'info', items: missingKw.slice(0, 12),
    });
  }
  if (quantScore < 7 && bullets.length > 0) {
    suggestions.push({
      id: 'quantification', priority: 'high', impact: 10 - quantScore,
      title: 'Quantify your achievements with numbers',
      description: `Only ${quantified.length}/${bullets.length} bullet points contain measurable impact. Add metrics:`,
      action: 'info', items: [
        'Reduced API latency by 35% using Redis caching',
        'Processed 2M+ events/day via Kafka consumers',
        'Led a team of 4 engineers, delivering in 3 sprints',
        'Improved test coverage from 40% → 85%',
      ],
    });
  }
  if (!hasEmail || !hasPhone) {
    suggestions.push({
      id: 'contact', priority: 'high', impact: (!hasEmail ? 4 : 0) + (!hasPhone ? 3 : 0),
      title: 'Complete contact information',
      description: `ATS may auto-reject resumes missing ${[!hasEmail && 'email address', !hasPhone && 'phone number'].filter(Boolean).join(' or ')}.`,
      action: 'info', items: [],
    });
  }
  const missingSec = sections.filter(s => !s.present);
  if (missingSec.length > 0) {
    suggestions.push({
      id: 'sections', priority: 'medium', impact: missingSec.reduce((a, s) => a + s.pts, 0),
      title: 'Add standard ATS section headers',
      description: 'ATS systems scan for exact section names. Missing:',
      action: 'info', items: missingSec.map(s => `Add "${s.key.toUpperCase()}" as a heading`),
    });
  }
  if (verbScore < 3) {
    suggestions.push({
      id: 'verbs', priority: 'low', impact: 5 - verbScore,
      title: 'Use stronger action verbs',
      description: 'Start achievement bullets with impactful verbs — try these:',
      action: 'info', items: unusedVerbs.slice(0, 10).map(v => v.charAt(0).toUpperCase() + v.slice(1)),
    });
  }

  return {
    overall,
    breakdown: [
      { label: 'Keyword Match',     score: kwScore,      max: 40 },
      { label: 'Skills Match',      score: skillScore,   max: 25 },
      { label: 'Contact Info',      score: contactScore, max: 10 },
      { label: 'Resume Sections',   score: sectionScore, max: 10 },
      { label: 'Metrics & Numbers', score: quantScore,   max: 10 },
      { label: 'Action Verbs',      score: verbScore,    max: 5  },
    ],
    suggestions: suggestions.sort((a, b) => b.impact - a.impact),
  };
}
