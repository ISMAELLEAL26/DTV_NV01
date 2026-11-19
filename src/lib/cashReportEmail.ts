import { jsPDF } from 'jspdf';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { PROGRAM_LOGO } from '@/lib/branding';
import { supabase } from '@/lib/supabase';
import type { CashRegister, CashMovement, Branch } from '@/lib/types';

export interface CashReportData {
  register: CashRegister;
  branch: Branch;
  cashierName: string;
  movements: CashMovement[];
  systemTotal: number;
  countedTotal?: number;
  difference?: number;
  salesByMethod?: { method: string; count: number; total: number }[];
  denominations?: { denomination: number; quantity: number; subtotal: number }[];
  reason?: 'opening' | 'movement' | 'cash_cut';
  movement?: CashMovement;
}

const METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
  vale: 'Vales',
  cheque: 'Cheques',
  monedero_electronico: 'Monedero electrónico',
};

function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method.replace(/_/g, ' ');
}

export function buildCashReportPdf(data: CashReportData, logoDataUrl?: string): string {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = margin;

  // Logo
  if (logoDataUrl) {
    try {
      const fmt = logoDataUrl.includes('image/png') ? 'PNG' : logoDataUrl.includes('image/jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(logoDataUrl, fmt, margin, y, 40, 20);
      y += 26;
    } catch { /* logo optional */ }
  } else {
    y += 26;
  }

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 118, 110);
  const title = data.reason === 'movement' ? 'Movimiento de caja' : data.reason === 'opening' ? 'Apertura de turno' : 'Corte de caja';
  doc.text(title, margin, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(data.branch.name, margin, y); y += 5;
  doc.text(`Cajero: ${data.cashierName}`, margin, y); y += 5;
  doc.text(`Folio: ${data.register.folio ?? '—'}`, margin, y); y += 5;
  const dateStr = data.reason === 'movement' && data.movement
    ? formatDateTime(data.movement.created_at)
    : formatDateTime(data.register.closed_at ?? data.register.opened_at);
  doc.text(`Fecha: ${dateStr}`, margin, y); y += 8;

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  if (data.reason === 'movement' && data.movement) {
    const m = data.movement;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(m.type === 'ingreso' ? 'Ingreso de efectivo' : 'Salida de efectivo', margin, y); y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Monto: ${formatCurrency(Number(m.amount))}`, margin, y); y += 5;
    doc.text(`Motivo: ${m.reason ?? '—'}`, margin, y); y += 5;
    doc.text(`Total esperado en caja: ${formatCurrency(data.systemTotal)}`, margin, y); y += 8;
  } else {
    doc.setFontSize(11);
    if (data.reason === 'opening') {
      doc.setFont('helvetica', 'bold');
      doc.text('Fondo inicial registrado', margin, y); y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Total de apertura: ${formatCurrency(Number(data.register.opening_amount))}`, margin, y); y += 5;
      doc.text(`Total contado: ${formatCurrency(data.countedTotal ?? 0)}`, margin, y); y += 5;
      doc.text('Turno abierto correctamente.', margin, y);
    } else {
    // Summary
    doc.setFont('helvetica', 'bold');
    doc.text('Resumen del corte', margin, y); y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const summary: [string, string][] = [
      ['Fondo inicial', formatCurrency(Number(data.register.opening_amount))],
      ['Total esperado (sistema)', formatCurrency(data.systemTotal)],
      ['Total contado', formatCurrency(data.countedTotal ?? 0)],
      ['Diferencia', formatCurrency(data.difference ?? 0)],
    ];
    for (const [label, val] of summary) {
      doc.text(label, margin, y);
      doc.text(val, pageW - margin, y, { align: 'right' });
      y += 5;
    }
    y += 4;

    // Sales by method
    if (data.salesByMethod && data.salesByMethod.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Ventas por método de pago', margin, y); y += 6;
      doc.setFont('helvetica', 'normal');
      for (const s of data.salesByMethod) {
        doc.text(`${methodLabel(s.method)} (${s.count})`, margin, y);
        doc.text(formatCurrency(s.total), pageW - margin, y, { align: 'right' });
        y += 5;
      }
      y += 4;
    }

    // Movements
    if (data.movements.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Movimientos de caja', margin, y); y += 6;
      doc.setFont('helvetica', 'normal');
      for (const m of data.movements) {
        const typeLabel = m.type === 'ingreso' ? '+' : '-';
        const line = `${m.type === 'ingreso' ? 'Ingreso' : 'Egreso'} · ${m.reason ?? '—'} · ${formatDateTime(m.created_at)}`;
        doc.text(line, margin, y, { maxWidth: pageW - margin * 2 - 35 });
        doc.text(`${typeLabel}${formatCurrency(Number(m.amount))}`, pageW - margin, y, { align: 'right' });
        y += 5;
        if (y > 260) { doc.addPage(); y = margin; }
      }
      y += 4;
    }

    }

    // Denominations
    if (data.denominations && data.denominations.length > 0) {
      if (y > 240) { doc.addPage(); y = margin; }
      doc.setFont('helvetica', 'bold');
      doc.text('Conteo de denominaciones', margin, y); y += 6;
      doc.setFont('helvetica', 'normal');
      for (const d of data.denominations) {
        if (d.quantity === 0) continue;
        doc.text(`${formatCurrency(d.denomination)} x ${d.quantity}`, margin, y);
        doc.text(formatCurrency(d.subtotal), pageW - margin, y, { align: 'right' });
        y += 5;
        if (y > 260) { doc.addPage(); y = margin; }
      }
    }
  }

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Generado automáticamente por el sistema de punto de venta.', margin, pageH - 12);

  return doc.output('datauristring').split(',')[1];
}

