// Single-file backend for Cloudflare Pages (replaces the functions/ folder). Routes: /api/*
// RBM publishes these directly. Every other African currency is worked out from the RBM dollar rate and a central-bank dollar rate.
const RBM_DIRECT = ["USD", "GBP", "EUR", "ZAR", "BWP", "KES", "TZS", "ZMW"];
const CROSS = ["NAD", "LSL", "SZL", "MZN", "ZWG", "AOA", "UGX", "RWF", "BIF", "ETB", "ERN", "DJF", "SOS", "SSP", "SDG", "MGA", "MUR", "SCR", "KMF", "NGN", "GHS", "XOF", "GMD", "GNF", "LRD", "SLE", "CVE", "MRU", "XAF", "CDF", "STN", "EGP", "MAD", "DZD", "TND", "LYD"];
const CUR = [...RBM_DIRECT, ...CROSS];
const num = v => typeof v === "number" && isFinite(v) && v > 0;
const J = (o, s = 200, cc = "no-store") => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": cc, "x-content-type-options": "nosniff" } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const norm = p => { let d = String(p).replace(/\D/g, ""); if (d.startsWith("0")) d = "265" + d.slice(1); return "+" + d; };
const hasSms = e => (e.AT_API_KEY && e.AT_USERNAME) || (e.TWILIO_SID && e.TWILIO_TOKEN && e.TWILIO_FROM);
const isAdmin = async (r, e) => { const t = (r.headers.get("authorization") || "").replace("Bearer ", ""); return t ? e.KV.get("asess:" + t, "json") : null; };
const session = async (r, e) => { const t = (r.headers.get("authorization") || "").replace("Bearer ", ""); return t ? e.KV.get("sess:" + t) : null; };
const kkey = p => "kyc:" + String(p).replace(/\D/g, "");

/* ---------- rates ---------- */
const pack = (rows, source) => { const perUnit = {}; let d = "9999"; for (const x of rows) { perUnit[x.c] = x.rate; if (x.date && x.date < d) d = x.date; } return { perUnit, updated: d === "9999" ? new Date().toISOString().slice(0, 10) : d, source }; };
const pick = j => { const r = Array.isArray(j) ? j[0] : j; return { rate: r.rate ?? r.value ?? (r.rates && r.rates.MWK), date: r.date || r.rate_date }; };
async function directRows(urlFor, headers) {
  const res = await Promise.allSettled(RBM_DIRECT.map(async c => { const r = await fetch(urlFor(c), { headers }); if (!r.ok) throw new Error("rate " + r.status); const { rate, date } = pick(await r.json()); if (!num(rate)) throw new Error("bad rate"); return { c, rate, date }; }));
  return res.filter(x => x.status === "fulfilled").map(x => x.value);
}
// Fill every currency the source did not give us: MWK per 1 X = (MWK per USD) / (X per USD), one batch call.
async function addCross(out) {
  const codes = CUR.filter(c => !out.perUnit[c]); if (!codes.length || !out.perUnit.USD) return;
  try {
    const rows = await (await fetch("https://api.frankfurter.dev/v2/rates?base=USD&quotes=" + codes.join(","))).json();
    for (const x of Array.isArray(rows) ? rows : []) if (codes.includes(x.quote) && num(x.rate)) { out.perUnit[x.quote] = out.perUnit.USD / x.rate; out.basis[x.quote] = "cross"; }
  } catch (e) {}
}
async function autoRates(request, env, ctx) {
  const cache = caches.default, key = new Request(new URL("/api/rates", request.url).toString());
  const hit = await cache.match(key); if (hit) return hit.json();
  const tries = [];
  if (env.RATES_URL) tries.push(async () => {
    const j = await (await fetch(env.RATES_URL)).json(), perUnit = {};
    for (const c of CUR) if (num(j.perUnit && j.perUnit[c])) perUnit[c] = j.perUnit[c];
    if (!perUnit.USD) throw new Error("bad feed");
    return { perUnit, updated: j.updated, source: j.source || "Bank rate feed", basis: Object.fromEntries(Object.keys(perUnit).map(c => [c, "feed"])) };
  });
  tries.push(async () => { const o = pack(await directRows(c => `https://api.frankfurter.dev/v2/rate/${c}/MWK?providers=RBM`), "Reserve Bank of Malawi official reference rate"); if (!o.perUnit.USD) throw new Error("no USD"); o.basis = Object.fromEntries(Object.keys(o.perUnit).map(c => [c, "rbm"])); return o; });
  if (env.ALLRATES_KEY) tries.push(async () => { const o = pack(await directRows(c => `https://allratestoday.com/api/v1/central-bank/rbm/latest?source=${c}&target=MWK`, { authorization: "Bearer " + env.ALLRATES_KEY }), "Reserve Bank of Malawi official rate"); if (!o.perUnit.USD) throw new Error("no USD"); o.basis = Object.fromEntries(Object.keys(o.perUnit).map(c => [c, "rbm"])); return o; });
  let out = null;
  for (const t of tries) { try { out = await t(); break; } catch (e) {} }
  if (out) await addCross(out);
  if (out && env.KV) ctx.waitUntil(env.KV.put("rates:last", JSON.stringify(out)));
  if (!out && env.KV) { const l = await env.KV.get("rates:last", "json"); if (l) out = { ...l, stale: true }; }
  if (!out) return null;
  if ((Date.now() - Date.parse(out.updated)) / 864e5 > 4) out.stale = true;
  if (!out.stale) ctx.waitUntil(cache.put(key, J(out, 200, "public, max-age=900")));
  return out;
}
async function rates(request, env, ctx) {
  const base = await (await env.ASSETS.fetch(new URL("/rates.json", request.url))).json();
  const fees = env.KV ? (await env.KV.get("fees", "json")) || {} : {}, cfg = env.KV ? (await env.KV.get("currencies", "json")) || {} : {}, manual = env.KV ? await env.KV.get("rates", "json") : null;
  let out = await autoRates(request, env, ctx);
  if (manual && manual.perUnit) out = { ...(out || {}), perUnit: { ...((out && out.perUnit) || {}), ...manual.perUnit }, basis: { ...((out && out.basis) || {}), ...Object.fromEntries(Object.keys(manual.perUnit).map(k => [k, "manual"])) }, source: manual.source, updated: manual.updated, override: true, stale: false };
  if (!out || !out.perUnit) return J({ error: "Rates unavailable" }, 503);
  const disabled = new Set(cfg.disabled || base.disabledCurrencies || []), perUnit = {}, basis = {};
  for (const c of CUR) if (num(out.perUnit[c]) && !disabled.has(c)) { perUnit[c] = Number(Number(out.perUnit[c]).toPrecision(6)); basis[c] = (out.basis && out.basis[c]) || "rbm"; }
  if (!Object.keys(perUnit).length) return J({ error: "Rates unavailable" }, 503);
  return J({ ...base, ...out, perUnit, basis, ...fees, live: true });
}

