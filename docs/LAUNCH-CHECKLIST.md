# Malawi Remit: test checklist and pre-launch security review

Tick every box. Anything you cannot tick is a reason to wait. Use a separate test Pages project with `TRANSFERS_ENABLED=true` for the transfer tests, and keep the live project on `false`.

## 1. Setup check (15 minutes)
- [ ] `/api/health` shows `worker`, `kv`, `sms`, `admin`, `db` and `botCheck` all `true`.
- [ ] `/api/rates` shows today's Reserve Bank of Malawi date and a USD rate close to the bank's published figure.
- [ ] `_headers`, `_worker.js`, `_routes.json`, `index.html`, `admin.html`, `sw.js`, `manifest.json`, `rates.json`, `icons/` are at the top level of the repo.
- [ ] `/docs/LAUNCH-CHECKLIST.md` and `/tests/server.test.mjs` return "Not found" on the live site.
- [ ] `node --no-warnings tests/server.test.mjs` passes (all PASS).
- [ ] `supportEmail` and `payInstructions` are filled in `rates.json`.
- [ ] Custom domain is connected (instead of `pages.dev`) and shows a padlock.

## 2. Customer tests (use two real phones, one Android and one iPhone)
**Sign-up and ID**
- [ ] Welcome page loads quickly, rate chips show real rates, buttons work, back button works everywhere.
- [ ] Create account: cannot continue without the tick box; Turnstile check appears; SMS code arrives within 30 seconds.
- [ ] Wrong code 5 times is blocked; an expired code (after 5 minutes) is refused; Resend works after 60 seconds.
- [ ] ID steps: under-18 date refused; non-image file refused; large photo (10 MB) still uploads; selfie required.
- [ ] Submitting twice quickly does not break anything. After 5 submissions in 15 minutes, further ones are refused.
- [ ] Waiting screen appears; closing and reopening the app returns to it (never to the upload form).
- [ ] Admin approves: customer gets a text, the waiting screen moves on by itself, Home opens.
- [ ] Admin rejects with a reason: text arrives, form reopens showing the reason, resubmitting works.
- [ ] Sign out, then sign in again with the same number: goes straight to the right screen (Home, waiting, or form).
- [ ] Phone with no signal: offline bar appears; app still opens; nothing breaks.

**Money screens**
- [ ] Amount screen: fee line, minimum fee note and limits note are correct for 3 amounts (a small one using the minimum fee, a normal one, one near the maximum).
- [ ] Amounts below the minimum, above the maximum, and above remaining daily/monthly limits are blocked with a clear message.
- [ ] Rate shown matches `/api/rates`; changing currency chip updates everything.
- [ ] Recipient: bad SWIFT or short account number is refused.
- [ ] (Test project) Confirm transfer: receipt appears with reference `MW-...`, "How to pay" shows your instructions, Activity lists it.
- [ ] Double-tapping Confirm creates only one transfer.
- [ ] If the bank rate changes between review and confirm, the app asks to review again.
- [ ] Cancel before paying works; cancel after "Payment received" is not offered.
- [ ] Print/save as PDF produces a clean one-page receipt; Share works on both phones.
- [ ] Admin moves it Paid > Sent > Completed: a text arrives at each step and the receipt timeline updates.
- [ ] Failed after paid: refund shows as "Refund due" on the receipt, then "Refunded" after you mark it.

**Everything else**
- [ ] Chichewa button switches the whole app and back; a native speaker has reviewed the wording.
- [ ] Privacy notice and Help open and back works. Delete my account and data signs out and the number can sign up again.
- [ ] Install to home screen works (Android prompt, iPhone Add to Home Screen); icon looks right.
- [ ] Large text size and screen reader (TalkBack/VoiceOver) can complete sign-in.

## 3. Admin tests
- [ ] First-time setup with the setup key works; a wrong key is refused and eventually blocked.
- [ ] Sign in; 5 wrong passwords lock the account for 15 minutes; the activity log shows "login failed".
- [ ] Two-step sign-in: turn on, sign out, sign in needs the code; wrong code refused; turn off needs the password.
- [ ] Add a Reviewer: they see ID checks only; Rates, Fees, Limits, Transfers, Refunds, Report, Team are hidden and the server refuses them (test with section 4).
- [ ] Rates: publish an override, confirm the customer app shows it; "Use automatic rates" restores the bank rate. Clear any override before launch.
- [ ] Fees and limits: change fee, minimum fee, send limits, daily and monthly limits; customer app updates immediately. Custom limit for one person works and can be removed.
- [ ] ID checks: photos are readable; approve and reject both text the customer; photos are gone after the decision (re-open the record: only text remains).
- [ ] Transfers: only valid next steps are allowed (cannot jump from Awaiting to Sent).
- [ ] Refunds: marking twice is refused. Daily report numbers match what you did that day; CSV opens in Excel and nothing runs as a formula.
- [ ] Sign out ends the session (old token no longer works).

