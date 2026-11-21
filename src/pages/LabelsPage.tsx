import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency } from '@/lib/format';
import { matchesQuery, sanitizeFilterValue } from '@/lib/search';
import type { Product, Department } from '@/lib/types';
import { PageHeader, Card, EmptyState } from '@/components/ui';
import Button from '@/components/Button';
import BarcodeScanner from '@/components/BarcodeScanner';
import LabelDesignerModal from '@/components/LabelDesignerModal';
import { printLabels, printTicketStrip, getProductCode, type LabelData } from '@/lib/labelPrint';
import { LABEL_PRINTER_STORAGE_KEY, defaultLabelTemplates, loadLabelTemplates, saveLabelTemplates, type LabelTemplate } from '@/lib/labelTemplates';
import { Camera, FileSpreadsheet, Image as ImageIcon, PackageSearch, Plus, Printer, Receipt, RefreshCw, Save, ScanLine, Trash2, X } from 'lucide-react';

const TICKET_LABEL_PRINTER_STORAGE_KEY = 'pos_ticket_label_printer_name';

interface QueueItem {
  product: Product;
  quantity: number;
}

interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

interface SavedBatch {
  id: string;
  name: string;
  status: 'pending' | 'printed';
  total_labels: number;
  branch_id: string | null;
  created_at: string;
  printed_at: string | null;
}

interface SavedBatchItem {
  id: string;
  batch_id: string;
  product_id: string | null;
  product_name: string;
  product_image_url: string | null;
  product_code: string;
  department: string | null;
  sale_price: number;
  quantity: number;
  sort_order: number;
}

const fieldClass = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10';

async function loadAllActiveProducts(): Promise<Product[]> {
  const allProducts: Product[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .order('name')
      .range(from, from + 999);
    if (error) throw error;
    allProducts.push(...((data as Product[]) ?? []));
    if (!data || data.length < 1000) return allProducts;
  }
}

function buildLabelData(product: Product, price: number, department: string, qrDataUrl: string, logoDataUrl: string): LabelData {
  return { product, price, code: getProductCode(product), department, qrDataUrl, logoDataUrl };
}

function productFromBatchItem(item: SavedBatchItem): Product {
  return {
    id: item.product_id ?? item.id,
    sku: null,
    barcode: item.product_code,
    barcode_2: null,
    name: item.product_name,
    description: null,
    department: item.department,
    category_id: null,
    location_id: null,
    supplier_id: null,
    cost_price: 0,
    sale_price: Number(item.sale_price),
    price_2: 0,
    price_3: 0,
    tax_rate: 0,
    ieps_rate: 0,
    unit: 'pieza',
    bulk: false,
    track_inventory: false,
    prices_shared: true,
    is_package: false,
    image_url: item.product_image_url,
    active: true,
    favorite: false,
    acumula_puntos: false,
    deleted_at: null,
    deleted_by: null,
    created_at: new Date().toISOString(),
  };
}

