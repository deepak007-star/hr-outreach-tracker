import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import GmailConnectCard  from './GmailConnectCard.jsx';
import GmailEmailList    from './GmailEmailList.jsx';
import LinkedInPosts     from './LinkedInPosts.jsx';
import FeedContactsPanel from './FeedContactsPanel.jsx';

const SUB_TABS = [
  { id: 'gmail',    label: '📧 Gmail Tracking',   desc: 'Emails sent to HRs tracked from your Gmail' },
  { id: 'linkedin', label: '💼 LinkedIn Feed',     desc: 'HR hiring posts from LinkedIn feed scraper' },
];

export default function ColdEmailSection() {
  const { user } = useAuth();
  const [subTab,       setSubTab]       = useState('gmail');
  const [gmailRefresh, setGmailRefresh] = useState(0);
  const [gmailStatus,  setGmailStatus]  = useState(null);

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="bg-gradient-to-r from-brand-600 to-brand-700 rounded-md p-5 text-white">
        <h2 className="text-lg font-bold">Cold Emailing & Contacts</h2>
        <p className="text-blue-100 text-sm mt-0.5">
          Track your HR outreach emails, monitor reply status, and find new contacts from LinkedIn feeds.
        </p>
        {gmailStatus?.connected && (
          <div className="mt-2 inline-flex items-center gap-2 bg-white/20 text-white text-xs font-medium px-3 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-green-300 inline-block" />
            Gmail connected · {gmailStatus.gmailEmail}
          </div>
        )}
      </div>

      {/* Gmail connect card */}
      <GmailConnectCard
        onStatusChange={s => {
          setGmailStatus(s);
          if (s?.synced) setGmailRefresh(r => r + 1);
        }}
      />

      {/* Sub-tab switcher */}
      <div className="flex gap-1 border-b bg-white rounded-t-xl px-2 pt-1 -mb-1">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              subTab === tab.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            title={tab.desc}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Gmail Tracking tab ──────────────────────────────────────────────── */}
      {subTab === 'gmail' && (
        <div className="bg-white rounded-b-md rounded-tr-md border border-t-0 p-4 space-y-6">
          {!user ? (
            <div className="text-center py-10 text-gray-500">
              <p className="text-3xl mb-2">🔒</p>
              <p className="text-sm">Sign in to view your Gmail outreach tracking</p>
            </div>
          ) : (
            <>
              <GmailEmailList refreshKey={gmailRefresh} myName={user?.name || ''} />

              {/* ── Auto-synced LinkedIn Feed contacts ───────────────────── */}
              <div className="border-t pt-5 space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-800 text-sm">
                    💼 LinkedIn Feed Contacts
                  </h3>
                  <span className="text-xs bg-brand-50 text-brand-700 border border-brand-100 px-2 py-0.5 rounded-full font-medium">
                    Auto-synced
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  Email contacts found by the LinkedIn Feed scraper. Updated automatically — no manual import needed.
                  Select one or many and send individual emails directly.
                </p>
                <FeedContactsPanel />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── LinkedIn Feed tab ────────────────────────────────────────────── */}
      {subTab === 'linkedin' && (
        <div className="bg-white rounded-b-md rounded-tr-md border border-t-0 p-4">
          <LinkedInPosts />
        </div>
      )}
    </div>
  );
}
