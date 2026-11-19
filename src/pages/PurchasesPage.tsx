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
  y += 14; doc.setFontSize(8); doc.setTextColor(70, 70, 70); doc.setFont('helvetica', 'bold'); doc.text('Cadena única de validación', 18, y); doc.setFont('helvetica', 'normal'); y += 5; doc.text(validationCode, 18, y); if (qrData) { try { doc.addImage(qrData, 'PNG', 164, y - 14, 28, 28); } catch { /* QR optional */ } }
  doc.setFontSize(8); doc.setTextColor(130, 130, 130); doc.text('Generado automáticamente por el sistema de punto de venta.', 18, 282);
  const report = `Compra ${folio}\nFecha: ${createdAt}\nSucursal: ${branchName}\nProveedor: ${supplierName}\nUsuario: ${userName} (${userContact})\nMétodo de pago: ${payment}\nCaja de salida: ${cashBox || 'No aplica'}\nTotal: ${formatCurrency(total)}\nCadena de validación: ${validationCode}`;
  const dataUri = doc.output('datauristring');
  return { url: String(doc.output('bloburl')), pdfBase64: dataUri.slice(dataUri.indexOf(',') + 1), report, validationCode };
}

export default function PurchasesPage({ initialTab = 'purchases' }: { initialTab?: Tab }) {
  const { user, profile, currentBranch } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branchPriceRows, setBranchPriceRows] = useState<ProductBranchPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [viewItem, setViewItem] = useState<Purchase | SupplierOrder | null>(null);
  const [viewItems, setViewItems] = useState<PurchaseItem[] | SupplierOrderItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([blankLine()]);
  const [hasDraft, setHasDraft] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLineIndex, setScannerLineIndex] = useState<number | null>(null);
  const [priceChanges, setPriceChanges] = useState<PriceChangeEntry[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const [purchaseFolio, setPurchaseFolio] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [cashExit, setCashExit] = useState(true);
  const [cashBoxes, setCashBoxes] = useState<CashBoxOption[]>([]);
  const [cashBoxId, setCashBoxId] = useState('');
  const [purchaseReceipt, setPurchaseReceipt] = useState<PurchaseReceipt | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);

  const branchRowByProduct = useMemo(() => {
    const map = new Map<string, ProductBranchPrice>();
    for (const row of branchPriceRows) if (row.branch_id === currentBranch?.id) map.set(row.product_id, row);
    return map;
  }, [branchPriceRows, currentBranch]);
  const branchCost = (product: Product): number => effectivePrices(product, branchRowByProduct.get(product.id)).cost_price;

  const load = useCallback(async () => {
    if (!currentBranch) return;
    setLoading(true);
    const allProducts: Product[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('products').select('*').eq('active', true).order('name').range(from, from + 999);
      if (error) { console.error(error); break; }
      allProducts.push(...((data as Product[]) ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const [{ data: purchaseRows }, { data: orderRows }, { data: supplierRows }] = await Promise.all([
      supabase.from('purchases').select('*, supplier:suppliers(*)').eq('branch_id', currentBranch.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('supplier_orders').select('*, supplier:suppliers(*)').eq('branch_id', currentBranch.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('suppliers').select('*').order('name'),
    ]);
    setPurchases((purchaseRows as Purchase[]) ?? []);
    setOrders((orderRows as SupplierOrder[]) ?? []);
    setSuppliers((supplierRows as Supplier[]) ?? []);
    setProducts(allProducts);
    setBranchPriceRows(await fetchAllBranchPrices());
    setLoading(false);
  }, [currentBranch]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const draft = loadDraft();
    if (draft) setHasDraft(true);
  }, []);

  useEffect(() => {
    if (open && lineItems.length > 0) {
      saveDraft({ tab, supplierId, lineItems });
    }
  }, [tab, supplierId, lineItems, open]);

  const filteredPurchases = useMemo(() => searchAndRank(search, purchases, (item) => [item.folio ?? '', item.supplier?.name ?? '']), [purchases, search]);
  const filteredOrders = useMemo(() => searchAndRank(search, orders, (item) => [item.folio ?? '', item.supplier?.name ?? '']), [orders, search]);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);
  const totals = lineItems.reduce((summary, line) => {
    const value = calculateLine(line);
    return { before: summary.before + value.beforeTotal, after: summary.after + value.afterTotal, tax: summary.tax + value.taxTotal };
  }, { before: 0, after: 0, tax: 0 });

  const loadCashBoxes = useCallback(async (branchId: string) => {
    const [{ data: boxes, error: boxesError }, { data: occupied, error: occError }] = await Promise.all([
      supabase.from('cash_boxes').select('id, name').eq('branch_id', branchId).eq('active', true).order('name'),
      supabase.rpc('get_occupied_cash_boxes', { p_branch_id: branchId }),
    ]);
    if (boxesError || occError) {
      console.error('cash boxes load failed', boxesError ?? occError);
      setCashBoxes([]);
      setError('No se pudieron cargar las cajas de la sucursal. Cierra y vuelve a abrir la pantalla.');
      return;
    }
    const registerByBox = new Map(((occupied as { box_id: string; register_id: string }[]) ?? []).map((row) => [row.box_id, row.register_id]));
    setCashBoxes(((boxes as { id: string; name: string }[]) ?? []).map((box) => ({ ...box, registerId: registerByBox.get(box.id) ?? null })));
  }, []);

  const openNew = (type: Tab) => {
    setTab(type); setSupplierId(''); setLineItems([blankLine()]); setError(null);
    setActiveLineIndex(0); setPurchaseFolio(generateFolio(type === 'purchases' ? 'C' : 'P'));
    setPaymentMethod('efectivo'); setCashExit(type === 'purchases'); setCashBoxId('');
    setEmailMessage(null); clearDraft(); setHasDraft(false);
    setOpen(true);
    if (type === 'purchases' && currentBranch) void loadCashBoxes(currentBranch.id);
  };

  const restoreDraft = () => {
    const draft = loadDraft();
    if (!draft) return;
    setTab(draft.tab); setSupplierId(draft.supplierId); setLineItems(draft.lineItems); setError(null);
    setHasDraft(false);
    setOpen(true);
    if (draft.tab === 'purchases' && currentBranch) void loadCashBoxes(currentBranch.id);
  };

  const discardDraft = () => {
    clearDraft(); setHasDraft(false);
  };

  const closeModal = () => {
    setOpen(false);
  };

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

      // Update cost_price in catalog and detect changes
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
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setTab('purchases')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'purchases' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}><ClipboardList className="mr-2 inline" size={16} />Compras</button>
        <button onClick={() => setTab('orders')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'orders' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}><ClipboardCheck className="mr-2 inline" size={16} />Pedidos a Proveedor</button>
        <div className="flex-1" />
        {hasDraft && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
            <span>Tienes un borrador en curso</span>
            <button onClick={restoreDraft} className="font-semibold text-emerald-700 hover:underline">Continuar</button>
            <button onClick={discardDraft} className="text-slate-400 hover:text-red-600" title="Descartar"><X size={14} /></button>
          </div>
        )}
        <Button onClick={() => openNew(tab)}><Plus size={16} /> {tab === 'purchases' ? 'Nueva compra' : 'Nuevo pedido'}</Button>
      </div>
      <div className="mb-4"><SearchInput value={search} onChange={setSearch} /></div>
      {tab === 'purchases' ? <PurchaseTable items={filteredPurchases} onView={(item) => void view(item, 'purchases')} /> : <OrderTable items={filteredOrders} onView={(item) => void view(item, 'orders')} onStatus={updateOrderStatus} />}

      <Modal open={open} onClose={closeModal} title={tab === 'purchases' ? 'Nueva compra' : 'Nuevo pedido a proveedor'} size="2xl">
        <div className="space-y-4">
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1.5fr_1fr_1fr]">
            <Field label="Proveedor *">
              <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">Selecciona...</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.commercial_name || supplier.name}</option>)}
              </Select>
            </Field>
            <div><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sucursal</span><p className="mt-2 font-semibold text-slate-800">{currentBranch?.name ?? '—'}</p></div>
            <div><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Folio</span><p className="mt-2 font-semibold text-slate-800">{purchaseFolio || 'Se generará al guardar'}</p></div>
          </div>
          {selectedSupplier && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm md:grid-cols-4">
              <div><span className="text-blue-600">Crédito</span><p className="font-semibold text-slate-700">{selectedSupplier.credit_enabled ? `${selectedSupplier.credit_term_days} días` : 'No'}</p></div>
              <div><span className="text-blue-600">Límite</span><p className="font-semibold text-slate-700">{formatCurrency(selectedSupplier.credit_limit)}</p></div>
              <div><span className="text-blue-600">Entrega</span><p className="font-semibold text-slate-700">{selectedSupplier.delivery_days || '—'}</p></div>
              <div><span className="text-blue-600">Saldo actual</span><p className="font-semibold text-amber-700">{formatCurrency(selectedSupplier.balance_due)}</p></div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div><h3 className="font-semibold text-slate-800">Captura activa</h3><p className="text-xs text-slate-500">Busca por nombre, SKU o código; agrega un producto y continúa con el siguiente.</p></div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Paso {Math.min(activeLineIndex + 1, lineItems.length)}</span>
          </div>
          <div className="space-y-2">
            {lineItems.slice(0, activeLineIndex).map((line, index) => {
              const result = calculateLine(line);
              return <button key={index} type="button" onClick={() => setActiveLineIndex(index)} className="flex w-full items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-left transition hover:border-emerald-300">{line.image_url ? <img src={line.image_url} alt="" className="h-9 w-9 flex-shrink-0 rounded-lg object-cover" /> : <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white"><Receipt size={16} className="text-emerald-400" /></div>}<span className="ml-3 min-w-0 flex-1 truncate font-medium text-slate-800">{line.product_name || 'Producto sin seleccionar'}</span><span className="ml-3 whitespace-nowrap text-sm font-semibold text-emerald-700">{result.pieces} · {formatCurrency(result.afterTotal)}</span></button>;
            })}
            <PurchaseLine
              key={activeLineIndex}
              line={lineItems[activeLineIndex] ?? blankLine()}
              index={activeLineIndex}
              products={products}
              onChange={updateLine}
              onRemove={() => removeLine(activeLineIndex)}
              onScan={() => openScannerForLine(activeLineIndex)}
              onPickProduct={(p) => applyProductToLine(p, activeLineIndex)}
              onSearchProduct={findProductByCode}
              onAddNext={() => addAndNext(activeLineIndex)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 text-sm md:grid-cols-4"><Summary label="Subtotal sin impuesto" value={totals.before} /><Summary label="Subtotal con impuesto" value={totals.after} /><Summary label="Impuestos cobrados" value={totals.tax} /><Summary label="Total general" value={totals.after} strong /></div>
          {tab === 'purchases' && <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center gap-2 font-semibold text-slate-800"><WalletCards size={17} className="text-emerald-600" /> Cierre y salida de caja</div><div className="grid gap-3 md:grid-cols-3"><Field label="Método de pago"><Select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setCashExit(event.target.value === 'efectivo'); }}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option><option value="credito">Crédito</option></Select></Field><Field label="Registrar salida"><label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700"><input type="checkbox" checked={cashExit} onChange={(event) => setCashExit(event.target.checked)} /> Salida de caja</label></Field>{cashExit && <Field label="Caja de origen *"><Select value={cashBoxId} onChange={(event) => setCashBoxId(event.target.value)}><option value="">Selecciona caja...</option>{cashBoxes.map((box) => <option key={box.id} value={box.id}>{box.name}{box.registerId ? '' : ' · Sin turno abierto'}</option>)}</Select></Field>}</div></div>}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={closeModal}>Cerrar (se guarda el borrador)</Button><Button variant="danger" onClick={() => { setLineItems([blankLine()]); setSupplierId(''); clearDraft(); setHasDraft(false); setOpen(false); }}>Eliminar borrador</Button><Button onClick={() => void save()} disabled={saving || activeLineIndex < lineItems.length - 1 && !lineItems[lineItems.length - 1]?.product_id}>{saving ? 'Guardando...' : 'Guardar compra'}</Button></div>
        </div>
      </Modal>

      <Modal open={purchaseReceipt !== null} onClose={() => setPurchaseReceipt(null)} title="Compra guardada" size="md">
        {purchaseReceipt && (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-50 p-4 text-center">
              <CheckCircle2 size={30} className="mx-auto text-emerald-600" />
              <p className="mt-2 font-semibold text-slate-800">Compra {purchaseReceipt.folio} registrada</p>
              <p className="text-sm text-slate-500">El inventario y la salida de caja quedaron actualizados.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div><span className="text-slate-500">Proveedor</span><p className="font-semibold text-slate-800">{purchaseReceipt.supplierName || '—'}</p></div>
              <div><span className="text-slate-500">Sucursal</span><p className="font-semibold text-slate-800">{purchaseReceipt.branchName || '—'}</p></div>
              <div><span className="text-slate-500">Método de pago</span><p className="font-semibold text-slate-800">{purchaseReceipt.payment || '—'}</p></div>
              <div><span className="text-slate-500">Caja</span><p className="font-semibold text-slate-800">{purchaseReceipt.cashBox || 'No aplica'}</p></div>
              <div><span className="text-slate-500">Total</span><p className="font-bold text-emerald-600">{formatCurrency(purchaseReceipt.total)}</p></div>
              <div><span className="text-slate-500">Fecha</span><p className="font-semibold text-slate-800">{formatDateTime(purchaseReceipt.createdAt)}</p></div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cadena única de validación</span>
              <p className="mt-1 break-all font-mono text-xs text-slate-700">{purchaseReceipt.validationCode}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <a href={purchaseReceipt.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
                <Download size={16} /> Ver PDF
              </a>
              {purchaseReceipt.cashExit && (
                <Button variant="secondary" onClick={printPurchaseExitTicket}>
                  <Printer size={16} /> Ticket salida
                </Button>
              )}
              <Button onClick={() => void sendReceiptEmail()} disabled={emailSending}>
                <Mail size={16} /> {emailSending ? 'Enviando...' : 'Enviar correo'}
              </Button>
            </div>
            {emailMessage && <div className={`rounded-lg px-3 py-2 text-sm ${emailMessage.includes('enviado') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{emailMessage}</div>}
            <div className="flex justify-end"><Button variant="secondary" onClick={() => setPurchaseReceipt(null)}>Cerrar</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={viewItem !== null} onClose={() => setViewItem(null)} title="Detalle de compra" size="xl">
        {viewItem && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><span className="text-slate-500">Folio</span><p className="font-semibold">{viewItem.folio || '—'}</p></div>
              <div><span className="text-slate-500">Proveedor</span><p className="font-semibold">{viewItem.supplier?.name || '—'}</p></div>
              <div><span className="text-slate-500">Fecha</span><p className="font-semibold">{formatDateTime(viewItem.created_at)}</p></div>
              <div><span className="text-slate-500">Total</span><p className="font-bold text-emerald-600">{formatCurrency(viewItem.total)}</p></div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">Presentación</th>
                    <th className="px-3 py-2">Impuesto</th>
                    <th className="px-3 py-2 text-right">Sin impuesto</th>
                    <th className="px-3 py-2 text-right">Con impuesto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewItems.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 font-medium">{item.product_name}</td>
                      <td className="px-3 py-2">{item.purchase_unit === 'caja' ? `${item.box_count} cajas × ${item.pieces_per_box}` : `${item.piece_quantity ?? item.quantity} ${item.purchase_unit === 'granel' ? 'kg' : 'piezas'}`}</td>
                      <td className="px-3 py-2">{taxLabel((item.tax_type as TaxType) || 'sin_impuesto')} · {item.includes_tax ? 'Incluido' : 'No incluido'}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(item.line_subtotal_before_tax ?? item.line_total)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.line_subtotal_after_tax ?? item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <BarcodeScannerModal open={scannerOpen} onClose={() => { setScannerOpen(false); setScannerLineIndex(null); }} onDetect={handleScan} />

      {reviewOpen && currentBranch && (
        <PriceReviewModal
          changes={priceChanges}
          branchId={currentBranch.id}
          onClose={() => { setReviewOpen(false); setPriceChanges([]); }}
          onSaved={() => {
            setReviewOpen(false);
            setPriceChanges([]);
            void load();
          }}
        />
      )}
    </div>
  );
}

function PurchaseLine({ line, index, products, onChange, onRemove, onScan, onPickProduct, onSearchProduct, onAddNext }: {
  line: LineItem;
  index: number;
  products: Product[];
  onChange: (index: number, key: keyof LineItem, value: string | boolean) => void;
  onRemove: () => void;
  onScan: () => void;
  onPickProduct: (p: Product) => void;
  onSearchProduct: (code: string) => Promise<Product | null>;
  onAddNext?: () => void;
}) {
  const result = calculateLine(line);
  const unitLabel = line.purchase_unit === 'granel' ? (line.unit_label || 'kg') : 'piezas';
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return searchAndRank(q, products, (p) => [p.name, p.sku, p.barcode, p.barcode_2]).slice(0, 6);
  }, [query, products]);

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const exactMatch = products.find((p) =>
      [p.barcode, p.barcode_2, p.sku].some((value) => value?.trim().toLowerCase() === trimmed.toLowerCase())
    );
    const product = exactMatch ?? await onSearchProduct(trimmed);
    if (product) {
      onPickProduct(product);
      setQuery('');
      setShowResults(false);
      return;
    }
    if (results.length > 0) {
      onPickProduct(results[0]);
      setQuery('');
      setShowResults(false);
    }
  };

  const comparison = line.product_id
    ? priceComparisonLabel(line.original_cost_price, result.unitCostAfter)
    : null;

  const boxPieceCost = line.purchase_unit === 'caja'
    ? (() => {
        const pieces = Math.max(0, Number(line.box_count) || 0) * Math.max(0, Number(line.pieces_per_box) || 0);
        const boxTotal = Math.max(0, Number(line.box_price) || 0);
        return pieces > 0 ? boxTotal / pieces : 0;
      })()
    : 0;

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="relative mb-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
              onFocus={() => setShowResults(true)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar por nombre, SKU o código..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <button type="button" onClick={onScan} title="Escanear código" className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-blue-50 hover:text-blue-700">
            <ScanLine size={16} /> Escanear
          </button>
          <button onClick={onRemove} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Quitar"><Trash2 size={16} /></button>
        </div>
        {showResults && query.trim() && (
          <div className="absolute z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg" style={{ width: 'calc(100% - 110px)' }}>
            {results.length === 0 ? (
              <div className="px-3 py-3 text-center text-sm text-slate-400">Sin resultados para "{query}"</div>
            ) : (
              results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onPickProduct(p); setQuery(''); setShowResults(false); }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-emerald-50"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 overflow-hidden">
                    {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : <Receipt size={14} className="text-slate-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">{p.name}</div>
                    <div className="truncate text-xs text-slate-400">{p.sku ?? 'Sin SKU'} · {p.barcode ?? 'Sin código'}</div>
                  </div>
                  <Plus size={16} className="flex-shrink-0 text-emerald-600" />
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {line.product_id && comparison && (
        <div className={`mb-2 flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-semibold ${comparison.color}`}>
          {comparison.icon}
          <span>{comparison.label}</span>
          {line.original_cost_price != null && line.original_cost_price > 0 && (
            <span className="ml-1 text-slate-400">Anterior: {formatCurrency(line.original_cost_price)} → Nuevo: {formatCurrency(result.unitCostAfter)}</span>
          )}
        </div>
      )}
      {line.product_id && (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-emerald-50 px-3 py-2">
          {line.image_url ? <img src={line.image_url} alt="" className="h-11 w-11 flex-shrink-0 rounded-lg object-cover ring-1 ring-emerald-200" /> : <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-emerald-100"><Receipt size={18} className="text-emerald-400" /></div>}
          <span className="text-sm font-medium text-emerald-800">{line.product_name}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 md:col-span-1 lg:col-span-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Unidad de compra</label>
          <Select value={line.purchase_unit} onChange={(event) => onChange(index, 'purchase_unit', event.target.value as PurchaseUnit)} className="w-full">
            <option value="pieza">Por pieza</option>
            <option value="caja">Por caja</option>
            <option value="granel">A granel ({line.unit_label || 'kg'})</option>
          </Select>
        </div>

        <div className={line.purchase_unit === 'caja' ? 'col-span-1 md:col-span-2 lg:col-span-2 grid grid-cols-3 gap-2' : 'col-span-1 md:col-span-1 lg:col-span-1'}>
          {line.purchase_unit === 'caja' ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Cajas</label>
                <Input type="number" min="0" step="0.001" value={line.box_count} onChange={(event) => onChange(index, 'box_count', event.target.value)} placeholder="Cajas" className="w-full" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Pzas/caja</label>
                <Input type="number" min="1" step="0.001" value={line.pieces_per_box} onChange={(event) => onChange(index, 'pieces_per_box', event.target.value)} placeholder="Pzas/caja" className="w-full" />
              </div>
              <div className="col-span-1">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Precio por caja</label>
                <Input type="number" min="0" step="0.01" value={line.box_price} onChange={(event) => onChange(index, 'box_price', event.target.value)} placeholder="Precio caja" className="w-full" />
              </div>
            </>
          ) : (
            <div className="col-span-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Cantidad ({line.purchase_unit === 'granel' ? (line.unit_label || 'kg') : 'piezas'})</label>
              <Input type="number" min="0" step={line.purchase_unit === 'granel' ? '0.001' : '1'} value={line.piece_quantity} onChange={(event) => onChange(index, 'piece_quantity', event.target.value)} placeholder={line.purchase_unit === 'granel' ? `Cantidad (${line.unit_label || 'kg'})` : 'Piezas'} className="w-full" />
            </div>
          )}
        </div>

        <div className="col-span-1 md:col-span-1 lg:col-span-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo de impuesto</label>
          <Select value={line.tax_type} onChange={(event) => onChange(index, 'tax_type', event.target.value as TaxType)} className="w-full">
            <option value="sin_impuesto">Sin impuesto</option>
            <option value="iva_16">IVA 16%</option>
            <option value="ieps_8">IEPS 8%</option>
            <option value="iva_16_ieps_8">IVA 16% + IEPS 8%</option>
          </Select>
        </div>

        <div className="col-span-1 md:col-span-1 lg:col-span-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Modo de precio</label>
          <Select value={line.includes_tax ? 'si' : 'no'} onChange={(event) => onChange(index, 'includes_tax', event.target.value === 'si')} className="w-full">
            <option value="si">Precio incluye impuesto</option>
            <option value="no">Precio sin impuesto</option>
          </Select>
        </div>

        {line.purchase_unit === 'caja' ? (
          <div className="col-span-2 md:col-span-1 lg:col-span-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Costo por pieza</label>
            <div className="flex h-10 items-center justify-end rounded-lg bg-blue-50 px-3 text-sm font-bold text-blue-700 w-full">
              {formatCurrency(boxPieceCost)}/pz
            </div>
          </div>
        ) : (
          <div className="col-span-2 md:col-span-1 lg:col-span-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{line.includes_tax ? 'Precio / Costo (con imp.)' : 'Precio / Costo (sin imp.)'}</label>
            <Input type="number" min="0" step="0.01" value={line.price_input} onChange={(event) => onChange(index, 'price_input', event.target.value)} placeholder={line.includes_tax ? 'Precio final' : 'Precio sin impuesto'} className="w-full" />
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
        <span>{result.pieces} {unitLabel} totales</span>
        <span>Precio pieza sin impuesto: <strong className="text-slate-700">{formatCurrency(result.before)}</strong></span>
        <span>Precio pieza con impuesto: <strong className="text-slate-700">{formatCurrency(result.after)}</strong></span>
        <span>Subtotal sin impuesto: <strong className="text-slate-700">{formatCurrency(result.beforeTotal)}</strong></span>
        <span>Subtotal con impuesto: <strong className="text-emerald-700">{formatCurrency(result.afterTotal)}</strong></span>
      </div>
      {onAddNext && <div className="mt-3 flex justify-end"><Button size="sm" onClick={onAddNext}><Plus size={14} /> Agregar y siguiente</Button></div>}
    </div>
  );
}

function PriceReviewModal({ changes, branchId, onClose, onSaved }: {
  changes: PriceChangeEntry[];
  branchId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [edits, setEdits] = useState<Record<string, { sale_price: string; price_2: string; price_3: string; margin: string }>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const getField = (entry: PriceChangeEntry, field: 'sale_price' | 'price_2' | 'price_3' | 'margin'): string => {
    const edit = edits[entry.product.id];
    if (edit && edit[field] != null && edit[field] !== '') return edit[field];
    if (field === 'margin') {
      const cost = entry.newCost;
      const sale = parseFloat(String(entry.product.sale_price ?? 0)) || 0;
      const totalTax = (Number(entry.product.tax_rate ?? 0) + Number(entry.product.ieps_rate ?? 0));
      const priceNoTax = totalTax > 0 ? sale / (1 + totalTax / 100) : sale;
      return cost > 0 ? (((priceNoTax - cost) / cost) * 100).toFixed(1) : '0';
    }
    return String(entry.product[field] ?? 0);
  };

  const setField = (entry: PriceChangeEntry, field: 'sale_price' | 'price_2' | 'price_3' | 'margin', value: string) => {
    setEdits((prev) => {
      const existing = prev[entry.product.id] ?? { sale_price: '', price_2: '', price_3: '', margin: '' };
      const next = { ...existing, [field]: value };
      if (field === 'margin') {
        const marginPct = parseFloat(value) || 0;
        const totalTax = (Number(entry.product.tax_rate ?? 0) + Number(entry.product.ieps_rate ?? 0));
        const priceNoTax = entry.newCost * (1 + marginPct / 100);
        const newSale = totalTax > 0 ? priceNoTax * (1 + totalTax / 100) : priceNoTax;
        next.sale_price = newSale.toFixed(2);
      }
      if (field === 'sale_price') {
        const sale = parseFloat(value) || 0;
        const totalTax = (Number(entry.product.tax_rate ?? 0) + Number(entry.product.ieps_rate ?? 0));
        const priceNoTax = totalTax > 0 ? sale / (1 + totalTax / 100) : sale;
        next.margin = entry.newCost > 0 ? (((priceNoTax - entry.newCost) / entry.newCost) * 100).toFixed(1) : '0';
      }
      return { ...prev, [entry.product.id]: next };
    });
  };

  const applyGlobalMargin = (percentage: number) => {
    if (isNaN(percentage)) return;
    const newEdits: typeof edits = {};
    changes.forEach((entry) => {
      const totalTax = (Number(entry.product.tax_rate ?? 0) + Number(entry.product.ieps_rate ?? 0));
      const priceNoTax = entry.newCost * (1 + percentage / 100);
      const newSale = totalTax > 0 ? priceNoTax * (1 + totalTax / 100) : priceNoTax;
      newEdits[entry.product.id] = {
        ...(edits[entry.product.id] ?? { sale_price: '', price_2: '', price_3: '', margin: '' }),
        sale_price: newSale.toFixed(2),
        margin: String(percentage.toFixed(1)),
      };
    });
    setEdits((prev) => ({ ...prev, ...newEdits }));
  };

  const [globalMargin, setGlobalMargin] = useState('');

  const dirtyCount = changes.filter((entry) => {
    const e = edits[entry.product.id];
    if (!e) return false;
    return (e.sale_price !== '' && e.sale_price !== String(entry.product.sale_price ?? 0)) ||
      (e.price_2 !== '' && e.price_2 !== String(entry.product.price_2 ?? 0)) ||
      (e.price_3 !== '' && e.price_3 !== String(entry.product.price_3 ?? 0));
  }).length;

  const savePrices = async () => {
    setSaving(true); setSavedMsg(null);
    let errors = 0;
    let saved = 0;
    for (const entry of changes) {
      const e = edits[entry.product.id];
      if (!e) continue;
      const hasChange = (e.sale_price !== '' && e.sale_price !== String(entry.product.sale_price ?? 0)) ||
        (e.price_2 !== '' && e.price_2 !== String(entry.product.price_2 ?? 0)) ||
        (e.price_3 !== '' && e.price_3 !== String(entry.product.price_3 ?? 0));
      if (!hasChange) continue;
      const ok = await saveProductPrices(entry.product, branchId, {
        cost_price: entry.newCost,
        sale_price: e.sale_price !== '' ? parseFloat(e.sale_price) || 0 : entry.product.sale_price,
        price_2: e.price_2 !== '' ? parseFloat(e.price_2) || 0 : entry.product.price_2,
        price_3: e.price_3 !== '' ? parseFloat(e.price_3) || 0 : entry.product.price_3,
      });
      if (ok) saved++; else errors++;
    }
    setSaving(false);
    setEdits({});
    if (errors === 0) {
      setSavedMsg(`${saved} precio(s) de venta actualizado(s) correctamente.`);
      window.setTimeout(onSaved, 900);
    } else {
      setSavedMsg(`${saved} guardado(s), ${errors} con error. Revisa los campos e inténtalo nuevamente.`);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="Productos con cambio de precio de compra" size="xl">
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex items-center gap-2 font-semibold">
            <TrendingUp size={18} />
            <span>Se actualizaron {changes.length} producto(s) con nuevo costo de compra.</span>
          </div>
          <p className="mt-1">Es obligatorio revisar y actualizar los precios de venta. Ajusta el margen o precio directamente y guarda los cambios.</p>
        </div>

        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-emerald-600" />
          <Input
            type="number"
            step="1"
            className="w-28"
            value={globalMargin}
            onChange={(e) => setGlobalMargin(e.target.value)}
            placeholder="% margen global"
          />
          <Button size="sm" variant="secondary" onClick={() => applyGlobalMargin(parseFloat(globalMargin) || 0)}>Aplicar margen a todos</Button>
          {dirtyCount > 0 && <Badge variant="warning">{dirtyCount} cambio(s)</Badge>}
          <div className="flex-1" />
          <Button size="sm" onClick={() => void savePrices()} disabled={saving || dirtyCount === 0}>
            <Tags size={14} /> {saving ? 'Guardando...' : 'Guardar precios'}
          </Button>
        </div>

        {savedMsg && (
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{savedMsg}</div>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2 text-right">Costo anterior</th>
                <th className="px-3 py-2 text-right">Costo nuevo</th>
                <th className="px-3 py-2 text-right">Cambio</th>
                <th className="px-3 py-2 text-right">Margen %</th>
                <th className="px-3 py-2 text-right">Precio venta 1</th>
                <th className="px-3 py-2 text-right">Precio 2</th>
                <th className="px-3 py-2 text-right">Precio 3</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {changes.map((entry) => {
                const diff = entry.diff;
                return (
                  <tr key={entry.product.id} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{entry.product.name}</div>
                      <div className="text-xs text-slate-400">{entry.product.sku ?? '—'} · {entry.product.barcode ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(entry.oldCost)}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800">{formatCurrency(entry.newCost)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-flex items-center gap-1 font-semibold ${diff > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {diff > 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                        {formatCurrency(Math.abs(diff))}
                      </span>
                    </td>
                    <td className="px-3 py-1">
                      <Input type="number" step="0.1" className="w-20 text-right" value={getField(entry, 'margin')} onChange={(e) => setField(entry, 'margin', e.target.value)} />
                    </td>
                    <td className="px-3 py-1">
                      <Input type="number" step="0.01" className="w-24 text-right" value={getField(entry, 'sale_price')} onChange={(e) => setField(entry, 'sale_price', e.target.value)} />
                    </td>
                    <td className="px-3 py-1">
                      <Input type="number" step="0.01" className="w-20 text-right" value={getField(entry, 'price_2')} onChange={(e) => setField(entry, 'price_2', e.target.value)} />
                    </td>
                    <td className="px-3 py-1">
                      <Input type="number" step="0.01" className="w-20 text-right" value={getField(entry, 'price_3')} onChange={(e) => setField(entry, 'price_3', e.target.value)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button onClick={() => void savePrices()} disabled={saving || dirtyCount === 0}>
            <ArrowRight size={16} /> {saving ? 'Guardando...' : 'Guardar precios y terminar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BarcodeScannerModal({ open, onClose, onDetect }: { open: boolean; onClose: () => void; onDetect: (code: string) => void }) {
  const [manualCode, setManualCode] = useState('');
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Escanear o capturar código" size="sm">
      <div className="space-y-4">
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          Si tienes un lector de código de barras USB, enfoca el campo y pasa el producto por el escáner.
        </div>
        <Field label="Código del producto">
          <Input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && manualCode.trim()) { onDetect(manualCode.trim()); setManualCode(''); } }}
            placeholder="Código de barras o SKU"
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => { if (manualCode.trim()) { onDetect(manualCode.trim()); setManualCode(''); } }}>Agregar</Button>
        </div>
      </div>
    </Modal>
  );
}

function Summary({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div><span className="text-slate-500">{label}</span><p className={strong ? 'text-lg font-bold text-emerald-700' : 'font-bold text-slate-800'}>{formatCurrency(value)}</p></div>;
}

function PurchaseTable({ items, onView }: { items: Purchase[]; onView: (item: Purchase) => void }) {
  return (
    <Card className="overflow-hidden">
      {items.length === 0 ? <EmptyState title="Sin compras" description="Registra tu primera compra a proveedor." icon={<ClipboardList size={48} />} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Folio</th><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3 text-right">Sin impuesto</th><th className="px-4 py-3 text-right">Impuestos</th><th className="px-4 py-3 text-right">Total</th><th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium">{item.folio || '—'}</td>
                  <td className="px-4 py-3">{item.supplier?.commercial_name || item.supplier?.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(item.created_at)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(item.subtotal_before_tax)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(item.tax_total)}</td>
                  <td className="px-4 py-3 text-right font-bold">{formatCurrency(item.total)}</td>
                  <td className="px-4 py-3 text-right"><button onClick={() => onView(item)} className="rounded p-1.5 text-slate-400 hover:text-emerald-600"><Eye size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function OrderTable({ items, onView, onStatus }: { items: SupplierOrder[]; onView: (item: SupplierOrder) => void; onStatus: (item: SupplierOrder, status: string) => void }) {
  return (
    <Card className="overflow-hidden">
      {items.length === 0 ? <EmptyState title="Sin pedidos" description="Crea tu primer pedido a proveedor." icon={<ClipboardCheck size={48} />} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Folio</th><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Estado</th><th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium">{item.folio || '—'}</td>
                  <td className="px-4 py-3">{item.supplier?.commercial_name || item.supplier?.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(item.created_at)}</td>
                  <td className="px-4 py-3 text-right font-bold">{formatCurrency(item.total)}</td>
                  <td className="px-4 py-3">
                    <Select value={item.status} onChange={(event) => onStatus(item, event.target.value)} className="w-32 py-1 text-xs">
                      <option value="pendiente">Pendiente</option>
                      <option value="enviado">Enviado</option>
                      <option value="recibido">Recibido</option>
                      <option value="cancelado">Cancelado</option>
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-right"><button onClick={() => onView(item)} className="rounded p-1.5 text-slate-400 hover:text-emerald-600"><Eye size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
