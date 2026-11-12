// GET /api/admin/kyc: list submissions. POST {phone, decision: "approved"|"rejected", reason}: decide.
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequest({ request, env }) {
  if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== "Bearer " + env.ADMIN_TOKEN) return J({ error: "Unauthorized" }, 401);
  if (!env.KV) return J({ error: "KV not bound" }, 501);
  if (request.method === "GET") {
    const { keys } = await env.KV.list({ prefix: "kyc:" });
    const rows = await Promise.all(keys.map(k => env.KV.get(k.name, "json")));
    return J(rows.filter(Boolean).sort((a, b) => b.submitted.localeCompare(a.submitted)));
  }
  if (request.method !== "POST") return J({ error: "Method not allowed" }, 405);
  const b = await request.json().catch(() => null);
  if (!b || !["approved", "rejected"].includes(b.decision)) return J({ error: "Invalid decision" }, 400);
  const k = "kyc:" + String(b.phone).replace(/\D/g, "");
  const rec = await env.KV.get(k, "json");
  if (!rec) return J({ error: "Not found" }, 404);
  // Delete the ID photo and selfie once a decision is made
  delete rec.idImg; delete rec.selfie;
  Object.assign(rec, { status: b.decision, reason: String(b.reason || "").slice(0, 200), decided: new Date().toISOString() });
  await env.KV.put(k, JSON.stringify(rec));
  return J({ ok: true });
}
