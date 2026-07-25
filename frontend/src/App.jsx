import { useState, useEffect, useCallback, useRef, Component } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import {
  Home, Users, FileText, Target, ListChecks,
  FolderOpen, UserPlus, User, ShieldCheck, Crown, Lock,
  MailCheck, Briefcase, Mail, BarChart3, Bell,
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

const STATUSES = ['New','Drafted','Sent','Opened','Replied','Interview','Rejected','Do Not Contact'];

export default function App() {
  const [contacts,       setContacts]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [search,         setSearch]         = useState('');
  const [statusFilter,   setStatusFilter]   = useState('');
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
  const [activeTab,        setActiveTab]        = useState('home'); // 'home' | 'contacts' | 'templates' | 'jobs' | 'bulk' | 'profile'
  const [showAuthModal,    setShowAuthModal]    = useState(false);
  const [showPlans,        setShowPlans]        = useState(false);
  // contacts section sub-tabs: 'my' | 'cold-email' | 'job-links'
  const [contactSubTab,    setContactSubTab]    = useState('my');
  const { user, loading: authLoading } = useAuth();

  // Unsaved-changes guard: ProfilePage reports dirty state here
  const profileDirtyRef   = useRef(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const pendingTabRef      = useRef(null);

  // Intercept tab navigation — show modal if ProfilePage has unsaved changes
  const navigateTo = useCallback((tabId, requiresAuth) => {
    if (requiresAuth && !user) { setShowAuthModal(true); return; }
    if (profileDirtyRef.current && activeTab === 'profile' && tabId !== 'profile') {
      pendingTabRef.current = tabId;
      setShowUnsavedModal(true);
      return;
    }
    setActiveTab(tabId);
  }, [activeTab, user]);

  const visibleLimit = PLAN_LIMITS[user?.plan] ?? PLAN_LIMITS.guest;
  const planName     = PLAN_NAMES[user?.plan]  ?? PLAN_NAMES.guest;

  const fetchContacts = useCallback(async () => {
    if (!user) { setLoading(false); return; } // guests land on LandingPage, not the contacts table
    setLoading(true);
    try {
      const params = {};
      if (search)       params.search = search;
      if (statusFilter) params.status = statusFilter;
      const data = await api.get('/contacts', { params });
      setContacts(data);
    } catch {
      toast.error('Could not reach backend — is it running on port 3001?');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, user]);

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
  }, []);

  useEffect(() => {
    api.get('/email/stats').then(setEmailStats).catch(() => {});
  }, [contacts]); // refresh stats whenever contacts list refreshes

  // Session-expired event: show toast so user knows why they got logged out
  useEffect(() => {
    const onExpired = () => {
      toast.error('Your session has expired. Please sign in again.', { id: 'session-expired', duration: 5000 });
      setShowAuthModal(true);
    };
    window.addEventListener('hr-session-expired', onExpired);
    return () => window.removeEventListener('hr-session-expired', onExpired);
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
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Scanning for signals…</p>
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
        <LandingPage
          onGetStarted={() => setShowAuthModal(true)}
          onSignIn={() => setShowAuthModal(true)}
        />
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      </>
    );
  }

  // ── Navigation definition ──────────────────────────────────────────────────
  // Creative labels (Section 2.6) + always-visible subtitles.
  // Sidebar label must match page <h1> exactly — enforced by using NAV_ITEMS as source of truth.
  const NAV_ITEMS = [
    { id: 'home',        icon: <Home         size={16} />, label: 'Overview',    sub: 'Your daily job hunt at a glance'     },
    { id: 'contacts',    icon: <Users        size={16} />, label: 'HR Contacts', sub: 'Recruiters & hiring managers'        },
    { id: 'templates',   icon: <FileText     size={16} />, label: 'Templates',   sub: 'Cold emails & resume formats'        },
    { id: 'jobs',        icon: <Target       size={16} />, label: 'Job Matcher', sub: 'ATS score & resume fit check'        },
    { id: 'bulk',        icon: <ListChecks   size={16} />, label: 'Bulk Apply',  sub: 'Apply to multiple jobs at once'      },
    { id: 'resume-vault',icon: <FolderOpen   size={16} />, label: 'Resume Box',  sub: 'Your saved resume versions',   requiresAuth: true },
    { id: 'referrals',   icon: <UserPlus     size={16} />, label: 'Referrals',   sub: 'Get referred at top companies', requiresAuth: true },
    { id: 'profile',     icon: <User         size={16} />, label: 'My Profile',  sub: 'Skills, resume & profile data', requiresAuth: true },
    ...(user?.role === 'admin' ? [{ id: 'admin', icon: <ShieldCheck size={16} />, label: 'Admin', sub: 'User & system management', requiresAuth: true }] : []),
  ];

  return (
    <div className="min-h-screen bg-orange-50">
      <ConfirmDialog />
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <EarlyAccessBanner />
      <Header onLoginClick={() => setShowAuthModal(true)} />

      {/* ── Tab navigation ──────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 sticky top-[57px] z-30">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 flex gap-0 overflow-x-auto">
          {NAV_ITEMS.map(tab => {
            const locked = tab.requiresAuth && !user;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => navigateTo(tab.id, tab.requiresAuth)}
                title={tab.sub}
                className={`group flex flex-col items-start px-4 py-2.5 border-b-2 transition-all duration-150 whitespace-nowrap min-w-0 ${
                  isActive
                    ? 'border-brand-600 text-brand-700 bg-brand-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300 hover:bg-gray-50/50'
                } ${locked ? 'opacity-50' : ''}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                  <span className={isActive ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-600'}>
                    {locked ? <Lock size={14} /> : tab.icon}
                  </span>
                  {tab.label}
                </span>
                <span className={`text-[10px] leading-tight mt-0.5 ${isActive ? 'text-brand-500' : 'text-gray-400'}`}>
                  {tab.sub}
                </span>
              </button>
            );
          })}
          {/* Plans — separate CTA style */}
          <button
            onClick={() => setShowPlans(true)}
            className="flex flex-col items-start px-4 py-2.5 border-b-2 border-transparent text-violet-600 hover:text-violet-800 hover:border-violet-300 hover:bg-violet-50/40 transition-all duration-150 whitespace-nowrap"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
              <Crown size={16} className="text-violet-400" />
              Upgrade
            </span>
            <span className="text-[10px] leading-tight mt-0.5 text-violet-400">Compare &amp; upgrade plan</span>
          </button>
        </div>
      </div>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fade-slide-in">

        {/* ── Dashboard tab ─────────────────────────────────────── */}
        {activeTab === 'home' && (
          <Dashboard
            contacts={contacts}
            emailStats={emailStats}
            onAddContact={() => { setActiveTab('contacts'); setContactSubTab('my'); openAdd(); }}
            onCompose={() => { if (!user) { setShowAuthModal(true); return; } setComposeContacts(contacts.filter(c => c.status === 'New').slice(0, 1)); setShowCompose(true); }}
            onGoToContacts={() => { setActiveTab('contacts'); setContactSubTab('my'); }}
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
        {activeTab === 'jobs' && <JobAnalyzer />}

        {/* ── Bulk Apply tab ────────────────────────────────────── */}
        {activeTab === 'bulk' && <BulkJobAnalyzer />}

        {/* ── Contacts tab ──────────────────────────────────────── */}
        {activeTab === 'contacts' && <>

        {/* Contact subtabs */}
        <div className="flex gap-0 border-b border-gray-200 bg-white overflow-x-auto">
          {[
            { id: 'my',         icon: <Users size={14} />,      label: 'My HR List',      desc: 'Manually added & imported contacts'  },
            { id: 'cold-email', icon: <MailCheck size={14} />,  label: 'Email Outreach', desc: 'Gmail tracking + LinkedIn feed'      },
            { id: 'job-links',  icon: <Briefcase size={14} />,  label: 'Job Scraper',    desc: 'Scrape LinkedIn, Naukri & more'      },
          ].map(sub => (
            <button
              key={sub.id}
              onClick={() => setContactSubTab(sub.id)}
              title={sub.desc}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-150 whitespace-nowrap -mb-px ${
                contactSubTab === sub.id
                  ? 'border-brand-600 text-brand-700 bg-brand-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300 hover:bg-gray-50/50'
              }`}
            >
              <span className={contactSubTab === sub.id ? 'text-brand-600' : 'text-gray-400'}>{sub.icon}</span>
              {sub.label}
            </button>
          ))}
        </div>

        {/* Cold Emailing sub-tab */}
        {contactSubTab === 'cold-email' && (
          <div className="bg-orange-50/40 rounded-b-md border border-gray-200 border-t-0 p-4">
            <TabErrorBoundary>
              <ColdEmailSection />
            </TabErrorBoundary>
          </div>
        )}

        {/* Job Scraper sub-tab */}
        {contactSubTab === 'job-links' && (
          <div className="bg-orange-50/40 rounded-b-md border border-gray-200 border-t-0 p-4">
            <TabErrorBoundary>
              <JobScraperSection />
            </TabErrorBoundary>
          </div>
        )}

        {/* My Contacts subtab */}
        {contactSubTab === 'my' && <>
        <StatsBar contacts={contacts} />
        <ActivityCalendar refreshKey={activityKey} />

        {/* ── Toolbar ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search name, company, email, title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-sm px-3 py-2 w-72 text-sm focus:ring-2 focus:ring-brand-300 focus:border-brand-400 outline-none bg-white"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none bg-white"
          >
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(search || statusFilter) && (
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); }}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Clear filters
            </button>
          )}

          <div className="ml-auto flex flex-wrap gap-2 items-center">
            <RateLimitBar />
            {emailStats && (
              <span className="text-xs text-gray-500 border border-gray-200 rounded-sm px-3 py-2 bg-white flex items-center gap-1.5">
                <Mail size={13} className="text-gray-400" />
                {emailStats.sentToday}/{emailStats.dailyCap} today
              </span>
            )}
            <button
              onClick={() => setShowPlans(true)}
              className="text-xs border border-gray-200 rounded-sm px-3 py-2 bg-white hover:bg-gray-50 font-medium transition flex items-center gap-1.5 text-gray-600"
            >
              <BarChart3 size={13} className="text-gray-400" />
              {planName} Plan{user && planName !== 'Advanced' ? ' · ↑ Upgrade' : ''}
            </button>
            <button onClick={() => setShowReminder(true)}
              className="px-4 py-2 text-sm bg-white border border-gray-200 rounded-sm hover:bg-gray-50 font-medium transition text-gray-600 flex items-center gap-1.5">
              <Bell size={14} className="text-gray-400" /> Reminder
            </button>
            <button onClick={() => setShowSmtp(true)}
              className="px-4 py-2 text-sm bg-white border border-gray-200 rounded-sm hover:bg-gray-50 font-medium transition text-gray-600">
              SMTP Settings
            </button>
            <button onClick={() => setShowImport(true)}
              className="px-4 py-2 text-sm bg-white border border-gray-200 rounded-sm hover:bg-gray-50 font-medium transition text-gray-600">
              Import CSV / Excel
            </button>
            <button onClick={handleExport}
              className="px-4 py-2 text-sm bg-white border border-gray-200 rounded-sm hover:bg-gray-50 font-medium transition text-gray-600">
              Download Excel
            </button>
            <button onClick={openAdd}
              className="px-4 py-2 text-sm bg-brand-600 text-white rounded-sm hover:bg-brand-700 font-semibold transition">
              + Add Contact
            </button>
          </div>
        </div>

        {/* ── Bulk action bar ──────────────────────────────────────────── */}
        {selected.length > 0 && (
          <div className="bg-brand-50 border border-brand-200 rounded-md px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold text-brand-700">{selected.length} selected</span>
            <select
              defaultValue=""
              onChange={e => { if (e.target.value) { handleBulkStatus(e.target.value); e.target.value = ''; } }}
              className="border border-gray-200 rounded-sm px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-brand-300 outline-none"
            >
              <option value="" disabled>Change status to…</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={handleBulkCompose}
              className={`px-3 py-1.5 rounded-sm text-sm font-medium transition flex items-center gap-1.5 ${
                user ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
              }`}
            >
              {!user && <Lock size={12} />}
              <MailCheck size={13} /> Compose for {selected.length}
            </button>
            <button onClick={handleBulkDelete}
              className="text-red-600 hover:text-red-800 font-medium">
              Delete Selected
            </button>
            <button onClick={() => setSelected([])}
              className="ml-auto text-gray-400 hover:text-gray-600 text-xs underline">
              Clear selection
            </button>
          </div>
        )}

        <ContactTable
          contacts={contacts}
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
        </>}

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
            if (pendingTabRef.current) { setActiveTab(pendingTabRef.current); pendingTabRef.current = null; }
          }}
          onLeave={() => {
            // Discard all profile drafts and navigate
            ['profile:overview', 'profile:links', 'profile:hero'].forEach(k => clearDraft(k));
            setShowUnsavedModal(false);
            profileDirtyRef.current = false;
            if (pendingTabRef.current) { setActiveTab(pendingTabRef.current); pendingTabRef.current = null; }
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
