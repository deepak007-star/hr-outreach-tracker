'use strict';
const axios = require('axios');

// Himalayas — free, no auth required, ~100k remote jobs indexed
module.exports = async function fetchHimalayas() {
  try {
    const { data } = await axios.get('https://himalayas.app/jobs/api', {
      params: { limit: 100 },
      timeout: 15000,
    });
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    return jobs.map(j => ({
      source:      'himalayas',
      external_id: j.guid || j.companySlug + ':' + j.title,
      title:       j.title || '',
      company:     j.companyName || '',
      location:    (Array.isArray(j.locationRestrictions) && j.locationRestrictions.length)
                     ? j.locationRestrictions.join(', ') : 'Remote',
      description: (j.description || j.excerpt || '').replace(/<[^>]+>/g, ' ').slice(0, 3000),
      apply_url:   j.applicationLink || '',
      posted_at:   j.pubDate ? new Date(j.pubDate).toISOString().slice(0, 10) : '',
      is_remote:   1,
    }));
  } catch (e) {
    console.warn('[Himalayas]', e.message);
    return [];
  }
};
