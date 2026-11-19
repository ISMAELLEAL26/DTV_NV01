import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { sendViaGmailSmtp, parseRecipients, type EmailAttachment } from "../_shared/smtp.ts";

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
      to?: string;
      subject?: string;
      text?: string;
      folio?: string;
      storeName?: string;
      pdfBase64?: string;
      logoUrl?: string;
    };

    const to = body.to?.trim();
    if (!to || !body.text) return jsonError(400, "Faltan datos");

    const { data: settingsRows } = await admin.from("settings").select("key, value").in("key", ["email_sender", "email_password", "email_template", "email_logo_url", "email_recipient"]);
    const settings: Record<string, string> = {};
    (settingsRows ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });

    const password = settings.email_password ?? "";
    const senderEmail = settings.email_sender ?? "";
    if (!password || !senderEmail) return jsonError(400, "Correo de Gmail no configurado. Ve a Configuración → Correo y Alertas.");

    const template = settings.email_template ?? "{ticket}";
    const emailBody = template
      .replace("{ticket}", body.text)
      .replace("{folio}", body.folio ?? "")
      .replace("{storeName}", body.storeName ?? "");
    const settingsLogoUrl = settings.email_logo_url ?? "";
    const logoUrl = body.logoUrl || settingsLogoUrl;
    const subject = body.subject ?? `Ticket ${body.folio ?? ""}`;
    const storeName = body.storeName ?? "Tienda";

    const html = buildTicketHtml(emailBody, logoUrl, storeName);

    const attachments: EmailAttachment[] = [];
    if (body.pdfBase64) {
      attachments.push({ filename: `Ticket_${body.folio ?? "venta"}.pdf`, content: body.pdfBase64 });
    }

    const result = await sendViaGmailSmtp({
      user: senderEmail,
      password,
      to: [to],
      subject,
      html,
      fromName: storeName,
      attachments,
    });

    if (!result.ok) {
      console.error("send-ticket-email failed", result.error);
      return jsonError(500, result.error ?? "No se pudo enviar el correo");
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (cause) {
    console.error("send-ticket-email failed", cause);
    return jsonError(500, "No se pudo enviar el correo");
  }
});

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildTicketHtml(bodyText: string, logoUrl: string, storeName: string): string {
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" style="max-width:180px;margin-bottom:16px;display:block;" alt="logo"/>`
    : "";
  return `<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  ${logo}
  <h2 style="color:#1a1a1a;margin-bottom:4px;">${escapeHtml(storeName)}</h2>
  <pre style="font-family:'Courier New',monospace;font-size:13px;white-space:pre-wrap;background:#f9f9f9;padding:16px;border-radius:8px;border:1px solid #e0e0e0;">${escapeHtml(bodyText)}</pre>
  <p style="color:#888;font-size:12px;margin-top:16px;">Este correo fue generado automaticamente.</p>
  </body></html>`;
}
