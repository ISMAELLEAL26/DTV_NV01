import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import type { Branch, WalletSaleResult } from '@/lib/types';

interface TicketItem {
  product_name: string;
  sku: string | null;
  barcode?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface TicketData {
  branch: Branch;
  logoUrl: string | null;
  ticketWidth: '55' | '80';
  storeName: string;
  folio: string;
  createdAt: string;
  customerName: string;
  items: TicketItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  amountReceived: number;
  change: number;
  currencySymbol: string;
  sellerName: string;
  paymentDetails?: Record<string, string | boolean | null>;
  wallet?: WalletSaleResult | null;
}

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character] ?? character));

const money = (value: number, symbol: string): string => `${symbol}${value.toFixed(2)}`;

const barcodeSvg = (value: string): string => {
  const bars = value.split('').flatMap((character) => {
    const code = character.charCodeAt(0);
    return Array.from({ length: 7 }, (_, index) => ((code >> index) & 1) === 1 ? 3 : 1);
  });
  const width = bars.reduce((sum, bar) => sum + bar, 0) + 16;
  let x = 8;
  const rectangles = bars.map((bar, index) => {
    const rect = index % 2 === 0 ? `<rect x="${x}" y="0" width="${bar}" height="42"/>` : '';
    x += bar;
    return rect;
  }).join('');
  return `<svg class="barcode" viewBox="0 0 ${width} 54" role="img" aria-label="Código de barras ${escapeHtml(value)}"><g fill="#000">${rectangles}</g><text x="50%" y="53" text-anchor="middle">${escapeHtml(value)}</text></svg>`;
};

const branchAddress = (branch: Branch): string[] => [
  [branch.street, branch.exterior_number && `No. ${branch.exterior_number}`, branch.interior_number && `Int. ${branch.interior_number}`].filter(Boolean).join(' '),
  [branch.neighborhood, branch.locality, branch.municipality, branch.state, branch.postal_code && `C.P. ${branch.postal_code}`].filter(Boolean).join(', '),
  branch.address ?? '',
].filter(Boolean);

export async function generateQrDataUrl(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, { margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } });
  } catch {
    return '';
  }
}

function buildPaymentDetailsHtml(data: TicketData): string {
  const details = data.paymentDetails;
  if (!details) return '';
  if (data.paymentMethod === 'mixto' && details.mixed_payments) {
    let rows = '';
    try {
      const payments = JSON.parse(String(details.mixed_payments)) as Array<{ method: string; amount: number }>;
      rows = payments.map((payment) => `<div class="row"><span>${escapeHtml(payment.method.replace(/_/g, ' '))}:</span><span>${money(Number(payment.amount), data.currencySymbol)}</span></div>`).join('');
    } catch {
      rows = `<div class="row"><span>Desglose:</span><span>${escapeHtml(String(details.mixed_payments))}</span></div>`;
    }
    return rows ? `<div class="divider"></div><div class="center small">Desglose de pago mixto</div>${rows}` : '';
  }
  const lines: string[] = [];
  if (data.paymentMethod === 'tarjeta') {
    lines.push(`<div class="row"><span>Tipo:</span><span>${escapeHtml(details.card_type === 'credito' ? 'Crédito' : 'Débito')}</span></div>`);
    if (details.card_last4) lines.push(`<div class="row"><span>Tarjeta:</span><span>**** ${escapeHtml(String(details.card_last4))}</span></div>`);
    if (details.card_bank) lines.push(`<div class="row"><span>Banco:</span><span>${escapeHtml(String(details.card_bank))}</span></div>`);
    if (details.authorization_number) lines.push(`<div class="row"><span>Aut.:</span><span>${escapeHtml(String(details.authorization_number))}</span></div>`);
    lines.push(`<div class="row"><span>Con NIP:</span><span>${details.nip_mode === 'con_nip' ? 'Sí' : 'No'}</span></div>`);
    if (details.nip_mode === 'sin_nip') {
      if (details.customer_name) lines.push(`<div class="row"><span>Cliente:</span><span>${escapeHtml(String(details.customer_name))}</span></div>`);
      if (details.customer_phone) lines.push(`<div class="row"><span>Tel.:</span><span>${escapeHtml(String(details.customer_phone))}</span></div>`);
      if (details.customer_address) lines.push(`<div>Dom: ${escapeHtml(String(details.customer_address))}</div>`);
      lines.push(`<div class="row"><span>Firmó:</span><span>${details.ticket_signed ? 'Sí' : 'No'}</span></div>`);
    }
  } else if (details.recharge) {
    lines.push(`<div class="row"><span>Recarga:</span><span>${escapeHtml(String(details.company ?? ''))}</span></div>`);
    if (details.phone) lines.push(`<div class="row"><span>Teléfono:</span><span>${escapeHtml(String(details.phone))}</span></div>`);
    if (details.provider_folio) lines.push(`<div class="row"><span>Folio proveedor:</span><span>${escapeHtml(String(details.provider_folio))}</span></div>`);
    if (details.margin_value) lines.push(`<div class="row"><span>Margen:</span><span>${escapeHtml(String(details.margin_value))}</span></div>`);
  } else if (data.paymentMethod === 'transferencia') {
    if (details.receiving_bank_name) lines.push(`<div class="row"><span>Cta. receptora:</span><span>${escapeHtml(String(details.receiving_bank_name))}</span></div>`);
    if (details.transfer_origin_bank) lines.push(`<div class="row"><span>Banco origen:</span><span>${escapeHtml(String(details.transfer_origin_bank))}</span></div>`);
    if (details.transfer_origin_account) lines.push(`<div class="row"><span>Cta. origen:</span><span>${escapeHtml(String(details.transfer_origin_account))}</span></div>`);
    if (details.transfer_concept) lines.push(`<div>Concepto: ${escapeHtml(String(details.transfer_concept))}</div>`);
  }
  return lines.length ? `<div class="divider"></div><div class="center small">Detalles de pago</div>${lines.join('')}` : '';
}

