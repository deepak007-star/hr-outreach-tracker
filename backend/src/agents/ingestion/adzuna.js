'use strict';
const axios = require('axios');

// Adzuna API — requires ADZUNA_APP_ID + ADZUNA_KEY env vars or settings
module.exports = async function fetchAdzuna(keywords = [], opts = {}) {
  const appId  = opts.appId  || process.env.ADZUNA_APP_ID;
  const appKey = opts.appKey || process.env.ADZUNA_KEY;
  if (!appId || !appKey) return [];

  const country   = opts.country || 'in';
  const location  = opts.location || '';
  const results   = [];

  for (const kw of keywords.slice(0, 5)) {
    try {
      const { data } = await axios.get(
        `https://api.adzuna.com/v1/api/jobs/${country}/search/1`,
        {
          params: {
            app_id:           appId,
            app_key:          appKey,
            results_per_page: 50,
            what:             kw,
            where:            location,
            'content-type':   'application/json',
          },
          timeout: 15000,
        }
      );
      const jobs = Array.isArray(data?.results) ? data.results : [];
      for (const j of jobs) {
        results.push({
          source:      'adzuna',
          external_id: j.id,
          title:       j.title || '',
          company:     j.company?.display_name || '',
          location:    j.location?.display_name || '',
          description: (j.description || '').slice(0, 2000),
          apply_url:   j.redirect_url || '',
          posted_at:   j.created ? new Date(j.created).toISOString().slice(0, 10) : '',
          salary_min:  j.salary_min,
          salary_max:  j.salary_max,
        });
      }
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.warn(`[Adzuna] "${kw}": ${e.message}`);
    }
  }
  return results;
};
