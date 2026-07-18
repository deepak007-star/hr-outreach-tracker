import { useAuth } from '../contexts/AuthContext.jsx';

const PLANS = [
  {
    id: 'guest', name: 'Guest', price: 'Free', per: '',
    badge: null, color: 'border-gray-200', headerBg: 'bg-gray-50',
    btnCls: 'border border-gray-300 text-gray-600 hover:bg-gray-50',
    btnLabel: 'Sign Up Free', btnAction: 'signup',
    contacts: 5, emails: '—',
    features: ['5 real emails & apply links', 'View contact list (rest masked)', 'Activity calendar'],
    locked: ['Send emails', 'Job Analyzer', 'Profile', 'Excel export'],
  },
  {
    id: 'demo', name: 'Demo', price: 'Free', per: 'forever',
    badge: null, color: 'border-blue-300', headerBg: 'bg-blue-50',
    btnCls: 'bg-blue-600 text-white hover:bg-blue-700',
    btnLabel: 'Current Plan', btnAction: 'current',
    contacts: 10, emails: '10/day',
    features: ['10 real emails & apply links', 'Send up to 10 emails/day', 'Job Analyzer', 'Profile + resume autofill', 'Excel sync & calendar'],
    locked: ['Bulk compose', 'Priority support'],
  },
  {
    id: 'basic', name: 'Basic', price: '₹299', per: '/mo',
    badge: null, color: 'border-indigo-300', headerBg: 'bg-indigo-50',
    btnCls: 'bg-indigo-600 text-white hover:bg-indigo-700',
    btnLabel: 'Upgrade to Basic', btnAction: 'upgrade',
    contacts: 100, emails: '50/day',
    features: ['100 real emails & apply links', '50 emails/day', 'Bulk compose', 'Import 5,000 contacts', 'Everything in Demo'],
    locked: ['Priority support'],
  },
  {
    id: 'advanced', name: 'Advanced', price: '₹599', per: '/mo',
    badge: '🔥 Popular', color: 'border-purple-400 ring-2 ring-purple-200', headerBg: 'bg-gradient-to-br from-purple-50 to-indigo-50',
    btnCls: 'bg-purple-600 text-white hover:bg-purple-700',
    btnLabel: 'Upgrade to Advanced', btnAction: 'upgrade',
    contacts: '∞', emails: '200/day',
    features: ['Unlimited emails & apply links', '200 emails/day', 'Bulk compose', 'Unlimited contacts', 'Priority support', 'Advanced analytics'],
    locked: [],
  },
];

export default function PlansModal({ onClose, onSignupClick }) {
  const { user } = useAuth();
  const currentId = user ? (user.plan || 'demo') : 'guest';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">Choose Your Plan</h2>
            <p className="text-xs text-gray-500 mt-0.5">Unlock more contacts &amp; send more emails</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 text-lg font-bold transition"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Plan grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-5">
          {PLANS.map(plan => {
            const isCurrent = plan.id === currentId;
            let btnLabel = plan.btnLabel;
            let btnDisabled = false;
            let comingSoon = false;

            if (isCurrent) { btnLabel = '✓ Current'; btnDisabled = true; }
            else if (plan.btnAction === 'upgrade') { comingSoon = true; btnDisabled = true; }
            else if (plan.btnAction === 'signup') {
              btnLabel = currentId === 'guest' ? 'Sign Up Free →' : '✓ Signed In';
              btnDisabled = currentId !== 'guest';
            }

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-xl border-2 overflow-hidden ${plan.color} ${isCurrent ? 'shadow-md' : ''}`}
              >
                {plan.badge && (
                  <span className="absolute top-2 right-2 bg-purple-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {plan.badge}
                  </span>
                )}

                <div className={`${plan.headerBg} px-3 pt-3 pb-2`}>
                  <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">{plan.name}</p>
                  <div className="flex items-baseline gap-0.5 mt-1">
                    <span className="text-xl font-extrabold text-gray-900">{plan.price}</span>
                    {plan.per && <span className="text-xs text-gray-400">{plan.per}</span>}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {typeof plan.contacts === 'number' ? plan.contacts : '∞'} contacts · {plan.emails}
                  </p>
                </div>

                <div className="flex-1 px-3 py-2 space-y-1">
                  {plan.features.map(f => (
                    <div key={f} className="flex items-start gap-1.5 text-[10px] text-gray-700">
                      <span className="text-green-500 font-bold mt-px">✓</span><span>{f}</span>
                    </div>
                  ))}
                  {plan.locked.map(f => (
                    <div key={f} className="flex items-start gap-1.5 text-[10px] text-gray-300">
                      <span className="font-bold mt-px">✗</span><span>{f}</span>
                    </div>
                  ))}
                </div>

                <div className="px-3 pb-3">
                  <button
                    onClick={() => !btnDisabled && plan.btnAction === 'signup' && onSignupClick?.()}
                    disabled={btnDisabled}
                    className={`w-full py-1.5 rounded-lg text-xs font-semibold transition ${plan.btnCls} ${btnDisabled ? 'opacity-60 cursor-default' : ''}`}
                  >
                    {btnLabel}
                  </button>
                  {comingSoon && <p className="text-center text-[10px] text-gray-400 mt-1">Payment coming soon</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 text-center border-t pt-3">
          <p className="text-[10px] text-gray-400">
            No payment gateway active yet · Pricing subject to change ·{' '}
            <span className="text-blue-500">Interested in early access? Fill the form above.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