/* ---------- SMS sign-in ---------- */
async function sendSms(env, to, text) {
  const r = await sendSmsRaw(env, to, text);
  if (!r.ok && env.KV) { try { await env.KV.put("smsfail", String((parseInt(await env.KV.get("smsfail")) || 0) + 1), { expirationTtl: 3600 }); } catch (e) {} }
  return r;
}
async function sendSmsRaw(env, to, text) {
  if (env.AT_API_KEY && env.AT_USERNAME) {
    const host = env.AT_USERNAME === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
    const f = new URLSearchParams({ username: env.AT_USERNAME, to, message: text }); if (env.AT_SENDER_ID) f.set("from", env.AT_SENDER_ID);
    const r = await fetch(`https://${host}/version1/messaging`, { method: "POST", headers: { apiKey: env.AT_API_KEY, accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: f });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok) return { ok: false, detail: `Africa's Talking ${r.status}: ${t.slice(0, 100)}` };
    const m = j && j.SMSMessageData, rec = m && m.Recipients && m.Recipients[0];
    if (!rec) return { ok: false, detail: (m && m.Message) || "No recipient accepted" };
    return [100, 101, 102].includes(rec.statusCode) ? { ok: true } : { ok: false, detail: "Africa's Talking: " + rec.status };
  }
  const f = new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: text });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, { method: "POST", headers: { authorization: "Basic " + btoa(env.TWILIO_SID + ":" + env.TWILIO_TOKEN) }, body: f });
  return r.ok ? { ok: true } : { ok: false, detail: "Twilio " + r.status };
}
async function otp(request, env) {
  if (request.method !== "POST") return J({ error: "Method not allowed" }, 405);
  if (!hasSms(env)) return J({ error: "SMS not configured" }, 501);
  const b = await request.json().catch(() => null); if (!b) return J({ error: "Bad request" }, 400);
  const phone = norm(b.phone || ""); if (!/^\+\d{10,14}$/.test(phone)) return J({ error: "Invalid phone number" }, 400);
  if (b.action === "send") {
    const ip = request.headers.get("cf-connecting-ip") || "x", ipk = "otpip:" + ip;
    if (env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET && !(await env.KV.get("human:" + ip))) {
      if (!b.turnstile) return J({ error: "Security check missing", detail: "complete the security check" }, 400);
      const v = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: b.turnstile, remoteip: ip }) })).json().catch(() => ({}));
      if (!v.success) return J({ error: "Security check failed", detail: "security check failed, try again" }, 400);
      await env.KV.put("human:" + ip, "1", { expirationTtl: 600 });
    }
    if (await env.KV.get("otprl:" + phone) || await tooMany(env, ipk, 10)) return J({ error: "Wait a minute before asking again." }, 429);
    await bump(env, ipk);
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    await env.KV.put("otp:" + phone, JSON.stringify({ h: await sha(code + phone), tries: 0 }), { expirationTtl: 300 });
    await env.KV.put("otprl:" + phone, "1", { expirationTtl: 60 });
    const s = await sendSms(env, phone, `Your Malawi Remit code is ${code}. It expires in 5 minutes.`);
    if (!s.ok) { await env.KV.delete("otp:" + phone); return J({ error: "SMS failed", detail: s.detail }, 502); }
    return J({ ok: true });
  }
  if (b.action === "verify") {
    const rec = await env.KV.get("otp:" + phone, "json");
    if (!rec) return J({ error: "Code expired. Go back and request a new one." }, 400);
    if (rec.tries >= 5) { await env.KV.delete("otp:" + phone); return J({ error: "Too many attempts. Request a new code." }, 400); }
    if ((await sha(String(b.code || "") + phone)) !== rec.h) { rec.tries++; await env.KV.put("otp:" + phone, JSON.stringify(rec), { expirationTtl: 300 }); return J({ error: "That code is not correct." }, 400); }
    await env.KV.delete("otp:" + phone);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.KV.put("sess:" + token, phone, { expirationTtl: 1209600 });
    return J({ token });
  }
  return J({ error: "Bad request" }, 400);
}

/* ---------- ID verification (user) ---------- */
async function kyc(request, env) {
  const phone = await session(request, env); if (!phone) return J({ error: "Sign in again" }, 401);
  if (request.method === "GET") { const r = await env.KV.get(kkey(phone), "json"); return J(r ? { status: r.status, reason: r.reason || "", name: r.name } : { status: "none" }); }
  if (request.method === "DELETE") { await env.KV.delete(kkey(phone)); await env.KV.delete("sess:" + (request.headers.get("authorization") || "").replace("Bearer ", "")); return J({ ok: true }); }
  if (request.method !== "POST") return J({ error: "Method not allowed" }, 405);
  const b = await request.json().catch(() => null);
  const jpg = s => typeof s === "string" && s.length < 1500000 && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(s);
  const age = b && /^\d{4}-\d{2}-\d{2}$/.test(b.dob || "") ? (Date.now() - Date.parse(b.dob)) / 31557600000 : 0;
  const bad = !b ? "no data" : b.consent !== true ? "privacy consent required" : String(b.name || "").trim().length < 3 ? "name missing" : !(age >= 18 && age < 120) ? "must be 18 or older" : !/^[A-Za-z0-9]{1,4}$/.test(b.idLast4 || "") ? "ID number missing" : !jpg(b.idImg) || !jpg(b.selfie) ? "photo missing or not a supported image" : "";
  if (bad) return J({ error: "Invalid submission", detail: bad }, 400);
  const rk = "kycrl:" + kkey(phone);
  if (await tooMany(env, rk, 5)) return J({ error: "Too many submissions", detail: "try again in 15 minutes" }, 429);
  await bump(env, rk);
  const old = await env.KV.get(kkey(phone), "json");
  if (old && old.status === "approved") return J({ status: "approved" });
  const pk = "pending:" + Date.now() + ":" + kkey(phone).slice(4);
  if (old && old.pendingKey) await env.KV.delete(old.pendingKey);
  await env.KV.put(pk, "1");
  await env.KV.put(kkey(phone), JSON.stringify({ pendingKey: pk, phone, name: String(b.name).slice(0, 100), dob: b.dob, idType: String(b.idType).slice(0, 30), idLast4: String(b.idLast4).slice(0, 4), address: String(b.address || "").slice(0, 150), idImg: b.idImg, selfie: b.selfie, status: "pending", consentAt: new Date().toISOString(), consentVersion: "2026-11", submitted: new Date().toISOString() }));
  return J({ status: "pending" });
}

