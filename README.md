# Malawi Remit

Installable web app (PWA) for sending money from Malawi at the bank rate. Rates, SMS sign-in and ID checks use real data. **Sending money is deliberately switched off** (the review screen shows "Transfers open soon").

## Deploy
Push to GitHub > Cloudflare Pages > Connect to Git. Framework: None. Build command: empty. Output directory: `/`.

## Required setup (Pages settings)
1. **KV**: create a namespace, bind it as `KV`.
2. **Admin**: secret `ADMIN_TOKEN` (long random). Open `/admin`, and also protect `/admin*` and `/api/admin/*` with Cloudflare Access.
3. **SMS** (needed for sign-in): Africa's Talking (`AT_USERNAME`, `AT_API_KEY`, optional `AT_SENDER_ID`; username `sandbox` for testing) or Twilio (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`).
4. **Rates are automatic.** `/api/rates` pulls the Reserve Bank of Malawi's published daily rates (Frankfurter, free, no key) and caches them 15 minutes. Optional extras: `ALLRATES_KEY` (AllRatesToday as a second source) or `RATES_URL` (your own feed). If every source fails it serves the last good rates marked as older, else "Rates unavailable". It never uses market or sample rates. `/admin` can publish a manual override and clear it again.
Fee and limits live in `rates.json` (and the admin page overrides them).

## Behaviour
- No demo code, sample rates or fake receipts. Without KV and SMS configured, sign-in shows "not available yet".
- ID photos are deleted when you approve or reject.
- Install: "Add to Home Screen" (iOS Safari) or the install prompt (Android Chrome). The shell works offline; rates, sign-in and ID checks need a connection. API calls and the admin page are never cached.

## Turning on transfers later
Requires a licensed payments partner, server-side payouts and ledger, and Reserve Bank of Malawi authorisation. Replace the disabled button in `stepReview()` in `index.html` once that exists.
