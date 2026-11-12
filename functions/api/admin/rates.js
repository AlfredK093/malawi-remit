// GET/POST /api/admin/rates (Authorization: Bearer ADMIN_TOKEN). Stores manual rates in KV.
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequest({ request, env }) {
  if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== "Bearer " + env.ADMIN_TOKEN) return J({ error: "Unauthorized" }, 401);
  if (!env.KV) return J({ error: "KV not bound" }, 501);
  if (request.method === "DELETE") { await env.KV.delete("rates"); return J({ ok: true }); }
  if (request.method === "GET") return J((await env.KV.get("rates", "json")) || {});
  if (request.method !== "POST") return J({ error: "Method not allowed" }, 405);
  const b = await request.json().catch(() => null);
  const num = v => typeof v === "number" && isFinite(v) && v > 0;
  if (!b || !b.perUnit || !["USD", "GBP", "EUR", "ZAR"].every(c => num(b.perUnit[c])) || !num(b.minFeeMWK) || typeof b.feePct !== "number" || b.feePct < 0 || b.feePct > 10) return J({ error: "Invalid rates" }, 400);
  const out = { perUnit: b.perUnit, feePct: b.feePct, minFeeMWK: b.minFeeMWK, source: String(b.source || "Reserve Bank of Malawi official rate").slice(0, 120), updated: new Date().toISOString().slice(0, 10) };
  await env.KV.put("rates", JSON.stringify(out));
  return J(out);
}
