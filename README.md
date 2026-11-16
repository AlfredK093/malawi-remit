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
