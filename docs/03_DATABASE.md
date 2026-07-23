# Database Reference — HR Outreach Tracker

## Connection

- Driver: `pg` (node-postgres) via `pg.Pool`
- Database: PostgreSQL 16
- Connection string: `DATABASE_URL` env var → fallback `postgres://postgres:postgres@localhost:5432/hr_outreach_tracker`
- SSL: disabled for localhost, `{ rejectUnauthorized: false }` for all other hosts

## Date/Time Convention

All date/time columns are `TEXT`, format `'YYYY-MM-DD HH:MM:SS'` in UTC.  
**Do not change to TIMESTAMPTZ** — every route that does string slicing, lexicographic date comparison, or `LEFT(col,10)` for day-bucketing depends on this format.

Column defaults use:
```sql
to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
```

Route code computes "now" in JS:
```js
new Date().toISOString().replace('T', ' ').slice(0, 19)
```

---

## Tables

### `users`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID, supplied by caller |
| name | TEXT NOT NULL | |
| email | TEXT UNIQUE NOT NULL | Stored lowercase |
| password_hash | TEXT NOT NULL | bcrypt(10 rounds). Google-auth users get a random unguessable hash |
| role | TEXT NOT NULL DEFAULT 'user' | 'admin' \| 'user' \| 'demo' \| 'guest' |
| plan | TEXT NOT NULL DEFAULT 'demo' | 'demo' \| 'user' \| 'pro' \| 'enterprise' |
| created_at | TEXT NOT NULL DEFAULT now_expr | |

First registered user is auto-promoted to `role='admin'` during DB initialization.

---

### `contacts`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | |
| title | TEXT | Job title |
| company | TEXT | |
| email | TEXT UNIQUE NOT NULL | |
| email_source | TEXT NOT NULL DEFAULT 'manual' | 'manual' \| 'import' \| 'scraped' |
| email_confidence | TEXT NOT NULL DEFAULT 'unknown' | 'unknown' \| 'guessed' \| 'verified' |
| source_url | TEXT | LinkedIn profile URL |
| status | TEXT NOT NULL DEFAULT 'New' | New \| Emailed \| Replied \| Interview \| Offer \| Rejected \| Do Not Contact |
| date_added | TEXT NOT NULL DEFAULT now_expr | |
| date_last_contacted | TEXT | |
| notes | TEXT | |
| tags | TEXT NOT NULL DEFAULT '[]' | JSON array of strings |
| email_verified | TEXT NOT NULL DEFAULT 'pending' | 'pending' \| 'valid' \| 'unverifiable' |
| email_checked_at | TEXT | When domain MX/A check last ran |
| email_deliverable | TEXT NOT NULL DEFAULT 'unknown' | 'unknown' \| 'delivered' \| 'bounced' |
| bounce_count | INTEGER NOT NULL DEFAULT 0 | |
| last_bounce_at | TEXT | |
| bounce_reason | TEXT | |