async function approved(request, env) {
  const phone = await session(request, env); if (!phone) return { err: J({ error: "Sign in again" }, 401) };
  const r = await env.KV.get(kkey(phone), "json");
  if (!r || r.status !== "approved") return { err: J({ error: "Your ID has not been approved yet" }, 403) };
  return { phone };
}
/* ---------- transfers (Cloudflare D1: bind a database as DB) ---------- */
let schemaReady = false;
async function ensureDb(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, ref TEXT UNIQUE, idem TEXT, phone TEXT, sender TEXT, created TEXT, updated TEXT, amount_minor INTEGER, fee_minor INTEGER, rate REAL, currency TEXT, receive_minor INTEGER, method TEXT, r_name TEXT, r_country TEXT, r_bank TEXT, r_acct TEXT, r_swift TEXT, status TEXT, note TEXT)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS t_idem ON transfers (phone, idem)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS t_phone ON transfers (phone, created)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS transfer_events (id INTEGER PRIMARY KEY AUTOINCREMENT, tid TEXT, t TEXT, actor TEXT, status TEXT, note TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS refunds (id TEXT PRIMARY KEY, tid TEXT UNIQUE, ref TEXT, phone TEXT, amount_minor INTEGER, status TEXT, created TEXT, updated TEXT, actor TEXT, note TEXT)")
  ]);
  schemaReady = true;
}
// Limits are counted per person in Malawi time (UTC+2, no daylight saving); cancelled and failed transfers do not count.
const CAT = 2 * 3600e3;
function windows(now = Date.now()) { const d = new Date(now + CAT); return { day: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - CAT).toISOString(), month: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - CAT).toISOString() }; }
async function usage(env, phone, R) {
  const w = windows(), ov = (await env.KV.get("limit:" + String(phone).replace(/\D/g, ""), "json")) || {};
  const sum = async since => (await env.DB.prepare("SELECT COALESCE(SUM(amount_minor),0) AS s FROM transfers WHERE phone=? AND created>=? AND status NOT IN ('cancelled','failed')").bind(phone, since).first()).s / 100;
  const dl = ov.daily || R.dailyLimitMWK || 5000000, ml = ov.monthly || R.monthlyLimitMWK || 20000000, du = await sum(w.day), mu = await sum(w.month);
  return { daily: { limit: dl, used: du, remaining: Math.max(0, dl - du) }, monthly: { limit: ml, used: mu, remaining: Math.max(0, ml - mu) } };
}
const PAY_METHODS = ["Airtel Money", "TNM Mpamba", "Bank account"];
const NEXT = { awaiting_payment: ["paid", "failed", "cancelled"], paid: ["sent", "failed"], sent: ["completed", "failed"] };
const mk = n => Math.round(n * 100);
const newRef = () => { const A = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; let o = ""; for (const x of crypto.getRandomValues(new Uint8Array(8))) o += A[x % A.length]; return "MW-" + o; };
const view = (r, events, refund) => ({ id: r.id, ref: r.ref, created: r.created, updated: r.updated, status: r.status, amount: r.amount_minor / 100, fee: r.fee_minor / 100, rate: r.rate, currency: r.currency, receive: r.receive_minor / 100, method: r.method, note: r.note || "", recipient: { name: r.r_name, country: r.r_country, bank: r.r_bank, acct: "****" + String(r.r_acct).slice(-4), swift: r.r_swift }, events, refund: refund ? { status: refund.status, amount: refund.amount_minor / 100 } : undefined });
const evIns = (env, tid, t, actor, status, note) => env.DB.prepare("INSERT INTO transfer_events (tid,t,actor,status,note) VALUES (?,?,?,?,?)").bind(tid, t, actor, status, note);

