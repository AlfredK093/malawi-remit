// POST /api/kyc: user submits ID check. GET /api/kyc?phone=...: user polls status.
// Needs a KV namespace bound as KV. Without it returns 501 and the app falls back to simulated approval.
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const key = p => "kyc:" + String(p).replace(/\D/g, "");

export async function onRequest({ request, env }) {
  if (!env.KV) return J({ error: "KV not bound" }, 501);
  const url = new URL(request.url);
  let sp = null; // verified phone from the SMS session (only when SMS is configured)
  if ((env.AT_API_KEY && env.AT_USERNAME) || (env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM)) {
    const t = (request.headers.get("authorization") || "").replace("Bearer ", "");
    sp = t ? await env.KV.get("sess:" + t) : null;
    if (!sp) return J({ error: "Sign in again" }, 401);
  }
  if (request.method === "GET") {
    const rec = await env.KV.get(key(sp || url.searchParams.get("phone") || ""), "json");
    return J(rec ? { status: rec.status, reason: rec.reason || "" } : { status: "none" });
  }
  if (request.method !== "POST") return J({ error: "Method not allowed" }, 405);
  const b = await request.json().catch(() => null);
  if (b && sp) b.phone = sp;
  const tooBig = s => typeof s !== "string" || s.length > 1500000;
  if (!b || !/^\+?\d{9,13}$/.test(b.phone || "") || !b.name || !b.dob || !b.idLast4 || tooBig(b.idImg) || tooBig(b.selfie)) return J({ error: "Invalid submission", detail: !b ? "no data" : (tooBig(b.idImg) || tooBig(b.selfie)) ? "photo too large or missing" : "missing field" }, 400);
  const rec = { phone: b.phone, name: String(b.name).slice(0, 100), dob: b.dob, idType: String(b.idType).slice(0, 30), idLast4: String(b.idLast4).slice(0, 4), address: String(b.address || "").slice(0, 150), idImg: b.idImg, selfie: b.selfie, status: "pending", submitted: new Date().toISOString() };
  await env.KV.put(key(b.phone), JSON.stringify(rec));
  return J({ status: "pending" });
}
