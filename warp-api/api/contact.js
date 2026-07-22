/**
 * POST /api/contact
 * Body: { name, email, message, website? }  (website = honeypot)
 *
 * Env (set in Vercel project):
 *   CONTACT_TO          — e.g. support@warpte.com
 *   WEB3FORMS_ACCESS_KEY — free key from https://web3forms.com (easiest)
 *   or RESEND_API_KEY   — from https://resend.com (optional)
 *   RESEND_FROM         — verified from address for Resend
 */
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "https://warpte.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  // Honeypot — bots fill hidden "website"
  if (body.website) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true }));
  }

  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 200);
  const message = String(body.message || "").trim().slice(0, 5000);

  if (!name || !email || !message) {
    res.statusCode = 400;
    return res.end(
      JSON.stringify({ ok: false, error: "Name, email, and message are required." })
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: "Invalid email." }));
  }

  const to = process.env.CONTACT_TO || "support@warpte.com";
  const subject = `Warp contact — ${name}`;
  const text = [
    `From: ${name} <${email}>`,
    `To: ${to}`,
    "",
    message,
  ].join("\n");

  try {
    if (process.env.WEB3FORMS_ACCESS_KEY) {
      const r = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: process.env.WEB3FORMS_ACCESS_KEY,
          subject,
          name,
          email,
          message,
          from_name: "Warp site",
          replyto: email,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.success === false) {
        res.statusCode = 502;
        return res.end(
          JSON.stringify({
            ok: false,
            error: data.message || "Email provider failed.",
          })
        );
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    if (process.env.RESEND_API_KEY) {
      const from =
        process.env.RESEND_FROM || "Warp <onboarding@resend.dev>";
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          reply_to: email,
          subject,
          text,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        res.statusCode = 502;
        return res.end(
          JSON.stringify({ ok: false, error: "Email send failed.", detail: err })
        );
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    res.statusCode = 503;
    return res.end(
      JSON.stringify({
        ok: false,
        error:
          "Contact form not configured. Set WEB3FORMS_ACCESS_KEY or RESEND_API_KEY on Vercel.",
      })
    );
  } catch (e) {
    res.statusCode = 500;
    return res.end(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : "Server error",
      })
    );
  }
}
