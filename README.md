# Malawi Remit

Installable web app for sending money from Malawi at the Reserve Bank of Malawi rate. Sending money is switched off.

## Files (all at the top level of the repo)
`index.html` `admin.html` `_worker.js` `_routes.json` `sw.js` `manifest.json` `rates.json` `icons/`
`_worker.js` is the whole backend. The old `functions/` folder is not needed.

## Cloudflare Pages settings
- Framework None, no build command, output directory `/`.
- KV namespace bound as `KV`.
- Secrets: `ADMIN_TOKEN`, plus SMS: `AT_USERNAME` + `AT_API_KEY` (Africa's Talking, optional `AT_SENDER_ID`) or `TWILIO_SID` + `TWILIO_TOKEN` + `TWILIO_FROM`.
- Optional: `ALLRATES_KEY` (second rate source), `RATES_URL` (own rate feed), `TRANSFERS_ENABLED` (leave unset until payments are built).
- Protect `/admin*` and `/api/admin/*` with Cloudflare Access.
- Check `/api/health` shows worker, kv, sms and admin all true.

## Admin (`/admin`)
Sign in with email and password (hashed, 12-hour sessions, lockout after repeated failures). First time: open `/admin`, expand First-time setup, enter the `ADMIN_TOKEN` secret as the setup key plus your email and a 10+ character password. The same form resets a forgotten password. Owners manage rates, fees and the team; reviewers only handle ID checks. Rates update automatically from the bank. Publish an override only when needed and clear it afterwards. Fees and limits are saved separately and apply to all rates. Approve or reject IDs; photos are deleted on decision.

## Server rules
Only users with an approved ID reach `/api/transfers`. Posting a transfer returns "not open yet" until `TRANSFERS_ENABLED=true` and a licensed payment provider is connected. The approval check is made on the server, not in the browser.

## Before real launch
Licensed payments partner and Reserve Bank of Malawi authorisation, lawyer review of the privacy notice, `supportEmail` in `rates.json`.

## Security
`_headers` sets browser protections (no framing, strict content policy, no referrer, HTTPS only). IDs are checked as real JPEG photos, adults only, with a limit of 5 submissions per 15 minutes. Code requests are limited per phone and per connection. Admins use hashed passwords, optional authenticator-app codes, lockouts, 12-hour sessions and an activity log (kept 90 days). User sign-out ends the session on the server too.

## Bot protection (Cloudflare Turnstile) and ID result texts
Turnstile: Cloudflare dashboard > Turnstile > Add widget for your site hostname, then set `TURNSTILE_SITEKEY` (variable) and `TURNSTILE_SECRET` (secret) in Pages and redeploy. `/api/health` shows `botCheck: true` when active. Without them the app works without the check. A passed check lets a connection resend codes for 10 minutes.
When an admin approves or rejects an ID, the user gets an SMS (the admin page warns if it could not be sent).

## Transfer records and receipts (needs a D1 database)
1. Cloudflare dashboard > Storage & Databases > D1 > Create a database (e.g. `mwremit`).
2. Pages project > Settings > Bindings > add D1 database, variable name `DB`. Tables are created automatically.
3. Only when licensed and ready to take transfer requests, set `TRANSFERS_ENABLED` to `true`. Until then the app shows "Transfers open soon".
4. Put your payment steps (till number, bank details) in `payInstructions` in `rates.json`.
How it works: the server re-checks the rate, fee and limits, locks them in, and creates a transfer with a reference like `MW-7K3Q9XPD` in status "awaiting payment". Double taps never create duplicates. In `/admin` (owners) you mark it paid, sent, completed or failed, and the customer is texted. Customers can open a printable receipt and cancel before paying. This app does not take money itself; you confirm payments by hand until a payments partner is connected.

## Per-person limits
Daily and monthly limits (MWK) per person are set in `/admin` > Fees and limits (defaults in `rates.json`). They are enforced on the server when a transfer is created, counted in Malawi time (reset at midnight), and cancelled or failed transfers do not count. The send screen shows how much a person has left. Owners can set a custom limit for one person under Custom limits. Set limits to match Reserve Bank of Malawi requirements.

## Refunds, daily report, Chichewa
- Refunds: if an admin marks a transfer failed after it was paid or sent, a refund is created automatically (full amount). Owners pay it back outside the app, then press Mark refunded in /admin; the customer is texted and the receipt shows the refund.
- Daily report (/admin > Daily report): totals for a Malawi day, money in flight, refunds still owed, stale unpaid transfers, plus a CSV of every transfer event that day for matching against your Airtel/TNM/bank and payout partner statements.
- Chichewa: a language button in the header switches the customer app. The wording is a first draft and must be reviewed by a native Chichewa speaker before launch. The privacy notice and help answers stay in English until they are professionally translated. SMS messages are in English.

## Testing and launch
`node --no-warnings tests/server.test.mjs` runs 45 server checks (Node 22+). Work through `docs/LAUNCH-CHECKLIST.md` before real customers use the app. The `docs/` and `tests/` folders are never served to the public.