// Only ID-approved users reach this. Creating transfers needs TRANSFERS_ENABLED=true and a D1 database.
async function transfers(request, env, ctx) {
  const a = await approved(request, env); if (a.err) return a.err;
  const m = request.method, url = new URL(request.url);
  if (!env.DB) return m === "GET" ? J([]) : J({ error: "Transfers are not open yet" }, 503);
  await ensureDb(env);
  if (m === "GET") {
    if (url.searchParams.get("usage")) { const R = await (await rates(request, env, ctx)).json(); if (!R.perUnit) return J({ error: "Rates unavailable" }, 503); return J(await usage(env, a.phone, R)); }
    const id = url.searchParams.get("id");
    if (id) {
      const r = await env.DB.prepare("SELECT * FROM transfers WHERE id=? AND phone=?").bind(id, a.phone).first(); if (!r) return J({ error: "Not found" }, 404);
      const ev = await env.DB.prepare("SELECT t,status,note FROM transfer_events WHERE tid=? ORDER BY id").bind(id).all();
      const rf = await env.DB.prepare("SELECT * FROM refunds WHERE tid=?").bind(id).first();
      return J(view(r, ev.results, rf));
    }
    const { results } = await env.DB.prepare("SELECT * FROM transfers WHERE phone=? ORDER BY created DESC LIMIT 50").bind(a.phone).all();
    return J(results.map(r => view(r)));
  }
  if (m !== "POST") return J({ error: "Method not allowed" }, 405);
  if (env.TRANSFERS_ENABLED !== "true") return J({ error: "Transfers are not open yet" }, 503);
  const b = await request.json().catch(() => null); if (!b) return J({ error: "Bad request" }, 400);
  const now = new Date().toISOString();
  if (b.action === "cancel") {
    const r = await env.DB.prepare("UPDATE transfers SET status='cancelled', updated=? WHERE id=? AND phone=? AND status='awaiting_payment'").bind(now, String(b.id), a.phone).run();
    if (!r.meta.changes) return J({ error: "This transfer can no longer be cancelled." }, 400);
    await evIns(env, b.id, now, "customer", "cancelled", "").run();
    return J({ ok: true });
  }
  const rk = "trl:" + a.phone; if (await tooMany(env, rk, 5)) return J({ error: "Too many transfers. Try again later." }, 429);
  const R = await (await rates(request, env, ctx)).json(); if (!R.perUnit) return J({ error: "Rates unavailable" }, 503);
  const c = String(b.currency || ""), amt = Number(b.amount), rc = b.recipient || {}, rate = R.perUnit[c], t = s => String(s || "").trim();
  const bad = !rate ? "currency" : !(amt >= R.minSendMWK && amt <= R.maxSendMWK) ? "amount outside the limits" : !PAY_METHODS.includes(b.method) ? "payment method" : (t(rc.name).length < 2 || t(rc.country).length < 2 || t(rc.bank).length < 2) ? "recipient details" : t(rc.acct).replace(/\s/g, "").length < 6 ? "account number" : !/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(t(rc.swift)) ? "SWIFT code" : !/^[A-Za-z0-9-]{8,64}$/.test(b.key || "") ? "request key" : "";
  if (bad) return J({ error: "Invalid transfer", detail: bad }, 400);
  if (Math.abs(rate - Number(b.rate)) / rate > 0.0005) return J({ error: "Rate changed", rate }, 409);
  const dup = await env.DB.prepare("SELECT * FROM transfers WHERE phone=? AND idem=?").bind(a.phone, b.key).first(); if (dup) return J(view(dup));
  const amountMinor = mk(amt), feeMinor = Math.max(mk(R.minFeeMWK), Math.round(amountMinor * R.feePct / 100)), recvMinor = Math.floor(((amountMinor - feeMinor) / 100) / rate * 100);
  if (recvMinor <= 0) return J({ error: "Invalid transfer", detail: "amount too small after the fee" }, 400);
  const u = await usage(env, a.phone, R);
  if (amt > u.daily.remaining) return J({ error: "Limit reached", detail: "you can send up to MWK " + u.daily.remaining.toLocaleString("en-GB") + " more today", limit: "daily", remaining: u.daily.remaining }, 422);
  if (amt > u.monthly.remaining) return J({ error: "Limit reached", detail: "you can send up to MWK " + u.monthly.remaining.toLocaleString("en-GB") + " more this month", limit: "monthly", remaining: u.monthly.remaining }, 422);
  await bump(env, rk);
  const kyc = await env.KV.get(kkey(a.phone), "json"), id = crypto.randomUUID();
  for (let i = 0; i < 4; i++) {
    const ref = newRef();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO transfers (id,ref,idem,phone,sender,created,updated,amount_minor,fee_minor,rate,currency,receive_minor,method,r_name,r_country,r_bank,r_acct,r_swift,status,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(id, ref, b.key, a.phone, kyc ? kyc.name : "", now, now, amountMinor, feeMinor, rate, c, recvMinor, b.method, t(rc.name).slice(0, 100), t(rc.country).slice(0, 60), t(rc.bank).slice(0, 100), t(rc.acct).slice(0, 40), t(rc.swift).toUpperCase(), "awaiting_payment", ""),
        evIns(env, id, now, "customer", "awaiting_payment", "")
      ]);
      break;
    } catch (e) {
      const d2 = await env.DB.prepare("SELECT * FROM transfers WHERE phone=? AND idem=?").bind(a.phone, b.key).first(); if (d2) return J(view(d2));
      if (i === 3) throw e;
    }
  }
  const row = await env.DB.prepare("SELECT * FROM transfers WHERE id=?").bind(id).first();
  return J(view(row, [{ t: now, status: "awaiting_payment", note: "" }]), 201);
}

async function adminRefunds(request, env) {
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (adm.role !== "owner") return J({ error: "Owner only" }, 403);
  if (!env.DB) return J({ error: "D1 database not bound" }, 501);
  await ensureDb(env);
  if (request.method === "GET") { const { results } = await env.DB.prepare("SELECT * FROM refunds ORDER BY (status='due') DESC, created DESC LIMIT 100").all(); return J(results.map(x => ({ id: x.id, ref: x.ref, phone: x.phone, amount: x.amount_minor / 100, status: x.status, created: x.created, note: x.note }))); }
  const b = await request.json().catch(() => null); if (!b) return J({ error: "Bad request" }, 400);
  const x = await env.DB.prepare("SELECT * FROM refunds WHERE id=?").bind(String(b.id)).first();
  if (!x || x.status !== "due") return J({ error: "This refund is not waiting to be paid." }, 400);
  const now = new Date().toISOString(), note = String(b.note || "").slice(0, 200);
  await env.DB.batch([env.DB.prepare("UPDATE refunds SET status='refunded', updated=?, actor=?, note=? WHERE id=?").bind(now, adm.email, note, x.id), evIns(env, x.tid, now, adm.email, "refunded", note)]);
  await audit(env, adm.email, "refund paid", x.ref + " MWK " + x.amount_minor / 100);
  let sms = true;
  if (hasSms(env)) { try { sms = (await sendSms(env, x.phone, "Malawi Remit: your refund of MWK " + (x.amount_minor / 100).toLocaleString("en-GB") + " for transfer " + x.ref + " has been sent.")).ok; } catch (e) { sms = false; } }
  return J({ ok: true, sms });
}

