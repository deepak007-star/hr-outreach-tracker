'use strict';
const axios = require('axios');

// "stripe" -> "Stripe", "scale-ai" -> "Scale Ai" — cosmetic only, the slug
// itself is still what's used for the API call and `source` tag.
function titleCaseSlug(slug) {
  return slug.split(/[-_]/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

// Fetch jobs from any company's public Greenhouse board (no auth required)
module.exports = async function fetchGreenhouse(companies = []) {
  const results = [];
  for (const slug of companies) {
    try {
      const { data } = await axios.get(
        `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
        { timeout: 15000 }
      );
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const companyName = titleCaseSlug(slug);
      for (const j of jobs) {
        const desc = (j.content || '').replace(/<[^>]+>/g, '').trim();
        results.push({
          source:      `greenhouse:${slug}`,
          external_id: String(j.id),
          title:       j.title || '',
          company:     companyName,
          location:    j.location?.name || '',
          description: desc.slice(0, 2000),
          apply_url:   j.absolute_url || '',
          posted_at:   j.updated_at ? new Date(j.updated_at).toISOString().slice(0, 10) : '',
          department:  j.departments?.[0]?.name || '',
        });
      }
    } catch (e) {
      console.warn(`[Greenhouse] ${slug}: ${e.message}`);
    }
  }
  return results;
};
