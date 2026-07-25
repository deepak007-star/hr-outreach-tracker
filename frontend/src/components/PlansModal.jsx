import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../api/client.js';
import toast from 'react-hot-toast';

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
    badge: null, color: 'border-brand-300', headerBg: 'bg-brand-50',
    btnCls: 'bg-brand-600 text-white hover:bg-brand-700',
    btnLabel: 'Current Plan', btnAction: 'current',
    contacts: 10, emails: '10/day',
    features: ['10 real emails & apply links', 'Send up to 10 emails/day', 'Job Analyzer', 'Profile + resume autofill', 'Excel sync & calendar'],
    locked: ['Bulk compose', 'Priority support'],
  },
  {
    id: 'basic', name: 'Basic', price: '₹299', per: '/mo',
    badge: null, color: 'border-brand-300', headerBg: 'bg-brand-50',
    btnCls: 'bg-brand-600 text-white hover:bg-brand-700',
    btnLabel: 'Upgrade to Basic', btnAction: 'upgrade',
    contacts: 100, emails: '50/day',
    features: ['100 real emails & apply links', '50 emails/day', 'Bulk compose', 'Import 5,000 contacts', 'Everything in Demo'],
    locked: ['Priority support'],
  },
  {
    id: 'advanced', name: 'Advanced', price: '₹599', per: '/mo',
    badge: 'Popular', color: 'border-purple-400 ring-2 ring-purple-200', headerBg: 'bg-gradient-to-br from-purple-50 to-indigo-50',
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

  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [upgrading, setUpgrading]               = useState(null); // plan id being upgraded
  const [subscription, setSubscription]         = useState(null);
  const [managingBilling, setManagingBilling]   = useState(false);

  useEffect(() => {
    if (!user) return;
    // Check if Stripe is configured
    api.get('/payments/config').then(data => {
      setStripeConfigured(data.configured);
    }).catch(() => {});

    // Load current subscription info
    api.get('/payments/subscription').then(data => {
      setSubscription(data.subscription);
    }).catch(() => {});
  }, [user]);

  async function handleUpgrade(planId) {
    if (!user) { onSignupClick?.(); return; }
    if (!stripeConfigured) {
      toast.error('Payment gateway not configured yet. Contact the admin.');
      return;
    }
    setUpgrading(planId);
    try {
      const data = await api.post('/payments/create-checkout', { plan: planId });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not start checkout. Try again.');
    } finally {
      setUpgrading(null);
    }
  }

  async function handleManageBilling() {
    setManagingBilling(true);
    try {
      const data = await api.post('/payments/manage');
      if (data.url) window.open(data.url, '_blank');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not open billing portal.');
    } finally {
      setManagingBilling(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-md shadow-modal w-full max-w-3xl max-h-[90vh] overflow-y-auto"
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
            let btnLabel    = plan.btnLabel;
            let btnDisabled = false;
            let btnOnClick  = null;

            if (isCurrent) {
              btnLabel    = '✓ Current';
              btnDisabled = true;
            } else if (plan.btnAction === 'upgrade') {
              btnLabel    = upgrading === plan.id ? 'Redirecting…' : plan.btnLabel;
              btnDisabled = !!upgrading;
              btnOnClick  = () => handleUpgrade(plan.id);
            } else if (plan.btnAction === 'signup') {
              btnLabel    = currentId === 'guest' ? 'Sign Up Free →' : '✓ Signed In';
              btnDisabled = currentId !== 'guest';
              btnOnClick  = () => { if (currentId === 'guest') onSignupClick?.(); };
            }

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-md border-2 overflow-hidden ${plan.color} ${isCurrent ? 'shadow-card' : ''}`}
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
                    onClick={btnOnClick}
                    disabled={btnDisabled}
                    className={`w-full py-1.5 rounded-sm text-xs font-semibold transition ${plan.btnCls} ${btnDisabled ? 'opacity-60 cursor-default' : ''}`}
                  >
                    {btnLabel}
                  </button>
                  {plan.btnAction === 'upgrade' && !stripeConfigured && !isCurrent && (
                    <p className="text-center text-[10px] text-amber-500 mt-1">Payment setup pending</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Manage billing for paying users */}
        {subscription && subscription.status === 'active' && ['basic', 'advanced'].includes(currentId) && (
          <div className="mx-5 mb-3 p-3 bg-gray-50 border border-gray-200 rounded-md flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-700">Active Subscription</p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {subscription.plan?.charAt(0).toUpperCase() + subscription.plan?.slice(1)} plan
                {subscription.current_period_end && ` · Renews ${new Date(subscription.current_period_end).toLocaleDateString()}`}
              </p>
            </div>
            <button
              onClick={handleManageBilling}
              disabled={managingBilling}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium underline underline-offset-2 disabled:opacity-60"
            >
              {managingBilling ? 'Loading…' : 'Manage Billing'}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 pb-4 text-center border-t pt-3">
          <p className="text-[10px] text-gray-400">
            {stripeConfigured
              ? 'Secure payments via Stripe · Cancel anytime · GST may apply'
              : 'Payment gateway not configured yet · Contact admin to enable payments'}
          </p>
        </div>
      </div>
    </div>
  );
}