**Note:** No `user_id` column — contacts are currently shared across all users. (Known issue #29 / audit finding #4)

**Indexes:** `status`, `company`, `email_deliverable`

---

### `email_log`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| contact_id | TEXT REFERENCES contacts(id) | No CASCADE — orphans remain after contact delete |
| user_id | TEXT REFERENCES users(id) | Added in migration |
| sent_at | TEXT NOT NULL DEFAULT now_expr | |
| subject | TEXT | |
| body_snapshot | TEXT | |
| opened | INTEGER NOT NULL DEFAULT 0 | |
| bounced | INTEGER NOT NULL DEFAULT 0 | Legacy flag |
| delivery_status | TEXT NOT NULL DEFAULT 'sent' | 'sent' \| 'delivered' \| 'bounced' \| 'failed' |
| message_id | TEXT | SMTP message-ID header |
| bounce_reason | TEXT | |
| bounced_at | TEXT | |

**Indexes:** `sent_at`, `contact_id`, `user_id`, `delivery_status`

---

### `email_delivery_events`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| email_log_id | TEXT REFERENCES email_log(id) ON DELETE CASCADE | |
| contact_id | TEXT REFERENCES contacts(id) ON DELETE SET NULL | |
| user_id | TEXT REFERENCES users(id) | |
| event_type | TEXT NOT NULL | 'sent' \| 'delivered' \| 'bounce' \| 'open' |
| message_id | TEXT | |
| bounce_reason | TEXT | |
| raw_data | TEXT NOT NULL DEFAULT '{}' | |
| created_at | TEXT NOT NULL DEFAULT now_expr | |

**Indexes:** `email_log_id`, `contact_id`

---

### `delivery_billing_stats`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| user_id | TEXT NOT NULL REFERENCES users(id) | |
| billing_month | TEXT NOT NULL | 'YYYY-MM' |
| emails_sent | INTEGER NOT NULL DEFAULT 0 | |
| emails_delivered | INTEGER NOT NULL DEFAULT 0 | |
| emails_bounced | INTEGER NOT NULL DEFAULT 0 | |
| emails_failed | INTEGER NOT NULL DEFAULT 0 | |
| updated_at | TEXT NOT NULL DEFAULT now_expr | |

**UNIQUE(user_id, billing_month)**

---

### `email_templates`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT NOT NULL | |
| subject | TEXT NOT NULL DEFAULT '' | |
| body | TEXT NOT NULL DEFAULT '' | HTML body |
| is_default | INTEGER NOT NULL DEFAULT 0 | |
| category | TEXT NOT NULL DEFAULT 'general' | |
| tags | TEXT NOT NULL DEFAULT '[]' | JSON |
| attachment_json | TEXT | Pre-wired attachment config |
| created_at | TEXT NOT NULL DEFAULT now_expr | |
| updated_at | TEXT NOT NULL DEFAULT now_expr | |

---

### `settings`
Key-value store. All config, feature flags, per-user reminder configs.

| Key pattern | Value |
|---|---|
| `daily_send_cap` | '20' (string) |
| `scheduler_enabled` | 'true' \| 'false' |
| `smtp_config` | JSON object (host, port, user, pass, secure) |
| `apify_search_queries` | JSON array of strings |
| `apify_max_posts` | '300' |
| `apify_last_scrape` | ISO timestamp |
| `reminder_<userId>` | JSON { enabled, time, days[], deliveryEmail } |
| `reminder_email_sent_<userId>_<date>` | '1' — dedup key |
| `scrape_done_YYYY-MM-DD` | '1' — daily scrape dedup |
| `purge_config` | JSON { enabled, retention_days, last_purge } |
| `github_backup_config` | JSON { enabled, token, owner, repo, last_backup } |
| `scraper_defaults` | JSON { since, limit, location } |
| `referral_request_limit` | '5' (max per user) |
| `migration_scraped_at_normalized` | '1' — one-time migration marker |

---

### `users` → `profiles`
| Column | Type | Notes |
|---|---|---|
| user_id | TEXT PK REFERENCES users(id) | One row per user |
| full_name | TEXT | |
| current_title | TEXT | |
| current_company | TEXT | |
| location | TEXT | |
| phone | TEXT | |
| linkedin_url | TEXT | |
| github_url | TEXT | |
| portfolio_url | TEXT | |
| summary | TEXT | Professional summary |
| total_experience | TEXT | |
| skills | TEXT NOT NULL DEFAULT '[]' | JSON array |
| resume_text | TEXT | Plain-text extracted from uploaded resume |
| resume_filename | TEXT | |
| resume_uploaded_at | TEXT | |
| resume_file_path | TEXT | Absolute path to stored file |
| resume_mime_type | TEXT | |
| job_title_1 / job_title_2 / job_title_3 | TEXT | Target job titles for scraper |
| preferred_city | TEXT | |
| notice_period | TEXT | |
| preferred_location | TEXT | |
| updated_at | TEXT NOT NULL DEFAULT now_expr | |

---

### `oauth_accounts`
| Column | Type | Notes |
|---|---|---|
| user_id | TEXT NOT NULL REFERENCES users(id) | |
| provider | TEXT NOT NULL | 'google' (others planned) |
| email | TEXT NOT NULL | Connected account email |
| refresh_token | TEXT NOT NULL | AES-256-GCM encrypted (tokenCrypto.js) |
| scope | TEXT | Space-delimited OAuth scopes granted |
| created_at | TEXT NOT NULL DEFAULT now_expr | |
| updated_at | TEXT NOT NULL DEFAULT now_expr | |

**PRIMARY KEY (user_id, provider)**

---

### `linkedin_posts` (Apify results)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| raw_json | TEXT NOT NULL DEFAULT '{}' | |
| title | TEXT | |
| description | TEXT | |
| company_name | TEXT | |
| author_name | TEXT | |
| author_headline | TEXT | |
| author_linkedin | TEXT | |
| location | TEXT | |
| job_type | TEXT | |
| tech_stack | TEXT NOT NULL DEFAULT '[]' | JSON |
| post_url | TEXT | |
| posted_at | TEXT | |
| likes | INTEGER NOT NULL DEFAULT 0 | |
| comments | INTEGER NOT NULL DEFAULT 0 | |
| is_hiring | INTEGER NOT NULL DEFAULT 1 | |
| confidence_score | REAL NOT NULL DEFAULT 0 | |
| status | TEXT NOT NULL DEFAULT 'new' | |
| scraped_at | TEXT NOT NULL DEFAULT now_expr | |

---

### `scraped_jobs`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| scraper_type | TEXT NOT NULL | linkedin-jobs, naukri, foundit, internshala, instahyre, jora, general, linkedin-feed |
| job_category | TEXT NOT NULL DEFAULT 'general' | 'general' \| 'remote' \| 'international' |
| title | TEXT | |
| company | TEXT | |
| location | TEXT | |
| job_type | TEXT | Full-time, Part-time, etc. |
| salary | TEXT | |
| experience | TEXT | |
| tags | TEXT | Comma-separated |
| description | TEXT | |
| link | TEXT | Job posting URL |
| apply_link | TEXT | Direct apply URL |
| posted_at | TEXT | |
| scraped_at | TEXT NOT NULL | Format: 'YYYY-MM-DD HH:MM:SS' (one-time migration normalized this) |
| is_remote | INTEGER NOT NULL DEFAULT 0 | |
| contact_email | TEXT | |
| contact_phone | TEXT | |
| google_form_link | TEXT | |
| whatsapp_link | TEXT | |
| all_contacts | TEXT | JSON array of all contact methods |
| created_at | TEXT NOT NULL DEFAULT now_expr | |

**Indexes:** `created_at`, `job_category`, `scraped_at`  
**Retention:** Configurable via `purge_config.retention_days` (default 30 days)

---

### `gmail_tokens`
| Column | Type | Notes |
|---|---|---|
| user_id | TEXT PK REFERENCES users(id) | |
| gmail_email | TEXT NOT NULL | |
| access_token | TEXT | Short-lived, may be null |
| refresh_token | TEXT NOT NULL | Encrypted |
| token_expiry | TEXT | |
| created_at / updated_at | TEXT NOT NULL | |

---

### `gmail_tracked_emails`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| user_id | TEXT NOT NULL REFERENCES users(id) | |
| gmail_message_id | TEXT | |
| gmail_thread_id | TEXT | |
| contact_email | TEXT NOT NULL | |
| contact_name | TEXT NOT NULL DEFAULT '' | |
| subject | TEXT | |
| body_snippet | TEXT | |
| full_body | TEXT | |
| sent_at | TEXT NOT NULL | |
| email_status | TEXT NOT NULL DEFAULT 'sent' | 'sent' \| 'delivered' \| 'opened' \| 'replied' |
| replied_at | TEXT | |
| reply_snippet | TEXT | |
| last_synced_at | TEXT | |
| created_at | TEXT NOT NULL | |

**Indexes:** `(user_id, sent_at)`, `(user_id, email_status)`

---

### `leads` (Early-access / waitlist)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT NOT NULL | |
| email | TEXT NOT NULL | UNIQUE (idx_leads_email_unique) |
| mobile | TEXT | |
| plan_interest | TEXT | |
| experience | TEXT | |
| job_type | TEXT | |
| other_info | TEXT | |
| linkedin_url | TEXT | |
| twitter_handle | TEXT | |
| github_url | TEXT | |
| preferred_contact | TEXT | |
| status | TEXT NOT NULL DEFAULT 'new' | 'new' \| 'contacted' \| 'qualified' \| 'converted' |
| notes | TEXT | Admin notes |
| created_at | TEXT NOT NULL DEFAULT now_expr | |

---

### `notifications`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| user_id | TEXT | NULL = broadcast to all users |
| type | TEXT NOT NULL DEFAULT 'info' | 'info' \| 'success' \| 'warning' \| 'error' |
| title | TEXT NOT NULL | |
| body | TEXT NOT NULL DEFAULT '' | |
| is_read | INTEGER NOT NULL DEFAULT 0 | |
| created_at | TEXT NOT NULL DEFAULT now_expr | |

**Index:** `user_id`

---

### RBAC Tables

**`roles`**
| id | name | description | is_system |
|---|---|---|---|
| role_admin | admin | Full system access | 1 |
| role_user | user | Standard user | 1 |
| role_demo | demo | Limited demo (10 contacts cap) | 1 |
| role_guest | guest | Read-only (5 contacts cap) | 1 |

**`permissions`** — 17 seeded permissions across resources: contacts, email, jobs, profile, admin

**`role_permissions`** — Many-to-many join. System roles are seeded in initialize().

---

### `password_vault`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| user_id | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| title | TEXT NOT NULL | |
| username | TEXT NOT NULL DEFAULT '' | |
| password_enc | TEXT NOT NULL | AES-256-GCM ciphertext |
| iv | TEXT NOT NULL | Initialization vector |
| tag | TEXT NOT NULL | GCM auth tag |
| url | TEXT NOT NULL DEFAULT '' | |
| category | TEXT NOT NULL DEFAULT 'general' | |
| notes | TEXT NOT NULL DEFAULT '' | |
| created_at / updated_at | TEXT NOT NULL | |

**Index:** `user_id`

---

### `referral_requests`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| from_user_id | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| to_user_id | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| subject | TEXT NOT NULL DEFAULT '' | |
| message | TEXT NOT NULL DEFAULT '' | |
| status | TEXT NOT NULL DEFAULT 'pending' | 'pending' \| 'accepted' \| 'rejected' |
| created_at | TEXT NOT NULL DEFAULT now_expr | |

**Indexes:** `from_user_id`, `to_user_id`  
The old UNIQUE(from_user_id, to_user_id) constraint has been dropped — multiple requests allowed (limit configurable).

---

### `resume_versions`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| user_id | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| label | TEXT NOT NULL DEFAULT 'Untitled Version' | |
| resume_text | TEXT NOT NULL DEFAULT '' | |
| target_role | TEXT NOT NULL DEFAULT '' | |
| skills | TEXT NOT NULL DEFAULT '[]' | JSON |
| auto_saved | INTEGER NOT NULL DEFAULT 0 | |
| file_path | TEXT | If backed by an uploaded file |
| mime_type | TEXT | |
| is_ats_template | INTEGER NOT NULL DEFAULT 0 | |
| created_at | TEXT NOT NULL DEFAULT now_expr | |

**Index:** `(user_id, created_at)`

---

## Migration Conventions

- Add columns via `addCol(table, col, definition)` helper in `initialize()`
- `addCol` checks `information_schema.columns` first — no-op if column exists
- Never edit the `CREATE TABLE` blocks — always append new `addCol` calls
- One-time data fixes use a settings key as a migration marker (e.g., `migration_scraped_at_normalized`)
- Initialization uses a dedicated `Client` (not pool) with `statement_timeout = 0` to handle Supabase/hosted Postgres timeouts during DDL
