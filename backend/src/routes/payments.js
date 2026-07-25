const router   = require('express').Router();
const crypto   = require('crypto');
const Razorpay = require('razorpay');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const database = require('../db/database');
const { randomUUID } = require('crypto');

const RZP_KEY_ID     = process.env.RAZORPAY_KEY_ID     || '';
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const PLAN_IDS = {
  basic:    process.env.RAZORPAY_BASIC_PLAN_ID    || '',
  advanced: process.env.RAZORPAY_ADVANCED_PLAN_ID || '',
};

function getRazorpay() {
  if (!RZP_KEY_ID || !RZP_KEY_SECRET) throw new Error('Razorpay keys not configured');
  return new Razorpay({ key_id: RZP_KEY_ID, key_secret: RZP_KEY_SECRET });
}

// ── GET /api/payments/config ─────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json({
    keyId:      RZP_KEY_ID,
    plans: {
      basic:    { planId: PLAN_IDS.basic,    name: 'Basic',    price: '₹299/mo', amount: 29900 },
      advanced: { planId: PLAN_IDS.advanced, name: 'Advanced', price: '₹599/mo', amount: 59900 },
    },
    configured: !!(RZP_KEY_ID && RZP_KEY_SECRET),
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

// ── POST /api/payments/create-subscription ───────────────────────────────────
// Creates a Razorpay subscription and returns the subscription_id for the frontend
router.post('/create-subscription', requireAuth, async (req, res) => {
  try {
    const rzp = getRazorpay();
    const { plan } = req.body;

    if (!PLAN_IDS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Must be basic or advanced.' });
    }
    if (!PLAN_IDS[plan]) {
      return res.status(400).json({ error: `Razorpay plan ID for "${plan}" not configured. Set RAZORPAY_${plan.toUpperCase()}_PLAN_ID in .env` });
    }

    const user = await database.prepare('SELECT email, name FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const subscription = await rzp.subscriptions.create({
      plan_id:         PLAN_IDS[plan],
      customer_notify: 1,
      total_count:     120, // allow up to 10 years of renewals
      notes: {
        userId: req.user.userId,
        plan,
        userEmail: user.email,
      },
    });

    res.json({
      subscriptionId: subscription.id,
      plan,
      keyId: RZP_KEY_ID,
      prefill: { name: user.name, email: user.email },
    });
  } catch (e) {
    console.error('[Payments] Create subscription error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payments/verify ────────────────────────────────────────────────
// Called by frontend after Razorpay checkout success to verify signature + activate plan
router.post('/verify', requireAuth, async (req, res) => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature, plan } = req.body;
  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment details' });
  }

  // Verify HMAC signature
  const body     = razorpay_payment_id + '|' + razorpay_subscription_id;
  const expected = crypto.createHmac('sha256', RZP_KEY_SECRET).update(body).digest('hex');
  if (expected !== razorpay_signature) {
    console.error('[Payments] Signature mismatch');
    return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
  }

  try {
    const userId    = req.user.userId;
    const planName  = plan || 'basic';
    const now       = new Date().toISOString().slice(0, 19);

    await database.prepare('UPDATE users SET plan = ? WHERE id = ?').run(planName, userId);
    await database.prepare(`
      INSERT INTO subscriptions
        (id, user_id, razorpay_subscription_id, razorpay_payment_id, plan, status, current_period_end, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        razorpay_subscription_id = EXCLUDED.razorpay_subscription_id,
        razorpay_payment_id      = EXCLUDED.razorpay_payment_id,
        plan                     = EXCLUDED.plan,
        status                   = 'active',
        current_period_end       = EXCLUDED.current_period_end,
        updated_at               = EXCLUDED.updated_at
    `).run(
      randomUUID(), userId,
      razorpay_subscription_id, razorpay_payment_id,
      planName,
      // Approximate next period end: 1 month from now
      new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 19),
      now
    );

    console.log(`[Payments] Plan activated: user=${userId} plan=${planName}`);
    res.json({ success: true, plan: planName });
  } catch (e) {
    console.error('[Payments] Verify error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payments/cancel ─────────────────────────────────────────────────
// Cancel the user's active Razorpay subscription
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const sub = await database.prepare(
      'SELECT razorpay_subscription_id FROM subscriptions WHERE user_id = ?'
    ).get(req.user.userId);

    if (!sub?.razorpay_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const rzp = getRazorpay();
    await rzp.subscriptions.cancel(sub.razorpay_subscription_id, true); // cancel at cycle end

    const now = new Date().toISOString().slice(0, 19);
    await database.prepare(
      "UPDATE subscriptions SET status = 'cancelled', updated_at = ? WHERE user_id = ?"
    ).run(now, req.user.userId);

    res.json({ success: true });
  } catch (e) {
    console.error('[Payments] Cancel error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payments/webhook ───────────────────────────────────────────────
// Razorpay webhook — raw body required for HMAC verification
async function webhookHandler(req, res) {
  if (!RZP_WEBHOOK_SECRET) {
    return res.status(400).json({ error: 'Webhook secret not configured' });
  }

  const rawBody = req.rawBody || JSON.stringify(req.body);
  const sig     = req.headers['x-razorpay-signature'];
  const expected = crypto.createHmac('sha256', RZP_WEBHOOK_SECRET).update(rawBody).digest('hex');

  if (expected !== sig) {
    console.error('[Payments] Webhook signature mismatch');
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const event = req.body;
  const type  = event.event;
  console.log('[Payments] Webhook:', type);

  try {
    if (type === 'subscription.activated' || type === 'subscription.charged') {
      const sub    = event.payload?.subscription?.entity;
      const payment = event.payload?.payment?.entity;
      const userId = sub?.notes?.userId;
      const plan   = sub?.notes?.plan;

      if (userId && plan) {
        const now = new Date().toISOString().slice(0, 19);
        await database.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
        await database.prepare(`
          INSERT INTO subscriptions
            (id, user_id, razorpay_subscription_id, razorpay_payment_id, plan, status, current_period_end, updated_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
          ON CONFLICT (user_id) DO UPDATE SET
            razorpay_subscription_id = EXCLUDED.razorpay_subscription_id,
            razorpay_payment_id      = EXCLUDED.razorpay_payment_id,
            plan      = EXCLUDED.plan,
            status    = 'active',
            current_period_end = EXCLUDED.current_period_end,
            updated_at = EXCLUDED.updated_at
        `).run(
          randomUUID(), userId,
          sub.id, payment?.id || null,
          plan,
          sub.current_end ? new Date(sub.current_end * 1000).toISOString().slice(0, 19) : null,
          now
        );
        console.log(`[Payments] Subscription activated: user=${userId} plan=${plan}`);
      }
    }

    if (type === 'subscription.cancelled' || type === 'subscription.halted') {
      const sub    = event.payload?.subscription?.entity;
      const userId = sub?.notes?.userId;
      const now    = new Date().toISOString().slice(0, 19);

      await database.prepare(
        "UPDATE subscriptions SET status = ?, updated_at = ? WHERE razorpay_subscription_id = ?"
      ).run(type === 'subscription.halted' ? 'halted' : 'cancelled', now, sub?.id);

      if (userId) {
        await database.prepare("UPDATE users SET plan = 'demo' WHERE id = ?").run(userId);
        console.log(`[Payments] Subscription ${type}: user=${userId} → demo`);
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error('[Payments] Webhook handler error:', e.message);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

// ── Admin routes ──────────────────────────────────────────────────────────────

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

// POST /api/payments/webhook — must be mounted on raw body (index.js preserves rawBody)
router.post('/webhook', webhookHandler);

module.exports = router;