function buildWalletHtml(data: TicketData): string {
  const wallet = data.wallet;
  if (!wallet) return '';
  const rows = [
    wallet.redeemed > 0 ? `<div class="row"><span>PAGO MONEDERO:</span><span>-${money(wallet.redeemed, data.currencySymbol)}</span></div>` : '',
    wallet.change_saved > 0 ? `<div class="row"><span>CAMBIO A MONEDERO:</span><span>${money(wallet.change_saved, data.currencySymbol)}</span></div>` : '',
    `<div class="row"><span>PUNTOS GANADOS:</span><span>${wallet.points_earned.toFixed(2)} pts</span></div>`,
    `<div class="row"><span>SALDO MONEDERO:</span><span>${money(wallet.balance, data.currencySymbol)}</span></div>`,
  ];
  return `<div class="divider"></div><div class="totals">${rows.join('')}</div>`;
}

function buildTicketBody(data: TicketData): string {
  const paymentLabel = data.paymentMethod === 'monedero_electronico'
    ? 'Monedero electrónico'
    : data.paymentMethod === 'mixto'
      ? 'Pago mixto'
      : data.paymentMethod.replace('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
  const itemsHtml = data.items.map((item) => `<div class="item"><div class="item-name"><b>${escapeHtml(item.product_name)}</b></div><div class="cols"><span class="c-clave">${escapeHtml((item.barcode ?? '').slice(-4))}</span><span class="c-cant">${item.quantity}</span><span class="c-precio">${money(item.unit_price, data.currencySymbol)}</span><span class="c-importe">${money(item.line_total, data.currencySymbol)}</span></div></div>`).join('');
  const addressHtml = branchAddress(data.branch).map((line) => `<div>${escapeHtml(line)}</div>`).join('');
  const logoSource = data.branch?.logo_url || data.logoUrl;
  const logoHtml = logoSource ? `<img class="logo" src="${escapeHtml(logoSource)}" alt="Logotipo" />` : '';
  const paymentDetailsHtml = buildPaymentDetailsHtml(data);
  const discountHtml = data.discount > 0 ? `<div class="row"><span>Descuento:</span><span>-${money(data.discount, data.currencySymbol)}</span></div>` : '';
  return `<header>${logoHtml}<h1>${escapeHtml(data.storeName)}</h1>${addressHtml}<div>${escapeHtml(data.branch.phone ?? '')}</div></header><div class="divider"></div><div class="row"><span>Venta:</span><span>${escapeHtml(data.createdAt)}</span></div><div class="row"><span>Vendedor:</span><span>${escapeHtml(data.sellerName)}</span></div><div class="row"><span>Folio:</span><span>${escapeHtml(data.folio)}</span></div><div>Cliente: ${escapeHtml(data.customerName)}</div><div class="divider"></div><div>DESCRIPCION</div><div class="cols"><span class="c-clave">CLAVE</span><span class="c-cant">CANT</span><span class="c-precio">PRECIO</span><span class="c-importe">IMPORTE</span></div><div class="divider"></div>${itemsHtml}<div class="divider"></div><div class="totals">${discountHtml}<div class="row"><span>TOTAL, A PAGAR:</span><span>${money(data.total, data.currencySymbol)}</span></div><div class="row"><span>METODO:</span><span>${paymentLabel}</span></div><div class="row"><span>PAGO CON:</span><span>${money(data.amountReceived || data.total, data.currencySymbol)}</span></div><div class="row"><span>CAMBIO:</span><span>${money(data.change, data.currencySymbol)}</span></div></div>${buildWalletHtml(data)}${paymentDetailsHtml}${barcodeSvg(data.folio)}<div class="center small">GRACIAS POR SU COMPRA</div><div class="ticket-spacer"><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div></div><div class="center small">.</div>`;
}

function buildTicketDocument(data: TicketData): string {
  const width = '58mm';
  const fontSize = '12px';
  const padding = '4mm';
  const h1Size = '14px';
  const smallSize = '10px';
  const bodyContent = buildTicketBody(data);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket ${escapeHtml(data.folio)}</title><style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000 !important; background: #fff !important; border-color: #000 !important; opacity: 1 !important; }
    html, body { width: ${width}; margin: 0; padding: 0; background: #fff; color: #000; }
    body { padding: ${padding}; color: #000; font-family: 'Courier New', monospace; font-size: ${fontSize}; font-weight: bold; line-height: 1.4; -webkit-font-smoothing: none; }
    header { text-align: center; color: #000; }
    .logo { display: block; max-width: 100%; max-height: 26mm; margin: 0 auto 1mm; object-fit: contain; }
    h1 { font-size: ${h1Size}; margin: 0 0 1mm; text-transform: uppercase; color: #000; font-weight: bold; }
    .center { text-align: center; color: #000; }
    .divider { border-top: 1px dashed #000; margin: 2mm 0; color: #000; }
    .row { display: flex; justify-content: space-between; gap: 4px; color: #000; font-weight: bold; }
    .item { margin: 1mm 0; page-break-inside: avoid; color: #000; font-weight: bold; }
    .item-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cols { display: grid; grid-template-columns: 11mm 8mm 1fr 1fr; gap: 1mm; }
    .c-cant { text-align: center; }
    .c-precio, .c-importe { text-align: right; }
    .small { font-size: ${smallSize}; color: #000; font-weight: bold; }
    .barcode { display: block; width: 90%; height: 18mm; margin: 3mm auto 1mm; page-break-inside: avoid; }
    .barcode text { font: bold 8px 'Courier New', monospace; fill: #000; }
    .barcode rect { fill: #000; }
    .ticket-spacer { line-height: 1.4; }
    b, strong { color: #000; font-weight: bold; }
    * { page-break-inside: avoid; }
    @media print {
      html, body { width: ${width}; margin: 0; }
      .no-print, button { display: none !important; }
    }
  </style></head><body>${bodyContent}<script>
    (function () {
      function doPrint() {
        try { window.print(); } catch (e) {}
      }
      function ready() {
        var img = document.querySelector('img.logo');
        if (img && !img.complete && img.src) {
          var called = false;
          function go() { if (called) return; called = true; setTimeout(doPrint, 150); }
          img.addEventListener('load', go);
          img.addEventListener('error', function () { img.remove(); go(); });
          setTimeout(function () { if (!called) { img.remove(); go(); } }, 2000);
        } else {
          setTimeout(doPrint, 150);
        }
      }
      if (document.readyState === 'complete') { ready(); }
      else { window.addEventListener('load', ready); }
    })();
  <\/script></body></html>`;
}

async function silentPrint(html: string): Promise<boolean> {
  const electronAPI = (window as unknown as { electronAPI?: { printTicket: (html: string, options?: { printerName?: string }) => Promise<void> } }).electronAPI;
  if (electronAPI?.printTicket) {
    const savedPrinter = window.localStorage.getItem('pos_printer_name') ?? '';
    try { await electronAPI.printTicket(html, savedPrinter ? { printerName: savedPrinter } : undefined); return true; } catch { return false; }
  }
  return false;
}

export async function printTicket(data: TicketData): Promise<void> {
  const html = buildTicketDocument(data);
  if (await silentPrint(html)) return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer,width=420,height=640');
  if (win) {
    win.focus();
    win.addEventListener('load', () => URL.revokeObjectURL(url));
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    URL.revokeObjectURL(url);
  }
}

export async function generateTicketPdfBase64(data: TicketData): Promise<string> {
  const html = buildTicketDocument(data);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '280px';
  iframe.style.height = '600px';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) { document.body.removeChild(iframe); throw new Error('No se pudo crear el documento'); }
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise<void>((resolve) => {
    if (doc.readyState === 'complete') resolve();
    else iframe.addEventListener('load', () => resolve(), { once: true });
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  const pdf = new jsPDF({ unit: 'mm', format: [80, 297], orientation: 'portrait' });
  const bodyEl = doc.body;
  await pdf.html(bodyEl, {
    callback: () => {},
    x: 2,
    y: 2,
    width: 76,
    windowWidth: 280,
    autoPaging: 'text',
  });
  const base64 = pdf.output('datauristring');
  document.body.removeChild(iframe);
  const commaIndex = base64.indexOf(',');
  return commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
}

export function buildTicketText(data: TicketData): string {
  const lines: string[] = [];
  lines.push(`*${data.storeName}*`);
  branchAddress(data.branch).forEach((line) => lines.push(line));
  if (data.branch.phone) lines.push(`Tel: ${data.branch.phone}`);
  lines.push('--------------------------------');
  lines.push(`Folio: ${data.folio}`);
  lines.push(`Fecha: ${data.createdAt}`);
  lines.push(`Vendedor: ${data.sellerName}`);
  lines.push(`Cliente: ${data.customerName}`);
  lines.push('--------------------------------');
  data.items.forEach((item) => {
    lines.push(`${item.quantity} x ${item.sku ?? ''} ${item.product_name}`);
    lines.push(`${money(item.unit_price, data.currencySymbol)} = ${money(item.line_total, data.currencySymbol)}`);
  });
  lines.push('--------------------------------');
  lines.push(`Subtotal: ${money(data.subtotal, data.currencySymbol)}`);
  if (data.discount > 0) lines.push(`Descuento: -${money(data.discount, data.currencySymbol)}`);
  lines.push(`IVA: ${money(data.tax, data.currencySymbol)}`);
  lines.push(`*Total: ${money(data.total, data.currencySymbol)}*`);
  const paymentLabel = data.paymentMethod.replace('_', ' ').replace(/^./, (l) => l.toUpperCase());
  lines.push(`${paymentLabel}: ${money(data.amountReceived || data.total, data.currencySymbol)}`);
  if (data.change > 0) lines.push(`Cambio: ${money(data.change, data.currencySymbol)}`);
  if (data.wallet) {
    if (data.wallet.redeemed > 0) lines.push(`Pago monedero: -${money(data.wallet.redeemed, data.currencySymbol)}`);
    if (data.wallet.change_saved > 0) lines.push(`Cambio a monedero: ${money(data.wallet.change_saved, data.currencySymbol)}`);
    lines.push(`Puntos ganados: ${data.wallet.points_earned.toFixed(2)} pts`);
    lines.push(`Saldo monedero: ${money(data.wallet.balance, data.currencySymbol)}`);
  }
  lines.push('--------------------------------');
  lines.push('Precios incluyen impuestos');
  lines.push('Gracias por su compra');
  return lines.join('\n');
}

export function buildWhatsAppUrl(phone: string, text: string): string {
  const cleanPhone = phone.replace(/\D/g, '');
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${cleanPhone}?text=${encoded}`;
}

export interface CashTicketData {
  branch: Branch;
  logoUrl: string | null;
  storeName: string;
  title: string;
  folio: string;
  cashierName: string;
  createdAt: string;
  currencySymbol: string;
  ticketWidth?: '55' | '80';
  rows: { label: string; value: string }[];
  sections?: { heading: string; rows: { label: string; value: string }[] }[];
  resultLabel?: string;
  resultValue?: string;
  resultKind?: 'ok' | 'short' | 'over';
  signatureLine?: boolean;
}

function buildCashTicketDocument(data: CashTicketData): string {
  const width = '58mm';
  const fontSize = '12px';
  const h1Size = '14px';
  const smallSize = '10px';
  const addressHtml = branchAddress(data.branch).map((line) => `<div>${escapeHtml(line)}</div>`).join('');
  const logoSource = data.branch?.logo_url || data.logoUrl;
  const logoHtml = logoSource ? `<img class="logo" src="${escapeHtml(logoSource)}" alt="Logotipo" />` : '';
  const rowsHtml = data.rows.map((r) => `<div class="row"><span>${escapeHtml(r.label)}</span><span>${escapeHtml(r.value)}</span></div>`).join('');
  const sectionsHtml = (data.sections ?? []).map((s) => `<div class="divider"></div><div class="center small">${escapeHtml(s.heading)}</div>${s.rows.map((r) => `<div class="row"><span>${escapeHtml(r.label)}</span><span>${escapeHtml(r.value)}</span></div>`).join('')}`).join('');
  const resultHtml = data.resultLabel && data.resultValue
    ? `<div class="divider"></div><div class="row"><b>${escapeHtml(data.resultLabel)}</b><b>${escapeHtml(data.resultValue)}</b></div>`
    : '';
  const signatureHtml = data.signatureLine ? `<div class="divider"></div><div style="margin-top:8mm;text-align:center;"><div style="border-top:1px solid #000;width:70%;margin:0 auto;"></div><div class="small" style="margin-top:1mm;">Firma del cajero</div></div>` : '';
  const body = `<header>${logoHtml}<h1>${escapeHtml(data.storeName)}</h1>${addressHtml}</header><div class="divider"></div><div class="center small">${escapeHtml(data.title)}</div><div class="divider"></div>${rowsHtml}${sectionsHtml}${resultHtml}${signatureHtml}<div class="center small" style="margin-top:2mm;">Gracias por su preferencia</div><div class="ticket-spacer"><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div></div><div class="center small">.</div>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(data.title)} ${escapeHtml(data.folio)}</title><style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000 !important; background: #fff !important; border-color: #000 !important; opacity: 1 !important; }
    html, body { width: ${width}; margin: 0; padding: 0; background: #fff; color: #000; }
    body { padding: 4mm; color: #000; font-family: 'Courier New', monospace; font-size: ${fontSize}; font-weight: bold; line-height: 1.4; -webkit-font-smoothing: none; }
    header { text-align: center; }
    .logo { display: block; max-width: 70%; max-height: 26mm; margin: 0 auto 1mm; object-fit: contain; }
    h1 { font-size: ${h1Size}; margin: 0 0 1mm; text-transform: uppercase; }
    .center { text-align: center; }
    .divider { border-top: 1px dashed #000; margin: 2mm 0; }
    .row { display: flex; justify-content: space-between; gap: 4px; }
    .small { font-size: ${smallSize}; }
    .ticket-spacer { line-height: 1.4; }
    b, strong { font-weight: bold; }
    * { page-break-inside: avoid; }
    @media print { html, body { width: ${width}; margin: 0; } button, .no-print { display: none !important; } }
  </style></head><body>${body}<script>(function(){function p(){try{window.print()}catch(e){}}if(document.readyState==='complete'){setTimeout(p,150)}else{window.addEventListener('load',function(){setTimeout(p,150)})}})();<\/script></body></html>`;
}

export async function printCashTicket(data: CashTicketData): Promise<void> {
  const html = buildCashTicketDocument(data);
  if (await silentPrint(html)) return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer,width=420,height=640');
  if (win) {
    win.focus();
    win.addEventListener('load', () => URL.revokeObjectURL(url));
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else {
    URL.revokeObjectURL(url);
  }
}
