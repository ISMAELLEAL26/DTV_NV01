import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency } from '@/lib/format';
import { matchesQuery } from '@/lib/search';
import type { Product, Department } from '@/lib/types';
import { PageHeader, Card, EmptyState } from '@/components/ui';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import BarcodeScanner from '@/components/BarcodeScanner';
import LabelDesignerModal from '@/components/LabelDesignerModal';
import { printLabels, getProductCode, type LabelData } from '@/lib/labelPrint';
import { LABEL_PRINTER_STORAGE_KEY, defaultLabelTemplates, loadLabelTemplates, saveLabelTemplates, type LabelTemplate } from '@/lib/labelTemplates';

interface QueueItem {
  product: Product;
  quantity: number;
}

interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

const fieldClass = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10';

function buildLabelData(product: Product, price: number, department: string, qrDataUrl: string, logoDataUrl: string): LabelData {
  return { product, price, code: getProductCode(product), department, qrDataUrl, logoDataUrl };
}

export default function LabelsPage() {
  const { hasPermission } = useAuth();
  if (!hasPermission('products')) {
    return <EmptyState title="Sin acceso" description="No tienes permiso para usar el módulo de etiquetas." />;
  }
  return <LabelsPageContent />;
}

function LabelsPageContent() {
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [scanValue, setScanValue] = useState('');
  const [search, setSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [templates, setTemplates] = useState<LabelTemplate[]>(() => [...defaultLabelTemplates(), ...loadLabelTemplates()]);
  const [activeTemplateId, setActiveTemplateId] = useState('builtin-standard-37x30');
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
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

  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    return products
      .filter((product) => product.active && matchesQuery(search, product.name, product.sku ?? '', product.barcode ?? '', product.barcode_2 ?? ''))
      .slice(0, 8);
  }, [products, search]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      const [productResult, departmentResult] = await Promise.all([
        supabase.from('products').select('*').eq('active', true).order('name').limit(5000),
        supabase.from('departments').select('*').order('name'),
      ]);
      setProducts((productResult.data as Product[]) ?? []);
      setDepartments((departmentResult.data as Department[]) ?? []);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    try { window.localStorage.getItem(LABEL_PRINTER_STORAGE_KEY); } catch { /* ignore */ }
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
      try { saved = window.localStorage.getItem(LABEL_PRINTER_STORAGE_KEY) ?? ''; } catch { /* ignore */ }
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
    setMessage(null);
    setError(null);
  }, []);

  const handleScan = (raw: string) => {
    const code = raw.trim();
    setScanValue('');
    if (!code) return;
    const normalized = code.toLowerCase();
    const match = products.find((product) => [product.barcode, product.barcode_2, product.sku].some((value) => value?.trim().toLowerCase() === normalized));
    if (match) {
      addProduct(match);
    } else {
      setError(`No se encontró un producto con el código "${code}".`);
    }
    scanInputRef.current?.focus();
  };

  const setQuantity = (productId: string, quantity: number) => {
    const value = Math.max(1, Math.min(999, Math.round(quantity) || 1));
    setQueue((current) => current.map((item) => item.product.id === productId ? { ...item, quantity: value } : item));
  };

  const removeItem = (productId: string) => setQueue((current) => current.filter((item) => item.product.id !== productId));

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
    if (queue.length === 0) { setError('La cola está vacía. Escanea o busca productos para agregar etiquetas.'); return; }
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
        const product = item.product;
        const qrDataUrl = await QRCode.toDataURL(getProductCode(product), { margin: 0, width: 220, color: { dark: '#000000', light: '#ffffff' } });
        const department = departmentNames[product.department ?? ''] ?? product.department ?? product.category?.name ?? '';
        for (let copy = 0; copy < item.quantity; copy++) {
          labels.push(buildLabelData(product, Number(product.sale_price), department, qrDataUrl, logoDataUrl));
        }
      }
      await printLabels(labels, activeTemplate.layout, printerName);
      setMessage(`${totalLabels} etiqueta(s) enviadas a la impresora.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron imprimir las etiquetas.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Etiquetas"
        subtitle="Escanea o busca productos, define cuántas etiquetas imprime cada uno y mándalas a la impresora térmica."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
        <div className="space-y-5">
          <Card className="p-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Escaneo rápido (lector USB)</label>
            <div className="flex gap-2">
              <input
                ref={scanInputRef}
                className={`${fieldClass} w-full`}
                value={scanValue}
                onChange={(event) => setScanValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleScan(scanValue); } }}
                placeholder="Escanea un código y presiona Enter"
                autoFocus
                autoComplete="off"
              />
              <Button variant="secondary" onClick={() => setScannerOpen(true)} title="Escanear con cámara"><span className="text-sm">Cámara</span></Button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-slate-500">Si el producto ya está en la cola le suma 1 a su cantidad.</p>

            <label className="mt-4 mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Buscar producto por nombre o código</label>
            <input className={`${fieldClass} w-full`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, SKU o código de barras" autoComplete="off" />
            {search.trim() !== '' && (
              <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">Sin coincidencias.</p>}
                {filtered.map((product) => (
                  <button key={product.id} type="button" onClick={() => { addProduct(product); setSearch(''); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-emerald-50">
                    <span className="min-w-0 truncate text-slate-700">{product.name}</span>
                    <span className="flex-shrink-0 text-xs text-slate-400">{getProductCode(product)} · {formatCurrency(Number(product.sale_price))}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-bold text-slate-800">Cola de impresión · {queue.length} producto(s) · {totalLabels} etiqueta(s)</div>
              {queue.length > 0 && <Button variant="secondary" size="sm" onClick={() => setQueue([])}>Vaciar cola</Button>}
            </div>
            {queue.length === 0 ? (
              <EmptyState title="Cola vacía" description="Escanea un código o busca un producto para agregarlo." />
            ) : (
              <div className="divide-y divide-slate-100">
                {queue.map((item, index) => (
                  <div key={item.product.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="w-6 flex-shrink-0 text-xs font-semibold text-slate-400">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-800">{item.product.name}</div>
                      <div className="text-xs text-slate-500">{getProductCode(item.product)} · {formatCurrency(Number(item.product.sale_price))}</div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button type="button" onClick={() => setQuantity(item.product.id, item.quantity - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-bold text-slate-600 hover:bg-slate-50">−</button>
                      <input
                        className={`${fieldClass} w-16 text-center`}
                        type="number"
                        min="1"
                        max="999"
                        value={item.quantity}
                        onChange={(event) => setQuantity(item.product.id, Number(event.target.value))}
                      />
                      <button type="button" onClick={() => setQuantity(item.product.id, item.quantity + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-bold text-slate-600 hover:bg-slate-50">+</button>
                    </div>
                    <button type="button" onClick={() => removeItem(item.product.id)} className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Quitar">✕</button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-4">
            <div className="mb-3 text-sm font-bold text-slate-800">Plantilla</div>
            <select className={`${fieldClass} w-full`} value={activeTemplate?.id ?? ''} onChange={(event) => setActiveTemplateId(event.target.value)}>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDesignerOpen(true)}>Abrir diseñador de plantillas</Button>
              {activeTemplate && !activeTemplate.builtin && (
                <Button variant="danger" size="sm" onClick={() => handleDeleteTemplate(activeTemplate.id)}>Eliminar plantilla</Button>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-bold text-slate-800">Impresora de etiquetas</div>
              <button type="button" onClick={() => void refreshPrinters()} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Actualizar impresoras">⟳</button>
            </div>
            {printers.length > 0 ? (
              <select className={`${fieldClass} w-full`} value={printerName} onChange={(event) => handlePrinterChange(event.target.value)}>
                <option value="">Selecciona una impresora</option>
                {printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName}{printer.isDefault ? ' · predeterminada del sistema' : ''}</option>)}
              </select>
            ) : (
              <p className="text-xs text-slate-500">{isElectron ? 'No se detectaron impresoras instaladas.' : 'La lista estará disponible al abrir el programa de escritorio; en el navegador se abrirá la vista previa de impresión.'}</p>
            )}
            <p className="mt-2 text-[11px] leading-4 text-slate-500">Esta selección solo se usa para etiquetas. No cambia la impresora de tickets ni la predeterminada de Windows.</p>
            {printerError && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{printerError}</div>}
          </Card>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {message && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

          <Button className="w-full" onClick={() => void handlePrint()} disabled={printing || queue.length === 0}>
            {printing ? 'Imprimiendo...' : `Imprimir ${totalLabels} etiqueta(s)`}
          </Button>
        </div>
      </div>

      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetect={(code) => handleScan(code)} />
      <LabelDesignerModal
        open={designerOpen}
        onClose={() => setDesignerOpen(false)}
        product={queue[0]?.product ?? null}
        template={activeTemplate ?? { id: 'fallback', name: 'Estándar 37.5 × 30 mm', layout: activeTemplateFallback(), builtin: true }}
        onSaveTemplate={handleSaveTemplate}
        departmentNames={departmentNames}
      />
    </div>
  );
}

function activeTemplateFallback() {
  return defaultLabelTemplates()[0].layout;
}
