# HR Outreach Tracker — Frontend User Guide

## Dashboard Layout (Top to Bottom)

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER                                                     │
├─────────────────────────────────────────────────────────────┤
│  STATS BAR   [Total] [Contacted] [Replied] [Interviews]     │
├─────────────────────────────────────────────────────────────┤
│  TOOLBAR     Search | Status Filter | Buttons               │
├─────────────────────────────────────────────────────────────┤
│  BULK BAR    (appears when rows are selected)               │
├─────────────────────────────────────────────────────────────┤
│  CONTACT TABLE                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Stats Bar

Four cards at the top that update live every time you change anything.

| Card | What it shows |
|---|---|
| **Total Contacts** | Everyone in your tracker |
| **Contacted** | Anyone with status Sent / Opened / Replied / Interview — shown as `N (X%)` |
| **Replied** | Replied + Interview contacts — the people who wrote back |
| **Interviews** | Contacts at Interview stage |

> These numbers also refresh after every email send and import automatically.

---

## 2. Toolbar (row of buttons)

### Search bar
- Type any part of a **name, company, email, or job title**
- Results filter live as you type
- Press backspace to clear and show all again

### Status filter dropdown
- Filter the table to show only one status at a time
- Options: All Statuses / New / Drafted / Sent / Opened / Replied / Interview / Rejected / Do Not Contact
- Combine with Search — e.g. search "Google" + filter "New" shows all new Google contacts

### Clear filters link
- Appears only when a filter or search is active
- Resets both search and status filter in one click

### 📧 X/20 today indicator
- Shows how many emails you've sent today vs your daily cap (default 20)
- Updates after every send
- Goes red-ish when you're near the limit

### SMTP Settings button
- Opens the email configuration modal
- Set your Gmail / Outlook credentials here before you can send
- Also where you edit the unsubscribe footer text

### Import CSV / Excel button
- Upload a spreadsheet of contacts
- Accepts `.xlsx`, `.xls`, `.csv`
- Required columns: **name**, **email** (everything else is optional)
- Optional columns it recognises: title, company, status, notes, tags, source_url (or url/link)
- Duplicate emails are silently skipped — safe to re-import the same file
- Shows a result summary: how many imported, skipped, errored

### Download Excel button
- Downloads the current state of your database as a colour-coded Excel file
- Same file as `backend/data/HR_Outreach_Tracker.xlsx`
- Opens in Excel with frozen header row, auto-filter dropdowns on every column, and row colours matching each status

### + Add Contact button
- Opens the Add Contact form (see Section 4)

---

## 3. Contact Table

### Columns

| Column | What it shows |
|---|---|
| **Checkbox** | Select this row for bulk actions |
| **Name** | Contact's full name |
| **Title** | Job title (HR Manager, Recruiter, Talent Acquisition, etc.) |
| **Company** | Where they work |
| **Email** | Clickable — opens your mail client with To: pre-filled |
| **Status** | Inline dropdown — change status right in the table row |
| **Source** | How this contact entered your tracker (manual / csv import / enrichment api / job board) |
| **Confidence** | How sure you are the email is correct (unknown / guessed / verified) |
| **Date Added** | When you first added them |
| **Actions** | Send · Edit · Delete buttons |

### Row colours (match the Excel output exactly)

| Colour | Status | Meaning |
|---|---|---|
| White | New | Added, not yet contacted |
| Light blue | Drafted | Email written but not sent |
| Light yellow | Sent | Email sent, waiting for reply |
| Light lime | Opened | They opened your email |
| Light green | Replied | They wrote back |
| Bright green | Interview | Interview scheduled |
| Light red | Rejected | Closed / not moving forward |
| Dark grey + strikethrough | Do Not Contact | Never email again — system enforces this |

### Inline status change
- Click the Status column dropdown on any row
- Pick a new status → saves immediately → Excel syncs → table row recolours
- No Save button needed

### Column sorting
- Click any column header to sort by that column
- Click again to reverse direction
- ↕ = unsorted, ↑ = ascending, ↓ = descending

### Row actions (rightmost column)

**Send** (green) — Opens the Compose modal for just this one contact. Hidden for Do Not Contact contacts.

**Edit** (blue) — Opens the Edit Contact form with all fields pre-filled. You can change anything including status, tags, notes, source URL.

**Delete** (red) — Asks for confirmation, then permanently removes the contact and updates Excel.

---

## 4. Add / Edit Contact Form

Opens as a modal overlay. Fields:

| Field | Required | Notes |
|---|---|---|
| Full Name | Yes | Displayed in table and used in `{{name}}` template variable |
| Email | Yes | Must be unique — duplicate rejected with clear error |
| Title | No | Used in `{{title}}` template variable |
| Company | No | Used in `{{company}}` variable |
| Status | No | Defaults to New |
| Source | No | How you found this contact (manual, csv import, etc.) |
| Email Confidence | No | unknown / guessed / verified |
| Tags | No | Comma-separated: `priority, fintech, referral` |
| Source URL | No | Link to the job posting or career page where you found them |
| Notes | No | Free text — anything you want to remember about this person |

Click **Add Contact** / **Save Changes** → contact appears in table → Excel updates automatically.

---

## 5. Import CSV / Excel

### How to prepare your file

Minimum CSV:
```
name,email
Priya Sharma,priya@google.com
Bob Kumar,bob@amazon.com
```

Full CSV with all fields:
```
name,email,title,company,status,notes,tags,url
Priya Sharma,priya@google.com,HR Manager,Google,New,Met at conference,priority,https://careers.google.com
```

