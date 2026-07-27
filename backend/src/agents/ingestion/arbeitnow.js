'use strict';
const axios = require('axios');

module.exports = async function fetchArbeitnow() {
  const url = 'https://www.arbeitnow.com/api/job-board-api';
  const { data } = await axios.get(url, { timeout: 15000 });
  const jobs = Array.isArray(data?.data) ? data.data : [];
  return jobs.map(j => ({
    source:      'arbeitnow',
    external_id: String(j.slug || j.url || ''),
    title:       j.title || '',
    company:     j.company_name || '',
    location:    j.location || (j.remote ? 'Remote' : ''),
    description: j.description || '',
    apply_url:   j.url || '',
    posted_at:   j.created_at ? new Date(j.created_at).toISOString().slice(0, 10) : '',
    tags:        Array.isArray(j.tags) ? j.tags.join(', ') : '',
    is_remote:   j.remote ? 1 : 0,
  }));
};
