# Malawi Remit (test phase)

Static prototype: MWK to USD/GBP/EUR/ZAR at the bank rate, shown with a separate, visible fee. Transfers are simulated.

## Deploy
1. Push this folder to a GitHub repo.
2. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git.
3. Framework preset: None. Build command: (empty). Output directory: `/`.
4. Every push to `main` redeploys.

## Update rates
Edit `rates.json` (MWK per 1 unit of foreign currency, fee %, limits) and push. Source these from the Reserve Bank of Malawi.

## Before a real launch
Real payments need a licensed payment provider, a backend (rates, KYC, ledger, payouts), and Reserve Bank of Malawi authorisation. The UI here is the front end only.

## Live rates (Pages Function)
`functions/api/rates.js` serves `/api/rates`, cached for 1 hour. Sources, in order:
1. `RATES_URL` (Pages > Settings > Environment variables): your own JSON feed of official bank rates, shaped like `rates.json`.
2. A free market reference rate (labelled as not the official bank rate in the app).
3. The static `rates.json`.
Set `RATES_URL` before testing so users see the bank rate, not the market reference.

## Sign-in and ID check (test mode)
Sign-in uses phone number plus code `123456`. The ID check accepts any details for 18+ users and approves after a few seconds. All of this is simulated in the browser. A real launch needs server-side OTP (SMS) and a KYC provider.

## Admin page and storage (rates + ID approvals)
1. Cloudflare dashboard > Workers & Pages > KV > Create a namespace (e.g. `mwremit`).
2. Your Pages project > Settings > Bindings (Functions) > add KV namespace, variable name `KV`.
3. Settings > Variables and Secrets > add a secret `ADMIN_TOKEN` (long random string).
4. Redeploy. Open `/admin.html`, enter the token.
- Rates published there override every other source and appear instantly.
- ID checks: users' submissions appear with ID photo and selfie. Approve or reject; photos are deleted once you decide, and the user's app updates within seconds.
- Protect `/admin.html` and `/api/admin/*` with Cloudflare Access (Zero Trust) as well as the token.
- Without the KV binding the app still works in simulated mode.

## Real SMS codes
Add these secrets in Pages > Settings > Variables and Secrets (KV must also be bound):
- Africa's Talking (strong Malawi coverage): `AT_USERNAME`, `AT_API_KEY`, optional `AT_SENDER_ID`. Use username `sandbox` to test.
- or Twilio: `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`.
Once either is set, codes are random, expire after 5 minutes, allow 5 tries and one request per minute. A successful code gives a 30-day session token, and ID submissions and status checks are tied to that verified number. With no provider set, the demo code 123456 is used.
