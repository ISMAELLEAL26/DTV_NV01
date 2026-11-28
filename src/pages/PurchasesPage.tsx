import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, formatDateTime, generateFolio } from '@/lib/format';
import type { Branch, Product, ProductBranchPrice, Purchase, PurchaseItem, Supplier, SupplierOrder, SupplierOrderItem } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import {
  ClipboardCheck, ClipboardList, Eye, Plus, Receipt, Trash2, ScanLine,
  Search as SearchIcon, X, ArrowRight, TrendingUp, ArrowDown, ArrowUp, Minus, Tags,
  Download, Mail, WalletCards, Loader2, CheckCircle2, Printer,
} from 'lucide-react';
import { sendBusinessEmail } from '@/services/emailService';
import { fetchCashReportRecipient } from '@/lib/cashReportEmail';
import { PROGRAM_LOGO } from '@/lib/branding';
import { generateQrDataUrl, printCashTicket, type CashTicketData } from '@/components/TicketPrint';
import { sanitizeFilterValue, searchAndRank } from '@/lib/search';
import { effectivePrices, fetchAllBranchPrices, saveProductPrices } from '@/lib/branchPrices';
import BienestarOrderModal from '@/components/BienestarOrderModal';

type Tab = 'purchases' | 'orders';
type PurchaseUnit = 'pieza' | 'caja' | 'granel';
type TaxType = 'sin_impuesto' | 'iva_16' | 'ieps_8' | 'iva_16_ieps_8';
interface LineItem {
  product_id: string;
  product_name: string;
  purchase_unit: PurchaseUnit;
  box_count: string;
  pieces_per_box: string;
  box_price: string;
  piece_quantity: string;
  tax_type: TaxType;
  includes_tax: boolean;
  price_input: string;
  unit_label: string;
  original_cost_price: number | null;
  image_url: string | null;
}

const blankLine = (): LineItem => ({
  product_id: '', product_name: '', purchase_unit: 'pieza', box_count: '1',
  pieces_per_box: '1', box_price: '0', piece_quantity: '1', tax_type: 'sin_impuesto',
  includes_tax: true, price_input: '0', unit_label: 'pieza', original_cost_price: null,
  image_url: null,
});
const taxRate = (type: TaxType): number => ({ sin_impuesto: 0, iva_16: 16, ieps_8: 8, iva_16_ieps_8: 24 }[type]);
const taxLabel = (type: TaxType): string => ({ sin_impuesto: 'Sin impuesto', iva_16: 'IVA 16%', ieps_8: 'IEPS 8%', iva_16_ieps_8: 'IVA 16% + IEPS 8%' }[type]);

function calculateLine(line: LineItem) {
  let pieces: number;
  let unitCostAfter = 0;
  if (line.purchase_unit === 'caja') {
    pieces = Math.max(0, Number(line.box_count) || 0) * Math.max(0, Number(line.pieces_per_box) || 0);
    const boxTotal = Math.max(0, Number(line.box_price) || 0);
    unitCostAfter = pieces > 0 ? boxTotal / pieces : 0;
  } else {
    pieces = Math.max(0, Number(line.piece_quantity) || 0);
    unitCostAfter = Math.max(0, Number(line.price_input) || 0);
  }
  const rate = taxRate(line.tax_type) / 100;
  const after = unitCostAfter;
  const before = rate > 0 ? after / (1 + rate) : after;
  return {
    pieces, before, after, tax: after - before,
    beforeTotal: before * pieces, afterTotal: after * pieces, taxTotal: (after - before) * pieces,
    unitCostAfter: after,
  };
}

interface PriceChangeEntry {
  product: Product;
  oldCost: number;
  newCost: number;
  diff: number;
}

const DRAFT_KEY = 'purchase_draft_v2';

interface DraftState { tab: Tab; supplierId: string; lineItems: LineItem[]; }
interface CashBoxOption { id: string; name: string; registerId: string | null; }
interface PurchaseReceipt {
  folio: string;
  pdfUrl: string;
  pdfBase64: string;
  report: string;
  supplierName: string;
  branchName: string;
  payment: string;
  cashBox: string;
  total: number;
  cashExit: boolean;
  createdAt: string;
  userName: string;
  validationCode: string;
}

