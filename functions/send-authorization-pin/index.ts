import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("server configuration unavailable");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError(401, "No autorizado");
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return jsonError(401, "No autorizado");

    const body = await req.json() as {
      action?: "send" | "verify";
      to?: string;
      customerName?: string;
      amount?: number | string;
      purpose?: string;
      storeName?: string;
      logoUrl?: string;
      verificationId?: string;
      pin?: string;
    };

    const action = body.action ?? "send";

    const { data: settingsRows } = await admin.from("settings").select("key, value").in("key", ["resend_sender_email", "resend_api_key"]);
    const settings: Record<string, string> = {};
    (settingsRows ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
    const apiKey = settings.resend_api_key ?? "";
    const senderEmail = settings.resend_sender_email ?? "";

    if (action === "send") {
      return await handleSend(admin, user.id, body, password, senderEmail);
    } else if (action === "verify") {
      return await handleVerify(admin, user.id, body);
    }
    return jsonError(400, "Acción no válida");
  } catch (cause) {
    console.error("send-authorization-pin failed", cause);
    return jsonError(500, "Error del servidor");
  }
});

async function handleSend(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: { to?: string; customerName?: string; amount?: number | string; purpose?: string; storeName?: string; logoUrl?: string },
  password: string,
  senderEmail: string,
): Promise<Response> {
  const to = body.to?.trim();
  if (!to) return jsonError(400, "Falta el correo del destinatario");
  if (!apiKey || !senderEmail) return jsonError(400, "Resend no está configurado. Ve a Configuración → Correo y Alertas.");

  const pin = generatePin();
  const pinHash = await sha256(pin);
  const customerName = body.customerName ?? "Cliente";
  const amount = body.amount ?? "";
  const purpose = body.purpose ?? "autorización de compra con monedero";
  const storeName = body.storeName ?? "Tienda";
  const subject = `PIN de ${purpose} - ${storeName}`;
  const { data: logoSetting } = await admin.from("settings").select("value").eq("key", "email_logo_url").maybeSingle();
  const logoUrl = body.logoUrl?.trim() || logoSetting?.value || "";
  const html = buildPinHtml(pin, customerName, amount, purpose, storeName, logoUrl);

  const { data: pinRow, error: pinErr } = await admin.from("wallet_pin_verifications").insert({
    user_id: userId,
    pin_hash: pinHash,
    email: to,
    amount: typeof amount === "number" ? amount : parseFloat(String(amount)) || 0,
    status: "pending",
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }).select("id").single();
  if (pinErr || !pinRow) {
    console.error("pin insert failed", pinErr);
    return jsonError(500, "No se pudo generar el PIN");
  }

  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${storeName} <${senderEmail}>`,
      to: [to],
      subject,
      html,
    }),
  });
  if (!result.ok) {
    const errText = await result.text();
    console.error("Resend error", result.status, errText);
    await admin.from("wallet_pin_verifications").update({ status: "expired" }).eq("id", pinRow.id);
    return jsonError(500, "No se pudo enviar el PIN por correo");
  }

  return new Response(
    JSON.stringify({ success: true, verificationId: pinRow.id }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

async function handleVerify(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: { verificationId?: string; pin?: string },
): Promise<Response> {
  const verificationId = body.verificationId?.trim();
  const pin = body.pin?.trim();
  if (!verificationId || !pin) return jsonError(400, "Falta el ID de verificación o el PIN");

  const { data: record, error: recordErr } = await admin.from("wallet_pin_verifications")
    .select("id, pin_hash, status, expires_at, user_id")
    .eq("id", verificationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (recordErr || !record) return jsonError(404, "Verificación no encontrada");

  if (record.status !== "pending") return jsonError(400, "Este PIN ya fue usado o cancelado");
  if (new Date(record.expires_at).getTime() < Date.now()) {
    await admin.from("wallet_pin_verifications").update({ status: "expired" }).eq("id", verificationId);
    return jsonError(400, "El PIN ha expirado");
  }

  const inputHash = await sha256(pin);
  if (inputHash !== record.pin_hash) return jsonError(400, "PIN incorrecto");

  const { error: updateErr } = await admin.from("wallet_pin_verifications")
    .update({ status: "verified", verified_at: new Date().toISOString() })
    .eq("id", verificationId);
  if (updateErr) {
    console.error("verify update failed", updateErr);
    return jsonError(500, "No se pudo verificar el PIN");
  }

  return new Response(
    JSON.stringify({ success: true, verified: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function generatePin(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => (b % 10).toString()).join("").slice(0, 6);
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPinHtml(pin: string, customerName: string, amount: string, purpose: string, storeName: string, logoUrl: string): string {
  const amountLine = amount ? `<p style="font-size:16px;color:#333;">Monto: <strong>${escapeHtml(String(amount))}</strong></p>` : "";
  const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Logo oficial" style="display:block;max-width:320px;width:100%;height:auto;margin:0 auto 20px;" />` : "";
  return `<html><body style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;text-align:center;">
  ${logo}
  <h2 style="color:#1a1a1a;">${escapeHtml(storeName)}</h2>
  <p style="font-size:16px;color:#555;">Hola <strong>${escapeHtml(customerName)}</strong>,</p>
  <p style="font-size:15px;color:#555;">Tu PIN de ${escapeHtml(purpose)} es:</p>
  <div style="margin:24px auto;padding:20px 40px;background:#f0f4f8;border-radius:12px;display:inline-block;">
    <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a56db;">${escapeHtml(pin)}</span>
  </div>
  ${amountLine}
  <p style="color:#888;font-size:12px;margin-top:24px;">Este PIN expira en 10 minutos. No lo compartas con nadie.</p>
  <p style="color:#aaa;font-size:11px;">Si no solicitaste este codigo, ignora este correo.</p>
  </body></html>`;
}
