import { useState, useEffect, useCallback, useRef, Component } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import {
  Home, Users, FileText, Target, ListChecks,
  FolderOpen, UserPlus, User, ShieldCheck, Crown, Lock,
  MailCheck, Briefcase, Mail, BarChart3, Bell, Zap,
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
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
import ColdEmailSection from './components/ColdEmailSection.jsx';
import JobScraperSection from './components/JobScraperSection.jsx';
import UnsavedChangesModal from './components/UnsavedChangesModal.jsx';
import AskReferral        from './components/AskReferral.jsx';
import ResumeVault        from './components/ResumeVault.jsx';
import LandingPage        from './components/LandingPage.jsx';
import Chatbot            from './components/Chatbot.jsx';
import JobIntelPanel      from './components/JobIntelPanel.jsx';
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

const PLAN_LIMITS = { guest: 5, demo: 10, basic: 100, advanced: 999999 };
const PLAN_NAMES  = { guest: 'Guest', demo: 'Demo', basic: 'Basic', advanced: 'Advanced' };

const TAB_PATHS = {
  home:           '/',
  contacts:       '/contacts',
  templates:      '/templates',
  jobs:           '/analyzer',
  bulk:           '/bulk-apply',
  profile:        '/profile',
  'job-scraper':  '/jobs',
  'job-intel':    '/job-intel',
  'resume-vault': '/vault',
  referrals:      '/referrals',
  admin:          '/admin',
};

function getTabFromPath(pathname) {
  const reverse = Object.fromEntries(Object.entries(TAB_PATHS).map(([t, p]) => [p, t]));
  return reverse[pathname] || 'home';
}

const STATUSES = ['New','Drafted','Sent','Opened','Replied','Interview','Rejected','Do Not Contact'];

export default function App() {
  const [contacts,       setContacts]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [searchInput,    setSearchInput]    = useState('');  // raw input (instant)
  const [search,         setSearch]         = useState('');  // debounced (sent to API)
  const [statusFilter,   setStatusFilter]   = useState('');
  const [sourceFilter,   setSourceFilter]   = useState('');
  const [titleFilter,    setTitleFilter]    = useState('');
  const [selected,       setSelected]       = useState([]);
  const [editingContact,   setEditingContact]   = useState(null);
  const [showForm,         setShowForm]         = useState(false);
  const [showImport,       setShowImport]       = useState(false);
  const [showCompose,      setShowCompose]      = useState(false);
  const [composeContacts,  setComposeContacts]  = useState([]);
  const [showSmtp,         setShowSmtp]         = useState(false);
  const [showReminder,     setShowReminder]     = useState(false);
  const [emailStats,       setEmailStats]       = useState(null);
  const [activityKey,      setActivityKey]      = useState(0);
  const [activeTab,        setActiveTab]        = useState(() => getTabFromPath(window.location.pathname));
  const [showAuthModal,    setShowAuthModal]    = useState(false);
  const [showPlans,        setShowPlans]        = useState(false);
  // contacts section sub-tabs: 'my' | 'cold-email' | 'job-links'
  const [contactSubTab,    setContactSubTab]    = useState('my');
  const { user, loading: authLoading } = useAuth();

  // Unsaved-changes guard: ProfilePage reports dirty state here
  const profileDirtyRef   = useRef(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const pendingTabRef      = useRef(null);

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

  const fetchContacts = useCallback(async () => {
    if (!user) { setLoading(false); return; } // guests land on LandingPage, not the contacts table
    setLoading(true);
    try {
      const params = {};
      if (search)       params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (sourceFilter) params.source = sourceFilter;
      const data = await api.get('/contacts', { params });
      setContacts(data);
    } catch {
      toast.error('Could not reach backend — is it running on port 3001?');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, sourceFilter, user]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

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

  useEffect(() => {
    api.get('/email/stats').then(setEmailStats).catch(() => {});
  }, [activityKey]); // refresh only after explicit actions (send, delete), not on every search keystroke

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
      const tab = e.state?.tabId || getTabFromPath(window.location.pathname) || 'home';
      setActiveTab(tab);
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

  const handleStatusChange = (id, status) => handleUpdate(id, { status });

  const handleExport = () => {
    if (!user) { setShowAuthModal(true); toast.error('Sign in to download the Excel file'); return; }
    window.open(`${API_ROOT}/api/contacts/export`, '_blank');
    toast('Excel download started');
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
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
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
    { id: 'home',        icon: <Home         size={16} />, label: 'Dashboard',               sub: 'Your outreach at a glance'           },
    { id: 'contacts',    icon: <Users        size={16} />, label: 'Cold Emailing & Contacts', sub: 'HR contacts & email outreach'        },
    { id: 'job-scraper', icon: <Briefcase    size={16} />, label: 'Jobs',                    sub: 'Scrape LinkedIn, Naukri & more'      },
    { id: 'job-intel',   icon: <Zap         size={16} />, label: 'Job Intel Contacts',        sub: 'HR emails extracted from job board APIs & ATS posts' },
    { id: 'templates',   icon: <FileText     size={16} />, label: 'Templates & Resumes',     sub: 'Email & resume templates'            },
    { id: 'jobs',        icon: <Target       size={16} />, label: 'Resume Analyzer & Maker', sub: 'ATS score & resume fit check'        },
    { id: 'bulk',        icon: <ListChecks   size={16} />, label: 'Generalize Resume',       sub: 'Tailor resume to any job description' },
    { id: 'resume-vault',icon: <FolderOpen   size={16} />, label: 'Resume Vault',            sub: 'Your saved resume versions', requiresAuth: true },
    { id: 'referrals',   icon: <UserPlus     size={16} />, label: 'Sifarish',                sub: 'Get referred at top companies', requiresAuth: true },
    { id: 'profile',     icon: <User         size={16} />, label: 'Profile',                 sub: 'Your skills & resume data',  requiresAuth: true },
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
                  <span className={isActive ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-500'}>
                    {locked ? <Lock size={14} /> : tab.icon}
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
          />
        )}

        {/* ── Templates tab ─────────────────────────────────────── */}
        {activeTab === 'templates' && <TemplatesPage />}

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

        {/* ── Resume Vault tab ──────────────────────────────────── */}
        {activeTab === 'resume-vault' && user && (
          <TabErrorBoundary>
            <ResumeVault />
          </TabErrorBoundary>
        )}
        {activeTab === 'resume-vault' && !user && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-gray-500 text-sm">Sign in to access your Resume Vault.</p>
            <button onClick={() => setShowAuthModal(true)} className="px-5 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 transition">Sign In</button>
          </div>
        )}

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

        {/* ── Job Analyzer tab ──────────────────────────────────── */}
        {/* ── Jobs (scraper) tab ────────────────────────────────── */}
        {activeTab === 'job-scraper' && (
          <TabErrorBoundary>
            <JobScraperSection />
          </TabErrorBoundary>
        )}

        {/* ── Job Intelligence tab (multi-agent pipeline) ───────── */}
        {activeTab === 'job-intel' && (
          <TabErrorBoundary>
            <div className="max-w-screen-xl mx-auto px-4 py-6">
              <div className="mb-5">
                <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Zap size={20} className="text-brand-600" /> Job Intel Contacts
                </h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  HR emails extracted from job descriptions across Arbeitnow, Remotive, RemoteOK, We Work Remotely, Greenhouse, Lever & more.
                  Configure in <span className="font-medium">Admin Panel → Job Intel Pipeline</span>.
                </p>
              </div>
              <JobIntelPanel />
            </div>
          </TabErrorBoundary>
        )}

        {/* ── Resume Analyzer & Maker tab ───────────────────────── */}
        {activeTab === 'jobs' && <JobAnalyzer />}

        {/* ── Bulk Apply tab ────────────────────────────────────── */}
        {activeTab === 'bulk' && <BulkJobAnalyzer />}

        {/* ── Contacts tab ──────────────────────────────────────── */}
        {activeTab === 'contacts' && <>

        {/* Contact subtabs */}
        <div className="bg-white border border-gray-200 rounded-md shadow-card overflow-hidden">
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {[
              { id: 'my',         icon: <Users size={14} />,      label: 'My HR List',      desc: 'Manually added & imported contacts'  },
              { id: 'cold-email', icon: <MailCheck size={14} />,  label: 'Email Outreach', desc: 'Gmail tracking + LinkedIn feed' },
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

          {/* Cold Emailing sub-tab */}
          {contactSubTab === 'cold-email' && (
            <div className="p-5 bg-stone-50">
              <TabErrorBoundary>
                <ColdEmailSection />
              </TabErrorBoundary>
            </div>
          )}

          {/* My Contacts subtab */}
          {contactSubTab === 'my' && (
          <div className="p-5 space-y-5">

          {/* Stats + Activity */}
          <StatsBar contacts={contacts} />
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
                <option value="">All Sources</option>
                <option value="job-intel">Job Intel</option>
                <option value="manual">Manual</option>
                <option value="csv">CSV Import</option>
                <option value="apify">Apify</option>
              </select>
              {(searchInput || statusFilter || sourceFilter || titleFilter) && (
                <button onClick={() => { setSearchInput(''); setSearch(''); setStatusFilter(''); setSourceFilter(''); setTitleFilter(''); }}
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
              <button onClick={handleExport}
                className="text-xs border border-gray-200 rounded-sm px-3 py-1.5 bg-white hover:bg-gray-50 font-medium transition text-gray-500">
                Download Excel
              </button>
            </div>
          </div>

          {/* ── Quick-select + bulk action bar ──────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-100">
            {/* Quick-select buttons — always visible */}
            <span className="text-xs text-gray-400 font-medium">Select:</span>
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
                  title={`Add ${Math.min(n, unsentIds.length)} unsent contact${Math.min(n, unsentIds.length) !== 1 ? 's' : ''} to selection`}
                >
                  +{n}
                </button>
              );
            })}
            {contacts.length > 0 && (
              <button
                onClick={() => setSelected(contacts.map(c => c.id))}
                className="text-xs px-2.5 py-1 border border-gray-300 rounded-sm text-gray-600 hover:bg-gray-100 hover:border-gray-400 font-semibold transition"
              >
                All ({contacts.length})
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

          <ContactTable
            contacts={titleFilter ? contacts.filter(c => (c.title || '').toLowerCase().includes(titleFilter.toLowerCase())) : contacts}
            loading={loading}
            selected={selected}
            onSelect={setSelected}
            onEdit={openEdit}
            onDelete={handleDelete}
            onStatusChange={handleStatusChange}
            onSendEmail={handleSendEmail}
            isAuthenticated={!!user}
            onLoginRequest={() => setShowAuthModal(true)}
            visibleLimit={visibleLimit}
            planName={planName}
            onUpgradeClick={() => setShowPlans(true)}
          />
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
