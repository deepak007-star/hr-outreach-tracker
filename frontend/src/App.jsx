import { useState, useEffect, useCallback, useRef, Component } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import {
  Home, Users, FileText, Target, ListChecks,
  FolderOpen, UserPlus, User, ShieldCheck, Crown, Lock,
  MailCheck, Briefcase, Mail, BarChart3, Bell, Zap, Sparkles,
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { Spinner, MultiSelectDropdown, LoadMoreSentinel } from './components/ui/index.js';
import Header            from './components/Header.jsx';
import StatsBar          from './components/StatsBar.jsx';
import ContactTable      from './components/ContactTable.jsx';
import ContactForm       from './components/ContactForm.jsx';
import ImportModal       from './components/ImportModal.jsx';
import ComposeModal      from './components/ComposeModal.jsx';
import SmtpSettingsModal from './components/SmtpSettingsModal.jsx';
import ActivityCalendar  from './components/ActivityCalendar.jsx';
import ReminderModal     from './components/ReminderModal.jsx';
import JobAnalyzer       from './components/JobAnalyzer.jsx';
import ProfilePage       from './components/ProfilePage.jsx';
import AuthModal         from './components/AuthModal.jsx';
import PlansModal        from './components/PlansModal.jsx';
import EarlyAccessBanner from './components/EarlyAccessBanner.jsx';
import BulkJobAnalyzer   from './components/BulkJobAnalyzer.jsx';
import RateLimitBar      from './components/RateLimitBar.jsx';
import Dashboard        from './components/Dashboard.jsx';
import TemplatesPage    from './components/TemplatesPage.jsx';
import AdminPanel       from './components/AdminPanel.jsx';
import GmailConnectCard  from './components/GmailConnectCard.jsx';
import GmailEmailList    from './components/GmailEmailList.jsx';
import FeedContactsPanel from './components/FeedContactsPanel.jsx';
import LinkedInPosts     from './components/LinkedInPosts.jsx';
import JobScraperSection from './components/JobScraperSection.jsx';
import ApplyQueue        from './components/ApplyQueue.jsx';
import UnsavedChangesModal from './components/UnsavedChangesModal.jsx';
import AskReferral        from './components/AskReferral.jsx';
import ResumeVault        from './components/ResumeVault.jsx';
import LandingPage        from './components/LandingPage.jsx';
import Chatbot            from './components/Chatbot.jsx';
import JobIntelPanel      from './components/JobIntelPanel.jsx';
import ContentReviewPanel  from './components/ContentReviewPanel.jsx';
import ContentHistoryPanel from './components/ContentHistoryPanel.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import { confirm }   from './utils/confirm.js';
import { clearDraft } from './hooks/useDraft.js';
import { api, API_ROOT } from './api/client.js';

class TabErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(err) { return { error: err }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
          <span className="text-4xl">⚠️</span>
          <p className="text-gray-700 font-medium">Something went wrong loading this section.</p>
          <p className="text-sm text-gray-400">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 text-sm bg-brand-600 text-white rounded-sm hover:bg-brand-700 transition"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Renders children once the tab has been visited, then keeps them mounted (hidden
// via display:none) so component state survives switching to another tab and back.
function KeepAlive({ active, name, visitedRef, children }) {
  if (active) visitedRef.current[name] = true;
  if (!visitedRef.current[name]) return null;
  return <div style={{ display: active ? 'block' : 'none' }}>{children}</div>;
}

const PLAN_LIMITS = { guest: 5, demo: 10, basic: 100, advanced: 999999 };
const PLAN_NAMES  = { guest: 'Guest', demo: 'Demo', basic: 'Basic', advanced: 'Advanced' };

const TAB_PATHS = {
  home:           '/',
  contacts:       '/contacts',
  jobs:           '/jobs',
  'job-intel':    '/job-intel',
  'content-ai':   '/content-ai',
  templates:      '/templates',
  'resume-tools': '/resume-tools',
  profile:        '/profile',
  referrals:      '/referrals',
  admin:          '/admin',
};

// Pre-restructuring URLs (bulk-apply/resume-vault used to be separate
// top-level tabs — see the Phase 3 nav consolidation) still resolve to the
// right place, just inside the umbrella tab that now owns them, with the
// matching sub-tab pre-selected, so a bookmarked/shared link never breaks.
// (/jobs, /job-intel, /templates were also aliases at one point, but are now
// real top-level paths in TAB_PATHS above, so they no longer need an entry here.)
const LEGACY_TAB_ALIASES = {
  '/analyzer':   { tab: 'resume-tools',  subTab: 'analyzer' },        // old 'jobs' tab (Resume Analyzer)
  '/bulk-apply': { tab: 'resume-tools',  subTab: 'bulk-apply' },
  '/vault':      { tab: 'resume-tools',  subTab: 'vault' },
};

function getTabFromPath(pathname) {
  const reverse = Object.fromEntries(Object.entries(TAB_PATHS).map(([t, p]) => [p, t]));
  if (reverse[pathname]) return { tab: reverse[pathname], subTab: null };
  if (LEGACY_TAB_ALIASES[pathname]) return LEGACY_TAB_ALIASES[pathname];
  return { tab: 'home', subTab: null };
}

const STATUSES = ['New','Drafted','Sent','Opened','Replied','Interview','Rejected','Do Not Contact'];
// "Contacted"/"not contacted" segment matching now happens server-side (see
// buildContactFilters + /contacts/summary in backend/src/routes/contacts.js) —
// kept in sync with the same status set there.

export default function App() {
  const [contacts,       setContacts]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [searchInput,    setSearchInput]    = useState('');  // raw input (instant)
  const [search,         setSearch]         = useState('');  // debounced (sent to API)
  const [statusFilter,   setStatusFilter]   = useState('');
  const [sourceFilter,   setSourceFilter]   = useState('');
  const [tagFilters,     setTagFilters]     = useState([]); // multi-select, AND-matched
  const [availableTags,  setAvailableTags]  = useState([]);
  const [bulkTagInput,   setBulkTagInput]   = useState('');
  const [titleFilter,    setTitleFilter]    = useState('');
  const [segment,        setSegment]        = useState('all'); // all | not_contacted | contacted | flagged
  const [selected,       setSelected]       = useState([]);
  // Pagination: contacts pool can run into the thousands once Job Intel has
  // been syncing a while — load a page at a time instead of the whole pool,
  // append more as the user scrolls. Page size is a per-browser preference.
  const [contactsPage,    setContactsPage]    = useState(1);
  const [contactsHasMore, setContactsHasMore] = useState(false);
  const [loadingMore,     setLoadingMore]     = useState(false);
  const [pageSize,        setPageSize]        = useState(() => parseInt(localStorage.getItem('hr_contacts_page_size'), 10) || 20);
  // True counts across ALL matching contacts (not just the loaded page) — feeds
  // StatsBar + the segment-tab counts, which must stay correct regardless of
  // how many pages have been loaded into `contacts` so far.
  const [contactsSummary, setContactsSummary] = useState({ total: 0, contacted: 0, not_contacted: 0, emailed: 0, replied: 0, interviews: 0, flagged: 0 });
  const [selectingAll,    setSelectingAll]    = useState(false);

  // Count for whichever segment tab is active — avoids repeating the same
  // 4-way ternary at every call site that needs "how many contacts are in
  // the CURRENT view."
  const segmentCount = useCallback((seg) => {
    if (seg === 'contacted')     return contactsSummary.contacted;
    if (seg === 'not_contacted') return contactsSummary.not_contacted;
    if (seg === 'flagged')       return contactsSummary.flagged;
    return contactsSummary.total;
  }, [contactsSummary]);
  const [editingContact,   setEditingContact]   = useState(null);
  const [showForm,         setShowForm]         = useState(false);
  const [showImport,       setShowImport]       = useState(false);
  const [showCompose,      setShowCompose]      = useState(false);
  const [composeContacts,  setComposeContacts]  = useState([]);
  const [showSmtp,         setShowSmtp]         = useState(false);
  const [showReminder,     setShowReminder]     = useState(false);
  const [emailStats,       setEmailStats]       = useState(null);
  const [activityKey,      setActivityKey]      = useState(0);
  const [activeTab,        setActiveTab]        = useState(() => getTabFromPath(window.location.pathname).tab);
  const [showAuthModal,    setShowAuthModal]    = useState(false);
  const [showPlans,        setShowPlans]        = useState(false);
  // Contacts & Outreach sub-tabs: 'my' | 'gmail-sync' | 'linkedin-contacts'
  const [contactSubTab,    setContactSubTab]    = useState(() => {
    const nav = getTabFromPath(window.location.pathname);
    return nav.tab === 'contacts' && nav.subTab ? nav.subTab : 'my';
  });
  // Jobs sub-tabs: 'browse' | 'apply-queue'
  const [jobsSubTab, setJobsSubTab] = useState('browse');
  // Job Intel sub-tabs: 'intel-contacts' | 'linkedin-hiring-posts'
  // (Job Postings used to be a third sub-tab here too, alongside Templates
  // living under Resume Tools — both pulled out to their own top-level tabs
  // per user feedback: too much nesting to find a single-component page.)
  const [jobIntelSubTab, setJobIntelSubTab] = useState(() => {
    const nav = getTabFromPath(window.location.pathname);
    return nav.tab === 'job-intel' && nav.subTab ? nav.subTab : 'intel-contacts';
  });
  // Content AI sub-tabs: 'review' | 'history'
  const [contentAiSubTab, setContentAiSubTab] = useState(() => {
    const nav = getTabFromPath(window.location.pathname);
    return nav.tab === 'content-ai' && nav.subTab ? nav.subTab : 'review';
  });
  // Resume Tools sub-tabs: 'analyzer' | 'bulk-apply' | 'vault'
  const [resumeToolsSubTab, setResumeToolsSubTab] = useState(() => {
    const nav = getTabFromPath(window.location.pathname);
    return nav.tab === 'resume-tools' && nav.subTab ? nav.subTab : 'analyzer';
  });
  // Gmail Sync sub-tab state (lifted out of the retired ColdEmailSection.jsx)
  const [gmailStatus,  setGmailStatus]  = useState(null);
  const [gmailRefresh, setGmailRefresh] = useState(0);
  const { user, loading: authLoading } = useAuth();

  // Unsaved-changes guard: ProfilePage reports dirty state here
  const profileDirtyRef   = useRef(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const pendingTabRef      = useRef(null);

  // Keep-alive: which analyzer tabs have been opened at least once. They stay
  // mounted (hidden) afterwards so switching tabs doesn't wipe unsaved work.
  const analyzerVisitedRef = useRef({});

  // Low-level navigate: updates state + pushes URL
  const goTo = useCallback((tabId) => {
    setActiveTab(tabId);
    window.history.pushState({ tabId }, '', TAB_PATHS[tabId] || '/');
  }, []);

  // Intercept tab navigation — show modal if ProfilePage has unsaved changes
  const navigateTo = useCallback((tabId, requiresAuth) => {
    if (requiresAuth && !user) { setShowAuthModal(true); return; }
    if (profileDirtyRef.current && activeTab === 'profile' && tabId !== 'profile') {
      pendingTabRef.current = tabId;
      setShowUnsavedModal(true);
      return;
    }
    goTo(tabId);
  }, [activeTab, user, goTo]);

  const visibleLimit = PLAN_LIMITS[user?.plan] ?? PLAN_LIMITS.guest;
  const planName     = PLAN_NAMES[user?.plan]  ?? PLAN_NAMES.guest;

  // Debounce search input — waits 400ms after the user stops typing before
  // firing an API call, preventing a request burst on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // silent=true → background auto-refresh (no loading spinner / no error toast)
  // Retries a transient (no-response-status) failure before surfacing an
  // error — a free-tier host waking from a cold-start sleep can take longer
  // than the request timeout, which otherwise showed a scary "could not
  // reach backend" toast on the very first load that then silently fixed
  // itself on the next background poll a few seconds later. Only applies to
  // the non-silent path (the user actually waiting on this); silent
  // background refreshes already tolerate a failed attempt with no toast.
  // page/append let this same function drive three cases:
  //  - fresh filtered fetch (page 1, replaces `contacts`, limit = pageSize —
  //    a filter change should snap back to the top of a short first page)
  //  - "load the next page" (append=true, limit = pageSize)
  //  - a silent background refresh — re-fetches the SAME amount currently on
  //    screen (contactsLenRef, tracked below) rather than always re-requesting
  //    just page 1's worth, which would otherwise truncate the list back down
  //    every 30s poll/focus after the user had scrolled and loaded more pages.
  const contactsLenRef = useRef(0);
  useEffect(() => { contactsLenRef.current = contacts.length; }, [contacts]);

  const fetchContacts = useCallback(async ({ silent = false, _attempt = 0, page = 1, append = false } = {}) => {
    if (!user) { setLoading(false); return; } // guests land on LandingPage, not the contacts table
    if (append) setLoadingMore(true);
    else if (!silent) setLoading(true);
    try {
      const effectiveLimit = (silent && !append) ? Math.max(pageSize, contactsLenRef.current) : pageSize;
      const params = { page, limit: effectiveLimit };
      if (search)        params.search  = search;
      if (statusFilter)  params.status  = statusFilter;
      if (sourceFilter)  params.source  = sourceFilter;
      if (tagFilters.length) params.tags = tagFilters.join(',');
      if (segment !== 'all') params.segment = segment;
      if (titleFilter)   params.title   = titleFilter;
      const data  = await api.get('/contacts', { params });
      const rows  = data.contacts || [];
      const total = data.total ?? 0;
      // Express "how much is now loaded" in pageSize-sized chunks so a
      // subsequent loadMoreContacts() (which always requests in pageSize
      // increments) asks for the right offset, even after a silent refresh
      // fetched a larger effectiveLimit in one shot.
      const newLen = append ? contactsLenRef.current + rows.length : rows.length;
      setContacts(prev => (append ? [...prev, ...rows] : rows));
      setContactsPage(Math.max(1, Math.ceil(newLen / pageSize)));
      setContactsHasMore(newLen < total);
      if (append) setLoadingMore(false);
      else if (!silent) setLoading(false);
    } catch (err) {
      const isNetworkError = err?.response?.status == null;
      if (!append && !silent && isNetworkError && _attempt < 2) {
        setTimeout(() => fetchContacts({ silent: false, _attempt: _attempt + 1, page }), 3000 * (_attempt + 1));
        return;
      }
      if (append) { setLoadingMore(false); toast.error('Could not load more contacts'); }
      else if (!silent) {
        toast.error('Could not reach backend — is it running on port 3001?');
        setLoading(false);
      }
    }
  }, [search, statusFilter, sourceFilter, tagFilters, segment, titleFilter, pageSize, user]);

  const loadMoreContacts = useCallback(() => {
    if (loadingMore || !contactsHasMore) return;
    fetchContacts({ page: contactsPage + 1, append: true });
  }, [fetchContacts, loadingMore, contactsHasMore, contactsPage]);

  // Independent of pagination — always reflects the true total/contacted/
  // replied/interview counts across every contact matching the current
  // filters, not just whatever page(s) happen to be loaded client-side.
  const fetchContactsSummary = useCallback(() => {
    if (!user) return;
    const params = {};
    if (search)       params.search = search;
    if (statusFilter) params.status = statusFilter;
    if (sourceFilter) params.source = sourceFilter;
    if (tagFilters.length) params.tags = tagFilters.join(',');
    if (titleFilter)  params.title  = titleFilter;
    api.get('/contacts/summary', { params }).then(setContactsSummary).catch(() => {});
  }, [search, statusFilter, sourceFilter, tagFilters, titleFilter, user]);

  const changePageSize = useCallback((n) => {
    localStorage.setItem('hr_contacts_page_size', String(n));
    setPageSize(n);
  }, []);

  // Explicit "select every contact matching the current filters" — deliberately
  // bypasses pagination (backend `all=true`, capped at 5000) since this is a
  // one-off user-initiated action, not the default page load. Also merges the
  // fetched rows into `contacts` so Compose has full details for every
  // selected id, even ones from pages never scrolled into.
  const selectAllMatching = useCallback(async (segmentOverride, { merge = false } = {}) => {
    if (!user) return;
    setSelectingAll(true);
    try {
      const params = { all: 'true' };
      if (search)        params.search  = search;
      if (statusFilter)  params.status  = statusFilter;
      if (sourceFilter)  params.source  = sourceFilter;
      if (tagFilters.length) params.tags = tagFilters.join(',');
      if (titleFilter)   params.title   = titleFilter;
      const seg = segmentOverride ?? segment;
      if (seg !== 'all') params.segment = seg;
      const data = await api.get('/contacts', { params });
      const rows = data.contacts || [];
      setContacts(prev => {
        const byId = new Map(prev.map(c => [c.id, c]));
        for (const r of rows) byId.set(r.id, r);
        return [...byId.values()];
      });
      const ids = rows.map(c => c.id);
      setSelected(prev => merge ? [...new Set([...prev, ...ids])] : ids);
    } catch {
      toast.error('Could not select all matching contacts');
    } finally {
      setSelectingAll(false);
    }
  }, [search, statusFilter, sourceFilter, tagFilters, titleFilter, segment, user]);

  // Job Intel health badge in the nav — antibot_status is otherwise only
  // visible inside the Job Intel tab itself, so a degraded scrape run is
  // invisible until the user happens to open it.
  const [jobIntelStatus, setJobIntelStatus] = useState('ok');
  useEffect(() => {
    if (!user) return;
    const check = () => api.get('/job-intel/status-badge').then(r => setJobIntelStatus(r.status || 'ok')).catch(() => {});
    check();
    const t = setInterval(check, 5 * 60_000);
    return () => clearInterval(t);
  }, [user]);

  const fetchAvailableTags = useCallback(() => {
    if (!user) return;
    api.get('/contacts/tags').then(r => setAvailableTags(Array.isArray(r) ? r : [])).catch(() => {});
  }, [user]);

  const fetchEmailStats = useCallback(() => {
    if (!user) return;
    api.get('/email/stats')
      // keep the same object reference when nothing changed, so dependent effects
      // (e.g. the reminder timer) don't reset on every background refresh
      .then(data => setEmailStats(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data))
      .catch(() => {});
  }, [user]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);
  useEffect(() => { fetchAvailableTags(); }, [fetchAvailableTags]);
  useEffect(() => { fetchContactsSummary(); }, [fetchContactsSummary]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('oauth');
    const error     = params.get('oauth_error');
    if (connected === 'connected') toast.success('Google account connected!');
    if (error) toast.error(`Google connection failed: ${error}`);
    if (connected || error) {
      params.delete('oauth');
      params.delete('oauth_error');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    }

    // Razorpay uses an inline modal — no redirect callbacks needed
  }, []);

  useEffect(() => { fetchEmailStats(); }, [activityKey, fetchEmailStats]);

  // ── Live auto-refresh ──────────────────────────────────────────────────────
  // Keep the dashboard, counts and contact list current without a manual reload:
  // poll periodically, and refresh whenever the user returns to the tab/window
  // or switches to the Dashboard/Contacts view. Uses silent refreshes so there's
  // no spinner flicker.
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      fetchContacts({ silent: true });
      fetchContactsSummary();
      fetchEmailStats();
    };
    const interval = setInterval(refresh, 30_000);
    const onFocus   = () => refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, fetchContacts, fetchContactsSummary, fetchEmailStats]);

  // Refresh immediately when returning to the Dashboard or Contacts view —
  // deliberately keyed ONLY on activeTab/user, not fetchContacts/fetchEmailStats.
  // Those two are recreated on every filter/search edit (see their useCallback
  // deps above), and including them here meant every filter change while
  // already on Contacts fired a second, silent fetch on top of the one the
  // filter-driven effect above already does — this only fires on an actual
  // tab *arrival*, not on every filter tweak while already there.
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    const arrived = prevTabRef.current !== activeTab;
    prevTabRef.current = activeTab;
    if (!user || !arrived) return;
    if (activeTab === 'home' || activeTab === 'contacts') {
      fetchContacts({ silent: true });
      fetchContactsSummary();
      fetchEmailStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, user]);

  // Session-expired event: show toast so user knows why they got logged out
  useEffect(() => {
    const onExpired = () => {
      toast.error('Your session has expired. Please sign in again.', { id: 'session-expired', duration: 5000 });
      setShowAuthModal(true);
    };
    window.addEventListener('hr-session-expired', onExpired);
    return () => window.removeEventListener('hr-session-expired', onExpired);
  }, []);

  // Sync active tab on browser back/forward
  useEffect(() => {
    const onPop = (e) => {
      const nav = e.state?.tabId ? { tab: e.state.tabId, subTab: null } : getTabFromPath(window.location.pathname);
      setActiveTab(nav.tab || 'home');
      if (nav.subTab) {
        if (nav.tab === 'contacts')       setContactSubTab(nav.subTab);
        else if (nav.tab === 'job-intel')     setJobIntelSubTab(nav.subTab);
        else if (nav.tab === 'content-ai')    setContentAiSubTab(nav.subTab);
        else if (nav.tab === 'resume-tools')  setResumeToolsSubTab(nav.subTab);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Listen for login requests dispatched from child components (e.g. JobAnalyzer)
  useEffect(() => {
    const open = () => setShowAuthModal(true);
    window.addEventListener('hr-open-login', open);
    return () => window.removeEventListener('hr-open-login', open);
  }, []);

  // Daily reminder check — fires every 60 s while app is open
  useEffect(() => {
    const LS_KEY  = 'hr_outreach_reminder';
    const DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    function check() {
      try {
        const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        if (!s.enabled || !s.time) return;

        const now      = new Date();
        const [h, m]   = s.time.split(':').map(Number);
        if (now.getHours() !== h || now.getMinutes() !== m) return;

        // Day filter
        const todayDay = DAYS[now.getDay()];
        if (s.days?.length && !s.days.includes(todayDay)) return;

        const todayStr = now.toISOString().split('T')[0];
        if (s.lastNotified === todayStr) return;

        const msg = s.message || `Time for daily outreach! ${emailStats?.sentToday || 0}/${emailStats?.dailyCap || 20} emails sent today.`;

        // In-app toast (default on, or explicitly enabled)
        if (s.deliveryToast !== false) {
          toast('⏰ ' + msg, {
            duration: 10000,
            style: { border: '2px solid #2563eb', background: '#eff6ff', color: '#1e40af', fontWeight: 600 },
          });
        }

        // Browser / OS notification
        if (s.deliveryBrowser !== false && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification('HR Outreach Tracker 🎯', { body: msg, icon: '/vite.svg' }); } catch {}
        }

        localStorage.setItem(LS_KEY, JSON.stringify({ ...s, lastNotified: todayStr }));
      } catch {}
    }
    check();
    const id = setInterval(check, 60000);
    return () => clearInterval(id);
  }, [emailStats]);

  // ── CRUD handlers ──────────────────────────────────────────────────────
  const handleCreate = async (data) => {
    // Soft-duplicate check: same name+company (case-insensitive) under a
    // different email — e.g. a typo'd address or personal-vs-work address for
    // the same recruiter. Non-blocking; the user can still proceed.
    const nameLc    = data.name?.trim().toLowerCase();
    const companyLc = data.company?.trim().toLowerCase();
    const dup = companyLc && contacts.find(c =>
      c.name?.trim().toLowerCase() === nameLc && c.company?.trim().toLowerCase() === companyLc
    );
    if (dup) {
      const proceed = await confirm(
        `A contact named "${dup.name}" at "${dup.company}" already exists (${dup.email}). Add this one anyway?`
      );
      if (!proceed) return;
    }
    try {
      await api.post('/contacts', data);
      toast.success('Contact added — Excel updated');
      setShowForm(false);
      setActivityKey(k => k + 1);
      fetchContacts();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add contact');
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      await api.put(`/contacts/${id}`, data);
      toast.success('Updated — Excel synced');
      setShowForm(false);
      setEditingContact(null);
      fetchContacts();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update');
    }
  };

  const handleDelete = async (id) => {
    if (!await confirm('Delete this contact? This cannot be undone.')) return;
    try {
      await api.delete(`/contacts/${id}`);
      toast.success('Deleted — Excel updated');
      setSelected(s => s.filter(x => x !== id));
      fetchContacts();
    } catch {
      toast.error('Delete failed');
    }
  };

  const handleBulkDelete = async () => {
    if (!await confirm(`Permanently delete ${selected.length} contacts?`)) return;
    try {
      await api.post('/contacts/bulk-delete', { ids: selected });
      toast.success(`${selected.length} deleted — Excel updated`);
      setSelected([]);
      fetchContacts();
    } catch {
      toast.error('Bulk delete failed');
    }
  };

  const handleBulkStatus = async (status) => {
    try {
      await api.post('/contacts/bulk-status', { ids: selected, status });
      toast.success(`${selected.length} contacts → ${status}`);
      setSelected([]);
      fetchContacts();
    } catch {
      toast.error('Status update failed');
    }
  };

  const handleBulkTags = async (mode) => {
    const tags = bulkTagInput.split(',').map(t => t.trim()).filter(Boolean);
    if (!tags.length) return;
    try {
      await api.post('/contacts/bulk-tags', { ids: selected, tags, mode });
      toast.success(`Tags ${mode === 'add' ? 'added to' : 'removed from'} ${selected.length} contacts`);
      setBulkTagInput('');
      fetchContacts();
      fetchAvailableTags();
    } catch {
      toast.error('Tag update failed');
    }
  };

  const handleStatusChange = (id, status) => handleUpdate(id, { status });
  const handleSetFollowUp  = async (id, dateStr) => {
    try {
      await api.put(`/contacts/${id}`, { follow_up_at: dateStr ? `${dateStr} 09:00:00` : null });
      toast.success(dateStr ? `Follow-up set for ${dateStr}` : 'Follow-up cleared');
      fetchContacts();
    } catch {
      toast.error('Could not set follow-up');
    }
  };

  const handleExport = (format = 'xlsx') => {
    if (!user) { setShowAuthModal(true); toast.error('Sign in to download the Excel file'); return; }
    const params = new URLSearchParams();
    if (search)            params.set('search', search);
    if (statusFilter)      params.set('status', statusFilter);
    if (sourceFilter)      params.set('source', sourceFilter);
    if (tagFilters.length) params.set('tags', tagFilters.join(','));
    if (format === 'csv')  params.set('format', 'csv');
    window.open(`${API_ROOT}/api/contacts/export?${params.toString()}`, '_blank');
    toast(`${format === 'csv' ? 'CSV' : 'Excel'} download started`);
  };

  const openAdd  = () => { setEditingContact(null); setShowForm(true); };
  const openEdit = (c) => { setEditingContact(c);   setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingContact(null); };

  const openCompose = (contactArr) => {
    if (!contactArr.length) return;
    setComposeContacts(contactArr);
    setShowCompose(true);
  };
  const requireAuth = (action) => {
    if (!user) { setShowAuthModal(true); toast.error('Sign in to send emails'); return; }
    action();
  };

  const handleSendEmail   = (c) => requireAuth(() => openCompose([c]));
  const handleBulkCompose = ()  => requireAuth(() => openCompose(contacts.filter(c => selected.includes(c.id))));
  const handleSent = () => { setShowCompose(false); setSelected([]); setActivityKey(k => k + 1); fetchContacts(); };

  // Block rendering until we know the auth state (prevents "Sign In" flash for logged-in users)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Spinner size="md" />
          <p className="text-sm text-gray-500">Milaan dhoond rahe hain…</p>
        </div>
      </div>
    );
  }

  // Guests get the marketing landing page instead of the dashboard shell —
  // every feature here requires an account anyway (contacts, email sending,
  // job analyzer results are all gated), so there's nothing useful to show
  // pre-login besides "sign in".
  if (!user) {
    return (
      <>
        <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
        <Chatbot onLoginRequest={() => setShowAuthModal(true)} />
        <LandingPage
          onGetStarted={() => setShowAuthModal(true)}
          onSignIn={() => setShowAuthModal(true)}
          onPlansClick={() => setShowPlans(true)}
        />
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
        {showPlans && (
          <PlansModal
            onClose={() => setShowPlans(false)}
            onSignupClick={() => { setShowPlans(false); setShowAuthModal(true); }}
          />
        )}
      </>
    );
  }

  // ── Navigation definition ──────────────────────────────────────────────────
  // Creative labels (Section 2.6) + always-visible subtitles.
  // Sidebar label must match page <h1> exactly — enforced by using NAV_ITEMS as source of truth.
  const NAV_ITEMS = [
    { id: 'home',          icon: <Home         size={16} />, label: 'Dashboard',           sub: 'Your outreach at a glance' },
    { id: 'contacts',      icon: <Users        size={16} />, label: 'Contacts & Outreach', sub: 'HR list, Gmail sync & LinkedIn contacts' },
    { id: 'jobs',          icon: <Briefcase    size={16} />, label: 'Jobs',                sub: 'Scraped board postings — LinkedIn, Naukri, Internshala & more' },
    { id: 'job-intel',     icon: <Zap          size={16} />, label: 'Job Intel',           sub: 'ATS & job-board contacts + LinkedIn hiring posts' },
    { id: 'content-ai',    icon: <Sparkles     size={16} />, label: 'Content AI',          sub: 'AI-drafted LinkedIn posts — reviewed by you, published by you', requiresAuth: true },
    { id: 'templates',     icon: <FileText     size={16} />, label: 'Templates',           sub: 'Email & resume templates' },
    { id: 'resume-tools',  icon: <Target       size={16} />, label: 'Resume Tools',        sub: 'ATS analyzer, bulk apply & resume vault' },
    { id: 'referrals',     icon: <UserPlus     size={16} />, label: 'Sifarish',            sub: 'Get referred at top companies', requiresAuth: true },
    { id: 'profile',       icon: <User         size={16} />, label: 'Profile',             sub: 'Your skills & resume data',  requiresAuth: true },
    ...(user?.role === 'admin' ? [{ id: 'admin', icon: <ShieldCheck size={16} />, label: 'Admin', sub: 'User & system management', requiresAuth: true }] : []),
  ];

  return (
    <div className="min-h-screen bg-stone-50">
      <ConfirmDialog />
      <Chatbot onLoginRequest={() => setShowAuthModal(true)} />
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <EarlyAccessBanner />
      <Header
        onLoginClick={() => setShowAuthModal(true)}
        onPlansClick={() => setShowPlans(true)}
        planName={planName}
      />

      {/* ── Tab navigation ──────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 sticky top-[57px] z-30 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 flex items-stretch">
          {/* Scrollable nav tabs */}
          <div className="flex overflow-x-auto flex-1" style={{ scrollbarWidth: 'none' }}>
            {NAV_ITEMS.map(tab => {
              const locked = tab.requiresAuth && !user;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => navigateTo(tab.id, tab.requiresAuth)}
                  title={tab.sub}
                  className={`group flex items-center gap-2 px-4 py-3.5 border-b-2 text-sm font-medium transition-all duration-150 whitespace-nowrap ${
                    isActive
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  } ${locked ? 'opacity-40' : ''}`}
                >
                  <span className={`relative ${isActive ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-500'}`}>
                    {locked ? <Lock size={14} /> : tab.icon}
                    {tab.id === 'job-intel' && jobIntelStatus !== 'ok' && (
                      <span
                        title={jobIntelStatus === 'proxy_pool_dead' ? 'Job Intel: proxy pool dead' : 'Job Intel: low yield'}
                        className={`absolute -top-1 -right-1.5 w-2 h-2 rounded-full ${
                          jobIntelStatus === 'proxy_pool_dead' ? 'bg-red-500' : 'bg-amber-500'
                        }`}
                      />
                    )}
                  </span>
                  {tab.label}
                </button>
              );
            })}
          </div>
          {/* Plans — always visible, pinned to the right */}
          <button
            onClick={() => setShowPlans(true)}
            title="View plans & upgrade"
            className="flex items-center gap-1.5 px-4 border-b-2 border-transparent text-sm font-semibold text-violet-600 hover:text-violet-800 hover:border-violet-400 hover:bg-violet-50 transition-all duration-150 whitespace-nowrap shrink-0 border-l border-gray-100"
          >
            <Crown size={14} className="text-violet-500" />
            {planName === 'Advanced' ? 'Plans' : 'Upgrade'}
          </button>
        </div>
      </div>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-8 space-y-6 animate-fade-slide-in">

        {/* ── Dashboard tab ─────────────────────────────────────── */}
        {activeTab === 'home' && (
          <Dashboard
            contacts={contacts}
            emailStats={emailStats}
            onAddContact={() => { goTo('contacts'); setContactSubTab('my'); openAdd(); }}
            onCompose={() => { if (!user) { setShowAuthModal(true); return; } setComposeContacts(contacts.filter(c => c.status === 'New').slice(0, 1)); setShowCompose(true); }}
            onGoToContacts={() => { goTo('contacts'); setContactSubTab('my'); }}
            activityKey={activityKey}
          />
        )}

        {/* ── Profile tab ────────────────────────────────────────── */}
        {activeTab === 'profile' && user && (
          <ProfilePage onDirtyChange={v => { profileDirtyRef.current = v; }} />
        )}
        {activeTab === 'profile' && !user && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-gray-500 text-sm">Sign in to view and edit your profile.</p>
            <button onClick={() => setShowAuthModal(true)} className="px-5 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 transition">Sign In</button>
          </div>
        )}

        {/* ── Admin tab ─────────────────────────────────────────── */}
        {activeTab === 'admin' && <AdminPanel />}

        {/* ── Ask Referral tab ──────────────────────────────────── */}
        {activeTab === 'referrals' && user && (
          <TabErrorBoundary>
            <AskReferral />
          </TabErrorBoundary>
        )}
        {activeTab === 'referrals' && !user && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-gray-500 text-sm">Sign in to access the referral network.</p>
            <button onClick={() => setShowAuthModal(true)} className="px-5 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 transition">Sign In</button>
          </div>
        )}

        {/* ── Jobs tab (umbrella: browse + apply queue) ── */}
        {activeTab === 'jobs' && (
          <div key={jobsSubTab} className="max-w-screen-xl mx-auto animate-tab-fade-in">
            <div className="mb-5">
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Briefcase size={20} className="text-brand-600" /> Jobs
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Scraped board postings from LinkedIn, Naukri, Internshala & more — and a queue of skill-matched jobs to review and apply to yourself.
              </p>
            </div>

            {/* Sub-tabs */}
            <div className="bg-white border border-gray-200 rounded-md shadow-card overflow-hidden mb-5">
              <div className="flex border-b border-gray-200 overflow-x-auto">
                {[
                  { id: 'browse',      icon: <Briefcase size={14} />, label: 'Browse Jobs', desc: 'All scraped postings, filterable by category & keyword' },
                  { id: 'apply-queue', icon: <ListChecks size={14} />, label: 'Apply Queue',  desc: 'Skill-matched jobs queued for you to review and apply' },
                ].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setJobsSubTab(sub.id)}
                    title={sub.desc}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all duration-150 whitespace-nowrap -mb-px ${
                      jobsSubTab === sub.id
                        ? 'border-brand-600 text-brand-700'
                        : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                    }`}
                  >
                    <span className={jobsSubTab === sub.id ? 'text-brand-600' : 'text-gray-400'}>{sub.icon}</span>
                    {sub.label}
                  </button>
                ))}
              </div>
            </div>

            {jobsSubTab === 'browse' && <TabErrorBoundary><JobScraperSection /></TabErrorBoundary>}
            {jobsSubTab === 'apply-queue' && <TabErrorBoundary><ApplyQueue /></TabErrorBoundary>}
          </div>
        )}

        {/* ── Job Intel tab (umbrella: ATS/job-board contacts + LinkedIn hiring posts) ── */}
        {/* Each sub-tab gets its OWN TabErrorBoundary below (not one shared
            boundary around the whole umbrella) — a class component's error
            state never auto-clears on its own, so a single boundary wrapping
            both sub-tabs meant one throwing ONCE would permanently show the
            fallback for the other too, until a manual Retry click. Nesting
            the boundary inside each {subTab === 'x' && ...} branch means
            switching sub-tabs fully unmounts/remounts a fresh one. */}
        {activeTab === 'job-intel' && (
          <div key={jobIntelSubTab} className="max-w-screen-xl mx-auto animate-tab-fade-in">
            <div className="mb-5">
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Zap size={20} className="text-brand-600" /> Job Intel
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                HR emails auto-extracted from job board APIs/ATS posts, and raw LinkedIn hiring posts — the two scraper-driven contact sources, side by side.
              </p>
            </div>

            {/* Sub-tabs */}
            <div className="bg-white border border-gray-200 rounded-md shadow-card overflow-hidden mb-5">
              <div className="flex border-b border-gray-200 overflow-x-auto">
                {[
                  { id: 'intel-contacts',        icon: <Zap size={14} />,       label: 'ATS & Job-Board Contacts',  desc: 'HR emails auto-extracted from job board APIs & ATS posts', badge: jobIntelStatus !== 'ok' },
                  { id: 'linkedin-hiring-posts', icon: <MailCheck size={14} />, label: 'LinkedIn Hiring Posts',     desc: 'Raw hiring posts from the LinkedIn feed scraper' },
                ].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setJobIntelSubTab(sub.id)}
                    title={sub.desc}
                    className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all duration-150 whitespace-nowrap -mb-px ${
                      jobIntelSubTab === sub.id
                        ? 'border-brand-600 text-brand-700'
                        : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                    }`}
                  >
                    <span className={`relative ${jobIntelSubTab === sub.id ? 'text-brand-600' : 'text-gray-400'}`}>
                      {sub.icon}
                      {sub.badge && (
                        <span
                          title={jobIntelStatus === 'proxy_pool_dead' ? 'Proxy pool dead' : 'Low yield'}
                          className={`absolute -top-1 -right-1.5 w-2 h-2 rounded-full ${jobIntelStatus === 'proxy_pool_dead' ? 'bg-red-500' : 'bg-amber-500'}`}
                        />
                      )}
                    </span>
                    {sub.label}
                  </button>
                ))}
              </div>
            </div>

            {jobIntelSubTab === 'intel-contacts' && <TabErrorBoundary><JobIntelPanel /></TabErrorBoundary>}
            {jobIntelSubTab === 'linkedin-hiring-posts' && <TabErrorBoundary><LinkedInPosts /></TabErrorBoundary>}
          </div>
        )}

        {/* ── Content AI tab (umbrella: review queue + history) ── */}
        {activeTab === 'content-ai' && user && (
          <div key={contentAiSubTab} className="max-w-screen-xl mx-auto animate-tab-fade-in">
            <div className="mb-5">
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Sparkles size={20} className="text-brand-600" /> Content AI
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                AI-drafted LinkedIn posts based on your profile & GitHub activity — you review, edit, approve or reject every one before anything goes out.
              </p>
            </div>

            {/* Sub-tabs */}
            <div className="bg-white border border-gray-200 rounded-md shadow-card overflow-hidden mb-5">
              <div className="flex border-b border-gray-200 overflow-x-auto">
                {[
                  { id: 'review',  icon: <ListChecks size={14} />, label: 'Review Queue', desc: 'Generated drafts waiting for your edit/approve/reject' },
                  { id: 'history', icon: <FileText   size={14} />, label: 'History',       desc: 'Approved, published, rejected & failed posts' },
                ].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setContentAiSubTab(sub.id)}
                    title={sub.desc}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all duration-150 whitespace-nowrap -mb-px ${
                      contentAiSubTab === sub.id
                        ? 'border-brand-600 text-brand-700'
                        : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                    }`}
                  >
                    <span className={contentAiSubTab === sub.id ? 'text-brand-600' : 'text-gray-400'}>{sub.icon}</span>
                    {sub.label}
                  </button>
                ))}
              </div>
            </div>

            {contentAiSubTab === 'review'  && <TabErrorBoundary><ContentReviewPanel /></TabErrorBoundary>}
            {contentAiSubTab === 'history' && <TabErrorBoundary><ContentHistoryPanel /></TabErrorBoundary>}
          </div>
        )}
        {activeTab === 'content-ai' && !user && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-gray-500 text-sm">Sign in to use the Content AI pipeline.</p>
            <button onClick={() => setShowAuthModal(true)} className="px-5 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 transition">Sign In</button>
          </div>
        )}

        {/* ── Templates tab (single component — no sub-tabs) ── */}
        {activeTab === 'templates' && (
          <div className="max-w-screen-xl mx-auto animate-tab-fade-in">
            <div className="mb-5">
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <FileText size={20} className="text-brand-600" /> Templates
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Email &amp; resume templates.
              </p>
            </div>
            <TabErrorBoundary><TemplatesPage /></TabErrorBoundary>
          </div>
        )}

        {/* ── Resume Tools tab (umbrella: analyzer + bulk apply + vault) ── */}
        {/* No key-based remount here (unlike Job Intel above) — JobAnalyzer/
            BulkJobAnalyzer are KeepAlive'd specifically so switching sub-tabs
            never loses in-progress unsaved work; retriggering a fade via `key`
            would force-remount them and defeat that entirely. */}
        {activeTab === 'resume-tools' && (
          <>
            <div className="max-w-screen-xl mx-auto">
              <div className="mb-5">
                <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Target size={20} className="text-brand-600" /> Resume Tools
                </h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  ATS fit-scoring, bulk tailoring, and your saved resume versions.
                </p>
              </div>

              {/* Sub-tabs */}
              <div className="bg-white border border-gray-200 rounded-md shadow-card overflow-hidden mb-5">
                <div className="flex border-b border-gray-200 overflow-x-auto">
                  {[
                    { id: 'analyzer',    icon: <Target size={14} />,     label: 'Resume Analyzer',  desc: 'ATS score & resume fit check for one job' },
                    { id: 'bulk-apply',  icon: <ListChecks size={14} />, label: 'Bulk Apply',       desc: 'Tailor your resume to many jobs at once' },
                    { id: 'vault',       icon: <FolderOpen size={14} />, label: 'Resume Vault',     desc: 'Your saved resume versions', requiresAuth: true },
                  ].map(sub => {
                    const locked = sub.requiresAuth && !user;
                    return (
                      <button
                        key={sub.id}
                        onClick={() => { if (locked) { setShowAuthModal(true); return; } setResumeToolsSubTab(sub.id); }}
                        title={sub.desc}
                        className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all duration-150 whitespace-nowrap -mb-px ${
                          resumeToolsSubTab === sub.id
                            ? 'border-brand-600 text-brand-700'
                            : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                        } ${locked ? 'opacity-40' : ''}`}
                      >
                        <span className={resumeToolsSubTab === sub.id ? 'text-brand-600' : 'text-gray-400'}>
                          {locked ? <Lock size={14} /> : sub.icon}
                        </span>
                        {sub.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {resumeToolsSubTab === 'vault' && user && (
                <TabErrorBoundary><ResumeVault /></TabErrorBoundary>
              )}
              {resumeToolsSubTab === 'vault' && !user && (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <p className="text-gray-500 text-sm">Sign in to access your Resume Vault.</p>
                  <button onClick={() => setShowAuthModal(true)} className="px-5 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 transition">Sign In</button>
                </div>
              )}
            </div>
          </>
        )}

        {/* JobAnalyzer/BulkJobAnalyzer KeepAlive — deliberately OUTSIDE the
            {activeTab === 'resume-tools' && ...} block above (unlike the rest
            of that tab's content) and gated by a COMPOUND active condition
            instead. KeepAlive only preserves state across sub-tab switches
            while its children stay in the React tree; nesting these inside
            the resume-tools conditional would unmount them the moment the
            user left the Resume Tools tab entirely (e.g. to check Contacts
            and come back), silently discarding in-progress unsaved work —
            exactly the regression KeepAlive exists to prevent. */}
        <div className="max-w-screen-xl mx-auto">
          <KeepAlive
            active={activeTab === 'resume-tools' && resumeToolsSubTab === 'analyzer'}
            name="resume-tools-analyzer"
            visitedRef={analyzerVisitedRef}
          >
            <TabErrorBoundary><JobAnalyzer /></TabErrorBoundary>
          </KeepAlive>
          <KeepAlive
            active={activeTab === 'resume-tools' && resumeToolsSubTab === 'bulk-apply'}
            name="resume-tools-bulk"
            visitedRef={analyzerVisitedRef}
          >
            <TabErrorBoundary><BulkJobAnalyzer /></TabErrorBoundary>
          </KeepAlive>
        </div>

        {/* ── Contacts tab ──────────────────────────────────────── */}
        {activeTab === 'contacts' && <>

        {/* Contact subtabs — Gmail Sync and LinkedIn Feed Contacts are now
            co-equal, top-level sub-tabs instead of being nested one level
            deeper inside a single "Cold Emailing" tab that stacked them in
            one long vertical scroll (LinkedIn contacts required scrolling
            past the whole Gmail list to reach). */}
        <div className="bg-white border border-gray-200 rounded-md shadow-card overflow-hidden">
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {[
              { id: 'my',                 icon: <Users size={14} />,      label: 'My HR List',            desc: 'Manually added & imported contacts' },
              { id: 'gmail-sync',         icon: <Mail size={14} />,       label: 'Gmail Sync',            desc: 'Emails sent to HRs tracked from your Gmail' },
              { id: 'linkedin-contacts',  icon: <MailCheck size={14} />,  label: 'LinkedIn Feed Contacts', desc: 'Emailable HR contacts found by the LinkedIn feed scraper' },
            ].map(sub => (
              <button
                key={sub.id}
                onClick={() => setContactSubTab(sub.id)}
                title={sub.desc}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all duration-150 whitespace-nowrap -mb-px ${
                  contactSubTab === sub.id
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                }`}
              >
                <span className={contactSubTab === sub.id ? 'text-brand-600' : 'text-gray-400'}>{sub.icon}</span>
                {sub.label}
              </button>
            ))}
          </div>

          {/* Gmail Sync sub-tab */}
          {contactSubTab === 'gmail-sync' && (
            <div key="gmail-sync" className="p-5 bg-stone-50 space-y-4 animate-tab-fade-in">
              <TabErrorBoundary>
                {!user ? (
                  <div className="text-center py-10 text-gray-500">
                    <p className="text-3xl mb-2">🔒</p>
                    <p className="text-sm">Sign in to view your Gmail outreach tracking</p>
                  </div>
                ) : (
                  <>
                    <GmailConnectCard
                      onStatusChange={s => {
                        setGmailStatus(s);
                        if (s?.synced) setGmailRefresh(r => r + 1);
                      }}
                    />
                    <GmailEmailList refreshKey={gmailRefresh} myName={user?.name || ''} />
                  </>
                )}
              </TabErrorBoundary>
            </div>
          )}

          {/* LinkedIn Feed Contacts sub-tab */}
          {contactSubTab === 'linkedin-contacts' && (
            <div key="linkedin-contacts" className="p-5 bg-stone-50 space-y-3 animate-tab-fade-in">
              <TabErrorBoundary>
                {!user ? (
                  <div className="text-center py-10 text-gray-500">
                    <p className="text-3xl mb-2">🔒</p>
                    <p className="text-sm">Sign in to view LinkedIn feed contacts</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-400">
                      Email contacts found by the LinkedIn Feed scraper. Updated automatically — no manual import needed.
                      Select one or many and send individual emails directly. Raw LinkedIn hiring posts live under
                      <span className="font-medium"> Job Discovery → LinkedIn Hiring Posts</span>.
                    </p>
                    <FeedContactsPanel />
                  </>
                )}
              </TabErrorBoundary>
            </div>
          )}

          {/* My Contacts subtab */}
          {contactSubTab === 'my' && (
          <div key="my" className="p-5 space-y-5 animate-tab-fade-in">

          {/* Stats + Activity */}
          <StatsBar summary={contactsSummary} />
          <ActivityCalendar refreshKey={activityKey} />

          {/* ── Toolbar ───────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-md shadow-card overflow-hidden">
            {/* Primary row: search + filters + add */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
              <input
                type="text"
                placeholder="Search name, email, company…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="border border-gray-200 rounded-sm px-3 py-2 w-52 text-sm focus:ring-2 focus:ring-brand-300 focus:border-brand-400 outline-none bg-white"
              />
              <input
                type="text"
                placeholder="Filter job title…"
                value={titleFilter}
                onChange={e => setTitleFilter(e.target.value)}
                className="border border-gray-200 rounded-sm px-3 py-2 w-40 text-sm focus:ring-2 focus:ring-brand-300 focus:border-brand-400 outline-none bg-white"
              />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="border border-gray-200 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none bg-white"
              >
                <option value="">All Statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={sourceFilter}
                onChange={e => setSourceFilter(e.target.value)}
                className="border border-gray-200 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none bg-white"
              >
                {/* Values must match the raw email_source stored on the row —
                    "csv" here used to silently return zero rows since the
                    column actually holds "csv_import". */}
                <option value="">All Sources</option>
                <option value="job-intel">Job Intel</option>
                <option value="manual">Manual</option>
                <option value="csv_import">CSV Import</option>
                <option value="gmail">Gmail Sync</option>
                <option value="linkedin-feed">LinkedIn Feed</option>
                <option value="naukri">Naukri</option>
                <option value="apify">Apify</option>
              </select>
              {availableTags.length > 0 && (
                <MultiSelectDropdown
                  options={availableTags.map(t => ({ value: t.tag, label: `${t.tag} (${t.count})` }))}
                  selected={tagFilters}
                  onChange={setTagFilters}
                  placeholder="All Tags"
                  title="Filter by tag — a contact must carry ALL selected tags. Job Intel contacts are auto-tagged by matched category/skills."
                />
              )}
              {(searchInput || statusFilter || sourceFilter || tagFilters.length || titleFilter || segment !== 'all') && (
                <button onClick={() => { setSearchInput(''); setSearch(''); setStatusFilter(''); setSourceFilter(''); setTagFilters([]); setTitleFilter(''); setSegment('all'); }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline">
                  Clear
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <RateLimitBar />
                {emailStats && (
                  <span className="text-xs text-gray-500 border border-gray-200 rounded-sm px-3 py-2 bg-white flex items-center gap-1.5">
                    <Mail size={13} className="text-gray-400" />
                    {emailStats.sentToday}/{emailStats.dailyCap} today
                  </span>
                )}
                <button onClick={openAdd}
                  className="px-4 py-2 text-sm bg-brand-600 text-white rounded-sm hover:bg-brand-700 font-semibold transition flex items-center gap-1.5">
                  + Add Contact
                </button>
              </div>
            </div>
            {/* Secondary row: settings + import/export */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-gray-50">
              <button onClick={() => setShowPlans(true)}
                className="text-xs border border-gray-200 rounded-sm px-3 py-1.5 bg-white hover:bg-gray-50 font-medium transition flex items-center gap-1.5 text-gray-500">
                <BarChart3 size={12} className="text-gray-400" />
                {planName} Plan{user && planName !== 'Advanced' ? ' · Upgrade' : ''}
              </button>
              <button onClick={() => setShowReminder(true)}
                className="text-xs border border-gray-200 rounded-sm px-3 py-1.5 bg-white hover:bg-gray-50 font-medium transition text-gray-500 flex items-center gap-1.5">
                <Bell size={12} className="text-gray-400" /> Reminders
              </button>
              <button onClick={() => setShowSmtp(true)}
                className="text-xs border border-gray-200 rounded-sm px-3 py-1.5 bg-white hover:bg-gray-50 font-medium transition text-gray-500">
                SMTP Settings
              </button>
              <span className="text-gray-200">|</span>
              <button onClick={() => setShowImport(true)}
                className="text-xs border border-gray-200 rounded-sm px-3 py-1.5 bg-white hover:bg-gray-50 font-medium transition text-gray-500">
                Import CSV / Excel
              </button>
              <button onClick={() => handleExport('xlsx')}
                className="text-xs border border-gray-200 rounded-sm px-3 py-1.5 bg-white hover:bg-gray-50 font-medium transition text-gray-500">
                Download Excel
              </button>
              <button onClick={() => handleExport('csv')}
                className="text-xs border border-gray-200 rounded-sm px-3 py-1.5 bg-white hover:bg-gray-50 font-medium transition text-gray-500">
                Download CSV
              </button>
            </div>
          </div>

          {/* ── Segment: Not contacted / Contacted / Flagged / All ───── */}
          {/* Counts come from /contacts/summary (true totals across every
              matching contact), not contacts.length — that only reflects
              whatever page(s) have been loaded into the table so far. */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white">
            {[
              { id: 'not_contacted', label: 'Not contacted', count: contactsSummary.not_contacted, active: 'bg-slate-800 text-white border-slate-800', dot: 'bg-slate-400' },
              { id: 'contacted',     label: 'Already mailed', count: contactsSummary.contacted,     active: 'bg-amber-500 text-white border-amber-500', dot: 'bg-amber-500' },
              { id: 'flagged',       label: '⚠ Flagged',      count: contactsSummary.flagged,        active: 'bg-red-600 text-white border-red-600',     dot: 'bg-red-500' },
              { id: 'all',           label: 'All',            count: contactsSummary.total,          active: 'bg-brand-600 text-white border-brand-600', dot: 'bg-brand-500' },
            ].map(seg => (
              <button
                key={seg.id}
                onClick={() => setSegment(seg.id)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                  segment === seg.id ? seg.active : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${segment === seg.id ? 'bg-white/80' : seg.dot}`} />
                {seg.label}
                <span className={`ml-0.5 tabular-nums ${segment === seg.id ? 'text-white/80' : 'text-gray-400'}`}>{seg.count}</span>
              </button>
            ))}
            <span className="text-[11px] text-gray-400 ml-1 hidden sm:inline">
              “Not contacted” = you haven’t emailed them yet
            </span>
          </div>

          {/* ── Quick-select + bulk action bar ──────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-100">
            {/* Quick-select buttons — always visible */}
            <span className="text-xs text-gray-400 font-medium">Select:</span>
            {/* These two fetch every matching contact from the server (not just
                the loaded page) so bulk actions cover the whole filtered set,
                not whatever happens to be scrolled into view. */}
            {contactsSummary.not_contacted > 0 && (
              <button
                onClick={() => selectAllMatching('not_contacted', { merge: true })}
                disabled={selectingAll}
                className="text-xs px-2.5 py-1 border border-slate-300 bg-slate-50 rounded-sm text-slate-700 hover:bg-slate-100 hover:border-slate-400 font-semibold transition disabled:opacity-50"
                title={`Select all ${contactsSummary.not_contacted} not-contacted HRs across every page`}
              >
                {selectingAll ? 'Selecting…' : `All not contacted (${contactsSummary.not_contacted})`}
              </button>
            )}
            {[5, 10].map(n => {
              const SENT_STATUSES = new Set(['Sent','Opened','Replied','Interview','Rejected','Do Not Contact']);
              const unsentIds = contacts
                .filter(c => !SENT_STATUSES.has(c.status) && !selected.includes(c.id))
                .map(c => c.id);
              return unsentIds.length > 0 && (
                <button
                  key={n}
                  onClick={() => setSelected(prev => [...prev, ...unsentIds.slice(0, n)])}
                  className="text-xs px-2.5 py-1 border border-gray-300 rounded-sm text-gray-600 hover:bg-gray-100 hover:border-gray-400 font-semibold transition"
                  title={`Add ${Math.min(n, unsentIds.length)} unsent contact${Math.min(n, unsentIds.length) !== 1 ? 's' : ''} to selection — picked from what's currently loaded`}
                >
                  +{n}
                </button>
              );
            })}
            {segmentCount(segment) > 0 && (
              <button
                onClick={() => selectAllMatching(segment)}
                disabled={selectingAll}
                className="text-xs px-2.5 py-1 border border-gray-300 rounded-sm text-gray-600 hover:bg-gray-100 hover:border-gray-400 font-semibold transition disabled:opacity-50"
              >
                {selectingAll ? 'Selecting…' : `All (${segmentCount(segment)})`}
              </button>
            )}
            {selected.length > 0 && (
              <button
                onClick={() => setSelected([])}
                className="text-xs px-2.5 py-1 border border-red-200 rounded-sm text-red-500 hover:bg-red-50 hover:border-red-400 font-semibold transition"
              >
                ✕ Clear ({selected.length})
              </button>
            )}

            {/* Bulk actions — shown when something is selected */}
            {selected.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 ml-2">
                <span className="text-gray-200">|</span>
                <span className="text-xs font-semibold text-brand-700">{selected.length} selected</span>
                <select
                  defaultValue=""
                  onChange={e => { if (e.target.value) { handleBulkStatus(e.target.value); e.target.value = ''; } }}
                  className="border border-gray-200 rounded-sm px-2.5 py-1 text-xs bg-white focus:ring-2 focus:ring-brand-300 outline-none"
                >
                  <option value="" disabled>Change status…</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="tag1, tag2…"
                  value={bulkTagInput}
                  onChange={e => setBulkTagInput(e.target.value)}
                  className="border border-gray-200 rounded-sm px-2 py-1 text-xs w-28 focus:ring-2 focus:ring-brand-300 outline-none"
                />
                <button onClick={() => handleBulkTags('add')} disabled={!bulkTagInput.trim()}
                  className="text-xs text-brand-700 hover:text-brand-900 font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                  + Tag
                </button>
                <button onClick={() => handleBulkTags('remove')} disabled={!bulkTagInput.trim()}
                  className="text-xs text-gray-500 hover:text-gray-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                  − Tag
                </button>
                <button
                  onClick={handleBulkCompose}
                  className={`px-3 py-1 rounded-sm text-xs font-semibold transition flex items-center gap-1.5 ${
                    user ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                  }`}
                >
                  {!user && <Lock size={11} />}
                  <MailCheck size={12} /> Compose ({selected.length})
                </button>
                <button onClick={handleBulkDelete} className="text-xs text-red-600 hover:text-red-800 font-semibold">
                  Delete
                </button>
              </div>
            )}
          </div>

          {/* segment/title filtering now happens server-side (see fetchContacts),
              so `contacts` already IS the current segment+filter's result set —
              no client-side re-filtering needed before handing it to the table. */}
          <ContactTable
            contacts={contacts}
            loading={loading}
            selected={selected}
            onSelect={setSelected}
            onEdit={openEdit}
            onDelete={handleDelete}
            onStatusChange={handleStatusChange}
            onSendEmail={handleSendEmail}
            onSetFollowUp={handleSetFollowUp}
            isAuthenticated={!!user}
            onLoginRequest={() => setShowAuthModal(true)}
            visibleLimit={visibleLimit}
            planName={planName}
            onUpgradeClick={() => setShowPlans(true)}
          />

          {!loading && (
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-gray-400">
                Showing {contacts.length} of {segmentCount(segment)}
              </span>
              <label className="text-xs text-gray-400 flex items-center gap-1.5">
                Rows per page
                <select
                  value={pageSize}
                  onChange={e => changePageSize(parseInt(e.target.value, 10))}
                  className="border border-gray-200 rounded-sm px-2 py-1 text-xs bg-white focus:ring-2 focus:ring-brand-300 outline-none"
                >
                  {[15, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          )}
          <LoadMoreSentinel hasMore={contactsHasMore} loading={loadingMore} onLoadMore={loadMoreContacts} />
          </div>
        )}

        </div>
        </>}

      </main>

      {showForm && (
        <ContactForm
          contact={editingContact}
          onSave={editingContact ? (data) => handleUpdate(editingContact.id, data) : handleCreate}
          onClose={closeForm}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); fetchContacts(); }}
        />
      )}

      {showCompose && (
        <ComposeModal
          contacts={composeContacts}
          onClose={() => setShowCompose(false)}
          onSent={handleSent}
        />
      )}

      {showSmtp     && <SmtpSettingsModal onClose={() => setShowSmtp(false)} />}
      {showReminder && <ReminderModal     onClose={() => setShowReminder(false)} />}
      {showAuthModal && <AuthModal         onClose={() => setShowAuthModal(false)} />}
      {showPlans && (
        <PlansModal
          onClose={() => setShowPlans(false)}
          onSignupClick={() => { setShowPlans(false); setShowAuthModal(true); }}
        />
      )}

      {showUnsavedModal && (
        <UnsavedChangesModal
          onSaveDraft={() => {
            // Draft is already auto-saved by useDraft; just proceed with navigation
            setShowUnsavedModal(false);
            profileDirtyRef.current = false;
            if (pendingTabRef.current) { goTo(pendingTabRef.current); pendingTabRef.current = null; }
          }}
          onLeave={() => {
            // Discard all profile drafts and navigate
            ['profile:overview', 'profile:links', 'profile:hero'].forEach(k => clearDraft(k));
            setShowUnsavedModal(false);
            profileDirtyRef.current = false;
            if (pendingTabRef.current) { goTo(pendingTabRef.current); pendingTabRef.current = null; }
          }}
          onStay={() => {
            setShowUnsavedModal(false);
            pendingTabRef.current = null;
          }}
        />
      )}
    </div>
  );
}
