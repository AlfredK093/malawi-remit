// Single-file backend for Cloudflare Pages (replaces the functions/ folder). Routes: /api/*
const CUR = ["USD", "GBP", "EUR", "ZAR"];
const num = v => typeof v === "number" && isFinite(v) && v > 0;
const J = (o, s = 200, cc = "no-store") => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": cc } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const norm = p => { let d = String(p).replace(/\D/g, ""); if (d.startsWith("0")) d = "265" + d.slice(1); return "+" + d; };
const hasSms = e => (e.AT_API_KEY && e.AT_USERNAME) || (e.TWILIO_SID && e.TWILIO_TOKEN && e.TWILIO_FROM);
const isAdmin = (r, e) => e.ADMIN_TOKEN && r.headers.get("authorization") === "Bearer " + e.ADMIN_TOKEN;
const session = async (r, e) => { const t = (r.headers.get("authorization") || "").replace("Bearer ", ""); return t ? e.KV.get("sess:" + t) : null; };
const kkey = p => "kyc:" + String(p).replace(/\D/g, "");

/* ---------- rates ---------- */
const pack = (rows, source) => { const perUnit = {}; let d = "9999"; for (const x of rows) { perUnit[x.c] = x.rate; if (x.date && x.date < d) d = x.date; } return { perUnit, updated: d === "9999" ? new Date().toISOString().slice(0, 10) : d, source }; };
const pick = j => { const r = Array.isArray(j) ? j[0] : j; return { rate: r.rate ?? r.value ?? (r.rates && r.rates.MWK), date: r.date || r.rate_date }; };
async function fetchRows(urlFor, headers) {
  return Promise.all(CUR.map(async c => { const r = await fetch(urlFor(c), { headers }); if (!r.ok) throw new Error("rate " + r.status); const { rate, date } = pick(await r.json()); if (!num(rate)) throw new Error("bad"); return { c, rate, date }; }));
}
async function rates(request, env, ctx) {
  const base = await (await env.ASSETS.fetch(new URL("/rates.json", request.url))).json();
  if (env.KV) { const m = await env.KV.get("rates", "json"); if (m && m.perUnit) return J({ ...base, ...m, live: true, override: true }); }
  const cache = caches.default, key = new Request(new URL("/api/rates", request.url).toString());
  const hit = await cache.match(key); if (hit) return hit;
  const tries = [];
  if (env.RATES_URL) tries.push(async () => { const j = await (await fetch(env.RATES_URL)).json(); if (!j.perUnit || !CUR.every(c => num(j.perUnit[c]))) throw 0; return { perUnit: j.perUnit, updated: j.updated, source: j.source || "Bank rate feed" }; });
  tries.push(async () => pack(await fetchRows(c => `https://api.frankfurter.dev/v2/rate/${c}/MWK?providers=RBM`), "Reserve Bank of Malawi official reference rate"));
  if (env.ALLRATES_KEY) tries.push(async () => pack(await fetchRows(c => `https://allratestoday.com/api/v1/central-bank/rbm/latest?source=${c}&target=MWK`, { authorization: "Bearer " + env.ALLRATES_KEY }), "Reserve Bank of Malawi official rate"));
  let out = null;
  for (const t of tries) { try { out = await t(); break; } catch (e) {} }
  if (out && env.KV) ctx.waitUntil(env.KV.put("rates:last", JSON.stringify(out)));
  if (!out && env.KV) { const l = await env.KV.get("rates:last", "json"); if (l) out = { ...l, stale: true }; }
  if (!out) return J({ error: "Rates unavailable" }, 503);
  if ((Date.now() - Date.parse(out.updated)) / 864e5 > 4) out.stale = true;
  for (const k of Object.keys(out.perUnit)) out.perUnit[k] = Math.round(out.perUnit[k] * 100) / 100;
  const res = J({ ...base, ...out, live: true }, 200, out.stale ? "no-store" : "public, max-age=900");
  if (!out.stale) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/* ---------- SMS sign-in ---------- */
async function sendSms(env, to, text) {
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
    if (await env.KV.get("otprl:" + phone)) return J({ error: "Wait a minute before asking again." }, 429);
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
    await env.KV.put("sess:" + token, phone, { expirationTtl: 2592000 });
    return J({ token });
  }
  return J({ error: "Bad request" }, 400);
}

