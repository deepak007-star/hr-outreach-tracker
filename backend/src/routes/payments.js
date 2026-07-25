const router   = require('express').Router();
const crypto   = require('crypto');
const Razorpay = require('razorpay');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const database = require('../db/database');
const { randomUUID } = require('crypto');

const RZP_KEY_ID         = process.env.RAZORPAY_KEY_ID         || '';
const RZP_KEY_SECRET     = process.env.RAZORPAY_KEY_SECRET     || '';
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

// Amounts in paise (INR × 100)
const PLAN_AMOUNTS = { basic: 29900, advanced: 59900 };
const PLAN_LABELS  = { basic: 'Basic — ₹299', advanced: 'Advanced — ₹599' };

function getRazorpay() {
  if (!RZP_KEY_ID || !RZP_KEY_SECRET) throw new Error('Razorpay keys not configured');
  return new Razorpay({ key_id: RZP_KEY_ID, key_secret: RZP_KEY_SECRET });
}

// ── GET /api/payments/config ─────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json({
    keyId: RZP_KEY_ID,
    plans: {
      basic:    { name: 'Basic',    price: '₹299/mo', amount: PLAN_AMOUNTS.basic },
      advanced: { name: 'Advanced', price: '₹599/mo', amount: PLAN_AMOUNTS.advanced },
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

// ── POST /api/payments/create-order ─────────────────────────────────────────
// Creates a Razorpay order and returns order_id for inline checkout
router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLAN_AMOUNTS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Must be basic or advanced.' });
    }

    const user = await database.prepare('SELECT email, name FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rzp = getRazorpay();
    const order = await rzp.orders.create({
      amount:   PLAN_AMOUNTS[plan],
      currency: 'INR',
      receipt:  `rcpt_${req.user.userId.slice(0, 8)}_${Date.now()}`,
      notes: {
        userId:    String(req.user.userId),
        plan,
        userEmail: user.email,
      },
    });

    res.json({
      orderId:     order.id,
      keyId:       RZP_KEY_ID,
      amount:      order.amount,
      currency:    order.currency,
      plan,
      name:        'HR Outreach Tracker',
      description: `${PLAN_LABELS[plan]}/month`,
      prefill:     { name: user.name, email: user.email },
    });
  } catch (e) {
    console.error('[Payments] Create order error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/payments/verify ────────────────────────────────────────────────
// Called after Razorpay checkout success — verifies HMAC and activates plan
router.post('/verify', requireAuth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment details' });
  }

  // Razorpay Orders signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret)
  const body     = razorpay_order_id + '|' + razorpay_payment_id;
  const expected = crypto.createHmac('sha256', RZP_KEY_SECRET).update(body).digest('hex');
  if (expected !== razorpay_signature) {
    console.error('[Payments] Signature mismatch');
    return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
  }

  try {
    const userId   = req.user.userId;
    const planName = plan || 'basic';
    const now      = new Date().toISOString().slice(0, 19);

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
      razorpay_order_id, razorpay_payment_id,
      planName,
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
// Downgrades the user to demo — no API call needed (one-time orders, not subscriptions)
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const now = new Date().toISOString().slice(0, 19);
    await database.prepare(
      "UPDATE subscriptions SET status = 'cancelled', updated_at = ? WHERE user_id = ?"
    ).run(now, req.user.userId);
    await database.prepare("UPDATE users SET plan = 'demo' WHERE id = ?").run(req.user.userId);
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
    if (type === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      const userId  = payment?.notes?.userId;
      const plan    = payment?.notes?.plan;

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
            plan                     = EXCLUDED.plan,
            status                   = 'active',
            current_period_end       = EXCLUDED.current_period_end,
            updated_at               = EXCLUDED.updated_at
        `).run(
          randomUUID(), userId,
          payment.order_id || null, payment.id,
          plan,
          new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 19),
          now
        );
        console.log(`[Payments] payment.captured: user=${userId} plan=${plan}`);
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
