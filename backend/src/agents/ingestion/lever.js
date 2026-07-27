'use strict';
const axios = require('axios');

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
          company:     slug,
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
