// GET /api/rates: Reserve Bank of Malawi official rates, fetched automatically, cached 15 min at the edge.
// Order: admin manual override (KV) > RATES_URL (optional custom feed) > Frankfurter (RBM, free, no key)
//        > AllRatesToday (RBM, needs ALLRATES_KEY) > last good rates saved in KV (flagged stale).
// Never falls back to market or sample rates.
const CUR = ["USD", "GBP", "EUR", "ZAR"];
const num = v => typeof v === "number" && isFinite(v) && v > 0;
const J = (o, s = 200, cc = "no-store") => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": cc } });

function pack(rows, source) {
  const perUnit = {}; let date = "9999";
  for (const x of rows) { perUnit[x.c] = x.rate; if (x.date && x.date < date) date = x.date; } // oldest date, to be conservative
  return { perUnit, updated: date === "9999" ? new Date().toISOString().slice(0, 10) : date, source };
}
const pick = j => { const row = Array.isArray(j) ? j[0] : j; return { rate: row.rate ?? row.value ?? (row.rates && row.rates.MWK), date: row.date || row.rate_date }; };

async function fromFrankfurter() {
  const rows = await Promise.all(CUR.map(async c => {
    const r = await fetch(`https://api.frankfurter.dev/v2/rate/${c}/MWK?providers=RBM`);
    if (!r.ok) throw new Error("frankfurter " + r.status);
    const { rate, date } = pick(await r.json());
    if (!num(rate)) throw new Error("bad rate");
    return { c, rate, date };
  }));
  return pack(rows, "Reserve Bank of Malawi official reference rate");
}
async function fromAllRates(key) {
  const rows = await Promise.all(CUR.map(async c => {
    const r = await fetch(`https://allratestoday.com/api/v1/central-bank/rbm/latest?source=${c}&target=MWK`, { headers: { authorization: "Bearer " + key } });
    if (!r.ok) throw new Error("allrates " + r.status);
    const { rate, date } = pick(await r.json());
    if (!num(rate)) throw new Error("bad rate");
    return { c, rate, date };
  }));
  return pack(rows, "Reserve Bank of Malawi official rate");
}

export async function onRequestGet({ request, env, waitUntil }) {
  const base = await (await env.ASSETS.fetch(new URL("/rates.json", request.url))).json();
  const kv = env.KV;
  if (kv) {
    const m = await kv.get("rates", "json");
    if (m && m.perUnit) return J({ ...base, ...m, live: true, override: true });
  }
  const cache = caches.default, key = new Request(new URL("/api/rates", request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const tries = [];
  if (env.RATES_URL) tries.push(async () => {
    const j = await (await fetch(env.RATES_URL)).json();
    if (!j.perUnit || !CUR.every(c => num(j.perUnit[c]))) throw new Error("bad feed");
    return { perUnit: j.perUnit, updated: j.updated, source: j.source || "Bank rate feed" };
  });
  tries.push(fromFrankfurter);
  if (env.ALLRATES_KEY) tries.push(() => fromAllRates(env.ALLRATES_KEY));

  let out = null;
  for (const t of tries) { try { out = await t(); break; } catch (e) { /* try next source */ } }
  if (out && kv) waitUntil(kv.put("rates:last", JSON.stringify(out)));
  if (!out && kv) { const last = await kv.get("rates:last", "json"); if (last) out = { ...last, stale: true }; }
  if (!out) return J({ error: "Rates unavailable" }, 503);

  if ((Date.now() - Date.parse(out.updated)) / 864e5 > 4) out.stale = true;
  for (const k of Object.keys(out.perUnit)) out.perUnit[k] = Math.round(out.perUnit[k] * 100) / 100;
  const res = J({ ...base, ...out, live: true }, 200, out.stale ? "no-store" : "public, max-age=900");
  if (!out.stale) waitUntil(cache.put(key, res.clone()));
  return res;
}