/* ---------- ID verification (user) ---------- */
async function kyc(request, env) {
  const phone = await session(request, env); if (!phone) return J({ error: "Sign in again" }, 401);
  if (request.method === "GET") { const r = await env.KV.get(kkey(phone), "json"); return J(r ? { status: r.status, reason: r.reason || "", name: r.name } : { status: "none" }); }
  if (request.method !== "POST") return J({ error: "Method not allowed" }, 405);
  const b = await request.json().catch(() => null);
  const big = s => typeof s !== "string" || s.length > 1500000;
  if (!b || !b.name || !b.dob || !b.idLast4 || big(b.idImg) || big(b.selfie)) return J({ error: "Invalid submission", detail: !b ? "no data" : (big(b.idImg) || big(b.selfie)) ? "photo too large or missing" : "missing field" }, 400);
  const old = await env.KV.get(kkey(phone), "json");
  if (old && old.status === "approved") return J({ status: "approved" });
  await env.KV.put(kkey(phone), JSON.stringify({ phone, name: String(b.name).slice(0, 100), dob: b.dob, idType: String(b.idType).slice(0, 30), idLast4: String(b.idLast4).slice(0, 4), address: String(b.address || "").slice(0, 150), idImg: b.idImg, selfie: b.selfie, status: "pending", submitted: new Date().toISOString() }));
  return J({ status: "pending" });
}

/* ---------- admin ---------- */
async function adminRates(request, env) {
  if (!isAdmin(request, env)) return J({ error: "Unauthorized" }, 401);
  if (request.method === "DELETE") { await env.KV.delete("rates"); return J({ ok: true }); }
  if (request.method === "GET") return J((await env.KV.get("rates", "json")) || {});
  const b = await request.json().catch(() => null);
  if (!b || !b.perUnit || !CUR.every(c => num(b.perUnit[c])) || !num(b.minFeeMWK) || typeof b.feePct !== "number" || b.feePct < 0 || b.feePct > 10) return J({ error: "Invalid rates" }, 400);
  const out = { perUnit: b.perUnit, feePct: b.feePct, minFeeMWK: b.minFeeMWK, source: String(b.source || "Reserve Bank of Malawi official rate").slice(0, 120), updated: new Date().toISOString().slice(0, 10) };
  await env.KV.put("rates", JSON.stringify(out)); return J(out);
}
async function adminKyc(request, env) {
  if (!isAdmin(request, env)) return J({ error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const { keys } = await env.KV.list({ prefix: "kyc:" });
    const rows = await Promise.all(keys.map(k => env.KV.get(k.name, "json")));
    return J(rows.filter(Boolean).sort((a, b) => b.submitted.localeCompare(a.submitted)));
  }
  const b = await request.json().catch(() => null);
  if (!b || !["approved", "rejected"].includes(b.decision)) return J({ error: "Invalid decision" }, 400);
  const k = kkey(b.phone), rec = await env.KV.get(k, "json"); if (!rec) return J({ error: "Not found" }, 404);
  delete rec.idImg; delete rec.selfie;
  Object.assign(rec, { status: b.decision, reason: String(b.reason || "").slice(0, 200), decided: new Date().toISOString() });
  await env.KV.put(k, JSON.stringify(rec)); return J({ ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const p = new URL(request.url).pathname;
    if (!p.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (p === "/api/health") return J({ worker: true, kv: !!env.KV, sms: !!hasSms(env), admin: !!env.ADMIN_TOKEN });
      if (p === "/api/rates") return rates(request, env, ctx);
      if (!env.KV) return J({ error: "KV not bound" }, 501);
      if (p === "/api/otp") return otp(request, env);
      if (p === "/api/kyc") return kyc(request, env);
      if (p === "/api/admin/rates") return adminRates(request, env);
      if (p === "/api/admin/kyc") return adminKyc(request, env);
      return J({ error: "Not found" }, 404);
    } catch (e) { return J({ error: "Server error", detail: String((e && e.message) || e).slice(0, 120) }, 500); }
  }
};
