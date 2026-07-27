'use strict';
const axios = require('axios');

module.exports = async function fetchRemoteOK() {
  const { data } = await axios.get('https://remoteok.com/api', {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hr-outreach-tracker/1.0)' },
  });
  const jobs = Array.isArray(data) ? data.filter(j => j.id && j.position) : [];
  return jobs.map(j => ({
    source:      'remoteok',
    external_id: String(j.id),
    title:       j.position || '',
    company:     j.company || '',
    location:    j.location || 'Remote',
    description: (j.description || '').replace(/<[^>]+>/g, '').slice(0, 2000),
    apply_url:   j.apply_url || j.url || `https://remoteok.com/jobs/${j.id}`,
    posted_at:   j.date ? new Date(j.date).toISOString().slice(0, 10) : '',
    is_remote:   1,
  }));
};
