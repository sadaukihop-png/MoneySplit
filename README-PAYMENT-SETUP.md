# MoneySplit — Secure Flutterwave Payment Setup

This package separates the public MoneySplit frontend from the Flutterwave secret-key payment logic.

## Why this is different

The browser no longer decides that `status=successful` means a payment succeeded. The backend:

1. Calculates the price from the selected plan/currency.
2. Creates the Flutterwave payment using the secret key.
3. Receives Flutterwave's callback with `transaction_id`.
4. Calls Flutterwave's transaction verification endpoint.
5. Checks `status`, `tx_ref`, `currency`, amount, and customer email.
6. Only then sends a signed proof back to MoneySplit.

Never put `FLW_SECRET_KEY` in `index.html` or GitHub Pages.

## Files

- `index.html` — MoneySplit frontend.
- `server.js` — secure payment backend.
- `package.json` — Node/Express dependency and start command.
- `.env.example` — environment-variable template.

## Recommended deployment

For the simplest setup, deploy the backend and frontend together on a Node host such as Render/Railway/Fly.io. Then leave:

```text
PAYMENT_API_BASE_URL = ""
```

in `index.html`.

Set these environment variables on the server:

```text
FLW_SECRET_KEY=your_live_or_test_secret_key
APP_SECRET=a-long-random-secret
FRONTEND_URL=https://your-domain.example
BACKEND_PUBLIC_URL=https://your-domain.example
```

If you keep the frontend on GitHub Pages and deploy the backend separately, change the frontend constant to your backend origin:

```js
const PAYMENT_API_BASE_URL = "https://your-backend.example";
```

Then set:

```text
FRONTEND_URL=https://yourusername.github.io/MoneySplit
BACKEND_PUBLIC_URL=https://your-backend.example
```

## Local test

```bash
npm install
```

Create `.env` from `.env.example`, fill in your Flutterwave test secret key and a random APP_SECRET, then run:

```bash
node server.js
```

Open:

```text
http://localhost:3000
```

Use Flutterwave's test environment first. Do not switch to live payments until the complete payment → callback → verification flow has been tested.

## Important production note

The current example keeps pending transactions and processed references in server memory. That is suitable for testing and a small proof-of-concept, but a production MoneySplit service should store orders, customers, transaction references, payment status, and premium expiry in a persistent database. It should also use a Flutterwave webhook with a secret hash as a second payment notification path.