## 4. Security tests (run these yourself; replace the domain)
- [ ] `curl -i https://YOURSITE/api/admin/kyc` returns 401 (no token).
- [ ] A Reviewer token calling `/api/admin/rates`, `/fees`, `/transfers`, `/refunds`, `/report`, `/limits`, `/users`, `/audit` returns 403.
- [ ] A customer token calling any `/api/admin/...` returns 401.
- [ ] Customer A cannot open Customer B's receipt by guessing its id (`/api/transfers?id=...` returns 404).
- [ ] A signed-in but not-approved customer calling `/api/transfers` gets 403.
- [ ] Creating a transfer with `TRANSFERS_ENABLED` not `true` returns 503.
- [ ] Sending a tampered amount, rate, currency or negative number is refused; the fee and receive amount always come from the server.
- [ ] Posting a non-image or a 5 MB string as an ID photo returns 400.
- [ ] 11 code requests in 15 minutes from one connection are blocked; the SMS bill stays sane.
- [ ] `https://SECURITYHEADERS.com` (or similar scanner) shows the headers from `_headers`; the page cannot be loaded inside another site's frame.
- [ ] Open `/admin` while not signed in: no data visible. Cloudflare Access is switched on in front of `/admin*` and `/api/admin/*`.
- [ ] Search your site name in a search engine after a week: `/admin` is not listed.

## 5. Secrets and access
- [ ] `ADMIN_TOKEN`, `AT_API_KEY`, `TURNSTILE_SECRET` are secrets (not plain variables), and are stored in a password manager, not chat or email.
- [ ] Only 2 to 3 people can open Cloudflare, GitHub and Africa's Talking, all with two-step sign-in on.
- [ ] Every admin uses a unique password (10+ characters) and two-step sign-in. Remove admins who leave the same day.
- [ ] GitHub repo is private; no secrets appear in any file or past commit.
- [ ] A calendar reminder to rotate `ADMIN_TOKEN` and the SMS key every 6 months.

## 6. Data and privacy
- [ ] A lawyer has reviewed the privacy notice and a Terms of Use is in place and linked in the app.
- [ ] You know how long each type of record is kept (ID details, transfers, audit log, refunds) and have a written rule. Financial records often must be kept for years; confirm with your lawyer.
- [ ] A person can ask for their data to be deleted and you can do it (Account tab, or by hand for records you must keep).
- [ ] Backups: confirm how you can export or restore D1 (it supports exports and point-in-time recovery; check your plan) and test one restore. KV has no automatic backup: export user and ID records regularly if you need them.
- [ ] Staff who see ID photos know the rules: view only in the admin page, never download, screenshot or share them.

## 7. Legal and money (cannot launch without these)
- [ ] Reserve Bank of Malawi authorisation and any other licence required for sending money abroad.
- [ ] A licensed partner or bank to hold and pay out the money; a signed agreement.
- [ ] Anti-money-laundering and know-your-customer procedures written down; sanctions screening in place (this app does not do it); a way to report suspicious activity as required.
- [ ] Per-person limits match what the regulator and your partner allow.
- [ ] Customer complaints process and contact, shown in the app.
- [ ] Insurance and who is responsible when a payout goes wrong.

## 8. Operations
- [ ] Alerts: someone is told when rates fail to load, SMS stops sending (Africa's Talking balance low), or sign-in errors spike. Check Cloudflare real-time logs weekly.
- [ ] Keep an Africa's Talking balance for at least 2 weeks of messages.
- [ ] Daily routine written down: review ID queue, process paid/sent/failed, pay refunds, run the Daily report and match it to Airtel/TNM/bank and payout statements, clear any stale unpaid transfers.
- [ ] Runbook for: rates stuck, SMS not arriving, customer says money missing, wrong payout, lost admin phone (reset via setup key), suspected breach (rotate every secret, remove admins, check the activity log).
- [ ] Support email and phone answered during stated hours.

## 9. Staged rollout (do not skip)
1. Staff only, 1 week, transfers on in the test project with tiny amounts.
2. 10 trusted people, low limits (for example MWK 50,000 a day), real money only after steps 5 to 7 are ticked.
3. 50 people, raise limits gradually; reconcile every single day.
4. Public launch only after 2 clean weeks with no unexplained difference in the daily report.

## 10. Known limits of this build (so nobody is surprised)
- It does not take or send money itself. Payments are confirmed by hand by an owner.
- Rate limits and lockouts use Cloudflare KV, which can lag by a moment. A busy live service should move these counters to a stricter store.
- The page's security policy still allows inline scripts, which weakens protection against injected code. Moving to separate script files fixes this.
- Full recipient account numbers are stored in D1 unencrypted by the app (Cloudflare encrypts storage at rest). Consider field-level encryption before volume.
- No transaction monitoring, sanctions screening or fraud scoring.
- Limits only count transfers made in this app.
- Customers' sign-in lasts 14 days on a phone; there is no "sign out all devices".
- SMS messages are English only. Chichewa wording is a first draft.
- Receipts are not legal tax documents.
- An independent security review and a penetration test by a professional are strongly recommended before public launch.

## Go / no-go
Launch only when sections 1 to 8 are fully ticked, the staged rollout has passed, and a named person owns each of: security, compliance, daily reconciliation and customer support.