// Daily reconciliation (Malawi dates). Compare "payments received" with your Airtel/TNM/bank statements and "sent" with your payout partner's.
async function adminReport(request, env) {
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (adm.role !== "owner") return J({ error: "Owner only" }, 403);
  if (!env.DB) return J({ error: "D1 database not bound" }, 501);
  await ensureDb(env);
  const u = new URL(request.url), date = u.searchParams.get("date") || new Date(Date.now() + CAT).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return J({ error: "Use a date like 2026-11-18." }, 400);
  const [y, mo, d] = date.split("-").map(Number), s0 = Date.UTC(y, mo - 1, d) - CAT, from = new Date(s0).toISOString(), to = new Date(s0 + 864e5).toISOString();
  const ev = (await env.DB.prepare("SELECT e.t AS et, e.status AS es, e.actor AS actor, t.* FROM transfer_events e JOIN transfers t ON t.id=e.tid WHERE e.t>=? AND e.t<? ORDER BY e.t").bind(from, to).all()).results;
  if (u.searchParams.get("format") === "csv") {
    const q = v => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const rows = ["time_utc,reference,event,by,sender,sender_phone,amount_mwk,fee_mwk,currency,receive,method"].concat(ev.map(x => [x.et, x.ref, x.es, x.actor, x.sender, x.phone, x.amount_minor / 100, x.fee_minor / 100, x.currency, x.receive_minor / 100, x.method].map(q).join(",")));
    return new Response(rows.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="report-' + date + '.csv"', "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
  const created = (await env.DB.prepare("SELECT amount_minor FROM transfers WHERE created>=? AND created<?").bind(from, to).all()).results;
  const by = s => ev.filter(x => x.es === s), sum = (l, f) => l.reduce((n, x) => n + f(x), 0), sentBy = {};
  for (const x of by("sent")) sentBy[x.currency] = Math.round(((sentBy[x.currency] || 0) + x.receive_minor / 100) * 100) / 100;
  const due = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_minor),0) AS s FROM refunds WHERE status='due'").first();
  const fl = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_minor),0) AS s FROM transfers WHERE status IN ('paid','sent')").first();
  const stale = await env.DB.prepare("SELECT COUNT(*) AS n FROM transfers WHERE status='awaiting_payment' AND created<?").bind(new Date(Date.now() - 864e5).toISOString()).first();
  return J({ date, created: { count: created.length, mwk: sum(created, x => x.amount_minor) / 100 }, paymentsIn: { count: by("paid").length, mwk: sum(by("paid"), x => x.amount_minor) / 100 }, sent: { count: by("sent").length, byCurrency: sentBy }, completed: { count: by("completed").length, feesMWK: sum(by("completed"), x => x.fee_minor) / 100 }, failed: { count: by("failed").length }, refundedToday: { count: by("refunded").length, mwk: sum(by("refunded"), x => x.amount_minor) / 100 }, refundsDue: { count: due.n, mwk: due.s / 100 }, inFlight: { count: fl.n, mwk: fl.s / 100 }, staleAwaitingPayment: stale.n });
}

async function adminCurrencies(request, env) {
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (adm.role !== "owner") return J({ error: "Owner only" }, 403);
  const saved = await env.KV.get("currencies", "json");
  if (request.method === "GET") { const base = await (await env.ASSETS.fetch(new URL("/rates.json", request.url))).json(); return J({ all: CUR, disabled: saved ? saved.disabled : base.disabledCurrencies || [] }); }
  const b = await request.json().catch(() => null);
  if (!b || !Array.isArray(b.disabled) || !b.disabled.every(c => CUR.includes(c))) return J({ error: "Invalid list" }, 400);
  await env.KV.put("currencies", JSON.stringify({ disabled: b.disabled })); await audit(env, adm.email, "currencies updated", b.disabled.length + " switched off"); return J({ ok: true });
}

async function adminLimits(request, env) {
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (adm.role !== "owner") return J({ error: "Owner only" }, 403);
  const m = request.method;
  if (m === "GET") { const d = norm(new URL(request.url).searchParams.get("phone") || "").slice(1); return J(d.length >= 9 ? (await env.KV.get("limit:" + d, "json")) || {} : {}); }
  const b = await request.json().catch(() => null), d = norm((b && b.phone) || "").slice(1);
  if (d.length < 9) return J({ error: "Enter a valid phone number." }, 400);
  if (m === "DELETE") { await env.KV.delete("limit:" + d); await audit(env, adm.email, "custom limit removed", "+" + d); return J({ ok: true }); }
  if (!num(b.daily) || !num(b.monthly) || b.monthly < b.daily) return J({ error: "Enter a daily and a monthly limit (monthly must not be lower)." }, 400);
  await env.KV.put("limit:" + d, JSON.stringify({ daily: b.daily, monthly: b.monthly, by: adm.email }));
  await audit(env, adm.email, "custom limit set", "+" + d + " " + b.daily + "/" + b.monthly); return J({ ok: true });
}