export function buildCashReportHtml(data: CashReportData): string {
  const rows: string[] = [];

  if (data.reason === 'movement' && data.movement) {
    const m = data.movement;
    rows.push(`
      <h3 style="color:${m.type === 'ingreso' ? '#059669' : '#dc2626'};margin:0 0 8px;">
        ${m.type === 'ingreso' ? 'Ingreso de efectivo' : 'Salida de efectivo'}
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;">Monto</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${formatCurrency(Number(m.amount))}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Motivo</td><td style="padding:6px 0;text-align:right;">${m.reason ?? '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Fecha</td><td style="padding:6px 0;text-align:right;">${formatDateTime(m.created_at)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Cajero</td><td style="padding:6px 0;text-align:right;">${data.cashierName}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Sucursal</td><td style="padding:6px 0;text-align:right;">${data.branch.name}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Folio</td><td style="padding:6px 0;text-align:right;">${data.register.folio ?? '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-top:1px solid #eee;">Total esperado en caja</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #eee;">${formatCurrency(data.systemTotal)}</td></tr>
      </table>`);
  } else if (data.reason === 'opening') {
    rows.push(`
      <h3 style="color:#0f766e;margin:0 0 8px;">Apertura de turno</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;">Cajero</td><td style="padding:6px 0;text-align:right;">${data.cashierName}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Sucursal</td><td style="padding:6px 0;text-align:right;">${data.branch.name}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Folio</td><td style="padding:6px 0;text-align:right;">${data.register.folio ?? '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Fondo inicial</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${formatCurrency(Number(data.register.opening_amount))}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Total contado</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${formatCurrency(data.countedTotal ?? 0)}</td></tr>
      </table>`);
  } else {
    rows.push(`
      <h3 style="color:#0f766e;margin:0 0 8px;">Corte de caja</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;">Cajero</td><td style="padding:6px 0;text-align:right;">${data.cashierName}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Sucursal</td><td style="padding:6px 0;text-align:right;">${data.branch.name}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Folio</td><td style="padding:6px 0;text-align:right;">${data.register.folio ?? '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Fecha</td><td style="padding:6px 0;text-align:right;">${formatDateTime(data.register.closed_at ?? data.register.opened_at)}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:12px 0;"/>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;">Fondo inicial</td><td style="padding:6px 0;text-align:right;">${formatCurrency(Number(data.register.opening_amount))}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Total esperado (sistema)</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${formatCurrency(data.systemTotal)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Total contado</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${formatCurrency(data.countedTotal ?? 0)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-top:1px solid #eee;">Diferencia</td>
        <td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #eee;color:${(data.difference ?? 0) === 0 ? '#666' : (data.difference ?? 0) > 0 ? '#059669' : '#dc2626'};">${formatCurrency(data.difference ?? 0)}</td></tr>
      </table>`);

    if (data.salesByMethod && data.salesByMethod.length > 0) {
      rows.push('<hr style="border:none;border-top:1px solid #eee;margin:12px 0;"/><h4 style="color:#0f766e;margin:0 0 8px;">Ventas por método de pago</h4><table style="width:100%;border-collapse:collapse;font-size:13px;">');
      for (const s of data.salesByMethod) {
        rows.push(`<tr><td style="padding:4px 0;color:#666;">${methodLabel(s.method)} (${s.count})</td><td style="padding:4px 0;text-align:right;">${formatCurrency(s.total)}</td></tr>`);
      }
      rows.push('</table>');
    }

    if (data.movements.length > 0) {
      rows.push('<hr style="border:none;border-top:1px solid #eee;margin:12px 0;"/><h4 style="color:#0f766e;margin:0 0 8px;">Movimientos de caja</h4><table style="width:100%;border-collapse:collapse;font-size:13px;">');
      for (const m of data.movements) {
        const sign = m.type === 'ingreso' ? '+' : '-';
        const color = m.type === 'ingreso' ? '#059669' : '#dc2626';
        rows.push(`<tr><td style="padding:4px 0;color:#666;">${m.type === 'ingreso' ? 'Ingreso' : 'Egreso'} · ${m.reason ?? '—'}</td><td style="padding:4px 0;text-align:right;color:${color};font-weight:bold;">${sign}${formatCurrency(Number(m.amount))}</td></tr>`);
      }
      rows.push('</table>');
    }
  }

  return rows.join('\n');
}

