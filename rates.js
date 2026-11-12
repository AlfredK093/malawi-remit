// Cloudflare Pages Function: GET /api/rates
// Order of sources: RATES_URL (your bank-rate feed) > market reference API > static rates.json
export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL("/api/rates", request.url).toString());
  const base = await (await env.ASSETS.fetch(new URL("/rates.json", request.url))).json();
  if (env.KV) {
    // Rates set by an admin always win and are never cached
    const manual = await env.KV.get("rates", "json");
    if (manual) return new Response(JSON.stringify({ ...base, ...manual, live: true }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const hit = await cache.match(key);
  if (hit) return hit;
  let out = { ...base, live: false };
  try {
    if (env.RATES_URL) {
      // Expected shape: { updated, source, perUnit: { USD, GBP, EUR, ZAR } } in MWK per 1 unit
      const j = await (await fetch(env.RATES_URL)).json();
      if (j && j.perUnit && j.perUnit.USD) out = { ...base, ...j, live: true };
    } else {
      const j = await (await fetch("https://open.er-api.com/v6/latest/USD")).json();
      const r = j.rates;
      if (r && r.MWK && r.GBP && r.EUR && r.ZAR) {
        out = {
          ...base,
          updated: new Date().toISOString().slice(0, 10),
          source: "Market reference rate, not the official bank rate",
          perUnit: { USD: r.MWK, GBP: r.MWK / r.GBP, EUR: r.MWK / r.EUR, ZAR: r.MWK / r.ZAR },
          live: true
        };
      }
    }
  } catch (e) { /* fall back to static rates.json */ }

  if (!out.perUnit) return new Response(JSON.stringify({ error: "Rates unavailable" }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  for (const k of Object.keys(out.perUnit)) out.perUnit[k] = Math.round(out.perUnit[k] * 100) / 100;
  const res = new Response(JSON.stringify(out), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" }
  });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
