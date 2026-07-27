'use strict';
const axios = require('axios');

// Jooble API — requires JOOBLE_KEY env var or settings
module.exports = async function fetchJooble(keywords = [], opts = {}) {
  const apiKey   = opts.key || process.env.JOOBLE_KEY;
  if (!apiKey) return [];

  const location = opts.location || 'India';
  const results  = [];

  for (const kw of keywords.slice(0, 5)) {
    try {
      const { data } = await axios.post(
        `https://jooble.org/api/${apiKey}`,
        { keywords: kw, location, radius: '25', page: '1', resultsOnPage: '50' },
        { timeout: 15000 }
      );
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      for (const j of jobs) {
        results.push({
          source:      'jooble',
          external_id: j.id || j.link || '',
          title:       j.title || '',
          company:     j.company || '',
          location:    j.location || '',
          description: (j.snippet || '').slice(0, 2000),
          apply_url:   j.link || '',
          posted_at:   j.updated ? new Date(j.updated).toISOString().slice(0, 10) : '',
          salary:      j.salary || '',
        });
      }
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.warn(`[Jooble] "${kw}": ${e.message}`);
    }
  }
  return results;
};
