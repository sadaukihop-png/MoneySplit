# MoneySplit Vercel deployment

This is the root-level Vercel deployment package. There is intentionally no `api` folder.

Files:
- `index.html` — MoneySplit web app, existing Google ad card, logo reference, feedback section
- `index.js` — Vercel entry point
- `server.js` — Express API, Flutterwave payment verification, Supabase feedback
- `vercel.json` — Vercel routing
- `feedback-admin.html` — private feedback viewer
- `package.json` — Node/Express configuration
- `.env.example` — environment-variable template

Keep your real secrets only in Vercel Environment Variables, never in GitHub.

The logo file expected by the existing HTML is `MoneySplit.webp`. Keep the logo already present in your GitHub repository.
