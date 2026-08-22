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

// Constant-time HMAC comparison — plain `===`/`!==` on strings short-circuits
// at the first differing character, which leaks a timing signal an attacker
// could in principle use to guess a valid signature byte-by-byte against a
// real payment-verification endpoint. crypto.timingSafeEqual takes the same
// time regardless of where the buffers diverge; it throws on a length
// mismatch (an attacker-controlled signature could be any length), so that's
// treated as "not equal" rather than allowed to crash the request.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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
    const msg = e.message || e.error?.description || 'Razorpay order creation failed';
    console.error('[Payments] Create order error:', e.statusCode, msg);
    if (e.statusCode === 401) {
      return res.status(503).json({ error: 'Razorpay API key authentication failed. Please update RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env.' });
    }
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/payments/verify ────────────────────────────────────────────────
// Called after Razorpay checkout success — verifies HMAC and activates plan
router.post('/verify', requireAuth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment details' });
  }

  // Razorpay Orders signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret)
  const body     = razorpay_order_id + '|' + razorpay_payment_id;
  const expected = crypto.createHmac('sha256', RZP_KEY_SECRET).update(body).digest('hex');
  if (!safeEqual(expected, razorpay_signature)) {
    console.error('[Payments] Signature mismatch');
    return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
  }

  try {
    const userId = req.user.userId;

    // The signature only proves order_id+payment_id are a genuine paid pair —
    // it says nothing about which plan was actually paid for. Never trust a
    // client-supplied `plan`; re-fetch the order from Razorpay and read the
    // plan from `order.notes.plan`, set server-side at /create-order time and
    // immutable via the Razorpay API. Also confirms the order belongs to this
    // user, so a leaked order_id/payment_id/signature can't be replayed by
    // someone else to upgrade their own account.
    const rzp   = getRazorpay();
    const order = await rzp.orders.fetch(razorpay_order_id);
    if (String(order.notes?.userId) !== String(userId)) {
      console.error('[Payments] Order/user mismatch on verify', { orderId: razorpay_order_id, userId });
      return res.status(403).json({ error: 'This payment does not belong to your account' });
    }
    const planName = PLAN_AMOUNTS[order.notes?.plan] ? order.notes.plan : null;
    if (!planName || order.amount !== PLAN_AMOUNTS[planName]) {
      console.error('[Payments] Amount/plan mismatch on verify', { orderId: razorpay_order_id, amount: order.amount, plan: order.notes?.plan });
      return res.status(400).json({ error: 'Order amount does not match plan' });
    }

    const now = new Date().toISOString().slice(0, 19);

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
    const msg = e.message || e.error?.description || 'Payment verification failed';
    console.error('[Payments] Verify error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/payments/cancel ─────────────────────────────────────────────────
// Marks subscription cancelled but keeps the plan active until current_period_end.
// The expiry downgrade job (index.js) or /auth/me check will drop plan to demo at expiry.
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const now = new Date().toISOString().slice(0, 19);
    const result = await database.prepare(
      "UPDATE subscriptions SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND status = 'active'"
    ).run(now, req.user.userId);
    if (result.changes === 0) {
      return res.status(400).json({ error: 'No active subscription found to cancel.' });
    }
    // Do NOT downgrade plan here — user keeps access until current_period_end
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

  if (!safeEqual(expected, sig)) {
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
        // Razorpay can redeliver the SAME payment.captured event (webhook
        // retries on transient failures on either side) — without this
        // guard, every redelivery recomputes current_period_end as
        // "now + 30 days" and pushes the expiry out again, handing out
        // free subscription time nobody actually paid for. payment.id is
        // unique per real payment; skip if this exact payment was already
        // applied to this user's subscription.
        const existing = await database.prepare(
          'SELECT razorpay_payment_id FROM subscriptions WHERE user_id = ?'
        ).get(userId);
        if (existing?.razorpay_payment_id === payment.id) {
          console.log(`[Payments] payment.captured: user=${userId} payment=${payment.id} already applied — skipping redelivery`);
        } else {
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
    } else if (type === 'payment.failed') {
      // Auto-renewal failed (expired card, insufficient funds, etc). Don't
      // downgrade immediately — Razorpay retries failed renewals — but flag it
      // so the user can fix their payment method before access actually lapses.
      const payment = event.payload?.payment?.entity;
      const userId  = payment?.notes?.userId;
      if (userId) {
        const now = new Date().toISOString().slice(0, 19);
        await database.prepare(
          "UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE user_id = ?"
        ).run(now, userId);
        await database.prepare(
          `INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'warning', ?, ?)`
        ).run(
          randomUUID(), userId,
          'Payment failed',
          'Your recent subscription payment failed. Please update your payment method in Plans to avoid losing access.'
        );
        console.log(`[Payments] payment.failed: user=${userId}`);
      }
    } else if (type === 'refund.processed' || type === 'refund.created') {
      // A refund means the user got their money back — downgrade immediately
      // rather than waiting for the (now-meaningless) current_period_end.
      const refund  = event.payload?.refund?.entity;
      const payment = event.payload?.payment?.entity;
      const userId  = payment?.notes?.userId || refund?.notes?.userId;
      if (userId) {
        const now = new Date().toISOString().slice(0, 19);
        await database.prepare(
          "UPDATE subscriptions SET status = 'refunded', updated_at = ? WHERE user_id = ?"
        ).run(now, userId);
        await database.prepare("UPDATE users SET plan = 'demo' WHERE id = ?").run(userId);
        console.log(`[Payments] refund processed: user=${userId} — downgraded to demo`);
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

// Plan overrides live at admin.js's PUT /api/admin/users/:id/plan — this used
// to be a second, duplicate endpoint that only touched users.plan (never the
// subscriptions row), so a change made here got silently reverted the next
// time the expiry-downgrade job or /auth/me ran. Removed rather than kept in
// sync with two copies of the same logic; nothing in the frontend called this
// path (it called admin.js's route directly).

// POST /api/payments/webhook — must be mounted on raw body (index.js preserves rawBody)
router.post('/webhook', webhookHandler);

module.exports = router;