function formatBatchDate(value: string): string {
  return new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

function formatElaborationDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

export default function LabelsPage() {
  const { hasPermission } = useAuth();
  if (!hasPermission('products')) {
    return <EmptyState title="Sin acceso" description="No tienes permiso para usar el módulo de etiquetas." />;
  }
  return <LabelsPageContent />;
}

function LabelsPageContent() {
  const auth = useAuth() as {
    currentBranch?: { id?: string | null; name?: string | null } | null;
    user?: { name?: string | null; full_name?: string | null; email?: string | null } | null;
    profile?: { name?: string | null; full_name?: string | null } | null;
  };
  const { currentBranch } = auth;

  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [productInput, setProductInput] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [templates, setTemplates] = useState<LabelTemplate[]>(() => [...defaultLabelTemplates(), ...loadLabelTemplates()]);
  const [activeTemplateId, setActiveTemplateId] = useState('builtin-standard-37x30');
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [ticketPrinterName, setTicketPrinterName] = useState('');
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [batches, setBatches] = useState<SavedBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchName, setBatchName] = useState(() => `Lote ${new Date().toLocaleDateString('es-MX')}`);
  const [loading, setLoading] = useState(true);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printingStrip, setPrintingStrip] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(false);

  const activeTemplate = useMemo(
    () => templates.find((template) => template.id === activeTemplateId) ?? templates[0],
    [templates, activeTemplateId],
  );
  const departmentNames = useMemo(
    () => Object.fromEntries(departments.map((department) => [department.code, department.name])),
    [departments],
  );
  const isElectron = Boolean(window.electronAPI?.printLabels);
  const isBusy = printing || printingStrip || exporting;
  const totalLabels = queue.reduce((sum, item) => sum + item.quantity, 0);
  const suggestions = useMemo(() => {
    const query = productInput.trim();
    if (!query) return [];
    return products
      .filter((product) => product.active && matchesQuery(query, product.name, product.sku ?? '', product.barcode ?? '', product.barcode_2 ?? ''))
      .slice(0, 8);
  }, [products, productInput]);

  const loadBatches = useCallback(async () => {
    const { data, error: batchError } = await supabase
      .from('label_print_batches')
      .select('id, name, status, total_labels, branch_id, created_at, printed_at')
      .order('created_at', { ascending: false })
      .limit(30);
    if (batchError) {
      setError('No se pudieron cargar los lotes guardados.');
      return;
    }
    setBatches((data as SavedBatch[]) ?? []);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('label-batches-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'label_print_batches' }, () => { void loadBatches(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadBatches]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      try {
        const [loadedProducts, departmentResult] = await Promise.all([
          loadAllActiveProducts(),
          supabase.from('departments').select('*').order('name'),
        ]);
        if (departmentResult.error) throw departmentResult.error;
        setProducts(loadedProducts);
        setDepartments((departmentResult.data as Department[]) ?? []);
      } catch (cause) {
        console.error('label catalog load failed', cause);
        setError('No se pudo cargar el catálogo completo de productos.');
      } finally {
        setLoading(false);
        await loadBatches();
      }
    })();
  }, [loadBatches]);

  useEffect(() => {
    setPrinterName((current) => {
      try { return window.localStorage.getItem(LABEL_PRINTER_STORAGE_KEY) ?? current; } catch { return current; }
    });
    setTicketPrinterName((current) => {
      try { return window.localStorage.getItem(TICKET_LABEL_PRINTER_STORAGE_KEY) ?? current; } catch { return current; }
    });
  }, []);

  const refreshPrinters = useCallback(async () => {
    setPrinterError(null);
    if (!window.electronAPI?.getPrinters) {
      setPrinters([]);
      return;
    }
    try {
      const list = await window.electronAPI.getPrinters();
      setPrinters(list);
      let saved = '';
      let savedTicket = '';
      try {
        saved = window.localStorage.getItem(LABEL_PRINTER_STORAGE_KEY) ?? '';
        savedTicket = window.localStorage.getItem(TICKET_LABEL_PRINTER_STORAGE_KEY) ?? '';
      } catch { /* best effort */ }
      if (saved && !list.some((printer) => printer.name === saved)) {
        setPrinterError(`La impresora de etiquetas guardada no está conectada: ${saved}. Elige otra impresora.`);
      }
      setPrinterName((current) => current || saved || list.find((printer) => printer.isDefault)?.name || list[0]?.name || '');
      setTicketPrinterName((current) => current || savedTicket || '');
    } catch {
      setPrinterError('No se pudieron detectar las impresoras instaladas.');
    }
  }, []);

  useEffect(() => { void refreshPrinters(); }, [refreshPrinters]);

  const handlePrinterChange = (value: string) => {
    setPrinterName(value);
    setPrinterError(null);
    try { window.localStorage.setItem(LABEL_PRINTER_STORAGE_KEY, value); } catch { /* best effort */ }
  };

  const handleTicketPrinterChange = (value: string) => {
    setTicketPrinterName(value);
    setPrinterError(null);
    try { window.localStorage.setItem(TICKET_LABEL_PRINTER_STORAGE_KEY, value); } catch { /* best effort */ }
  };

  const addProduct = useCallback((product: Product) => {
    setQueue((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) {
        return [
          { product, quantity: existing.quantity + 1 },
          ...current.filter((item) => item.product.id !== product.id),
        ];
      }
      return [{ product, quantity: 1 }, ...current];
    });
    setProductInput('');
    setMessage(null);
    setError(null);
    window.setTimeout(() => productInputRef.current?.focus(), 0);
  }, []);

  const findProductByCode = useCallback(async (raw: string): Promise<Product | null> => {
    const value = raw.trim();
    if (!value) return null;
    const normalized = value.toLowerCase();
    const localMatch = products.find((product) => [product.barcode, product.barcode_2, product.sku, product.name].some((candidate) => candidate?.trim().toLowerCase() === normalized));
    if (localMatch) return localMatch;
    const filter = sanitizeFilterValue(value);
    if (!filter) return null;
    const { data, error: lookupError } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .or(`barcode.eq.${filter},barcode_2.eq.${filter},sku.eq.${filter}`)
      .limit(1);
    if (lookupError) {
      console.error('label product lookup failed', lookupError);
      return null;
    }
    const match = ((data as Product[]) ?? [])[0] ?? null;
    if (match) setProducts((current) => current.some((product) => product.id === match.id) ? current : [...current, match]);
    return match;
  }, [products]);

  const handleProductInput = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const product = await findProductByCode(value);
    if (product) {
      addProduct(product);
      return;
    }
    if (suggestions.length === 1) {
      addProduct(suggestions[0]);
      return;
    }
    setError(`No se encontró un producto con "${value}". Selecciona una coincidencia o revisa el código.`);
  };

  const setQuantity = (productId: string, quantity: number) => {
    const value = Math.max(1, Math.min(999, Math.round(quantity) || 1));
    setQueue((current) => current.map((item) => item.product.id === productId ? { ...item, quantity: value } : item));
  };

  const removeItem = (productId: string) => setQueue((current) => current.filter((item) => item.product.id !== productId));

  const saveBatch = async () => {
    setError(null);
    setMessage(null);
    if (queue.length === 0) { setError('Agrega productos antes de guardar un lote.'); return; }
    const name = batchName.trim() || `Lote ${new Date().toLocaleDateString('es-MX')}`;
    const { data: batch, error: batchError } = await supabase
      .from('label_print_batches')
      .insert({ name, branch_id: currentBranch?.id ?? null, total_labels: totalLabels })
      .select('id, name, status, total_labels, branch_id, created_at, printed_at')
      .maybeSingle();
    if (batchError || !batch) { setError('No se pudo guardar el lote.'); return; }
    const items = queue.map((item, index) => ({
      batch_id: batch.id,
      product_id: item.product.id,
      product_name: item.product.name,
      product_image_url: item.product.image_url,
      product_code: getProductCode(item.product),
      department: departmentNames[item.product.department ?? ''] ?? item.product.department ?? item.product.category?.name ?? null,
      sale_price: Number(item.product.sale_price),
      quantity: item.quantity,
      sort_order: index,
    }));
    const { error: itemsError } = await supabase.from('label_print_batch_items').insert(items);
    if (itemsError) {
      await supabase.from('label_print_batches').delete().eq('id', batch.id);
      setError('No se pudo guardar el contenido del lote.');
      return;
    }
    setSelectedBatchId(null);
    setQueue([]);
    setBatchName(`Lote ${new Date().toLocaleDateString('es-MX')}`);
    await loadBatches();
    setMessage(`Lote "${name}" guardado. Ya puedes abrirlo desde cualquier usuario o equipo de la sucursal. La cola quedó lista para un lote nuevo.`);
  };

  const loadBatch = async (batch: SavedBatch) => {
    setLoadingBatch(true);
    setError(null);
    const { data, error: itemsError } = await supabase
      .from('label_print_batch_items')
      .select('*')
      .eq('batch_id', batch.id