function loadDraft(): DraftState | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState;
    if (!parsed.lineItems || parsed.lineItems.length === 0) return null;
    return parsed;
  } catch { return null; }
}

function saveDraft(state: DraftState) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

function priceComparisonLabel(original: number | null, newCost: number): { label: string; color: string; icon: React.ReactNode } {
  if (original == null || original === 0) return { label: 'Costo nuevo', color: 'text-blue-600', icon: <Tags size={13} /> };
  const diff = newCost - original;
  if (Math.abs(diff) < 0.001) return { label: 'Mismo precio de compra', color: 'text-slate-500', icon: <Minus size={13} /> };
  if (diff > 0) return { label: `Más caro (+${formatCurrency(diff)})`, color: 'text-red-600', icon: <ArrowUp size={13} /> };
  return { label: `Más barato (${formatCurrency(diff)})`, color: 'text-emerald-600', icon: <ArrowDown size={13} /> };
}

interface PurchasePdfLine {
  product_name: string;
  purchase_unit: PurchaseUnit;
  quantity: number;
  box_count: number;
  pieces_per_box: number;
  unit_cost_before_tax: number;
  unit_cost_after_tax: number;
  line_subtotal_before_tax: number;
  line_subtotal_after_tax: number;
  tax_amount: number;
  tax_type: TaxType;
}

