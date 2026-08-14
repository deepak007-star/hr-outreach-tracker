'use strict';
const axios = require('axios');

// Jobicy — free, no auth required, global remote jobs
module.exports = async function fetchJobicy() {
  try {
    const { data } = await axios.get('https://jobicy.com/api/v2/remote-jobs', {
      params: { count: 100 },
      timeout: 15000,
    });
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    return jobs.map(j => ({
      source:      'jobicy',
      external_id: String(j.id || j.jobSlug || j.url),
      title:       j.jobTitle || '',
      company:     j.companyName || '',
      location:    j.jobGeo || 'Remote',
      description: (j.jobDescription || j.jobExcerpt || '').replace(/<[^>]+>/g, ' ').slice(0, 3000),
      apply_url:   j.url || '',
      posted_at:   j.pubDate ? new Date(j.pubDate).toISOString().slice(0, 10) : '',
      is_remote:   1,
    }));
  } catch (e) {
    console.warn('[Jobicy]', e.message);
    return [];
  }
};
