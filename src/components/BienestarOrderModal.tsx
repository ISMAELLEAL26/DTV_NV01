import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { matchesQuery } from '@/lib/search';
import type { Product } from '@/lib/types';
import Button from '@/components/Button';
import { FileText, ImagePlus, Plus, Printer, RotateCcw, ScanLine, Trash2, X } from 'lucide-react';

interface BienestarOrderItem {
  product: Product;
  claveBienestar: string;
  quantity: number;
  unitCost: number;
  cap: string;
  med: string;
  gram: string;
  emp: string;
}

interface BienestarOrderModalProps {
  open: boolean;
  onClose: () => void;
}

type EntregaColumn = 'PRIMERA' | 'SEGUNDA' | 'TERCERA' | 'CUARTA';

const MESES_OPCIONES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
] as const;

type MesNombre = (typeof MESES_OPCIONES)[number];

const STORAGE_LOGO_KEY = 'pdv_bienestar_pedido_logo_v1';

const DEFAULT_BIENESTAR_LOGO_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 115" width="360" height="115">
  <circle cx="58" cy="56" r="44" fill="#E8D8A6"/>
  <path d="M58 14 C69 27, 72 45, 62 63 C51 47, 49 28, 58 14 Z" fill="#A6822A"/>
  <path d="M22 33 C36 39, 43 52, 39 67 C25 60, 19 47, 22 33 Z" fill="#6B1435"/>
  <ellipse cx="33" cy="65" rx="13" ry="8" transform="rotate(18 33 65)" fill="#1E1E1E"/>
  <circle cx="77" cy="49" r="10" fill="#8C1D40"/>
  <circle cx="88" cy="62" r="9" fill="#8C1D40"/>
  <path d="M16 68 C42 66, 68 78, 96 92 C72 106, 36 104, 16 68 Z" fill="#134E3A"/>
  <path d="M44 96 C66 82, 86 78, 102 82 C90 100, 66 105, 44 96 Z" fill="#1B6B50"/>
  <text x="215" y="45" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="25" fill="#A6822A">Tienda</text>
  <text x="225" y="88" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="44" fill="#6B1435">Bienestar</text>
</svg>
`)}`;

const fieldClass =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getDefaultMes(): MesNombre {
  const idx = new Date().getMonth();
  return MESES_OPCIONES[idx] ?? 'DICIEMBRE';
}