### Import flow
1. Click **Import CSV / Excel**
2. Drag & drop your file onto the modal, or click to browse
3. The tool auto-detects column names (case-insensitive, partial match)
4. Shows result: `✓ 14 imported · ⚠ 2 skipped · ✗ 0 errors`
5. Click **View Contacts** — table refreshes, Excel auto-updates

### What "skipped" means
- Row has no name or no email → skipped
- Email already exists in your database → silently skipped (no duplicate)

---

## 6. Compose & Send Email

### Single send (one contact)
1. Click green **Send** on any table row
2. Compose modal opens with the template editor

### Bulk send (multiple contacts)
1. Tick the checkbox on each row you want to email
2. Click **✉ Compose for N** in the bulk actions bar

### Inside the Compose modal

**Step 1 — Compose**

| Element | What it does |
|---|---|
| Variable chips `{{name}}` `{{company}}` `{{title}}` `{{email}}` | Click any chip to insert it at your cursor position in subject or body |
| Subject field | Click inside it first, then click a chip to insert there |
| Body textarea | Default text pre-filled — edit freely |
| Yellow notice at bottom | Reminds you that the unsubscribe line is auto-appended |

**Step 2 — Preview** (mandatory, cannot skip)

After clicking **Preview →**, every email is rendered with the actual contact data replacing the `{{variables}}`. You see:

- Contact name and email address
- Rendered subject line
- Rendered body text
- The opt-out footer that will be appended
- ✓ Will send (green badge) or ⚠ Skipped with reason (yellow badge)

**Skipped reasons:**
- Contact is marked **Do Not Contact** → never emailed regardless
- Contact was **already emailed in the last 14 days** → duplicate-send guard
- **Daily cap reached** → you've hit your 20/day limit (configurable in SMTP Settings)

**Step 3 — Confirm & Send**

Click **Confirm & Send N Emails**:
- Emails go out with a 2-second gap between each (rate limiting)
- Contact statuses update to **Sent** (if they were New or Drafted)
- `date_last_contacted` is recorded
- Email is logged in the database
- Excel syncs after all sends complete
- Bounce handling: if an email hard-bounces (SMTP 5xx), that contact is auto-marked **Do Not Contact**

---

## 7. Bulk Actions Bar

Appears at the top of the table when you have one or more rows checked.

```
3 selected  | Change status to… ▼ | ✉ Compose for 3 | Delete Selected | Clear selection
```

| Action | What it does |
|---|---|
| **Change status to…** | Updates all selected contacts to the chosen status in one click — Excel syncs once |
| **✉ Compose for N** | Opens Compose modal addressed to all selected contacts |
| **Delete Selected** | Asks confirmation, deletes all selected, Excel syncs |
| **Clear selection** | Unchecks all rows without doing anything |

---

## 8. SMTP Settings Modal

Opened via the **SMTP Settings** button in the toolbar.

| Field | What to enter |
|---|---|
| Provider preset | Click Gmail, Outlook, or Custom — auto-fills host and port |
| SMTP Host | Mail server (e.g. `smtp.gmail.com`) |
| Port | `587` for STARTTLS (recommended), `465` for SSL |
| Username / From Email | Your email address |
| Password | Gmail App Password (16 chars, no spaces) |
| Your Name | How your name appears in recipients' inbox |
| Opt-out line | Text appended to every email — edit to personalise |

**Test Connection** — tries to connect to the SMTP server with your credentials. No email is sent. Shows ✓ or the exact error message.

**Save Settings** — stores everything in the local database. Credentials never leave your machine.

---

## 9. Status Workflow (recommended flow)

```
New
 └─► Drafted      (you've written the email but haven't sent yet)
      └─► Sent    (email sent — system sets this automatically on send)
           └─► Opened    (they opened it)
                └─► Replied      (they replied — set this manually)
                     └─► Interview   (call/interview scheduled)
                          └─► Rejected  (didn't move forward)

At any point: → Do Not Contact  (never contact again — system enforces)
```

Change status by:
- Inline dropdown in the table row (fastest)
- Edit Contact form
- Bulk status change for multiple contacts at once
- Automatically by the system after a successful email send

---

## 10. Excel File — What It Contains

Located at `backend/data/HR_Outreach_Tracker.xlsx`

- Updates automatically on every add / edit / delete / import / send
- Columns: Name, Title, Company, Email, Status, Source, Confidence, Tags, Notes, Source URL, Date Added, Last Contacted
- Row background colour matches status (same as UI)
- Do Not Contact rows are dark grey with strikethrough text
- Row 1 is frozen (stays visible when you scroll down)
- Auto-filter dropdowns on every column so you can filter in Excel too
- Safe to open in Excel while the app is running — the app overwrites it on next change

---

## Quick Reference Card

| I want to… | Do this |
|---|---|
| Add one contact | + Add Contact button |
| Add many contacts | Import CSV / Excel |
| Email one person | Green Send on their row |
| Email many people | Checkbox rows → ✉ Compose for N |
| Change someone's status | Click status dropdown in their row |
| Change many statuses at once | Checkbox rows → Change status to… |
| Find a contact | Search bar (name / company / email / title) |
| See only replied contacts | Status filter → Replied |
| Get a coloured Excel file | Download Excel button |
| Configure Gmail | SMTP Settings → Gmail → App Password → Test → Save |
| See today's send count | 📧 X/20 today in toolbar |
| Prevent accidental email | Mark contact Do Not Contact — system blocks all sends |

---

## Starting the App

Run `start.bat` from the project root. It opens two terminal windows:
- **Backend** → `http://localhost:3001` (Express + SQLite)
- **Frontend** → `http://localhost:5173` (React + Vite)

Open your browser to `http://localhost:5173` to use the dashboard.

To stop: close both terminal windows.
