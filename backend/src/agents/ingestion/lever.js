'use strict';
const axios = require('axios');

// "airbnb" -> "Airbnb", "scale-ai" -> "Scale Ai" — cosmetic only, the slug
// itself is still what's used for the API call and `source` tag.
function titleCaseSlug(slug) {
  return slug.split(/[-_]/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

// Fetch jobs from any company's public Lever posting board (no auth required)
module.exports = async function fetchLever(companies = []) {
  const results = [];
  for (const slug of companies) {
    try {
      const { data } = await axios.get(
        `https://api.lever.co/v0/postings/${slug}?mode=json`,
        { timeout: 15000 }
      );
      const jobs = Array.isArray(data) ? data : [];
      const companyName = titleCaseSlug(slug);
      for (const j of jobs) {
        const desc = (j.descriptionPlain || j.description || '')
          .replace(/<[^>]+>/g, '').trim();
        const lists = Array.isArray(j.lists)
          ? j.lists.map(l => `${l.text}: ${(l.content || '').replace(/<[^>]+>/g, '')}`).join('\n')
          : '';
        results.push({
          source:      `lever:${slug}`,
          external_id: j.id || '',
          title:       j.text || '',
          company:     companyName,
          location:    j.categories?.location || j.workplaceType || '',
          description: `${desc}\n${lists}`.trim().slice(0, 2000),
          apply_url:   j.hostedUrl || '',
          posted_at:   j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : '',
          department:  j.categories?.team || '',
        });
      }
    } catch (e) {
      console.warn(`[Lever] ${slug}: ${e.message}`);
    }
  }
  return results;
};
