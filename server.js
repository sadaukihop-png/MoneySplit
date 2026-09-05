const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow the static frontend to call this API when it is hosted separately (e.g. GitHub Pages).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 3000;
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const APP_SECRET = process.env.APP_SECRET;

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FEEDBACK_ADMIN_SECRET = process.env.FEEDBACK_ADMIN_SECRET || APP_SECRET;

const vercelHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  process.env.VERCEL_URL;

const defaultPublicUrl = vercelHost
  ? `https://${vercelHost}`
  : 'http://localhost:3000';

const FRONTEND_URL =
  (process.env.FRONTEND_URL || defaultPublicUrl).replace(/\/$/, '');

const BACKEND_PUBLIC_URL =
  (process.env.BACKEND_PUBLIC_URL || defaultPublicUrl).replace(/\/$/, '');

if (!FLW_SECRET_KEY || !APP_SECRET) {
  console.warn('WARNING: Set FLW_SECRET_KEY and APP_SECRET environment variables before accepting payments.');
}

const PRICES = {
  NGN: { monthly: 1000, yearly: 5000 },
  USD: { monthly: 0.65, yearly: 3.25 },
  EUR: { monthly: 0.60, yearly: 3.00 },
  GBP: { monthly: 0.50, yearly: 2.50 },
  GHS: { monthly: 10, yearly: 50 },
  KES: { monthly: 85, yearly: 425 },
  ZAR: { monthly: 12, yearly: 60 }
};

const pending = new Map();
const used = new Set();

function sign(value) {
  return crypto.createHmac('sha256', APP_SECRET || 'missing-secret').update(value).digest('base64url');
}

function makeProof(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + sign(body);
}

function readProof(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !APP_SECRET) return null;
  const [body, sig] = parts;
  const expected = sign(body);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return null; }
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    paymentsConfigured: Boolean(FLW_SECRET_KEY && APP_SECRET),
    feedbackConfigured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  });
});

app.post('/api/create-payment', async (req, res) => {
  try {
    if (!FLW_SECRET_KEY || !APP_SECRET) {
      return res.status(500).json({ error: 'Payment server is not configured.' });
    }

    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const currency = String(req.body.currency || '').toUpperCase();
    const plan = String(req.body.plan || '').toLowerCase();

    if (!name) return res.status(400).json({ error: 'Full name is required.' });
    if (!validEmail(email)) return res.status(400).json({ error: 'A valid email is required.' });
    if (!PRICES[currency]) return res.status(400).json({ error: 'Unsupported currency.' });
    if (!['monthly', 'yearly'].includes(plan)) return res.status(400).json({ error: 'Invalid plan.' });

    const amount = PRICES[currency][plan];
    const tx_ref = 'MS-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex');

    pending.set(tx_ref, {
      amount,
      currency,
      plan,
      email: email.toLowerCase(),
      name,
      createdAt: Date.now()
    });

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FLW_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tx_ref,
        amount,
        currency,
        redirect_url: `${BACKEND_PUBLIC_URL}/payment-callback`,
        customer: { name, email },
        customizations: {
          title: 'MoneySplit Premium',
          description: `${plan === 'monthly' ? 'Monthly' : 'Yearly'} Plan`
        },
        meta: { product: 'MoneySplit Premium', plan }
      })
    });

    const data = await response.json();
    if (!response.ok || data.status !== 'success' || !data.data?.link) {
      pending.delete(tx_ref);
      console.error('Flutterwave create payment error:', data);
      return res.status(502).json({ error: 'Flutterwave could not create the payment.' });
    }

    res.json({ payment_link: data.data.link, tx_ref });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to start payment.' });
  }
});

app.get('/payment-callback', async (req, res) => {
  const { status, tx_ref, transaction_id } = req.query;
  const order = pending.get(tx_ref);

  if (status !== 'successful' || !tx_ref || !transaction_id || !order) {
    return res.redirect(`${FRONTEND_URL}/?payment=cancelled`);
  }

  if (used.has(tx_ref)) {
    return res.redirect(`${FRONTEND_URL}/?payment=already_processed`);
  }

  try {
    const response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transaction_id)}/verify`, {
      headers: {
        'Authorization': `Bearer ${FLW_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();
    const payment = result?.data;

    const amountMatches = Number(payment?.amount) >= Number(order.amount);
    const currencyMatches = payment?.currency === order.currency;
    const refMatches = payment?.tx_ref === tx_ref;
    const statusMatches = payment?.status === 'successful';
    const emailMatches = !payment?.customer?.email || payment.customer.email.toLowerCase() === order.email;

    if (!response.ok || !payment || !statusMatches || !amountMatches || !currencyMatches || !refMatches || !emailMatches) {
      console.error('Payment verification failed:', { result, order, transaction_id });
      return res.redirect(`${FRONTEND_URL}/?payment=failed`);
    }

    used.add(tx_ref);
    pending.delete(tx_ref);

    const proof = makeProof({
      tx_ref,
      transaction_id: String(transaction_id),
      plan: order.plan,
      email: order.email,
      verifiedAt: Date.now()
    });

    return res.redirect(`${FRONTEND_URL}/?payment=verified&proof=${encodeURIComponent(proof)}`);
  } catch (err) {
    console.error('Verification error:', err);
    return res.redirect(`${FRONTEND_URL}/?payment=failed`);
  }
});

app.get('/api/payment-result', (req, res) => {
  const proof = readProof(req.query.proof);
  if (!proof || !proof.tx_ref || !proof.transaction_id || !proof.plan) {
    return res.status(400).json({ verified: false, error: 'Invalid payment proof.' });
  }
  res.json({ verified: true, plan: proof.plan, email: proof.email });
});

// Optional: serve MoneySplit from the same server when deployed together.
app.use(express.static(path.join(__dirname)));

if (require.main === module) {
  app.listen(PORT, () => console.log(`MoneySplit payment server listening on port ${PORT}`));
}

module.exports = app;
