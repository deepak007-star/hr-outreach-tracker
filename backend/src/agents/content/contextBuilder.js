'use strict';
const db = require('../../db/database');
const { decrypt } = require('../../services/tokenCrypto');

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Read-only GitHub signal pull — recent commit messages across the user's
// most-recently-pushed repos. Any failure here (bad/expired PAT, rate limit,
// private repo scope gap) is caught and recorded to github_integration —
// it must never fail the whole content pipeline over a GitHub hiccup.
async function getGithubSignals(userId) {
  const row = await db.prepare(
    'SELECT pat_encrypted, github_username FROM github_integration WHERE user_id = ?'
  ).get(userId);
  if (!row || !row.github_username) return null;

  try {
    const { Octokit } = require('@octokit/rest');
    const octokit = new Octokit({ auth: decrypt(row.pat_encrypted) });
    const username = row.github_username;

    const { data: repos } = await octokit.repos.listForUser({ username, sort: 'pushed', per_page: 5 });
    const recentCommits = [];
    for (const repo of repos || []) {
      try {
        const { data: commits } = await octokit.repos.listCommits({ owner: username, repo: repo.name, per_page: 3 });
        for (const c of commits || []) {
          const msg = (c.commit?.message || '').split('\n')[0];
          if (msg) recentCommits.push(`[${repo.name}] ${msg}`);
        }
      } catch (_) { /* empty repo or restricted history — skip this repo */ }
    }

    await db.prepare(
      'UPDATE github_integration SET last_synced_at = ?, last_error = NULL, updated_at = ? WHERE user_id = ?'
    ).run(nowStr(), nowStr(), userId);

    return {
      username,
      repos: (repos || []).map(r => r.name),
      recentCommits: recentCommits.slice(0, 15),
    };
  } catch (e) {
    await db.prepare(
      'UPDATE github_integration SET last_error = ?, updated_at = ? WHERE user_id = ?'
    ).run(String(e.message || e).slice(0, 500), nowStr(), userId).catch(() => {});
    return null;
  }
}

function parseSkills(raw) {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

/**
 * Builds the personal context used to prompt topic/candidate generation.
 * Never throws — a missing profile or GitHub connection just yields a
 * thinner (but still usable) context.
 */
async function buildUserContext(userId) {
  const profile = await db.prepare(
    `SELECT full_name, current_title, current_company, location, summary,
            total_experience, skills, github_url, linkedin_url
     FROM profiles WHERE user_id = ?`
  ).get(userId);

  const github = await getGithubSignals(userId);
  const skills = parseSkills(profile?.skills);

  const lines = [];
  if (profile?.full_name) lines.push(`Name: ${profile.full_name}`);
  const roleParts = [profile?.current_title, profile?.current_company].filter(Boolean);
  if (roleParts.length) lines.push(`Role: ${roleParts.join(' at ')}`);
  if (profile?.total_experience) lines.push(`Experience: ${profile.total_experience}`);
  if (skills.length) lines.push(`Skills: ${skills.join(', ')}`);
  if (profile?.summary) lines.push(`Summary: ${profile.summary}`);
  if (github?.recentCommits?.length) {
    lines.push(`Recent GitHub activity:\n${github.recentCommits.map(c => `- ${c}`).join('\n')}`);
  }

  return {
    profile: profile || null,
    github,
    summaryForPrompt: lines.join('\n') || 'No profile information available yet.',
  };
}

module.exports = { buildUserContext, getGithubSignals };