export default function BienestarOrderModal({ open, onClose }: BienestarOrderModalProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [qtyInput, setQtyInput] = useState<number>(1);
  const [orderItems, setOrderItems] = useState<BienestarOrderItem[]>([]);
  const [bonusPercent, setBonusPercent] = useState<number>(6);
  const [tiendaNum, setTiendaNum] = useState('274');
  const [tiendaNombre, setTiendaNombre] = useState('MILPILLAS');
  const [almacenNombre, setAlmacenNombre] = useState('ALMACEN OMETEPEC');
  const [entregaCol, setEntregaCol] = useState<EntregaColumn>('PRIMERA');
  const [mesPedido, setMesPedido] = useState<MesNombre>(getDefaultMes);
  const [customLogo, setCustomLogo] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_LOGO_KEY) || '';
    } catch {
      return '';
    }
  });
  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const activeLogo = customLogo || DEFAULT_BIENESTAR_LOGO_SVG;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingProducts(true);
    setError(null);

    void (async () => {
      try {
        const all: Product[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error: fetchError } = await supabase
            .from('products')
            .select('*')
            .eq('active', true)
            .order('name')
            .range(from, from + 999);
          if (fetchError) throw fetchError;
          all.push(...((data as Product[]) ?? []));
          if (!data || data.length < 1000) break;
        }
        if (!cancelled) {
          setProducts(all);
          window.setTimeout(() => searchRef.current?.focus(), 50);
        }
      } catch {
        if (!cancelled) setError('No se pudo cargar el catálogo de productos.');
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const suggestions = useMemo(() => {
    const q = searchInput.trim();
    if (!q) return [];
    return products
      .filter((p) =>
        matchesQuery(q, p.name, p.barcode ?? '', p.barcode_2 ?? '', p.sku ?? '')
      )
      .slice(0, 8);
  }, [products, searchInput]);

  const subtotalGeneral = useMemo(
    () => orderItems.reduce((acc, it) => acc + it.quantity * it.unitCost, 0),
    [orderItems]
  );

  const totalPiezas = useMemo(
    () => orderItems.reduce((acc, it) => acc + it.quantity, 0),
    [orderItems]
  );

  const safeBonus = Math.max(0, Number(bonusPercent) || 0);
  const gananciaBonificacion = useMemo(
    () => subtotalGeneral * (safeBonus / 100),
    [subtotalGeneral, safeBonus]
  );

  if (!open) return null;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Selecciona un archivo de imagen válido (PNG, JPG o WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;
      setCustomLogo(result);
      try {
        localStorage.setItem(STORAGE_LOGO_KEY, result);
      } catch {
        // Si excede almacenamiento local se mantiene en sesión
      }
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleResetLogo = () => {
    setCustomLogo('');
    try {
      localStorage.removeItem(STORAGE_LOGO_KEY);
    } catch {
      // Ignorar
    }
  };

  const selectArticle = (product: Product) => {
    setSelectedProduct(product);
    setSearchInput(product.name);
    setQtyInput(1);
    setError(null);
    window.setTimeout(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }, 20);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = searchInput.trim().toLowerCase();
    if (!raw) return;

    const exact = products.find((p) =>
      [p.barcode, p.barcode_2, p.sku, p.name].some(
        (val) => val?.trim().toLowerCase() === raw
      )
    );
    if (exact) {
      selectArticle(exact);
      return;
    }
    if (suggestions.length === 1) {
      selectArticle(suggestions[0]);
      return;
    }
    setError(`No se encontró coincidencia exacta para "${searchInput.trim()}".`);
  };

  const handleAddItem = () => {
    if (!selectedProduct) {
      setError('Selecciona primero un artículo.');
      return;
    }
    const cleanQty = Math.max(1, Math.round(Number(qtyInput) || 1));
    const claveBienestar = (
      selectedProduct.barcode_2 ||
      selectedProduct.sku ||
      selectedProduct.barcode ||
      ''
    ).trim();

    if (!claveBienestar) {
      setError(`El artículo "${selectedProduct.name}" no tiene Código de Barras 2 (Clave Bienestar) asignado.`);
      return;
    }

    const unitCost = Number(selectedProduct.cost_price) || 0;

    setOrderItems((prev) => {
      const idx = prev.findIndex((it) => it.product.id === selectedProduct.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + cleanQty };
        return copy;
      }
      return [
        ...prev,
        {
          product: selectedProduct,
          claveBienestar,
          quantity: cleanQty,
          unitCost,
          cap: '',
          med: selectedProduct.unit?.slice(0, 1).toUpperCase() || 'P',
          gram: '',
          emp: '',
        },
      ];
    });

    setSelectedProduct(null);
    setSearchInput('');
    setQtyInput(1);
    setError(null);
    window.setTimeout(() => searchRef.current?.focus(), 20);
  };

  const updateItemQty = (productId: string, quantity: number) => {
    const clean = Math.max(1, Math.round(Number(quantity) || 1));
    setOrderItems((prev) =>
      prev.map((it) => (it.product.id === productId ? { ...it, quantity: clean } : it))
    );
  };

  const updateItemField = (
    productId: string,
    field: 'cap' | 'med' | 'gram' | 'emp' | 'unitCost',
    value: string
  ) => {
    setOrderItems((prev) =>
      prev.map((it) => {
        if (it.product.id !== productId) return it;
        if (field === 'unitCost') {
          return { ...it, unitCost: Math.max(0, Number(value) || 0) };
        }
        return { ...it, [field]: value };
      })
    );
  };

  const removeItem = (productId: string) => {
    setOrderItems((prev) => prev.filter((it) => it.product.id !== productId));
  };

  const openPrintDocument = (html: string, title: string) => {
    const win = window.open('', '_blank', 'width=960,height=720');
    if (!win) {
      setError('El navegador bloqueó la ventana del PDF. Haz clic en "Permitir ventanas emergentes" en la barra de arriba.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.document.title = title;
    window.setTimeout(() => {
      win.focus();
      win.print();
    }, 300);
  };

  const handleDownloadInternalPdf = () => {
    if (orderItems.length === 0) {
      setError('Agrega al menos un artículo antes de generar los PDF.');
      return;
    }
    const fecha = new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
    const rowsHtml = orderItems
      .map((it, idx) => {
        const sub = it.quantity * it.unitCost;
        return `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td>${escapeHtml(it.claveBienestar)}</td>
            <td>${escapeHtml(it.product.name)}</td>
            <td style="text-align:right;">${it.quantity} PIEZAS</td>
            <td style="text-align:right;">${formatCurrency(it.unitCost)}</td>
            <td style="text-align:right;">${formatCurrency(sub)}</td>
          </tr>
        `;
      })
      .join('');

    const html = `
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Pedido Bienestar · Control Interno</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 24px; font-size: 12px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 16px; }
          .logo { max-height: 54px; width: auto; }
          h1 { margin: 0 0 4px; font-size: 18px; color: #0f172a; }
          .meta { color: #475569; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
          th { background: #f1f5f9; text-align: left; font-size: 11px; }
          .summary { margin-top: 16px; margin-left: auto; width: 320px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
          .summary-row { display: flex; justify-content: space-between; margin: 5px 0; }
          .summary-total { font-weight: 700; font-size: 14px; border-top: 1px solid #cbd5e1; padding-top: 6px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>Pedido Bienestar · Control Interno y Costos</h1>
            <div class="meta">Tienda #${escapeHtml(tiendaNum)} · ${escapeHtml(tiendaNombre)} · Almacén: ${escapeHtml(almacenNombre)} · ENTREGA ${escapeHtml(entregaCol)} · MES: ${escapeHtml(mesPedido)} · Fecha: ${escapeHtml(fecha)}</div>
          </div>
          <img class="logo" src="${activeLogo}" alt="Logo Bienestar" />
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:42px;text-align:center;">#</th>
              <th style="width:120px;">Clave / Cód. 2</th>
              <th>Artículo</th>
              <th style="width:105px;text-align:right;">CANTIDAD SOLICITADA</th>
              <th style="width:95px;text-align:right;">Costo Unit.</th>
              <th style="width:105px;text-align:right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="summary">
          <div class="summary-row"><span>Total de piezas:</span><strong>${totalPiezas} PIEZAS</strong></div>
          <div class="summary-row"><span>Subtotal general:</span><strong>${formatCurrency(subtotalGeneral)}</strong></div>
          <div class="summary-row"><span>Bonificación (${safeBonus}%):</span><strong>${formatCurrency(gananciaBonificacion)}</strong></div>
          <div class="summary-row summary-total"><span>Total estimado:</span><span>${formatCurrency(subtotalGeneral)}</span></div>
        </div>
      </body>
      </html>
    `;
    openPrintDocument(html, 'Pedido Bienestar - Control Interno');
  };

  const handleDownloadWarehousePdf = () => {
    if (orderItems.length === 0) {
      setError('Agrega al menos un artículo antes de generar los PDF.');
      return;
    }
    const fecha = new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
    const rowsHtml = orderItems
      .map((it, idx) => `
        <tr>
          <td class="num-col">${idx + 1}</td>
          <td class="clave-col">${escapeHtml(it.claveBienestar)}</td>
          <td class="art-col">${escapeHtml(it.product.name)}</td>
          <td class="cant-col">${it.quantity} PIEZAS</td>
        </tr>
      `)
      .join('');

    const html = `
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Pedido Bienestar · Formato Almacén</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 24px; font-size: 14px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0f766e; padding-bottom: 14px; margin-bottom: 18px; gap: 16px; }
          .logo { max-height: 68px; width: auto; }
          h1 { margin: 0 0 8px; font-size: 24px; font-weight: 800; color: #0f172a; }
          .meta { color: #1e293b; font-size: 14px; font-weight: 600; line-height: 1.45; }
          .entrega-mes { margin-top: 6px; font-size: 15px; font-weight: 800; color: #0f766e; letter-spacing: 0.3px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1.5px solid #94a3b8; padding: 10px 12px; font-size: 14px; }
          th { background: #e2e8f0; color: #0f172a; font-size: 14px; font-weight: 800; text-align: left; }
          th.num-col, td.num-col { width: 54px; text-align: center; font-weight: 700; }
          th.clave-col, td.clave-col { width: 165px; font-family: monospace, sans-serif; font-size: 14px; font-weight: 700; }
          th.art-col, td.art-col { text-align: left; font-weight: 600; }
          th.cant-col, td.cant-col { width: 175px; text-align: right; font-weight: 800; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>Pedido Bienestar · Formato de Almacén</h1>
            <div class="meta">Tienda #${escapeHtml(tiendaNum)} · ${escapeHtml(tiendaNombre)} · Almacén: ${escapeHtml(almacenNombre)} · Fecha: ${escapeHtml(fecha)}</div>
            <div class="entrega-mes">ENTREGA ${escapeHtml(entregaCol)} MES: ${escapeHtml(mesPedido)}</div>
          </div>
          <img class="logo" src="${activeLogo}" alt="Logo Bienestar" />
        </div>
        <table>
          <thead>
            <tr>
              <th class="num-col">#</th>
              <th class="clave-col">Clave</th>
              <th class="art-col">Artículo</th>
              <th class="cant-col">CANTIDAD SOLICITADA</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
      </html>
    `;
    openPrintDocument(html, 'Pedido Bienestar - Formato Almacen');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <img src={activeLogo} alt="Logo Bienestar" className="h-10 w-auto rounded object-contain" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">Pedido Bienestar</h2>
              <p className="text-xs text-slate-500">
                Captura por código, SKU o nombre · Control interno y formato de almacén
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoUpload}
            />
            <Button variant="secondary" onClick={() => logoInputRef.current?.click()}>
              <ImagePlus size={15} /> Logo
            </Button>
            {customLogo && (
              <Button variant="secondary" onClick={handleResetLogo} title="Restaurar logo predeterminado">
                <RotateCcw size={15} />
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="Cerrar modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">No. Tienda</label>
              <input
                type="text"
                value={tiendaNum}
                onChange={(e) => setTiendaNum(e.target.value)}
                className={`w-full ${fieldClass}`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Tienda / Localidad</label>
              <input
                type="text"
                value={tiendaNombre}
                onChange={(e) => setTiendaNombre(e.target.value)}
                className={`w-full ${fieldClass}`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Almacén</label>
              <input
                type="text"
                value={almacenNombre}
                onChange={(e) => setAlmacenNombre(e.target.value)}
                className={`w-full ${fieldClass}`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Entrega</label>
              <select
                value={entregaCol}
                onChange={(e) => setEntregaCol(e.target.value as EntregaColumn)}
                className={`w-full ${fieldClass}`}
              >
                <option value="PRIMERA">1RA ENTREGA</option>
                <option value="SEGUNDA">2DA ENTREGA</option>
                <option value="TERCERA">3RA ENTREGA</option>
                <option value="CUARTA">4TA ENTREGA</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Mes</label>
              <select
                value={mesPedido}
                onChange={(e) => setMesPedido(e.target.value as MesNombre)}
                className={`w-full ${fieldClass}`}
              >
                {MESES_OPCIONES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="relative grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-12">
            <div className="relative sm:col-span-7">
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                {loadingProducts ? 'Cargando catálogo...' : 'Buscar o escanear producto (código, SKU o nombre)'}
              </label>
              <div className="relative">
                <ScanLine size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    setSelectedProduct(null);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Escribe nombre, SKU o escanea código..."
                  className={`w-full pl-9 ${fieldClass}`}
                />
              </div>

              {suggestions.length > 0 && !selectedProduct && (
                <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {suggestions.map((prod) => (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => selectArticle(prod)}
                      className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-emerald-50 last:border-b-0"
                    >
                      <span className="font-medium text-slate-800">{prod.name}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {prod.barcode_2 || prod.sku || prod.barcode || 'Sin código'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600">Cantidad</label>
              <input
                ref={qtyRef}
                type="number"
                min={1}
                step={1}
                value={qtyInput}
                onChange={(e) => setQtyInput(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddItem();
                  }
                }}
                className={`w-full ${fieldClass}`}
              />
            </div>

            <div className="flex items-end sm:col-span-3">
              <Button type="button" onClick={handleAddItem} className="w-full justify-center">
                <Plus size={16} /> Agregar artículo
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">Clave</th>
                  <th className="px-3 py-2.5">Producto</th>
                  <th className="px-2 py-2.5 text-center">Cant.</th>
                  <th className="px-2 py-2.5 text-right">Costo</th>
                  <th className="px-2 py-2.5 text-center">CAP</th>
                  <th className="px-2 py-2.5 text-center">MED</th>
                  <th className="px-2 py-2.5 text-center">GRAM</th>
                  <th className="px-2 py-2.5 text-center">EMP</th>
                  <th className="px-3 py-2.5 text-right">Subtotal</th>
                  <th className="px-2 py-2.5 text-center">Quitar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orderItems.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                      Aún no has agregado artículos al pedido Bienestar.
                    </td>
                  </tr>
                ) : (
                  orderItems.map((it) => (
                    <tr key={it.product.id} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{it.claveBienestar}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{it.product.name}</td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="number"
                          min={1}
                          value={it.quantity}
                          onChange={(e) => updateItemQty(it.product.id, Number(e.target.value))}
                          className="w-16 rounded border border-slate-200 px-2 py-1 text-center text-xs"
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={it.unitCost}
                          onChange={(e) => updateItemField(it.product.id, 'unitCost', e.target.value)}
                          className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-xs"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="text"
                          value={it.cap}
                          onChange={(e) => updateItemField(it.product.id, 'cap', e.target.value)}
                          className="w-14 rounded border border-slate-200 px-1.5 py-1 text-center text-xs"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="text"
                          value={it.med}
                          onChange={(e) => updateItemField(it.product.id, 'med', e.target.value)}
                          className="w-14 rounded border border-slate-200 px-1.5 py-1 text-center text-xs"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="text"
                          value={it.gram}
                          onChange={(e) => updateItemField(it.product.id, 'gram', e.target.value)}
                          className="w-14 rounded border border-slate-200 px-1.5 py-1 text-center text-xs"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="text"
                          value={it.emp}
                          onChange={(e) => updateItemField(it.product.id, 'emp', e.target.value)}
                          className="w-14 rounded border border-slate-200 px-1.5 py-1 text-center text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {formatCurrency(it.quantity * it.unitCost)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(it.product.id)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Eliminar artículo"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Bonificación (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={bonusPercent}
                onChange={(e) => setBonusPercent(Math.max(0, Number(e.target.value) || 0))}
                className={`w-full ${fieldClass}`}
              />
            </div>
            <div className="flex flex-col justify-center rounded-lg bg-white px-3 py-2 border border-slate-200">
              <span className="text-xs text-slate-500">Piezas: {totalPiezas} · Subtotal</span>
              <span className="text-base font-bold text-slate-900">{formatCurrency(subtotalGeneral)}</span>
            </div>
            <div className="flex flex-col justify-center rounded-lg bg-emerald-50 px-3 py-2 border border-emerald-200">
              <span className="text-xs text-emerald-700">Bonificación ({safeBonus}%)</span>
              <span className="text-base font-bold text-emerald-800">{formatCurrency(gananciaBonificacion)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleDownloadWarehousePdf}>
              <Printer size={16} /> PDF Almacén
            </Button>
            <Button onClick={handleDownloadInternalPdf}>
              <FileText size={16} /> PDF Control Interno
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
