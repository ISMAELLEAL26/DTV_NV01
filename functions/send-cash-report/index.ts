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
      to?: string;
      cc?: string;
      subject?: string;
      html?: string;
      pdfBase64?: string;
      pdfFilename?: string;
      logoUrl?: string;
      logoBase64?: string;
      storeName?: string;
    };

    const to = body.to?.trim();
    if (!body.html) return jsonError(400, "Faltan datos");

    const [{ data: settingsRows }, { data: appSettingsRows }] = await Promise.all([
      admin.from("settings").select("key, value").in("key", ["resend_sender_email", "resend_api_key", "email_logo_url", "email_recipient", "email_cc", "email_sender"]),
      admin.from("app_settings").select("key, value").eq("key", "email_alert_recipient"),
    ]);
    const settings: Record<string, string> = {};
    const appSettings: Record<string, string> = {};
    (settingsRows ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
    (appSettingsRows ?? []).forEach((r: { key: string; value: string }) => { appSettings[r.key] = r.value; });

    const apiKey = settings.resend_api_key?.trim() ?? "";
    const senderEmail = settings.resend_sender_email?.trim() ?? "";
    if (!apiKey || !senderEmail) return jsonError(400, "Resend no está configurado. Ve a Configuración -> Correo y Alertas.");

    const configuredRecipient = appSettings.email_alert_recipient?.trim() || settings.email_recipient?.trim() || settings.email_sender?.trim();
    const recipient = to || configuredRecipient;
    if (!recipient) return jsonError(400, "No hay correo destinatario configurado");
    const settingsLogoUrl = settings.email_logo_url ?? "";
    const logoBase64 = body.logoBase64?.trim() ?? "";
    const logoUrl = logoBase64 ? "" : (body.logoUrl || settingsLogoUrl);
    const storeName = body.storeName ?? "Tienda Bienestar";
    const subject = body.subject ?? "Reporte de caja";

    const html = buildReportHtml(body.html, logoUrl, logoBase64, storeName);

    const ccRecipients: string[] = [];
    if (body.cc?.trim()) ccRecipients.push(...body.cc.split(",").map((s) => s.trim()).filter(Boolean));
    if (settings.email_cc?.trim()) ccRecipients.push(...settings.email_cc.split(",").map((s) => s.trim()).filter(Boolean));

    const emailPayload: Record<string, unknown> = {
      from: `${storeName} <${senderEmail}>`,
      to: [recipient],
      subject,
      html,
    };
    if (ccRecipients.length > 0) emailPayload.cc = ccRecipients;

    if (body.pdfBase64) {
      emailPayload.attachments = [{
        filename: body.pdfFilename ?? "Reporte_Caja.pdf",
        content: body.pdfBase64,
      }];
    }
    if (logoBase64) {
      emailPayload.attachments = [...(Array.isArray(emailPayload.attachments) ? emailPayload.attachments : []), {
        filename: "logo.png",
        content: logoBase64,
        content_id: "logo_cid",
        disposition: "inline",
      }];
    }

    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    if (!result.ok) {
      const errText = await result.text();
      console.error("Resend error", result.status, errText);
      let detail = "No se pudo enviar el correo";
      try {
        const resendError = JSON.parse(errText) as { message?: string; name?: string };
        if (resendError.message) detail = resendError.message;
      } catch {
        if (errText.trim()) detail = errText.slice(0, 240);
      }
      return jsonError(result.status, detail);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (cause) {
    console.error("send-cash-report failed", cause);
    return jsonError(500, "No se pudo enviar el correo");
  }
});

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildReportHtml(innerHtml: string, logoUrl: string, logoBase64: string, storeName: string): string {
  const logo = logoBase64
    ? `<img src="cid:logo_cid" style="max-width:200px;margin-bottom:16px;display:block;" alt="logo"/>`
    : logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" style="max-width:200px;margin-bottom:16px;display:block;" alt="logo"/>`
      : "";
  return `<html><body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:20px;">
  ${logo}
  <h2 style="color:#0f766e;margin-bottom:4px;">${escapeHtml(storeName)}</h2>
  ${innerHtml}
  <p style="color:#888;font-size:12px;margin-top:20px;">Este reporte fue generado automaticamente por el sistema de punto de venta.</p>
  </body></html>`;
}
