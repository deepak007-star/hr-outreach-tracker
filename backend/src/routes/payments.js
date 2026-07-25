const router  = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const database = require('../db/database');
const { randomUUID } = require('crypto');

const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY    || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Lazy-init stripe so missing key doesn't crash startup
function getStripe() {
  if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
  return require('stripe')(STRIPE_SECRET_KEY);
}

const PLAN_PRICE_IDS = {
  basic:    process.env.STRIPE_BASIC_PRICE_ID    || '',
  advanced: process.env.STRIPE_ADVANCED_PRICE_ID || '',
};

// ── GET /api/payments/config ─────────────────────────────────────────────────
// Returns publishable key and plan price IDs for the frontend
router.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    plans: {
      basic:    { priceId: PLAN_PRICE_IDS.basic,    name: 'Basic',    price: '₹299/mo' },
      advanced: { priceId: PLAN_PRICE_IDS.advanced, name: 'Advanced', price: '₹599/mo' },
    },
    configured: !!STRIPE_SECRET_KEY,
  });
});

// ── GET /api/payments/subscription ──────────────────────────────────────────
router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const sub = await database.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ?'
    ).get(req.user.userId);
    res.json({ subscription: sub || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payments/create-checkout ──────────────────────────────────────
router.post('/create-checkout', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const { plan } = req.body;

    if (!PLAN_PRICE_IDS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Must be basic or advanced.' });
    }

    const user = await database.prepare('SELECT email, name FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: PLAN_PRICE_IDS[plan], quantity: 1 }],
      mode: 'subscription',
      customer_email: user.email,
      success_url: `${frontendUrl}?payment=success&plan=${plan}`,
      cancel_url:  `${frontendUrl}?payment=cancelled`,
      metadata: { userId: req.user.userId, plan },
      subscription_data: {
        metadata: { userId: req.user.userId, plan },
      },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error('[Payments] Checkout error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payments/manage ────────────────────────────────────────────────
// Creates a Stripe Billing Portal session so the user can manage/cancel
router.post('/manage', requireAuth, async (req, res) => {
  try {
    const stripe = getStripe();
    const sub = await database.prepare(
      'SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?'
    ).get(req.user.userId);

    if (!sub?.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   sub.stripe_customer_id,
      return_url: frontendUrl,
    });

    res.json({ url: portalSession.url });
  } catch (e) {
    console.error('[Payments] Portal error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payments/webhook ───────────────────────────────────────────────
// Raw body required — must be mounted BEFORE express.json() in index.js
// We export a dedicated handler so index.js can wire it with express.raw()
async function webhookHandler(req, res) {
  if (!STRIPE_SECRET_KEY) {
    return res.status(400).json({ error: 'Stripe not configured' });
  }

  const stripe = getStripe();
  const sig    = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody || req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[Payments] Webhook signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session  = event.data.object;
      const { userId, plan } = session.metadata || {};
      if (userId && plan) {
        await database.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
        await database.prepare(`
          INSERT INTO subscriptions
            (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end)
          VALUES (?, ?, ?, ?, ?, 'active', ?)
          ON CONFLICT (user_id) DO UPDATE SET
            stripe_customer_id     = EXCLUDED.stripe_customer_id,
            stripe_subscription_id = EXCLUDED.stripe_subscription_id,
            plan                   = EXCLUDED.plan,
            status                 = 'active',
            current_period_end     = EXCLUDED.current_period_end,
            updated_at             = now()
        `).run(
          randomUUID(), userId,
          session.customer, session.subscription,
          plan,
          session.expires_at ? new Date(session.expires_at * 1000).toISOString().slice(0,19) : null
        );
        console.log(`[Payments] Plan updated: user=${userId} plan=${plan}`);
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const sub    = event.data.object;
      const userId = sub.metadata?.userId;
      const plan   = sub.metadata?.plan;
      if (userId) {
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString().slice(0,19) : null;
        await database.prepare(`
          UPDATE subscriptions SET status = ?, current_period_end = ?, updated_at = ?
          WHERE stripe_subscription_id = ?
        `).run(sub.status, periodEnd, new Date().toISOString().slice(0,19), sub.id);
        if (plan) {
          await database.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await database.prepare(`
        UPDATE subscriptions SET status = 'cancelled', updated_at = ? WHERE stripe_subscription_id = ?
      `).run(new Date().toISOString().slice(0,19), sub.id);

      const subRow = await database.prepare(
        'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?'
      ).get(sub.id);
      if (subRow) {
        await database.prepare("UPDATE users SET plan = 'demo' WHERE id = ?").run(subRow.user_id);
        console.log(`[Payments] Subscription cancelled: user=${subRow.user_id} → demo plan`);
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      console.warn(`[Payments] Invoice payment failed: customer=${invoice.customer}`);
    }

    res.json({ received: true });
  } catch (e) {
    console.error('[Payments] Webhook handler error:', e.message);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

// Admin: list all subscriptions
router.get('/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const subs = await database.prepare(`
      SELECT s.*, u.email, u.name FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
    `).all();
    res.json({ subscriptions: subs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: manually update user plan (without Stripe, for testing)
router.put('/admin/plan/:userId', requireAuth, requireAdmin, async (req, res) => {
  const { plan } = req.body;
  const validPlans = ['guest', 'demo', 'basic', 'advanced'];
  if (!validPlans.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  try {
    await database.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, req.params.userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.webhookHandler = webhookHandler;
module.exports = router;
