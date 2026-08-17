'use strict';
/**
 * Bot-challenge / CAPTCHA detection for all search engines the scraper uses.
 *
 * Call detectBotChallenge(page) after page.goto() to check whether the response
 * is a real SERP or a bot-block page. The scraper uses this to:
 *  - Stop hammering a blocked engine (mark as blocked, switch to next engine)
 *  - Rotate proxy and retry
 *  - Log anti-bot statistics for the pipeline
 *
 * Returns: { detected: boolean, type: string|null, engine: string|null, message: string|null }
 */

// URL patterns that indicate a bot-block redirect happened
const URL_PATTERNS = [
  { re: /google\.com\/sorry\//i,               engine: 'google',     type: 'google-sorry'    },
  { re: /google\.com\/_\/[a-z]+\?.*captcha/i,  engine: 'google',     type: 'google-recaptcha'},
  { re: /bing\.com\/ck\/a\?/i,                  engine: 'bing',       type: 'bing-redirect'   },
  { re: /linkedin\.com\/authwall/i,             engine: 'linkedin',   type: 'linkedin-authwall'},
  { re: /linkedin\.com\/checkpoint/i,           engine: 'linkedin',   type: 'linkedin-checkpoint'},
  { re: /linkedin\.com\/uas\/login/i,           engine: 'linkedin',   type: 'linkedin-login'  },
  { re: /ddos-guard\.net/i,                     engine: 'ddos-guard', type: 'ddos-guard'      },
];

// DOM selectors that indicate a challenge page
const DOM_SELECTORS = [
  // Google
  '#captcha-form',
  'form[action*="/sorry/"]',
  'div#recaptcha',
  // DuckDuckGo
  '.anomaly-modal',
  '#challenge-form',
  '[class*="challenge"][class*="modal"]',
  // Cloudflare
  '#challenge-running',
  '.cf-browser-verification',
  '#cf-challenge-running',
  // LinkedIn
  '.authwall-join-form',
  '#join-form.sign-in-modal',
  // Generic
  '[id*="captcha"]',
  '[class*="captcha"]',
  '.g-recaptcha',
  // Bing
  '.b_captcha',
  '#captcha-container',
  // Brave
  '.captcha-wrapper',
];

// Body text patterns (case-insensitive) indicating bot detection
const TEXT_PATTERNS = [
  { re: /our systems have detected unusual traffic/i,           engine: 'google'     },
  { re: /please complete this captcha to continue/i,           engine: 'google'     },
  { re: /verify you.?re not a robot/i,                         engine: 'generic'    },
  { re: /are you a robot/i,                                    engine: 'generic'    },
  { re: /checking your browser/i,                              engine: 'cloudflare' },
  { re: /just a moment.{0,30}ddos/i,                          engine: 'cloudflare' },
  { re: /unusual activity detected/i,                          engine: 'duckduckgo' },
  { re: /too many requests/i,                                  engine: 'generic'    },
  { re: /automated access.{0,50}denied/i,                      engine: 'generic'    },
  { re: /access denied/i,                                      engine: 'generic'    },
  { re: /rate limit exceeded/i,                                engine: 'generic'    },
  { re: /join linkedin to see/i,                               engine: 'linkedin'   },
  { re: /sign in to continue/i,                                engine: 'linkedin'   },
  { re: /you need to sign in/i,                                engine: 'linkedin'   },
  // "security check"/"please enable javascript" were removed — both show up
  // verbatim in ordinary, non-blocked SERP boilerplate (footer text, <noscript>
  // fallbacks) often enough that they were false-positive-triggering markBlocked()
  // on real, unblocked pages, killing an engine's yield for the rest of the run.
  // Bing block
  { re: /this page has been blocked/i,                         engine: 'bing'       },
  // Yahoo CAPTCHA
  { re: /yahoo requires you to solve a captcha/i,              engine: 'yahoo'      },
];

/**
 * Check if a Playwright page is showing a bot challenge.
 * @param {import('playwright').Page} page
 * @returns {Promise<{detected:boolean, type:string|null, engine:string|null, message:string|null}>}
 */
async function detectBotChallenge(page) {
  const NOT_DETECTED = { detected: false, type: null, engine: null, message: null };

  try {
    const currentUrl = page.url();

    // Fast: URL-based check (catches redirects before DOM evaluation)
    for (const pat of URL_PATTERNS) {
      if (pat.re.test(currentUrl)) {
        return {
          detected: true,
          type:     pat.type,
          engine:   pat.engine,
          message:  `URL matched bot-block pattern: ${pat.type}`,
        };
      }
    }

    // DOM + body text check
    const { foundSelectors, bodySnippet } = await page.evaluate((selectors) => {
      const found = selectors.filter(s => {
        try { return !!document.querySelector(s); } catch { return false; }
      });
      const body = (document.body?.innerText || '').slice(0, 4000);
      return { foundSelectors: found, bodySnippet: body };
    }, DOM_SELECTORS).catch(() => ({ foundSelectors: [], bodySnippet: '' }));

    if (foundSelectors.length > 0) {
      return {
        detected: true,
        type:     'dom-challenge',
        engine:   'unknown',
        message:  `Challenge selector found: ${foundSelectors[0]}`,
      };
    }

    for (const pat of TEXT_PATTERNS) {
      if (pat.re.test(bodySnippet)) {
        return {
          detected: true,
          type:     'text-challenge',
          engine:   pat.engine,
          message:  `Body matched: ${pat.re.source.slice(0, 60)}`,
        };
      }
    }

    return NOT_DETECTED;
  } catch {
    return NOT_DETECTED; // page crashed / closed — let caller handle
  }
}

/**
 * Engine-level state tracker — tracks which engines are currently blocked
 * so the scraper doesn't waste time retrying a known-dead engine mid-session.
 */
class EngineState {
  constructor() {
    this._blocked    = new Map();   // engine → { blockedAt, cooldownMs }
    this._successes  = new Map();   // engine → count
    this._failures   = new Map();   // engine → count
  }

  markBlocked(engine, cooldownMs = 5 * 60_000) {
    this._blocked.set(engine, { blockedAt: Date.now(), cooldownMs });
    this._failures.set(engine, (this._failures.get(engine) || 0) + 1);
    console.warn(`[captcha] ${engine} blocked — cooling down ${cooldownMs / 60_000}min`);
  }

  markSuccess(engine) {
    this._successes.set(engine, (this._successes.get(engine) || 0) + 1);
    // Unblock if we somehow got through
    if (this._blocked.has(engine)) {
      console.log(`[captcha] ${engine} recovered — unblocking`);
      this._blocked.delete(engine);
    }
  }

  isBlocked(engine) {
    const state = this._blocked.get(engine);
    if (!state) return false;
    if (Date.now() - state.blockedAt >= state.cooldownMs) {
      // Cooldown expired — give it another chance
      this._blocked.delete(engine);
      return false;
    }
    return true;
  }

  summary() {
    const out = {};
    const engines = new Set([...this._blocked.keys(), ...this._successes.keys(), ...this._failures.keys()]);
    for (const e of engines) {
      out[e] = {
        blocked:  this.isBlocked(e),
        successes: this._successes.get(e) || 0,
        failures:  this._failures.get(e)  || 0,
      };
    }
    return out;
  }
}

module.exports = { detectBotChallenge, EngineState };
