export type BusinessEmailType = 'OTP_INVENTORY' | 'CASH_CUT' | 'PURCHASE_ORDER' | 'WALLET_PIN' | 'TEST';

export interface BusinessEmailData {
  subject?: string;
  message?: string;
  otpCode?: string;
  differences?: string;
  report?: string;
  folio?: string;
  branchName?: string;
  employeeName?: string;
  supplierName?: string;
  total?: number | string;
  to_email?: string;
  customerName?: string;
  amount?: number | string;
  purpose?: string;
  storeName?: string;
  logoUrl?: string;
  [key: string]: unknown;
}

export interface EmailResult {
  success: boolean;
  error?: string;
  pin?: string;
}

import { supabase } from '@/lib/supabase';

async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) return null;
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    'Content-Type': 'application/json',
  };
}

function moduleLabel(type: BusinessEmailType): string {
  if (type === 'OTP_INVENTORY') return 'Autorización de inventario';
  if (type === 'CASH_CUT') return 'Corte de caja';
  if (type === 'PURCHASE_ORDER') return 'Compras y pedidos';
  if (type === 'WALLET_PIN') return 'PIN de autorización de monedero';
  return 'Prueba de conexión';
}

function summaryFor(type: BusinessEmailType, data: BusinessEmailData): string {
  if (data.message) return data.message;
  if (data.report) return data.report;
  if (type === 'TEST') return 'Correo de prueba de configuración Tienda Bienestar';
  return `Notificación de ${moduleLabel(type)}`;
}

function getFunctionUrl(slug: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${slug}`;
}

export async function sendBusinessEmail(type: BusinessEmailType, data: BusinessEmailData = {}): Promise<EmailResult> {
  const recipientEmail = typeof data.to_email === 'string' && data.to_email.trim()
    ? data.to_email.trim()
    : '';
  if (!recipientEmail) return { success: false, error: 'Falta el correo del destinatario' };

  const summaryText = summaryFor(type, data);
  const storeName = data.storeName ?? 'Tienda Bienestar';
  const subject = data.subject ?? moduleLabel(type);

  try {
    const authHeaders = await getAuthHeaders();
    if (!authHeaders) return { success: false, error: 'La sesión expiró. Vuelve a iniciar sesión para enviar el correo.' };
    if (type === 'WALLET_PIN') {
      const res = await fetch(getFunctionUrl('send-authorization-pin'), {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          to: recipientEmail,
          customerName: data.customerName ?? 'Cliente',
          amount: data.amount ?? '',
          purpose: data.purpose ?? 'autorización de compra con monedero',
          storeName,
          logoUrl: data.logoUrl ?? `${window.location.origin}/RETIRA_(3)_(1) copy.png`,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        return { success: false, error: errBody.error ?? `Error ${res.status}` };
      }
      const json = await res.json() as { success?: boolean; pin?: string; error?: string };
      return { success: !!json.success, pin: json.pin, error: json.error };
    }

    const res = await fetch(getFunctionUrl('send-ticket-email'), {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        to: recipientEmail,
        subject,
        text: summaryText,
        folio: data.folio ?? '',
        storeName,
        pdfBase64: typeof data.pdfBase64 === 'string' ? data.pdfBase64 : undefined,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { success: false, error: errBody.error ?? `Error ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error de red';
    return { success: false, error: msg };
  }
}

export async function sendTicketEmail(to: string, text: string, folio: string, storeName: string): Promise<EmailResult> {
  try {
    const authHeaders = await getAuthHeaders();
    if (!authHeaders) return { success: false, error: 'La sesión expiró. Vuelve a iniciar sesión para enviar el correo.' };
    const res = await fetch(getFunctionUrl('send-ticket-email'), {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ to, subject: `Ticket ${folio}`, text, folio, storeName }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { success: false, error: errBody.error ?? `Error ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error de red';
    return { success: false, error: msg };
  }
}

export async function sendWalletPin(
  to: string,
  customerName: string,
  amount: number | string,
  purpose: string,
  storeName: string,
): Promise<EmailResult> {
  return sendBusinessEmail('WALLET_PIN', {
    to_email: to,
    customerName,
    amount,
    purpose,
    storeName,
  });
}

export async function hashSupervisorPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
