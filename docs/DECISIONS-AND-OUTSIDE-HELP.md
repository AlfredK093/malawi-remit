# What still needs a decision or an outside party

The app is built and tested. These are the things only you, or someone outside, can supply. Order matters: the first group blocks real money.

## A. Outside parties (start these now, they take weeks)
| Who | What to ask for | Needed before |
|---|---|---|
| Reserve Bank of Malawi (and any other regulator they point you to) | Which licence or authorisation you need to send money abroad, application steps, fees, how long it takes | Any real money |
| Financial intelligence / anti-money-laundering authority | Registration and reporting duties for a money transfer business | Any real money |
| Partner bank or licensed payment provider | Account to hold customer money, payout to foreign banks, collection from Airtel Money / TNM Mpamba, their fees, limits, settlement times, API or manual process | Any real money |
| Lawyer (Malawi, financial services and data protection) | Review privacy notice, write Terms of Use and refund and complaints wording, advise on record keeping and retention, check customer limits | Launch |
| Native Chichewa speaker or translator | Review all Chichewa wording; translate privacy notice, help answers, SMS texts | Launch |
| Independent security reviewer | Penetration test and code review (send them the `docs` and `tests` folders) | Before public launch |
| Accountant | Tax treatment of fees and exchange income, record keeping, reconciliation procedure | Launch |
| Insurer | Cover for errors, fraud and data breach | Launch |
| Africa's Talking | Alphanumeric sender name approval for Malawi, enough balance, delivery to Airtel and TNM confirmed | Launch |
| Cloudflare | Check free-plan limits against your expected traffic (Workers requests, KV and D1 reads and writes); upgrade if needed. Turn on Access for `/admin*` and `/api/admin/*` | Launch |
| Domain registrar | A domain of your own (instead of `pages.dev`) | Launch |

## B. Decisions only you can make
1. **Fees:** the percentage and the minimum fee (today 1% and MWK 2,000 are placeholders). Is the fee taken from the amount sent (as now) or added on top?
2. **Limits:** per transfer, per day, per month, per person (today MWK 5,000,000 / 5,000,000 / 20,000,000 are placeholders). Lower limits for new customers?
3. **Where money can go:** the app now offers USD, GBP, EUR and every African currency (44). Decide which you can really pay out with your partner, and which are allowed under your licence and sanctions rules. SDG, SSP, ERN, LYD and SOS are off by default; confirm Zimbabwe (ZWG), DR Congo (CDF), Somalia, Libya and others with your compliance adviser before switching them on.
3a. **Which Reserve Bank rate:** the app uses the middle rate. The bank also publishes a buying and a selling rate; a customer buying foreign currency from a bank normally gets the selling rate, which is less favourable. Ask your partner bank which rate they will actually give you, and whether you can honestly call the middle rate the "bank rate".
3b. **Cross-rate currencies:** 36 currencies are calculated from the RBM dollar rate, not published by RBM. Decide whether to offer them, and whether to add a margin for the extra rate risk.
4. **How customers pay you:** Airtel Money, TNM Mpamba, bank. Whose till number or account, and the exact words for "How to pay" (`payInstructions` in `rates.json`).
5. **Refund policy:** full amount or minus costs, how fast, and how it is paid back. The app currently records a full-amount refund.
6. **Business details to show:** legal business name, support email and phone, opening hours, physical address, complaints contact.
7. **People and roles:** who are Owners (can change money settings) and who are Reviewers (ID checks only). Keep Owners to two or three people.
8. **Data rules:** how long you keep ID details, transfer records and logs; who may see ID photos; what happens when someone asks to be deleted.
9. **Money checks:** how you screen names against sanctions lists and watch for suspicious activity (the app does none of this).
10. **Launch plan:** date, who the first 10 customers are, starting limits, who reconciles every day, who answers support.
11. **First weeks operating model:** you confirm payments and payouts by hand in `/admin`. Is that acceptable, or do you wait for an automatic partner connection?
12. **Brand:** name, logo and colours. The current name and logo are placeholders you can change.

## C. What I can still build once you decide
- Terms of Use screen and links, once the lawyer's text exists.
- Connection to your payment partner's collection and payout (needs their documentation and test account).
- Sanctions-list or name-check step in the ID review (needs your chosen provider).
- Chichewa SMS texts and a per-customer language choice.
- "Sign out all devices", stronger encryption of stored account numbers, and a stricter store for lockout counters.
- A custom-domain and email setup guide, and a staff training sheet for the daily routine.

## D. The five that block everything
1. Regulator authorisation.
2. Partner bank or provider agreement.
3. Lawyer sign-off (privacy, terms, retention).
4. Independent security review passed.
5. Two clean weeks in the staged rollout, with daily reconciliation matching.