async function fetchLogoDataUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

export async function sendCashReportEmail(
  data: CashReportData,
  recipientEmail: string | null,
  logoUrl: string,
  storeName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const logoDataUrl = await fetchLogoDataUrl(logoUrl);
    const logoBase64 = logoDataUrl.split(',')[1] ?? '';
    const pdfBase64 = buildCashReportPdf(data, logoDataUrl);
    const html = buildCashReportHtml(data);
    const isMovement = data.reason === 'movement';
    const subject = isMovement
      ? `${data.movement?.type === 'ingreso' ? 'Ingreso' : 'Salida'} de efectivo — ${data.branch.name} — ${data.register.folio ?? ''}`
      : data.reason === 'opening'
        ? `Apertura de turno — ${data.branch.name} — ${data.register.folio ?? ''}`
        : `Corte de caja — ${data.branch.name} — ${data.register.folio ?? ''}`;
    const pdfFilename = isMovement
      ? `Movimiento_${data.register.folio ?? 'caja'}.pdf`
      : data.reason === 'opening'
        ? `Apertura_${data.register.folio ?? 'caja'}.pdf`
        : `Corte_${data.register.folio ?? 'caja'}.pdf`;

    const { data: responseData, error: functionError } = await supabase.functions.invoke('send-cash-report', {
      body: {
        ...(recipientEmail ? { to: recipientEmail } : {}),
        subject,
        html,
        pdfBase64,
        pdfFilename,
        logoUrl: logoBase64 ? '' : logoUrl,
        logoBase64,
        storeName,
      },
    });
    if (functionError) {
      return { success: false, error: functionError.message || 'No se pudo enviar el correo' };
    }
    const response = responseData as { success?: boolean; error?: string } | null;
    if (!response?.success) {
      return { success: false, error: response?.error ?? 'No se pudo enviar el correo' };
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error de red';
    return { success: false, error: msg };
  }
}

export async function fetchCashReportRecipient(): Promise<string | null> {
  const [{ data: appSettingsRows }, { data: settingsRows }] = await Promise.all([
    supabase.from('app_settings').select('key, value').eq('key', 'email_alert_recipient'),
    supabase.from('settings').select('key, value').in('key', ['email_recipient', 'email_sender']),
  ]);
  const appSettings: Record<string, string> = {};
  const settings: Record<string, string> = {};
  (appSettingsRows ?? []).forEach((r: { key: string; value: string }) => { appSettings[r.key] = r.value; });
  (settingsRows ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
  return appSettings.email_alert_recipient?.trim() || settings.email_recipient?.trim() || settings.email_sender?.trim() || null;
}