/* ---------- monitoring ---------- */
async function health(request, env, ctx) {
  const problems = [], warnings = [], info = {}, n = async k => parseInt(await env.KV.get(k)) || 0;
  try {
    const R = await (await rates(request, env, ctx)).json();
    if (!R.perUnit) problems.push("Rates are unavailable");
    else { info.ratesDate = R.updated; if (R.stale) problems.push("Rates are out of date (last " + R.updated + ")"); if (R.override) warnings.push("A manual rate override is switched on"); }
  } catch (e) { problems.push("The rates check failed"); }
  if (env.AT_API_KEY && env.AT_USERNAME) {
    try {
      const host = env.AT_USERNAME === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
      const j = await (await fetch(`https://${host}/version1/user?username=${encodeURIComponent(env.AT_USERNAME)}`, { headers: { apiKey: env.AT_API_KEY, accept: "application/json" } })).json().catch(() => null);
      const bal = parseFloat(String(j && j.UserData && j.UserData.balance).replace(/[^0-9.\-]/g, ""));
      if (isFinite(bal)) { info.smsBalance = j.UserData.balance; if (bal < (parseFloat(env.SMS_MIN_BALANCE) || 5)) problems.push("SMS balance is low (" + j.UserData.balance + ")"); }
      else warnings.push("Could not read the SMS balance");
    } catch (e) { warnings.push("Could not read the SMS balance"); }
  }
  const sf = await n("smsfail"), er = await n("err5xx");
  if (sf >= 3) problems.push("Text messages are failing (" + sf + " in the last hour)");
  if (er >= 5) problems.push("Server errors are rising (" + er + " in the last hour)");
  const { keys } = await env.KV.list({ prefix: "pending:", limit: 1 });
  if (keys[0] && Number(keys[0].name.split(":")[1]) < Date.now() - 864e5) problems.push("ID checks have been waiting over 24 hours");
  if (env.DB) {
    try {
      await ensureDb(env);
      const ago = h => new Date(Date.now() - h * 36e5).toISOString(), c = async (sql, a) => (await env.DB.prepare(sql).bind(a).first()).n;
      const rf = await c("SELECT COUNT(*) AS n FROM refunds WHERE status='due' AND created<?", ago(24)); if (rf) problems.push(rf + " refund(s) owed for over 24 hours");
      const pd = await c("SELECT COUNT(*) AS n FROM transfers WHERE status='paid' AND updated<?", ago(24)); if (pd) problems.push(pd + " paid transfer(s) not sent for over 24 hours");
      const st = await c("SELECT COUNT(*) AS n FROM transfers WHERE status='sent' AND updated<?", ago(48)); if (st) problems.push(st + " sent transfer(s) not completed for over 48 hours");
      const aw = await c("SELECT COUNT(*) AS n FROM transfers WHERE status='awaiting_payment' AND created<?", ago(24)); if (aw) warnings.push(aw + " transfer(s) awaiting payment for over 24 hours");
    } catch (e) { warnings.push("Could not check transfers"); }
  }
  return { ok: !problems.length, problems, warnings, info, checked: new Date().toISOString() };
}
// For an uptime monitor (checks every 5 minutes): 200 = fine, 503 = a problem. Also texts ALERT_PHONE once per new problem.
async function statusEndpoint(request, env, ctx) {
  if (!env.MONITOR_KEY) return J({ error: "Set MONITOR_KEY to use this." }, 501);
  const k = request.headers.get("x-monitor-key") || new URL(request.url).searchParams.get("key") || "";
  if (!same(k, env.MONITOR_KEY)) return J({ error: "Unauthorized" }, 401);
  const h = await health(request, env, ctx);
  if (h.ok) await env.KV.delete("alert:sig");
  else if (env.ALERT_PHONE && hasSms(env)) {
    const sig = h.problems.join("|");
    if ((await env.KV.get("alert:sig")) !== sig) { await env.KV.put("alert:sig", sig, { expirationTtl: 21600 }); await sendSms(env, norm(env.ALERT_PHONE), "Malawi Remit alert: " + h.problems.join("; ").slice(0, 140)); }
  }
  return J(h, h.ok ? 200 : 503);
}
async function adminStatus(request, env, ctx) {
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (adm.role !== "owner") return J({ error: "Owner only" }, 403);
  return J(await health(request, env, ctx));
}

