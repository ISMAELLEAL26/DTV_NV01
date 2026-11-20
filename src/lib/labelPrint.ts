import type { Product } from '@/lib/types';

export type LabelToken = 'PRODUCTO' | 'PRECIO' | 'QR' | 'BARCODE' | 'CODIGO' | 'DEPARTAMENTO' | 'LOGO' | 'TEXTO';
export type LabelAlign = 'left' | 'center' | 'right';

export interface LabelElement {
  id: string;
  token: LabelToken;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold: boolean;
  align: LabelAlign;
  visible: boolean;
}

export interface LabelLayout {
  width: number;
  height: number;
  marginTop: number;
  marginLeft: number;
  shape: 'square' | 'rounded';
  elements: LabelElement[];
}

export interface LabelData {
  product: Product;
  price: number;
  code: string;
  department: string;
  qrDataUrl: string;
  logoDataUrl: string;
}

export function getProductCode(product: Product): string {
  return product.barcode?.trim() || product.barcode_2?.trim() || product.sku?.trim() || product.id.slice(0, 12);
}

export const LABEL_WIDTH = 37.5;
export const LABEL_HEIGHT = 30;

export const createDefaultLabelLayout = (): LabelLayout => ({
  width: LABEL_WIDTH,
  height: LABEL_HEIGHT,
  marginTop: 0.6,
  marginLeft: 1.0,
  shape: 'square',
  elements: [
    // 1. Nombre del producto arriba en 1-2 líneas compactas
    { id: 'product', token: 'PRODUCTO', text: '', x: 1.0, y: 0.6, width: 35.5, height: 5.4, fontSize: 6.2, bold: true, align: 'center', visible: true },
    // 2. Precio grande y protagonista al centro (sin QR estorbando)
    { id: 'price', token: 'PRECIO', text: '', x: 0.8, y: 5.8, width: 35.9, height: 14.2, fontSize: 28, bold: true, align: 'center', visible: true },
    // 3. Código de barras/numérico abajo a la izquierda
    { id: 'right-code', token: 'CODIGO', text: '', x: 1.4, y: 20.8, width: 34.7, height: 3.8, fontSize: 7.5, bold: true, align: 'left', visible: true },
    // 4. Departamento abajo a la izquierda, debajo del código
    { id: 'department', token: 'DEPARTAMENTO', text: '', x: 1.4, y: 24.6, width: 34.7, height: 4.2, fontSize: 5.2, bold: true, align: 'left', visible: true },
    // QR desactivado por defecto para dar prioridad al precio grande
    { id: 'qr', token: 'QR', text: '', x: 1.4, y: 20.4, width: 7.4, height: 7.4, fontSize: 7, bold: true, align: 'center', visible: false },
    { id: 'qr-code', token: 'CODIGO', text: '', x: 1.0, y: 24.4, width: 10.2, height: 4.4, fontSize: 5.2, bold: true, align: 'center', visible: false },
    { id: 'logo', token: 'LOGO', text: '', x: 20.2, y: 14.2, width: 16, height: 7.8, fontSize: 7, bold: true, align: 'center', visible: false },
    { id: 'barcode', token: 'BARCODE', text: '', x: 12.2, y: 15.2, width: 7, height: 10, fontSize: 5, bold: true, align: 'center', visible: false },
    { id: 'free-text', token: 'TEXTO', text: 'PRECIO SUJETO A CAMBIO', x: 1.0, y: 27.5, width: 35.5, height: 1.8, fontSize: 4, bold: false, align: 'center', visible: false },
  ],
});

const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character] ?? character));

