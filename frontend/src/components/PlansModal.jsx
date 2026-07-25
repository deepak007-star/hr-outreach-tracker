import { useState, useEffect, useCallback } from 'react';
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

// Load Razorpay checkout script once
function loadRazorpayScript() {
  return new Promise(resolve => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function PlansModal({ onClose, onSignupClick }) {
  const { user, refreshUser } = useAuth();
  const currentId = user ? (user.plan || 'demo') : 'guest';

  const [config,         setConfig]         = useState(null);
  const [subscription,   setSubscription]   = useState(null);
  const [upgrading,      setUpgrading]      = useState(null);
  const [cancelling,     setCancelling]     = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      api.get('/payments/config'),
      api.get('/payments/subscription'),
    ]).then(([cfg, sub]) => {
      setConfig(cfg);
      setSubscription(sub.subscription);
    }).catch(() => {});
  }, [user]);

  const handleUpgrade = useCallback(async (planId) => {
    if (!user) { onSignupClick?.(); return; }
    if (!config?.configured) {
      toast.error('Payment gateway not configured yet. Contact the admin.');
      return;
    }

    setUpgrading(planId);
    try {
      // Step 1 — create order on backend
      const data = await api.post('/payments/create-order', { plan: planId });

      // Step 2 — load Razorpay script
      const loaded = await loadRazorpayScript();
      if (!loaded) { toast.error('Could not load payment gateway. Check your connection.'); return; }

      // Step 3 — open Razorpay modal
      await new Promise((resolve, reject) => {
        const options = {
          key:      data.keyId,
          order_id: data.orderId,
          amount:   data.amount,
          currency: data.currency,
          name:     data.name,
          description: data.description,
          image:    '/favicon.svg',
          handler: async (response) => {
            // Step 4 — verify on backend
            try {
              const result = await api.post('/payments/verify', {
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
                plan: planId,
              });
              if (result.success) {
                toast.success(`${planId.charAt(0).toUpperCase() + planId.slice(1)} plan activated!`);
                refreshUser?.();
                setSubscription(s => ({ ...s, plan: planId, status: 'active' }));
                onClose();
              }
              resolve();
            } catch (e) {
              toast.error(e?.response?.data?.error || 'Payment verification failed');
              reject(e);
            }
          },
          prefill: { name: data.prefill?.name || '', email: data.prefill?.email || '' },
          theme:   { color: '#4f46e5' },
          modal: {
            ondismiss: () => {
              toast('Payment cancelled.', { icon: 'ℹ️' });
              resolve();
            },
          },
        };
        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', (resp) => {
          toast.error(`Payment failed: ${resp.error?.description || 'Unknown error'}`);
          resolve();
        });
        rzp.open();
      });
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not start checkout. Try again.');
    } finally {
      setUpgrading(null);
    }
  }, [user, config, onSignupClick, onClose, refreshUser]);

  const handleCancel = useCallback(async () => {
    if (!window.confirm('Cancel your subscription? You\'ll keep access until the end of the billing period.')) return;
    setCancelling(true);
    try {
      await api.post('/payments/cancel');
      toast.success('Subscription cancelled. Access continues until period end.');
      setSubscription(s => ({ ...s, status: 'cancelled' }));
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not cancel subscription.');
    } finally {
      setCancelling(false);
    }
  }, []);

  const isConfigured = config?.configured;

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
              btnLabel    = upgrading === plan.id ? 'Loading…' : plan.btnLabel;
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
                  {plan.btnAction === 'upgrade' && !isConfigured && !isCurrent && (
                    <p className="text-center text-[10px] text-amber-500 mt-1">Payment setup pending</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Active subscription management */}
        {subscription && subscription.status === 'active' && ['basic', 'advanced'].includes(currentId) && (
          <div className="mx-5 mb-3 p-3 bg-gray-50 border border-gray-200 rounded-md flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-700">Active Subscription</p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {subscription.plan?.charAt(0).toUpperCase() + subscription.plan?.slice(1)} plan
                {subscription.current_period_end && ` · Renews ${new Date(subscription.current_period_end).toLocaleDateString('en-IN')}`}
              </p>
            </div>
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="text-xs text-red-500 hover:text-red-700 font-medium underline underline-offset-2 disabled:opacity-60"
            >
              {cancelling ? 'Cancelling…' : 'Cancel Plan'}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 pb-4 text-center border-t pt-3">
          <p className="text-[10px] text-gray-400">
            {isConfigured
              ? 'Secure payments via Razorpay · UPI, Cards, Net Banking · Cancel anytime · GST may apply'
              : 'Payment gateway not configured yet · Contact admin to enable payments'}
          </p>
          {isConfigured && (
            <p className="text-[10px] text-gray-300 mt-1">
              Powered by Razorpay — trusted by 10M+ Indian businesses
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