async function adminTransfers(request, env) {
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (adm.role !== "owner") return J({ error: "Owner only" }, 403);
  if (!env.DB) return J({ error: "D1 database not bound" }, 501);
  await ensureDb(env);
  if (request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM transfers ORDER BY created DESC LIMIT 100").all();
    return J(results.map(r => ({ ...view(r), r_acct: r.r_acct, phone: r.phone, sender: r.sender })));
  }
  const b = await request.json().catch(() => null); if (!b) return J({ error: "Bad request" }, 400);
  const r = await env.DB.prepare("SELECT * FROM transfers WHERE id=?").bind(String(b.id)).first(); if (!r) return J({ error: "Not found" }, 404);
  if (!(NEXT[r.status] || []).includes(b.status)) return J({ error: "Cannot move from " + r.status + " to " + b.status }, 400);
  const now = new Date().toISOString(), note = String(b.note || "").slice(0, 200);
  const ops = [env.DB.prepare("UPDATE transfers SET status=?, updated=?, note=? WHERE id=?").bind(b.status, now, note, r.id), evIns(env, r.id, now, adm.email, b.status, note)];
  const refund = b.status === "failed" && (r.status === "paid" || r.status === "sent"); // money was received, so it is owed back
  if (refund) ops.push(env.DB.prepare("INSERT INTO refunds (id,tid,ref,phone,amount_minor,status,created,updated,actor,note) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), r.id, r.ref, r.phone, r.amount_minor, "due", now, now, adm.email, note), evIns(env, r.id, now, adm.email, "refund_due", ""));
  await env.DB.batch(ops);
  await audit(env, adm.email, "transfer " + b.status, r.ref);
  const txt = { paid: "we have received your payment", sent: "has been sent to the recipient's bank", completed: "is complete", failed: "could not be completed" + (note ? " (" + note.slice(0, 60) + ")" : "") + (r.status === "paid" || r.status === "sent" ? ". Your payment will be refunded" : "") }[b.status];
  let sms = true;
  if (txt && hasSms(env)) { try { sms = (await sendSms(env, r.phone, "Malawi Remit: transfer " + r.ref + " " + txt + ".")).ok; } catch (e) { sms = false; } }
  return J({ ok: true, sms });
}

/* ---------- admin ---------- */
async function adminRates(request, env) {
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (adm.role !== "owner") return J({ error: "Owner only" }, 403);
  if (request.method === "DELETE") { await env.KV.delete("rates"); await audit(env, adm.email, "rate override removed", ""); return J({ ok: true }); }
  if (request.method === "GET") return J((await env.KV.get("rates", "json")) || {});
  const b = await request.json().catch(() => null);
  if (!b || !b.perUnit || !Object.keys(b.perUnit).length || !Object.entries(b.perUnit).every(([k, v]) => CUR.includes(k) && num(v))) return J({ error: "Invalid rates" }, 400);
  const out = { perUnit: b.perUnit, source: String(b.source || "Reserve Bank of Malawi official rate").slice(0, 120), updated: new Date().toISOString().slice(0, 10) };
  await env.KV.put("rates", JSON.stringify(out)); await audit(env, adm.email, "rate override published", "USD " + out.perUnit.USD); return J(out);
}
async function adminKyc(request, env) {
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const { keys } = await env.KV.list({ prefix: "kyc:" });
    const rows = await Promise.all(keys.map(k => env.KV.get(k.name, "json")));
    return J(rows.filter(Boolean).sort((a, b) => b.submitted.localeCompare(a.submitted)));
  }
  const b = await request.json().catch(() => null);
  if (!b || !["approved", "rejected"].includes(b.decision)) return J({ error: "Invalid decision" }, 400);
  const k = kkey(b.phone), rec = await env.KV.get(k, "json"); if (!rec) return J({ error: "Not found" }, 404);
  delete rec.idImg; delete rec.selfie;
  if (rec.pendingKey) { await env.KV.delete(rec.pendingKey); delete rec.pendingKey; }
  Object.assign(rec, { decidedBy: adm.email, status: b.decision, reason: String(b.reason || "").slice(0, 200), decided: new Date().toISOString() });
  await env.KV.put(k, JSON.stringify(rec)); await audit(env, adm.email, "ID " + b.decision, rec.phone + " " + rec.name);
  let sms = false;
  if (hasSms(env)) { try { sms = (await sendSms(env, rec.phone, b.decision === "approved" ? "Malawi Remit: your ID is approved. Open the app to continue." : "Malawi Remit: we could not approve your ID" + (rec.reason ? " (" + rec.reason.slice(0, 80) + ")" : "") + ". Open the app to try again.")).ok; } catch (e) {} }
  return J({ ok: true, sms });
}

async function adminFees(request, env) {
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (adm.role !== "owner") return J({ error: "Owner only" }, 403);
  if (request.method === "GET") return J((await env.KV.get("fees", "json")) || {});
  const b = await request.json().catch(() => null);
  const ok = b && typeof b.feePct === "number" && b.feePct >= 0 && b.feePct <= 10 && num(b.minFeeMWK) && num(b.minSendMWK) && num(b.maxSendMWK) && b.maxSendMWK > b.minSendMWK && num(b.dailyLimitMWK) && num(b.monthlyLimitMWK) && b.dailyLimitMWK >= b.minSendMWK && b.monthlyLimitMWK >= b.dailyLimitMWK;
  if (!ok) return J({ error: "Invalid fees" }, 400);
  const out = { feePct: b.feePct, minFeeMWK: b.minFeeMWK, minSendMWK: b.minSendMWK, maxSendMWK: b.maxSendMWK, dailyLimitMWK: b.dailyLimitMWK, monthlyLimitMWK: b.monthlyLimitMWK };
  await env.KV.put("fees", JSON.stringify(out)); await audit(env, adm.email, "fees saved", out.feePct + "% min " + out.minFeeMWK); return J(out);
}

/*TOTP*/
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32enc = u => { let bits = "", o = ""; for (const x of u) bits += x.toString(2).padStart(8, "0"); for (let i = 0; i < bits.length; i += 5) o += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]; return o; };
const b32dec = s => { let bits = ""; for (const c of s.replace(/=+$/, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0"); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Uint8Array.from(o); };
async function totp(secret, t = Date.now()) {
  const buf = new ArrayBuffer(8); new DataView(buf).setUint32(4, Math.floor(t / 30000));
  const key = await crypto.subtle.importKey("raw", b32dec(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf)), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, "0");
}
const totpOk = async (secret, code) => { for (const d of [-1, 0, 1]) if ((await totp(secret, Date.now() + d * 30000)) === String(code).trim()) return true; return false; };
/*END*/
async function audit(env, who, action, detail) {
  try { await env.KV.put("audit:" + Date.now() + "-" + hex(crypto.getRandomValues(new Uint8Array(3))), JSON.stringify({ t: new Date().toISOString(), who, action, detail: String(detail || "").slice(0, 120) }), { expirationTtl: 7776000 }); } catch (e) {}
}

/* ---------- admin accounts: email + password, hashed (PBKDF2), 12-hour sessions ---------- */
const ek = e => "admin:" + String(e).trim().toLowerCase();
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
async function hashPw(pw, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return { salt: hex(salt), hash: hex(bits) };
}
const tooMany = async (env, k, max) => (parseInt(await env.KV.get(k)) || 0) >= max;
const bump = async (env, k) => env.KV.put(k, String((parseInt(await env.KV.get(k)) || 0) + 1), { expirationTtl: 900 });
const okEmail = e => /^\S+@\S+\.\S+$/.test(e || "");

async function adminAuth(request, env, action) {
  const m = request.method, b = (m === "POST" || m === "DELETE") ? await request.json().catch(() => ({})) : {};
  const ip = request.headers.get("cf-connecting-ip") || "x", kip = "alrl:ip:" + ip;
  if (action === "setup" && m === "POST") {              // create or reset an admin with the master key (ADMIN_TOKEN)
    if (await tooMany(env, kip, 15)) return J({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    if (!env.ADMIN_TOKEN || b.setupKey !== env.ADMIN_TOKEN) { await bump(env, kip); return J({ error: "Wrong setup key." }, 401); }
    if (!okEmail(b.email) || String(b.password || "").length < 10) return J({ error: "Enter a valid email and a password of at least 10 characters." }, 400);
    const old = await env.KV.get(ek(b.email), "json");
    await env.KV.put(ek(b.email), JSON.stringify({ ...(await hashPw(b.password)), role: old ? old.role : "owner", created: old ? old.created : new Date().toISOString() }));
    return J({ ok: true });
  }
  if (action === "login" && m === "POST") {
    const ke = "alrl:e:" + ek(b.email || "");
    if ((await tooMany(env, kip, 15)) || (await tooMany(env, ke, 5))) return J({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    const rec = await env.KV.get(ek(b.email || ""), "json");
    const h = await hashPw(String(b.password || ""), rec ? rec.salt : null);
    if (!rec || !same(h.hash, rec.hash)) { await bump(env, kip); await bump(env, ke); await audit(env, String(b.email || "").slice(0, 60), "login failed", ip); return J({ error: "Wrong email or password." }, 401); }
    if (rec.totp) {
      if (!b.code) return J({ need2fa: true });
      if (!(await totpOk(rec.totp, b.code))) { await bump(env, kip); await bump(env, ke); return J({ error: "That code is not correct." }, 401); }
    }
    const token = hex(crypto.getRandomValues(new Uint8Array(32))), email = ek(b.email).slice(6);
    await env.KV.put("asess:" + token, JSON.stringify({ email, role: rec.role }), { expirationTtl: 43200 });
    await env.KV.delete(ke); await audit(env, email, "signed in", ip);
    return J({ token, email, role: rec.role });
  }
  const adm = await isAdmin(request, env); if (!adm) return J({ error: "Unauthorized" }, 401);
  if (action === "me") { const r = await env.KV.get(ek(adm.email), "json"); return J({ ...adm, totp: !!(r && r.totp) }); }
  if (action === "audit") { if (adm.role !== "owner") return J({ error: "Owner only" }, 403); const { keys } = await env.KV.list({ prefix: "audit:" }); return J((await Promise.all(keys.slice(-50).map(k => env.KV.get(k.name, "json")))).filter(Boolean).reverse()); }
  if (action === "2fa" && m === "POST") {
    const rec = await env.KV.get(ek(adm.email), "json");
    if (b.action === "start") { const secret = b32enc(crypto.getRandomValues(new Uint8Array(20))); await env.KV.put(ek(adm.email), JSON.stringify({ ...rec, totpPending: secret })); return J({ secret, uri: "otpauth://totp/Malawi%20Remit:" + encodeURIComponent(adm.email) + "?secret=" + secret + "&issuer=Malawi%20Remit" }); }
    if (b.action === "confirm") { if (!rec.totpPending || !(await totpOk(rec.totpPending, b.code))) return J({ error: "That code is not correct." }, 400); const { totpPending, ...rest } = rec; await env.KV.put(ek(adm.email), JSON.stringify({ ...rest, totp: totpPending })); await audit(env, adm.email, "two-step sign-in on", ""); return J({ ok: true }); }
    if (b.action === "disable") { if (!same((await hashPw(String(b.password || ""), rec.salt)).hash, rec.hash)) return J({ error: "Wrong password." }, 400); const { totp, totpPending, ...rest } = rec; await env.KV.put(ek(adm.email), JSON.stringify(rest)); await audit(env, adm.email, "two-step sign-in off", ""); return J({ ok: true }); }
    return J({ error: "Bad request" }, 400);
  }
  if (action === "logout") { await env.KV.delete("asess:" + (request.headers.get("authorization") || "").replace("Bearer ", "")); return J({ ok: true }); }
  if (action === "password" && m === "POST") {
    const rec = await env.KV.get(ek(adm.email), "json");
    if (!rec || !same((await hashPw(String(b.current || ""), rec.salt)).hash, rec.hash)) return J({ error: "Current password is wrong." }, 400);
    if (String(b.next || "").length < 10) return J({ error: "New password must be at least 10 characters." }, 400);
    await env.KV.put(ek(adm.email), JSON.stringify({ ...rec, ...(await hashPw(b.next)) })); return J({ ok: true });
  }
  if (action === "users") {
    if (adm.role !== "owner") return J({ error: "Owner only" }, 403);
    if (m === "GET") { const { keys } = await env.KV.list({ prefix: "admin:" }); return J(await Promise.all(keys.map(async k => ({ email: k.name.slice(6), role: ((await env.KV.get(k.name, "json")) || {}).role })))); }
    if (m === "POST") {
      if (!okEmail(b.email) || String(b.password || "").length < 10) return J({ error: "Enter a valid email and a password of at least 10 characters." }, 400);
      if (await env.KV.get(ek(b.email))) return J({ error: "That admin already exists." }, 400);
      await env.KV.put(ek(b.email), JSON.stringify({ ...(await hashPw(b.password)), role: b.role === "owner" ? "owner" : "reviewer", created: new Date().toISOString() })); await audit(env, adm.email, "admin added", b.email); return J({ ok: true });
    }
    if (m === "DELETE") { if (String(b.email).toLowerCase() === adm.email) return J({ error: "You cannot remove yourself." }, 400); await env.KV.delete(ek(b.email)); await audit(env, adm.email, "admin removed", b.email); return J({ ok: true }); }
  }
  return J({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const p = new URL(request.url).pathname;
    if (/^\/(docs|tests)\//.test(p)) return new Response("Not found", { status: 404 }); // internal files are never served
    if (!p.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (p === "/api/config") return J({ turnstile: env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET ? env.TURNSTILE_SITEKEY : "", transfers: env.TRANSFERS_ENABLED === "true" && !!env.DB }, 200, "public, max-age=300");
      if (p === "/api/health") return J({ worker: true, kv: !!env.KV, sms: !!hasSms(env), admin: !!env.ADMIN_TOKEN, db: !!env.DB, botCheck: !!(env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET) });
      if (p === "/api/rates") return rates(request, env, ctx);
      if (!env.KV) return J({ error: "KV not bound" }, 501);
      if (p === "/api/logout") { await env.KV.delete("sess:" + (request.headers.get("authorization") || "").replace("Bearer ", "")); return J({ ok: true }); }
      if (p === "/api/otp") return otp(request, env);
      if (p === "/api/kyc") return kyc(request, env);
      if (p === "/api/transfers") return transfers(request, env, ctx);
      if (p === "/api/status") return statusEndpoint(request, env, ctx);
      if (p === "/api/admin/status") return adminStatus(request, env, ctx);
      if (p === "/api/admin/refunds") return adminRefunds(request, env);
      if (p === "/api/admin/report") return adminReport(request, env);
      if (p === "/api/admin/currencies") return adminCurrencies(request, env);
      if (p === "/api/admin/limits") return adminLimits(request, env);
      if (p === "/api/admin/transfers") return adminTransfers(request, env);
      if (p === "/api/admin/rates") return adminRates(request, env);
      if (["login", "logout", "me", "setup", "password", "users", "2fa", "audit"].includes(p.slice(11)) && p.startsWith("/api/admin/")) return adminAuth(request, env, p.slice(11));
      if (p === "/api/admin/fees") return adminFees(request, env);
      if (p === "/api/admin/kyc") return adminKyc(request, env);
      return J({ error: "Not found" }, 404);
    } catch (e) { try { if (env.KV) await env.KV.put("err5xx", String((parseInt(await env.KV.get("err5xx")) || 0) + 1), { expirationTtl: 3600 }); } catch (x) {} return J({ error: "Server error", detail: String((e && e.message) || e).slice(0, 120) }, 500); }
  }
};
