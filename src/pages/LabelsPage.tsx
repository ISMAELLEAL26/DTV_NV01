import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { printLabels, getProductCode, type LabelData } from '@/lib/labelPrint';
import { LABEL_PRINTER_STORAGE_KEY, defaultLabelTemplates, loadLabelTemplates, saveLabelTemplates, type LabelTemplate } from '@/lib/labelTemplates';
import { Camera, Image as ImageIcon, PackageSearch, Plus, RefreshCw, Save, ScanLine, Trash2, X } from 'lucide-react';

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

export default function LabelsPage() {
  const { hasPermission } = useAuth();
  if (!hasPermission('products')) {
    return <EmptyState title="Sin acceso" description="No tienes permiso para usar el módulo de etiquetas." />;
  }
  return <LabelsPageContent />;
}

function LabelsPageContent() {
  const { currentBranch } = useAuth();
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
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [batches, setBatches] = useState<SavedBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchName, setBatchName] = useState(() => `Lote ${new Date().toLocaleDateString('es-MX')}`);
  const [loading, setLoading] = useState(true);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [printing, setPrinting] = useState(false);
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
      try { saved = window.localStorage.getItem(LABEL_PRINTER_STORAGE_KEY) ?? ''; } catch { /* best effort */ }
      if (saved && !list.some((printer) => printer.name === saved)) {
        setPrinterError(`La impresora de etiquetas guardada no está conectada: ${saved}. Elige otra impresora.`);
      }
      setPrinterName((current) => current || saved || list.find((printer) => printer.isDefault)?.name || list[0].name || '');
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

  const addProduct = useCallback((product: Product) => {
    setQueue((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) return current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { product, quantity: 1 }];
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
    setSelectedBatchId(batch.id);
    setBatches((current) => [batch as SavedBatch, ...current]);
    setMessage(`Lote "${name}" guardado. Ya puedes abrirlo desde otra computadora.`);
  };

  const loadBatch = async (batch: SavedBatch) => {
    setLoadingBatch(true);
    setError(null);
    const { data, error: itemsError } = await supabase
      .from('label_print_batch_items')
      .select('*')
      .eq('batch_id', batch.id)
      .order('sort_order');
    if (itemsError) {
      setError('No se pudo cargar ese lote.');
      setLoadingBatch(false);
      return;
    }
    const nextQueue = ((data as SavedBatchItem[]) ?? []).map((item) => {
      const current = item.product_id ? products.find((product) => product.id === item.product_id) : undefined;
      const product = current ? { ...current, name: item.product_name, image_url: item.product_image_url, sale_price: Number(item.sale_price), department: item.department } : productFromBatchItem(item);
      return { product, quantity: item.quantity };
    });
    setQueue(nextQueue);
    setSelectedBatchId(batch.id);
    setBatchName(batch.name);
    setMessage(`Lote "${batch.name}" cargado.`);
    setLoadingBatch(false);
    productInputRef.current?.focus();
  };

  const deleteBatch = async (batchId: string) => {
    const { error: deleteError } = await supabase.from('label_print_batches').delete().eq('id', batchId);
    if (deleteError) { setError('No se pudo eliminar el lote.'); return; }
    setBatches((current) => current.filter((batch) => batch.id !== batchId));
    if (selectedBatchId === batchId) setSelectedBatchId(null);
  };

  const handleSaveTemplate = (name: string, layout: LabelTemplate['layout']) => {
    const template: LabelTemplate = { id: `tpl-${Date.now()}`, name, layout };
    const next = [...templates, template];
    setTemplates(next);
    saveLabelTemplates(next.filter((item) => !item.builtin));
    setActiveTemplateId(template.id);
    setMessage(`Plantilla "${name}" guardada.`);
  };

  const handleDeleteTemplate = (templateId: string) => {
    const next = templates.filter((template) => template.id !== templateId);
    setTemplates(next);
    saveLabelTemplates(next.filter((item) => !item.builtin));
    if (activeTemplateId === templateId) setActiveTemplateId(next[0]?.id ?? '');
  };

  const handlePrint = async () => {
    setError(null);
    setMessage(null);
    if (queue.length === 0) { setError('La cola está vacía. Agrega productos o carga un lote guardado.'); return; }
    if (isElectron) {
      if (printers.length === 0) { setError('No hay una impresora disponible. Conecta la impresora de etiquetas y actualiza la lista.'); return; }
      if (!printerName || !printers.some((printer) => printer.name === printerName)) {
        setPrinterError(`Selecciona una impresora de etiquetas conectada antes de imprimir${printerName ? `: ${printerName}` : '.'}`);
        return;
      }
    }
    if (!activeTemplate) { setError('Selecciona una plantilla válida.'); return; }
    setPrinting(true);
    try {
      const logoDataUrl = (() => {
        try { return window.localStorage.getItem('pos_label_logo_data_url') ?? ''; } catch { return ''; }
      })();
      const labels: LabelData[] = [];
      for (const item of queue) {
        const qrDataUrl = await QRCode.toDataURL(getProductCode(item.product), { margin: 0, width: 220, color: { dark: '#000000', light: '#ffffff' } });
        const department = departmentNames[item.product.department ?? ''] ?? item.product.department ?? item.product.category?.name ?? '';
        for (let copy = 0; copy < item.quantity; copy++) labels.push(buildLabelData(item.product, Number(item.product.sale_price), department, qrDataUrl, logoDataUrl));
      }
      await printLabels(labels, activeTemplate.layout, printerName);
      if (selectedBatchId) {
        await supabase.from('label_print_batches').update({ status: 'printed', printed_at: new Date().toISOString() }).eq('id', selectedBatchId);
        setBatches((current) => current.map((batch) => batch.id === selectedBatchId ? { ...batch, status: 'printed', printed_at: new Date().toISOString() } : batch));
      }
      setMessage(`${totalLabels} etiqueta(s) enviadas a la impresora.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron imprimir las etiquetas.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Etiquetas" subtitle="Usa el mismo control para lector USB, búsqueda o cámara. Guarda lotes en el celular y recupéralos aquí para imprimir." />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <div className="space-y-5">
          <Card className="p-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Agregar producto</label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  ref={productInputRef}
                  className={`${fieldClass} w-full`}
                  value={productInput}
                  onChange={(event) => setProductInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void handleProductInput(productInput); } }}
                  placeholder="Escanea, escribe nombre/código y presiona Enter"
                  autoFocus
                  autoComplete="off"
                />
                {productInput.trim() && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                    {suggestions.map((product) => (
                      <button key={product.id} type="button" onClick={() => addProduct(product)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-emerald-50">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">{product.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={15} className="text-slate-400" />}</div>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-700">{product.name}</span><span className="block text-xs text-slate-400">{getProductCode(product)} · {formatCurrency(Number(product.sale_price))}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button className="w-full flex-shrink-0 sm:w-auto" variant="secondary" onClick={() => setScannerOpen(true)} title="Escanear con cámara"><Camera size={17} /><span className="hidden sm:inline">Cámara</span><span className="sm:hidden">Escanear con cámara</span></Button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] leading-4 text-slate-500"><ScanLine size={13} /> El lector USB funciona cuando este campo está enfocado; la cámara agrega el producto desde el celular.</p>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-bold text-slate-800">Cola de impresión · {queue.length} producto(s) · {totalLabels} etiqueta(s)</div>
              <div className="flex gap-2">{queue.length > 0 && <Button variant="secondary" size="sm" onClick={() => setQueue([])}>Vaciar cola</Button>}</div>
            </div>
            {loading ? <p className="px-4 py-8 text-center text-sm text-slate-500">Cargando catálogo...</p> : queue.length === 0 ? (
              <EmptyState title="Cola vacía" description="Escanea, busca o carga un lote guardado para comenzar." icon={<PackageSearch size={48} />} />
            ) : (
              <div className="divide-y divide-slate-100">
                {queue.map((item, index) => {
                  const department = departmentNames[item.product.department ?? ''] ?? item.product.department ?? item.product.category?.name ?? 'Sin departamento';
                  return <div key={item.product.id} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:flex sm:flex-wrap">
                    <span className="w-6 flex-shrink-0 text-xs font-semibold text-slate-400">{index + 1}</span>
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">{item.product.image_url ? <img src={item.product.image_url} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={18} className="text-slate-400" />}</div>
                    <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-800">{item.product.name}</div><div className="truncate text-xs text-slate-500">{getProductCode(item.product)} · {formatCurrency(Number(item.product.sale_price))} · Departamento: {department}</div></div>
                    <div className="col-span-3 flex items-center justify-end gap-1 sm:col-auto sm:ml-auto"><button type="button" onClick={() => setQuantity(item.product.id, item.quantity - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-bold text-slate-600 hover:bg-slate-50" title="Restar"><span aria-hidden="true">−</span></button><input className={`${fieldClass} w-16 text-center`} type="number" min="1" max="999" value={item.quantity} onChange={(event) => setQuantity(item.product.id, Number(event.target.value))} /><button type="button" onClick={() => setQuantity(item.product.id, item.quantity + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-bold text-slate-600 hover:bg-slate-50" title="Sumar"><Plus size={15} /></button><button type="button" onClick={() => removeItem(item.product.id)} className="ml-2 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Quitar"><X size={17} /></button></div>
                  </div>;
                })}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-bold text-slate-800">Guardar lote para imprimir después</div><p className="mt-1 text-xs text-slate-500">Guárdalo desde el celular y cárgalo aquí desde la computadora con la misma cuenta.</p></div><Save size={20} className="text-emerald-600" /></div>
            <div className="flex flex-col gap-2 sm:flex-row"><input className={`${fieldClass} min-w-0 flex-1`} value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="Nombre del lote" /><Button className="w-full sm:w-auto" onClick={() => void saveBatch()} disabled={queue.length === 0}><Save size={15} /> Guardar lote</Button></div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><div><div className="text-sm font-bold text-slate-800">Lotes guardados</div><p className="mt-1 text-xs text-slate-500">Pendientes y ya impresos de tu cuenta.</p></div><button type="button" onClick={() => void loadBatches()} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Actualizar lotes"><RefreshCw size={16} /></button></div>
            {batches.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">Todavía no hay lotes guardados.</p> : <div className="max-h-64 space-y-2 overflow-y-auto">{batches.map((batch) => <div key={batch.id} className={`rounded-lg border p-3 ${selectedBatchId === batch.id ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200'}`}><div className="flex items-start gap-2"><button type="button" onClick={() => void loadBatch(batch)} disabled={loadingBatch} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold text-slate-700">{batch.name}</span><span className="mt-1 block text-xs text-slate-500">{batch.total_labels} etiqueta(s) · {formatBatchDate(batch.created_at)} · {batch.status === 'printed' ? 'Impreso' : 'Pendiente'}</span></button><button type="button" onClick={() => void deleteBatch(batch.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Eliminar lote"><Trash2 size={15} /></button></div></div>)}</div>}
          </Card>

          <Card className="p-4">
            <div className="mb-3 text-sm font-bold text-slate-800">Plantilla</div>
            <select className={`${fieldClass} w-full`} value={activeTemplate?.id ?? ''} onChange={(event) => setActiveTemplateId(event.target.value)}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
            <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => setDesignerOpen(true)}>Abrir diseñador de plantillas</Button>{activeTemplate && !activeTemplate.builtin && <Button variant="danger" size="sm" onClick={() => handleDeleteTemplate(activeTemplate.id)}>Eliminar plantilla</Button>}</div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><div className="text-sm font-bold text-slate-800">Impresora de etiquetas</div><button type="button" onClick={() => void refreshPrinters()} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Actualizar impresoras"><RefreshCw size={16} /></button></div>
            {printers.length > 0 ? <select className={`${fieldClass} w-full`} value={printerName} onChange={(event) => handlePrinterChange(event.target.value)}><option value="">Selecciona una impresora</option>{printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName}{printer.isDefault ? ' · predeterminada del sistema' : ''}</option>)}</select> : <p className="text-xs text-slate-500">{isElectron ? 'No se detectaron impresoras instaladas.' : 'En el navegador se abrirá la vista previa; el programa de escritorio mostrará la impresora de etiquetas.'}</p>}
            <p className="mt-2 text-[11px] leading-4 text-slate-500">Esta selección solo se usa para etiquetas. No cambia la impresora de tickets ni la predeterminada de Windows.</p>{printerError && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{printerError}</div>}
          </Card>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}{message && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}
          <Button className="w-full" onClick={() => void handlePrint()} disabled={printing || queue.length === 0}>{printing ? 'Imprimiendo...' : `Imprimir ${totalLabels} etiqueta(s)`}</Button>
        </div>
      </div>

      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetect={(code) => { void handleProductInput(code); }} title="Escanear producto para etiquetas" />
      <LabelDesignerModal open={designerOpen} onClose={() => setDesignerOpen(false)} product={queue[0]?.product ?? null} template={activeTemplate ?? { id: 'fallback', name: 'Estándar 37.5 × 30 mm', layout: defaultLabelTemplates()[0].layout, builtin: true }} onSaveTemplate={handleSaveTemplate} departmentNames={departmentNames} />
    </div>
  );
}
