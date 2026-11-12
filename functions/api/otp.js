// POST /api/otp  {action:"send", phone} | {action:"verify", phone, code}
// Providers (set secrets in Pages): Africa's Talking: AT_USERNAME, AT_API_KEY, optional AT_SENDER_ID.
// Twilio: TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM. Needs KV. With none configured it returns 501 and the app uses demo code 123456.
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const sha = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const norm = p => { let d = String(p).replace(/\D/g, ""); if (d.startsWith("0")) d = "265" + d.slice(1); return "+" + d; };

async function sendSms(env, to, text) {
  if (env.AT_API_KEY && env.AT_USERNAME) {
    const host = env.AT_USERNAME === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
    const f = new URLSearchParams({ username: env.AT_USERNAME, to, message: text });
    if (env.AT_SENDER_ID) f.set("from", env.AT_SENDER_ID);
    const r = await fetch(`https://${host}/version1/messaging`, { method: "POST", headers: { apiKey: env.AT_API_KEY, accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: f });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok) return { ok: false, detail: `Africa's Talking ${r.status}: ${t.slice(0, 120)}` };
    const m = j && j.SMSMessageData, rec = m && m.Recipients && m.Recipients[0];
    if (!rec) return { ok: false, detail: (m && m.Message) || "No recipient accepted" };
    if (![100, 101, 102].includes(rec.statusCode)) return { ok: false, detail: `Africa's Talking: ${rec.status}` };
    return { ok: true };
  }
  if (env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM) {
    const f = new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: text });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, { method: "POST", headers: { authorization: "Basic " + btoa(env.TWILIO_SID + ":" + env.TWILIO_TOKEN) }, body: f });
    return r.ok ? { ok: true } : { ok: false, detail: "Twilio " + r.status };
  }
  return { ok: false, detail: "No SMS provider" };
}

export async function onRequestPost(ctx) {
  try { return await handle(ctx); }
  catch (e) { console.log("otp error:", e && e.message); return J({ error: "Server error", detail: "server: " + String((e && e.message) || e).slice(0, 120) }, 500); }
}

async function handle({ request, env }) {
  const hasSms = (env.AT_API_KEY && env.AT_USERNAME) || (env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM);
  if (!env.KV || !hasSms) return J({ error: "SMS not configured" }, 501);
  const b = await request.json().catch(() => null);
  if (!b) return J({ error: "Bad request" }, 400);
  const phone = norm(b.phone || "");
  if (!/^\+\d{10,14}$/.test(phone)) return J({ error: "Invalid phone number" }, 400);

  if (b.action === "send") {
    if (await env.KV.get("otprl:" + phone)) return J({ error: "Wait a minute before asking again." }, 429);
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    await env.KV.put("otp:" + phone, JSON.stringify({ h: await sha(code + phone), tries: 0 }), { expirationTtl: 300 });
    await env.KV.put("otprl:" + phone, "1", { expirationTtl: 60 });
    const sent = await sendSms(env, phone, `Your Malawi Remit code is ${code}. It expires in 5 minutes.`);
    if (!sent.ok) {
      console.log("SMS failed:", sent.detail);
      await env.KV.delete("otp:" + phone);
      return J({ error: "SMS failed", detail: sent.detail }, 502);
    }
    return J({ ok: true });
  }
  if (b.action === "verify") {
    const rec = await env.KV.get("otp:" + phone, "json");
    if (!rec) return J({ error: "Code expired. Go back and request a new one." }, 400);
    if (rec.tries >= 5) { await env.KV.delete("otp:" + phone); return J({ error: "Too many attempts. Request a new code." }, 400); }
    if ((await sha(String(b.code || "") + phone)) !== rec.h) {
      rec.tries++; await env.KV.put("otp:" + phone, JSON.stringify(rec), { expirationTtl: 300 });
      return J({ error: "That code is not correct." }, 400);
    }
    await env.KV.delete("otp:" + phone);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.KV.put("sess:" + token, phone, { expirationTtl: 2592000 });
    return J({ token });
  }
  return J({ error: "Bad request" }, 400);
}
