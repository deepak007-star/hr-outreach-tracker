'use strict';
const axios   = require('axios');
const cheerio = require('cheerio');

const FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
  'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
];

module.exports = async function fetchWWR() {
  const results = [];
  for (const feed of FEEDS) {
    try {
      const { data } = await axios.get(feed, { timeout: 15000, headers: { Accept: 'application/rss+xml' } });
      const $    = cheerio.load(data, { xmlMode: true });
      $('item').each((_, el) => {
        const $el       = $(el);
        const title     = $el.find('title').first().text().trim();
        const link      = $el.find('url').text().trim() || $el.find('link').text().trim();
        const pubDate   = $el.find('pubDate').text().trim();
        const rawDesc   = $el.find('description').text().trim();
        const desc      = cheerio.load(rawDesc).text().trim();
        const region    = $el.find('region').text().trim();
        const company   = title.split(':')[0]?.trim() || '';
        const jobTitle  = title.split(':').slice(1).join(':').trim() || title;
        results.push({
          source:      'wwr',
          external_id: link || title,
          title:       jobTitle,
          company,
          location:    region || 'Remote',
          description: desc.slice(0, 2000),
          apply_url:   link,
          posted_at:   pubDate ? new Date(pubDate).toISOString().slice(0, 10) : '',
          is_remote:   1,
        });
      });
    } catch (_) {}
  }
  return results;
};
