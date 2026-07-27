'use strict';
const axios = require('axios');

module.exports = async function fetchRemotive(keywords = []) {
  const results = [];
  // Remotive: single call, no category filter (most reliable across API versions)
  try {
    const { data } = await axios.get('https://remotive.com/api/remote-jobs', {
      params: { limit: 100 },
      timeout: 15000,
    });
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    results.push(...jobs);
  } catch (_) {}
  return results.map(j => ({
    source:      'remotive',
    external_id: String(j.id),
    title:       j.title || '',
    company:     j.company_name || '',
    location:    j.candidate_required_location || 'Remote',
    description: j.description || '',
    apply_url:   j.url || '',
    posted_at:   j.publication_date ? new Date(j.publication_date).toISOString().slice(0, 10) : '',
    is_remote:   1,
  }));
};