async function logoDataUrl(): Promise<string> {
  try {
    const response = await fetch(`${window.location.origin}${PROGRAM_LOGO}`);
    if (!response.ok) return '';
    const blob = await response.blob();
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

async function createPurchasePdf({
  branchName, supplierName, folio, userName, userContact, lines, subtotal, tax, total, payment, cashBox, createdAt,
}: {
  branchName: string;
  supplierName: string;
  folio: string;
  userName: string;
  userContact: string;
  lines: PurchasePdfLine[];
  subtotal: number;
  tax: number;
  total: number;
  payment: string;
  cashBox: string;
  createdAt: string;
}): Promise<{ url: string; pdfBase64: string; report: string; validationCode: string }> {
  const validationPayload = `${folio}|${createdAt}|${supplierName}|${total.toFixed(2)}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(validationPayload));
  const validationCode = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24).toUpperCase();
  const qrData = await generateQrDataUrl(`Compra ${folio}\nProveedor: ${supplierName}\nTotal: ${formatCurrency(total)}\nValidación: ${validationCode}`);
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const logo = await logoDataUrl();
  if (logo) {
    try { doc.addImage(logo, logo.includes('image/jpeg') ? 'JPEG' : 'PNG', 18, 14, 34, 17); } catch { /* logo optional */ }
  }
  let y = 18;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(15, 118, 110);
  doc.text('Comprobante de compra', 58, y + 4);
  doc.setFontSize(10); doc.setTextColor(70, 70, 70); doc.setFont('helvetica', 'normal');
  doc.text(`Sucursal: ${branchName}`, 58, y + 11); doc.text(`Folio: ${folio}`, 58, y + 16); doc.text(`Fecha: ${createdAt}`, 58, y + 21);
  y = 48; doc.setDrawColor(220, 220, 220); doc.line(18, y, 198, y); y += 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Proveedor', 18, y); doc.text('Usuario responsable', 112, y);
  doc.setFont('helvetica', 'normal'); y += 6; doc.text(supplierName.slice(0, 42), 18, y); doc.text(userName.slice(0, 35), 112, y); y += 5; doc.setFontSize(8); doc.text(userContact.slice(0, 42), 112, y); y += 9;
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text('Método de pago', 18, y); doc.text('Caja de salida', 112, y);
  doc.setFont('helvetica', 'normal'); y += 6; doc.text(payment, 18, y); doc.text(cashBox || 'No aplica', 112, y); y += 10;
  doc.setFillColor(15, 118, 110); doc.rect(18, y - 5, 180, 8, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('Producto', 20, y); doc.text('Presentación', 85, y); doc.text('Cantidad', 122, y); doc.text('Impuesto', 145, y); doc.text('Total', 178, y); y += 8;
  doc.setTextColor(50, 50, 50); doc.setFont('helvetica', 'normal');
  lines.forEach((line) => { if (y > 258) { doc.addPage(); y = 20; } const presentation = line.purchase_unit === 'caja' ? `${line.box_count} caja(s) x ${line.pieces_per_box}` : line.purchase_unit; doc.text(line.product_name.slice(0, 32), 20, y); doc.text(presentation.slice(0, 20), 85, y); doc.text(String(line.quantity), 122, y); doc.text(taxLabel(line.tax_type).slice(0, 18), 145, y); doc.text(formatCurrency(line.line_subtotal_after_tax), 178, y); y += 6; });
  y += 5; doc.line(112, y, 198, y); y += 7; doc.text('Subtotal', 145, y); doc.text(formatCurrency(subtotal), 178, y); y += 6; doc.text('Impuestos', 145, y); doc.text(formatCurrency(tax), 178, y); y += 7; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('TOTAL', 145, y); doc.text(formatCurrency(total), 178, y);
  y += 14; doc.setFontSize(8); doc.setTextColor(70, 70, 70); doc.
  const addLine = () => {
    setLineItems((previous) => [...previous, blankLine()]);
    setActiveLineIndex(lineItems.length);
  };
  const addAndNext = (index: number) => {
    const line = lineItems[index];
    if (!line.product_id || calculateLine(line).pieces <= 0) {
      setError('Selecciona un producto y captura una cantidad válida antes de continuar.');
      return;
    }
    setError(null);
    if (index === lineItems.length - 1) setLineItems((previous) => [...previous, blankLine()]);
    setActiveLineIndex(index + 1);
  };
  const removeLine = (index: number) => {
    setLineItems((previous) => previous.filter((_, current) => current !== index));
    setActiveLineIndex((current) => Math.max(0, Math.min(current, lineItems.length - 2)));
  };
  const updateLine = (index: number, key: keyof LineItem, value: string | boolean) => setLineItems((previous) => previous.map((line, current) => {
    if (current !== index) return line;
    if (key === 'product_id' && typeof value === 'string') {
      const product = products.find((item) => item.id === value);
      const isBulk = product?.bulk ?? false;
      return {
        ...line,
        product_id: value,
        product_name: product?.name ?? '',
        price_input: String(product ? branchCost(product) : 0),
        box_price: String((product ? branchCost(product) : 0) * Number(line.pieces_per_box || 1)),
        tax_type: product?.tax_rate === 16 && product.ieps_rate === 8 ? 'iva_16_ieps_8' : product?.tax_rate === 16 ? 'iva_16' : product?.ieps_rate === 8 ? 'ieps_8' : 'sin_impuesto',
        purchase_unit: isBulk ? 'granel' : 'pieza',
        unit_label: product?.unit ?? 'pieza',
        original_cost_price: product ? branchCost(product) : null,
      };
    }
    if (key === 'box_price' && typeof value === 'string') {
      const pieces = line.purchase_unit === 'caja'
        ? Math.max(0, Number(line.box_count) || 0) * Math.max(0, Number(line.pieces_per_box) || 0)
        : 0;
      const pieceCost = pieces > 0 ? (Math.max(0, Number(value) || 0)) / pieces : 0;
      return { ...line, box_price: value, price_input: pieceCost.toFixed(4) };
    }
    if (key === 'pieces_per_box' && typeof value === 'string') {
      const pieces = line.purchase_unit === 'caja'
        ? Math.max(0, Number(line.box_count) || 0) * Math.max(0, Number(value) || 0)
        : 0;
      const boxTotal = Math.max(0, Number(line.box_price) || 0);
      const pieceCost = pieces > 0 ? boxTotal / pieces : 0;
      return { ...line, pieces_per_box: value, price_input: pieceCost.toFixed(4) };
    }
    if (key === 'box_count' && typeof value === 'string') {
      const pieces = Math.max(0, Number(value) || 0) * Math.max(0, Number(line.pieces_per_box) || 0);
      const boxTotal = Math.max(0, Number(line.box_price) || 0);
      const pieceCost = pieces > 0 ? boxTotal / pieces : 0;
      return { ...line, box_count: value, price_input: pieceCost.toFixed(4) };
    }
    return { ...line, [key]: value };
  }));

  const applyProductToLine = (product: Product, lineIndex: number) => {
    setLineItems((prev) => prev.map((line, i) => {
      if (i !== lineIndex) return line;
      const isBulk = product.bulk ?? false;
      const cost = branchCost(product);
      const piecesPerBox = Number(line.pieces_per_box || 1);
      return {
        ...line,
        product_id: product.id,
        product_name: product.name,
        image_url: product.image_url ?? null,
        price_input: String(cost),
        box_price: String((cost * piecesPerBox).toFixed(2)),
        tax_type: product.tax_rate === 16 && product.ieps_rate === 8 ? 'iva_16_ieps_8' : product.tax_rate === 16 ? 'iva_16' : product.ieps_rate === 8 ? 'ieps_8' : 'sin_impuesto',
        purchase_unit: isBulk ? 'granel' : line.purchase_unit === 'pieza' ? 'pieza' : line.purchase_unit,
        unit_label: product.unit ?? 'pieza',
        original_cost_price: cost,
      };
    }));
    window.setTimeout(() => lineInputRefs.current[lineIndex]?.focus(), 20);
  };

  const openScannerForLine = (lineIndex: number) => {
    setScannerLineIndex(lineIndex);
    setScannerOpen(true);
  };

  const findProductByCode = async (code: string): Promise<Product | null> => {
    const trimmed = sanitizeFilterValue(code);
    if (!trimmed) return null;
    const localMatch = products.find((p) =>
      [p.barcode, p.barcode_2, p.sku].some((value) => value?.trim().toLowerCase() === trimmed.toLowerCase())
    );
    if (localMatch) return localMatch;
    const { data, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .or(`barcode.eq.${trimmed},barcode_2.eq.${trimmed},sku.eq.${trimmed}`)
      .maybeSingle();
    if (productError || !data) {
      if (productError) console.error('product code lookup failed', productError);
      return null;
    }
    const product = data as Product;
    setProducts((prev) => prev.some((p) => p.id === product.id) ? prev : [...prev, product]);
    return product;
  };

  const handleScan = async (code: string) => {
    if (!code.trim() || scannerLineIndex === null) return;
    const product = await findProductByCode(code);
    if (product) applyProductToLine(product, scannerLineIndex);
    setScannerOpen(false);
    setScannerLineIndex(null);
  };

  const save = async () => {
    if (!user || !currentBranch) return;
    if (!supplierId) { setError('Selecciona un proveedor.'); return; }
    if (tab === 'purchases' && cashExit && !cashBoxId) { setError('Selecciona la caja de origen para registrar la salida.'); return; }
    const selectedCashBox = cashBoxes.find((box) => box.id === cashBoxId);
    if (tab === 'purchases' && cashExit && !selectedCashBox?.registerId) { setError('La caja seleccionada no tiene un turno abierto para registrar la salida.'); return; }
    const validLines = lineItems.filter((l) => l.product_id);
    if (validLines.length === 0) { setError('Agrega al menos un producto.'); return; }
    if (validLines.some((line) => calculateLine(line).pieces <= 0)) { setError('Cada producto debe tener una cantidad válida.'); return; }
    setSaving(true); setError(null);
    const itemPayload = validLines.map((line) => {
      const value = calculateLine(line);
      return {
        product_id: line.product_id, product_name: line.product_name, quantity: value.pieces,
        unit_cost: value.after, line_total: value.afterTotal, purchase_unit: line.purchase_unit,
        box_count: line.purchase_unit === 'caja' ? Number(line.box_count) : 0,
        pieces_per_box: line.purchase_unit === 'caja' ? Number(line.pieces_per_box) : 1,
        piece_quantity: value.pieces, tax_type: line.tax_type, includes_tax: line.includes_tax,
        unit_cost_before_tax: value.before, unit_cost_after_tax: value.after,
        line_subtotal_before_tax: value.beforeTotal, line_subtotal_after_tax: value.afterTotal,
        tax_amount: value.taxTotal,
      };
    });
    const folio = purchaseFolio || generateFolio(tab === 'purchases' ? 'C' : 'P');
    const common = {
      branch_id: currentBranch.id, supplier_id: supplierId, user_id: user.id, folio,
      subtotal_before_tax: totals.before, subtotal_after_tax: totals.after,
      tax_total: totals.tax, total: totals.after,
      status: tab === 'purchases' ? 'recibida' : 'pendiente',
    };

    if (tab === 'purchases') {
      const { data, error: purchaseError } = await supabase.from('purchases').insert(common).select().maybeSingle();
      if (purchaseError || !data) { console.error(purchaseError); setError('No se pudo guardar la compra.'); setSaving(false); return; }
      const { error: itemError } = await supabase.from('purchase_items').insert(itemPayload.map((item) => ({ ...item, purchase_id: data.id })));
      if (itemError) { console.error(itemError); setError('La compra se guardó, pero no se pudieron guardar sus productos.'); setSaving(false); return; }
      for (const item of itemPayload) {
        const { data: stock } = await supabase.from('product_stock').select('id, quantity').eq('product_id', item.product_id).eq('branch_id', currentBranch.id).maybeSingle();
        if (stock) await supabase.from('product_stock').update({ quantity: Number(stock.quantity) + item.quantity }).eq('id', stock.id);
        else await supabase.from('product_stock').insert({ product_id: item.product_id, branch_id: currentBranch.id, quantity: item.quantity, min_stock: 0 });
      }

      const changes: PriceChangeEntry[] = [];
      const uniqueProductCosts = new Map<string, number>();
      for (const item of itemPayload) {
        if (!uniqueProductCosts.has(item.product_id)) {
          uniqueProductCosts.set(item.product_id, item.unit_cost_after_tax);
        }
      }
      for (const [productId, newCost] of uniqueProductCosts) {
        const { data: prod } = await supabase.from('products').select('id, name, cost_price, sale_price, price_2, price_3, tax_rate, ieps_rate, sku, barcode, barcode_2, prices_shared').eq('id', productId).maybeSingle();
        if (prod) {
          const product = prod as Product;
          const { data: branchRow } = await supabase.from('product_branch_prices').select('*').eq('product_id', productId).eq('branch_id', currentBranch.id).maybeSingle();
          const current = effectivePrices(product, (branchRow as ProductBranchPrice | null) ?? undefined);
          const oldCost = current.cost_price;
          if (Math.abs(oldCost - newCost) > 0.001) {
            changes.push({ product: { ...product, ...current }, oldCost, newCost, diff: newCost - oldCost });
          }
          const saved = await saveProductPrices(product, currentBranch.id, { ...current, cost_price: newCost });
          if (!saved) console.error('Failed to update cost_price', productId);
        }
      }
      if (cashExit && selectedCashBox?.registerId) {
        const { error: cashError } = await supabase.from('cash_movements').insert({
          cash_register_id: selectedCashBox.registerId,
          type: 'egreso',
          amount: totals.after,
          reason: `Compra ${folio} · ${selectedSupplier?.commercial_name || selectedSupplier?.name || 'Proveedor'}`,
        });
        if (cashError) console.error('purchase cash exit failed', cashError);
      }
      const createdAt = new Date().toLocaleString('es-MX');
      const supplierName = selectedSupplier?.commercial_name || selectedSupplier?.name || 'Proveedor';
      const payment = paymentMethod === 'efectivo' ? 'Efectivo' : paymentMethod === 'transferencia' ? 'Transferencia' : paymentMethod === 'tarjeta' ? 'Tarjeta' : 'Crédito';
      const userName = profile?.full_name || user.email || 'Usuario';
      const userContact = [profile?.position, profile?.email || user.email].filter(Boolean).join(' · ');
      const pdf = await createPurchasePdf({ branchName: currentBranch.name, supplierName, folio, userName, userContact, lines: itemPayload as PurchasePdfLine[], subtotal: totals.before, tax: totals.tax, total: totals.after, payment, cashBox: selectedCashBox?.name ?? '', createdAt });
      setPurchaseReceipt({ folio, pdfUrl: pdf.url, pdfBase64: pdf.pdfBase64, report: pdf.report, supplierName, branchName: currentBranch.name, payment, cashBox: selectedCashBox?.name ?? '', total: totals.after, cashExit: Boolean(cashExit && selectedCashBox?.registerId), createdAt, userName, validationCode: pdf.validationCode });
      setSaving(false); setOpen(false); clearDraft(); setHasDraft(false); await load();

      if (changes.length > 0) {
        setPriceChanges(changes);
        setReviewOpen(true);
      }
    } else {
      const { data, error: orderError } = await supabase.from('supplier_orders').insert(common).select().maybeSingle();
      if (orderError || !data) { console.error(orderError); setError('No se pudo guardar el pedido.'); setSaving(false); return; }
      const { error: itemError } = await supabase.from('supplier_order_items').insert(itemPayload.map((item) => ({ ...item, supplier_order_id: data.id })));
      if (itemError) { console.error(itemError); setError('El pedido se guardó, pero no se pudieron guardar sus productos.'); setSaving(false); return; }
      setSaving(false); setOpen(false); clearDraft(); setHasDraft(false); await load();
    }
    sendBusinessEmail('PURCHASE_ORDER', { folio, branchName: currentBranch.name, supplierName: selectedSupplier?.name ?? '—', total: formatCurrency(totals.after), report: `${tab === 'purchases' ? 'Compra' : 'Pedido'} ${folio} a ${selectedSupplier?.name ?? '—'} por ${formatCurrency(totals.after)}` }).catch(() => {});
  };

  const sendReceiptEmail = async () => {
    if (!purchaseReceipt) return;
    setEmailSending(true); setEmailMessage(null);
    try {
      const recipient = await fetchCashReportRecipient();
      if (!recipient) throw new Error('No hay correo de gerencia configurado.');
      const result = await sendBusinessEmail('PURCHASE_ORDER', {
        to_email: recipient,
        subject: `Compra ${purchaseReceipt.folio} — ${currentBranch?.name ?? ''}`,
        folio: purchaseReceipt.folio,
        branchName: currentBranch?.name ?? '',
        storeName: currentBranch?.name ?? 'Tienda Bienestar',
        report: purchaseReceipt.report,
        pdfBase64: purchaseReceipt.pdfBase64,
      });
      if (!result.success) throw new Error(result.error ?? 'No se pudo enviar el correo.');
      setEmailMessage('Comprobante enviado por correo.');
    } catch (err) {
      setEmailMessage(err instanceof Error ? err.message : 'No se pudo enviar el correo.');
    } finally {
      setEmailSending(false);
    }
  };

  const printPurchaseExitTicket = () => {
    if (!purchaseReceipt || !currentBranch || !purchaseReceipt.cashExit) return;
    void printCashTicket({
      branch: currentBranch as Branch,
      logoUrl: PROGRAM_LOGO,
      storeName: currentBranch.name,
      title: 'SALIDA DE CAJA · COMPRA',
      folio: purchaseReceipt.folio,
      cashierName: purchaseReceipt.userName,
      createdAt: purchaseReceipt.createdAt,
      currencySymbol: '$',
      rows: [
        { label: 'Proveedor:', value: purchaseReceipt.supplierName },
        { label: 'Monto pagado:', value: `-${formatCurrency(purchaseReceipt.total)}` },
        { label: 'Caja:', value: purchaseReceipt.cashBox || 'No aplica' },
        { label: 'Método:', value: purchaseReceipt.payment },
        { label: 'Sucursal:', value: purchaseReceipt.branchName },
      ],
      signatureLine: true,
    });
  };

  const view = async (item: Purchase | SupplierOrder, type: Tab) => {
    setViewItem(item);
    const { data } = type === 'purchases'
      ? await supabase.from('purchase_items').select('*').eq('purchase_id', item.id)
      : await supabase.from('supplier_order_items').select('*').eq('supplier_order_id', item.id);
    setViewItems((data as PurchaseItem[] | SupplierOrderItem[]) ?? []);
  };
  const updateOrderStatus = async (order: SupplierOrder, status: string) => { await supabase.from('supplier_orders').update({ status }).eq('id', order.id); await load(); };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;
  return (
    <div className="p-6">
      <PageHeader title="Compras y Pedidos" subtitle="Órdenes por cajas, piezas o kilos con desglose de impuestos" />

      {hasDraft && !open && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>Tienes un borrador de compra o pedido sin guardar.</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={restoreDraft}>Continuar borrador</Button>
            <Button variant="secondary" onClick={discardDraft}>Descartar</Button>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab('purchases')}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'purchases' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
          >
            Compras
          </button>
          <button
            type="button"
            onClick={() => setTab('orders')}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'orders' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
          >
            Pedidos a Proveedor
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setBienestarOpen(true)}>
            Pedido Bienestar
          </Button>
          <Button onClick={() => openNew(tab)}>
            <Plus size={16} /> Nuevo {tab === 'purchases' ? 'compra' : 'pedido'}
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por folio o proveedor..." />
      </div>

      {tab === 'purchases' ? (
        <Card>
          {filteredPurchases.length === 0 ? (
            <EmptyState title="Sin compras registradas" description="Aún no hay compras registradas en esta sucursal." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Folio</th>
                    <th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPurchases.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-800">{p.folio}</td>
                      <td className="px-4 py-3 text-slate-700">{p.supplier?.name || 'Proveedor'}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(p.created_at)}</td>
                      <td className="px-4 py-3"><Badge>{p.status || 'recibida'}</Badge></td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(Number(p.total) || 0)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" onClick={() => void view(p, 'purchases')}>
                          <Eye size={15} /> Ver
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          {filteredOrders.length === 0 ? (
            <EmptyState title="Sin pedidos a proveedor" description="Crea un pedido normal o abre Pedido Bienestar." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Folio</th>
                    <th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-800">{o.folio}</td>
                      <td className="px-4 py-3 text-slate-700">{o.supplier?.name || 'Proveedor'}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(o.created_at)}</td>
                      <td className="px-4 py-3">
                        <select
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                          value={o.status || 'pendiente'}
                          onChange={(e) => void updateOrderStatus(o, e.target.value)}
                        >
                          <option value="pendiente">Pendiente</option>
                          <option value="enviado">Enviado</option>
                          <option value="recibido">Recibido</option>
                          <option value="cancelado">Cancelado</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(Number(o.total) || 0)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" onClick={() => void view(o, 'orders')}>
                          <Eye size={15} /> Ver
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={open} onClose={closeModal} title={tab === 'purchases' ? 'Nueva compra' : 'Nuevo pedido a proveedor'}>
        <div className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Proveedor">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Selecciona proveedor...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.commercial_name || s.name}</option>)}
              </Select>
            </Field>
            <Field label="Folio">
              <Input value={purchaseFolio} onChange={(e) => setPurchaseFolio(e.target.value)} />
            </Field>
          </div>

          {lineItems.map((line, idx) => {
            const calc = calculateLine(line);
            const cmp = priceComparisonLabel(line.original_cost_price, calc.unitCostAfter);
            return (
              <div key={idx} className={`rounded-xl border p-3 ${activeLineIndex === idx ? 'border-emerald-400 bg-emerald-50/20' : 'border-slate-200'}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500">Renglón #{idx + 1}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openScannerForLine(idx)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <ScanLine size={14} /> Escanear
                    </button>
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <Select value={line.product_id} onChange={(e) => updateLine(idx, 'product_id', e.target.value)}>
                      <option value="">Selecciona producto...</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </div>
                  <Select value={line.purchase_unit} onChange={(e) => updateLine(idx, 'purchase_unit', e.target.value)}>
                    <option value="pieza">Pieza</option>
                    <option value="caja">Caja</option>
                    <option value="granel">Granel</option>
                  </Select>
                  <Select value={line.tax_type} onChange={(e) => updateLine(idx, 'tax_type', e.target.value)}>
                    <option value="sin_impuesto">Sin impuesto</option>
                    <option value="iva_16">IVA 16%</option>
                    <option value="ieps_8">IEPS 8%</option>
                    <option value="iva_16_ieps_8">IVA 16% + IEPS 8%</option>
                  </Select>
                </div>

                {line.purchase_unit === 'caja' ? (
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
                    <Input type="number" min="0" placeholder="Cajas" value={line.box_count} onChange={(e) => updateLine(idx, 'box_count', e.target.value)} />
                    <Input type="number" min="1" placeholder="Piezas por caja" value={line.pieces_per_box} onChange={(e) => updateLine(idx, 'pieces_per_box', e.target.value)} />
                    <Input type="number" step="0.01" min="0" placeholder="Precio por caja" value={line.box_price} onChange={(e) => updateLine(idx, 'box_price', e.target.value)} />
                  </div>
                ) : (
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    <Input
                      ref={(el) => { lineInputRefs.current[idx] = el; }}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Cantidad"
                      value={line.piece_quantity}
                      onChange={(e) => updateLine(idx, 'piece_quantity', e.target.value)}
                    />
                    <Input type="number" step="0.01" min="0" placeholder="Costo unitario" value={line.price_input} onChange={(e) => updateLine(idx, 'price_input', e.target.value)} />
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className={`inline-flex items-center gap-1 font-medium ${cmp.color}`}>
                    {cmp.icon} {cmp.label}
                  </span>
                  <span className="font-semibold text-slate-700">
                    Piezas: {calc.pieces} · Total renglón: {formatCurrency(calc.afterTotal)}
                  </span>
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={addLine}>
              <Plus size={15} /> Agregar renglón
            </Button>
            <Button type="button" variant="secondary" onClick={() => addAndNext(activeLineIndex)}>
              <ArrowRight size={15} /> Validar y siguiente
            </Button>
          </div>

          {tab === 'purchases' && (
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="credito">Crédito</option>
              </Select>
              <Select value={cashBoxId} onChange={(e) => setCashBoxId(e.target.value)}>
                <option value="">Caja de salida...</option>
                {cashBoxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={cashExit} onChange={(e) => setCashExit(e.target.checked)} />
                Registrar salida de caja
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-white">
            <div className="text-xs text-slate-300">
              Subtotal: {formatCurrency(totals.before)} · Impuestos: {formatCurrency(totals.tax)}
            </div>
            <div className="text-base font-bold">Total: {formatCurrency(totals.after)}</div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeModal}>Cancelar</Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 size={15} className="animate-spin" />} Guardar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(viewItem)} onClose={() => { setViewItem(null); setViewItems([]); }} title={viewItem ? `Detalle ${viewItem.folio}` : 'Detalle'}>
        {viewItem && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Proveedor:</span>
              <span className="font-semibold">{viewItem.supplier?.name || 'Proveedor'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Total:</span>
              <span className="font-bold">{formatCurrency(Number(viewItem.total) || 0)}</span>
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {viewItems.map((it, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="font-medium text-slate-800">{it.product_name}</span>
                  <span className="text-slate-600">{it.quantity} · {formatCurrency(Number(it.line_total) || 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={scannerOpen} onClose={() => { setScannerOpen(false); setScannerLineIndex(null); }} title="Escanear o buscar código">
        <div className="space-y-3">
          <Input
            placeholder="Escribe o escanea código de barras, código 2 o SKU y presiona Enter"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleScan((e.target as HTMLInputElement).value);
              }
            }}
          />
          <Button variant="secondary" onClick={() => { setScannerOpen(false); setScannerLineIndex(null); }}>
            Cerrar
          </Button>
        </div>
      </Modal>

      <Modal open={reviewOpen} onClose={() => setReviewOpen(false)} title="Cambios detectados en costo de compra">
        <div className="space-y-3 text-sm">
          {priceChanges.map((ch) => (
            <div key={ch.product.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <span className="font-medium text-slate-800">{ch.product.name}</span>
              <span className="text-xs text-slate-600">
                {formatCurrency(ch.oldCost)} → <strong>{formatCurrency(ch.newCost)}</strong>
              </span>
            </div>
          ))}
          <div className="flex justify-end">
            <Button onClick={() => setReviewOpen(false)}>Listo</Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(purchaseReceipt)} onClose={() => setPurchaseReceipt(null)} title={purchaseReceipt ? `Compra guardada · ${purchaseReceipt.folio}` : 'Comprobante'}>
        {purchaseReceipt && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-emerald-700 font-semibold">
              <CheckCircle2 size={18} /> Compra registrada correctamente.
            </div>
            <div className="text-xs text-slate-600">
              Proveedor: <strong>{purchaseReceipt.supplierName}</strong> · Total: <strong>{formatCurrency(purchaseReceipt.total)}</strong>
            </div>
            {emailMessage && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{emailMessage}</div>}
            <div className="flex flex-wrap gap-2">
              <a
                href={purchaseReceipt.pdfUrl}
                download={`Compra_${purchaseReceipt.folio}.pdf`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Download size={15} /> Descargar PDF
              </a>
              <Button variant="secondary" onClick={() => void sendReceiptEmail()} disabled={emailSending}>
                <Mail size={15} /> Enviar por correo
              </Button>
              {purchaseReceipt.cashExit && (
                <Button variant="secondary" onClick={printPurchaseExitTicket}>
                  <Printer size={15} /> Ticket salida caja
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <BienestarOrderModal open={bienestarOpen} onClose={() => setBienestarOpen(false)} />
    </div>
  );
}