const formatPrice = (value: number): string =>
  `$${value.toLocaleString('es-MX', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

function getPriceSizeMm(priceText: string, layoutHeight: number): number {
  const digitsAndSign = priceText.replace(/[^0-9$]/g, '').length;
  const maxHeightMm = Math.min(14.5, layoutHeight * 0.48);
  if (digitsAndSign >= 4) return Number((maxHeightMm * 0.84).toFixed(1)); // ej. $100 / $222
  if (digitsAndSign === 3) return Number((maxHeightMm * 0.94).toFixed(1)); // ej. $22
  return Number(maxHeightMm.toFixed(1)); // ej. $5
}

export function code128Svg(value: string): string {
  const clean = value.trim();
  if (!clean) return '';
  const encoded = Array.from(clean).map((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code <= 126 ? code - 32 : 0;
  });
  const checksum = (104 + encoded.reduce((sum, code, index) => sum + code * (index + 1), 0)) % 103;
  const symbols = [104, ...encoded, checksum, 106];
  const totalModules = symbols.reduce((sum, symbol) => sum + (symbol === 106 ? 13 : 11), 0);
  let x = 0;
  const bars: string[] = [];
  symbols.forEach((symbol) => {
    const pattern = CODE128_PATTERNS[symbol];
    let drawBar = true;
    for (const width of pattern.split('').map(Number)) {
      if (drawBar) bars.push(`<rect x="${x}" y="0" width="${width}" height="31"/>`);
      x += width;
      drawBar = !drawBar;
    }
  });
  return `<svg class="linear-barcode" viewBox="0 0 ${totalModules} 42" preserveAspectRatio="none" role="img" aria-label="Código ${escapeHtml(clean)}"><g fill="#000">${bars.join('')}</g><text x="${totalModules / 2}" y="40" text-anchor="middle">${escapeHtml(clean)}</text></svg>`;
}

function valueForElement(element: LabelElement, data: LabelData): string {
  switch (element.token) {
    case 'PRODUCTO': return data.product.name.toUpperCase();
    case 'PRECIO': return formatPrice(data.price);
    case 'CODIGO': return data.code;
    case 'DEPARTAMENTO': return data.department.toUpperCase();
    case 'TEXTO': return element.text;
    default: return '';
  }
}

function elementHtml(element: LabelElement, data: LabelData, layoutHeight: number): string {
  if (!element.visible) return '';
  const rawText = valueForElement(element, data);
  const fontSizeCss =
    element.token === 'PRECIO'
      ? `${getPriceSizeMm(rawText, layoutHeight)}mm`
      : `${element.fontSize}pt`;
  const style = `left:${element.x}mm;top:${element.y}mm;width:${element.width}mm;height:${element.height}mm;font-size:${fontSizeCss};font-weight:${element.bold ? 700 : 400};text-align:${element.align};`;
  if (element.token === 'QR') return `<div class="label-element image-element" style="${style}"><img src="${escapeHtml(data.qrDataUrl)}" alt="QR" /></div>`;
  if (element.token === 'LOGO') return `<div class="label-element image-element" style="${style}">${data.logoDataUrl ? `<img src="${escapeHtml(data.logoDataUrl)}" alt="Logo" />` : ''}</div>`;
  if (element.token === 'BARCODE') return `<div class="label-element barcode-element" style="${style}">${code128Svg(data.code)}</div>`;
  const singleLineClass = element.id === 'right-code' || element.id === 'price' || element.id === 'department' ? ' single-line' : '';
  return `<div class="label-element${singleLineClass}" style="${style}">${escapeHtml(rawText)}</div>`;
}

export function buildLabelPrintHtml(labels: LabelData[], layout: LabelLayout): string {
  const pages = labels
    .map((data) => `<section class="label-page">${layout.elements.map((element) => elementHtml(element, data, layout.height)).join('')}</section>`)
    .join('');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @page { size: ${layout.width}mm ${layout.height}mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { width: ${layout.width}mm; font-family: Arial, Helvetica, sans-serif; }
    .label-page { position: relative; width: ${layout.width}mm; height: ${layout.height}mm; overflow: hidden; background: #fff; color: #000; border: none; border-radius: 0; page-break-after: always; }
    .label-page:last-child { page-break-after: auto; }
    .label-element { position: absolute; overflow: hidden; line-height: 1.05; white-space: pre-wrap; word-break: break-word; color: #000; display: flex; align-items: center; justify-content: flex-start; padding: 0; }
    .label-element.single-line { white-space: nowrap; word-break: normal; }
    .label-element[style*="text-align:center"] { justify-content: center; }
    .label-element[style*="text-align:right"] { justify-content: flex-end; }
    .image-element img { display: block; width: 100%; height: 100%; object-fit: contain; filter: grayscale(1) contrast(2); }
    .barcode-element { display: block; }
    .linear-barcode { display: block; width: 100%; height: 100%; overflow: visible; }
    .linear-barcode text { font: bold 7px Arial, sans-serif; fill: #000; }
    @media print { html, body { width: ${layout.width}mm; } }
  </style></head><body>${pages}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));</script></body></html>`;
}

export async function printLabels(labels: LabelData[], layout: LabelLayout, printerName: string): Promise<void> {
  if (labels.length === 0) throw new Error('No hay etiquetas para imprimir.');
  const html = buildLabelPrintHtml(labels, layout);
  if (window.electronAPI?.printLabels) {
    await window.electronAPI.printLabels(html, { printerName, width: layout.width, height: layout.height });
    return;
  }
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank', 'noopener,noreferrer,width=480,height=720');
  if (!printWindow) {
    URL.revokeObjectURL(url);
    throw new Error('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes e intenta de nuevo.');
  }
  printWindow.addEventListener('afterprint', () => URL.revokeObjectURL(url), { once: true });
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
