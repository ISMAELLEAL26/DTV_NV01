import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { matchesQuery } from '@/lib/search';
import type { Product } from '@/lib/types';
import Button from '@/components/Button';
import {
  BookmarkCheck,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  ImagePlus,
  Plus,
  Printer,
  RotateCcw,
  ScanLine,
  Trash2,
  X,
} from 'lucide-react';

interface BienestarOrderItem {
  id: string;
  product: Product | null;
  isManual: boolean;
  claveBienestar: string;
  name: string;
  quantity: number;
  unitCost: number | null;
  isSuggestedPrice: boolean;
  cap: string;
  med: string;
  gram: string;
  emp: string;
}

interface SavedBienestarPedido {
  id: string;
  folio: string;
  savedAt: string;
  status: 'BORRADOR' | 'GUARDADO';
  tiendaNum: string;
  tiendaNombre: string;
  almacenNombre: string;
  entregaCol: EntregaColumn;
  mesPedido: MesNombre;
  bonusPercent: number;
  items: BienestarOrderItem[];
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
const STORAGE_PEDIDOS_KEY = 'pdv_bienestar_pedidos_guardados_v1';
const STORAGE_ACTIVE_DRAFT_KEY = 'pdv_bienestar_borrador_activo_v1';

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

function makeItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeFolio(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes()
  ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `PB-${stamp}`;
}

function readSavedPedidos(): SavedBienestarPedido[] {
  try {
    const raw = localStorage.getItem(STORAGE_PEDIDOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedPedidos(list: SavedBienestarPedido[]): void {
  try {
    localStorage.setItem(STORAGE_PEDIDOS_KEY, JSON.stringify(list));
  } catch {
    // Ignorar si supera cuota de almacenamiento
  }
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
  const [currentPedidoId, setCurrentPedidoId] = useState<string | null>(null);
  const [currentFolio, setCurrentFolio] = useState<string>(() => makeFolio());

  const [savedPedidos, setSavedPedidos] = useState<SavedBienestarPedido[]>(() => readSavedPedidos());
  const [showHistorial, setShowHistorial] = useState(false);
  const [inspectedPedido, setInspectedPedido] = useState<SavedBienestarPedido | null>(null);

  // Estado para agregar producto no existente en catálogo
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualClave, setManualClave] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState<number>(1);
  const [manualPriceMode, setManualPriceMode] = useState<'SUGERIDO' | 'BLANCO'>('SUGERIDO');
  const [manualPriceValue, setManualPriceValue] = useState<string>('');

  const [customLogo, setCustomLogo] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_LOGO_KEY) || '';
    } catch {
      return '';
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const activeLogo = customLogo || DEFAULT_BIENESTAR_LOGO_SVG;

  // Persistir borrador automático de sesión activa al cambiar artículos o datos
  useEffect(() => {
    try {
      const hasContent =
        orderItems.length > 0 ||
        tiendaNum !== '274' ||
        tiendaNombre !== 'MILPILLAS' ||
        almacenNombre !== 'ALMACEN OMETEPEC';
      if (!hasContent) {
        localStorage.removeItem(STORAGE_ACTIVE_DRAFT_KEY);
        return;
      }
      localStorage.setItem(
        STORAGE_ACTIVE_DRAFT_KEY,
        JSON.stringify({
          currentPedidoId,
          currentFolio,
          tiendaNum,
          tiendaNombre,
          almacenNombre,
          entregaCol,
          mesPedido,
          bonusPercent,
          orderItems,
        })
      );
    } catch {
      // Ignorar
    }
  }, [
    currentPedidoId,
    currentFolio,
    tiendaNum,
    tiendaNombre,
    almacenNombre,
    entregaCol,
    mesPedido,
    bonusPercent,
    orderItems,
  ]);

  // Restaurar borrador activo si se reabre el modal
  useEffect(() => {
    if (!open) return;
    setSavedPedidos(readSavedPedidos());
    try {
      const rawDraft = localStorage.getItem(STORAGE_ACTIVE_DRAFT_KEY);
      if (rawDraft && orderItems.length === 0) {
        const draft = JSON.parse(rawDraft);
        if (Array.isArray(draft.orderItems) && draft.orderItems.length > 0) {
          setOrderItems(draft.orderItems);
          if (draft.currentPedidoId) setCurrentPedidoId(draft.currentPedidoId);
          if (draft.currentFolio) setCurrentFolio(draft.currentFolio);
          if (draft.tiendaNum) setTiendaNum(draft.tiendaNum);
          if (draft.tiendaNombre) setTiendaNombre(draft.tiendaNombre);
          if (draft.almacenNombre) setAlmacenNombre(draft.almacenNombre);
          if (draft.entregaCol) setEntregaCol(draft.entregaCol);
          if (draft.mesPedido) setMesPedido(draft.mesPedido);
          if (typeof draft.bonusPercent === 'number') setBonusPercent(draft.bonusPercent);
        }
      }
    } catch {
      // Ignorar
    }

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
    () =>
      orderItems.reduce(
        (acc, it) => acc + (it.unitCost !== null ? it.quantity * it.unitCost : 0),
        0
      ),
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
    setNotice(null);
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
      setError(
        `El artículo "${selectedProduct.name}" no tiene Código de Barras 2 (Clave Bienestar) asignado.`
      );
      return;
    }

    const unitCost = Number(selectedProduct.cost_price) || 0;

    setOrderItems((prev) => {
      const idx = prev.findIndex(
        (it) => !it.isManual && it.product?.id === selectedProduct.id
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + cleanQty };
        return copy;
      }
      return [
        ...prev,
        {
          id: makeItemId(),
          product: selectedProduct,
          isManual: false,
          claveBienestar,
          name: selectedProduct.name,
          quantity: cleanQty,
          unitCost,
          isSuggestedPrice: false,
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
    setNotice(null);
    window.setTimeout(() => searchRef.current?.focus(), 20);
  };

  const handleAddManualItem = () => {
    const cleanName = manualName.trim();
    if (!cleanName) {
      setError('Escribe el nombre del producto no existente en sistema.');
      return;
    }
    const cleanQty = Math.max(1, Math.round(Number(manualQty) || 1));
    const cleanClave = manualClave.trim() || 'S/C';

    let finalUnitCost: number | null = null;
    let isSuggested = false;

    if (manualPriceMode === 'SUGERIDO') {
      const parsed = Number(manualPriceValue);
      if (!manualPriceValue.trim() || Number.isNaN(parsed) || parsed < 0) {
        setError('Ingresa un precio sugerido válido o selecciona la opción de dejarlo en blanco.');
        return;
      }
      finalUnitCost = parsed;
      isSuggested = true;
    } else {
      finalUnitCost = null;
      isSuggested = false;
    }

    setOrderItems((prev) => [
      ...prev,
      {
        id: makeItemId(),
        product: null,
        isManual: true,
        claveBienestar: cleanClave,
        name: cleanName,
        quantity: cleanQty,
        unitCost: finalUnitCost,
        isSuggestedPrice: isSuggested,
        cap: '',
        med: 'P',
        gram: '',
        emp: '',
      },
    ]);

    setManualClave('');
    setManualName('');
    setManualQty(1);
    setManualPriceValue('');
    setShowManualForm(false);
    setError(null);
    setNotice(`Se agregó "${cleanName}" al pedido (no afecta el catálogo del sistema).`);
  };

  const updateItemQty = (itemId: string, quantity: number) => {
    const clean = Math.max(1, Math.round(Number(quantity) || 1));
    setOrderItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, quantity: clean } : it))
    );
  };

  const updateItemCost = (itemId: string, rawValue: string) => {
    setOrderItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        if (it.isManual && rawValue.trim() === '') {
          return { ...it, unitCost: null, isSuggestedPrice: false };
        }
        const num = Math.max(0, Number(rawValue) || 0);
        return {
          ...it,
          unitCost: num,
          isSuggestedPrice: it.isManual ? true : it.isSuggestedPrice,
        };
      })
    );
  };

  const toggleManualBlankPrice = (itemId: string) => {
    setOrderItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        if (it.unitCost === null) {
          return { ...it, unitCost: 0, isSuggestedPrice: true };
        }
        return { ...it, unitCost: null, isSuggestedPrice: false };
      })
    );
  };

  const updateItemField = (
    itemId: string,
    field: 'cap' | 'med' | 'gram' | 'emp',
    value: string
  ) => {
    setOrderItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, [field]: value } : it))
    );
  };

  const removeItem = (itemId: string) => {
    setOrderItems((prev) => prev.filter((it) => it.id !== itemId));
  };

  const persistPedido = (status: 'BORRADOR' | 'GUARDADO') => {
    if (orderItems.length === 0) {
      setError('Agrega al menos un artículo antes de guardar.');
      return;
    }
    const nowLabel = new Date().toLocaleString('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const recordId = currentPedidoId || `pedido-${Date.now()}`;
    const folio = currentFolio || makeFolio();

    const record: SavedBienestarPedido = {
      id: recordId,
      folio,
      savedAt: nowLabel,
      status,
      tiendaNum,
      tiendaNombre,
      almacenNombre,
      entregaCol,
      mesPedido,
      bonusPercent,
      items: orderItems,
    };

    const existing = readSavedPedidos();
    const idx = existing.findIndex((p) => p.id === recordId);
    const nextList =
      idx >= 0
        ? existing.map((p, i) => (i === idx ? record : p))
        : [record, ...existing];

    writeSavedPedidos(nextList);
    setSavedPedidos(nextList);
    setCurrentPedidoId(recordId);
    setCurrentFolio(folio);
    setError(null);
    setNotice(
      status === 'BORRADOR'
        ? `Borrador ${folio} guardado. Puedes consultarlo o retomarlo cuando quieras.`
        : `Pedido ${folio} guardado. Ya puedes consultarlo, verlo y volver a descargar sus PDF.`
    );
  };

  const handleLoadPedidoIntoEditor = (pedido: SavedBienestarPedido) => {
    setCurrentPedidoId(pedido.id);
    setCurrentFolio(pedido.folio);
    setTiendaNum(pedido.tiendaNum);
    setTiendaNombre(pedido.tiendaNombre);
    setAlmacenNombre(pedido.almacenNombre);
    setEntregaCol(pedido.entregaCol);
    setMesPedido(pedido.mesPedido);
    setBonusPercent(pedido.bonusPercent);
    setOrderItems(pedido.items);
    setInspectedPedido(null);
    setShowHistorial(false);
    setError(null);
    setNotice(`Cargado ${pedido.folio} (${pedido.status === 'BORRADOR' ? 'Borrador' : 'Guardado'}).`);
  };

  const handleDeleteSavedPedido = (pedidoId: string) => {
    const nextList = readSavedPedidos().filter((p) => p.id !== pedidoId);
    writeSavedPedidos(nextList);
    setSavedPedidos(nextList);
    if (inspectedPedido?.id === pedidoId) {
      setInspectedPedido(null);
    }
    if (currentPedidoId === pedidoId) {
      setCurrentPedidoId(null);
      setCurrentFolio(makeFolio());
    }
  };

  const handleStartNewPedido = () => {
    setCurrentPedidoId(null);
    setCurrentFolio(makeFolio());
    setOrderItems([]);
    setSelectedProduct(null);
    setSearchInput('');
    setQtyInput(1);
    setError(null);
    setNotice('Nuevo pedido Bienestar listo.');
    try {
      localStorage.removeItem(STORAGE_ACTIVE_DRAFT_KEY);
    } catch {
      // Ignorar
    }
  };

  const openPrintDocument = (html: string, title: string) => {
    const win = window.open('', '_blank', 'width=960,height=720');
    if (!win) {
      setError(
        'El navegador bloqueó la ventana del PDF. Haz clic en "Permitir ventanas emergentes" en la barra de arriba.'
      );
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

  const buildInternalPdfForRecord = (data: {
    folio: string;
    tiendaNum: string;
    tiendaNombre: string;
    almacenNombre: string;
    entregaCol: EntregaColumn;
    mesPedido: MesNombre;
    bonusPercent: number;
    items: BienestarOrderItem[];
    fechaTexto?: string;
  }) => {
    if (data.items.length === 0) {
      setError('Agrega al menos un artículo antes de generar los PDF.');
      return;
    }
    const fecha =
      data.fechaTexto ||
      new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

    const subGeneral = data.items.reduce(
      (acc, it) => acc + (it.unitCost !== null ? it.quantity * it.unitCost : 0),
      0
    );
    const piezasTotal = data.items.reduce((acc, it) => acc + it.quantity, 0);
    const bonifPct = Math.max(0, Number(data.bonusPercent) || 0);
    const bonifMonto = subGeneral * (bonifPct / 100);

    const rowsHtml = data.items
      .map((it, idx) => {
        const hasPrice = it.unitCost !== null;
        const sub = hasPrice ? it.quantity * (it.unitCost ?? 0) : null;
        const costoLabel = hasPrice
          ? `${formatCurrency(it.unitCost ?? 0)}${it.isSuggestedPrice ? ' (Sug.)' : ''}`
          : '—';
        const subLabel = sub !== null ? formatCurrency(sub) : '—';
        const tagExtra = it.isManual ? ' <span style="color:#0f766e;font-size:10px;">[Extra]</span>' : '';

        return `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td>${escapeHtml(it.claveBienestar)}</td>
            <td>${escapeHtml(it.name)}${tagExtra}</td>
            <td style="text-align:right;">${it.quantity} PIEZAS</td>
            <td style="text-align:right;">${escapeHtml(costoLabel)}</td>
            <td style="text-align:right;">${escapeHtml(subLabel)}</td>
          </tr>
        `;
      })
      .join('');

    const html = `
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Pedido Bienestar · Control Interno · ${escapeHtml(data.folio)}</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 24px; font-size: 12px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 16px; }
          .logo { max-height: 54px; width: auto; }
          h1 { margin: 0 0 4px; font-size: 18px; color: #0f172a; }
          .meta { color: #475569; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
          th { background: #f1f5f9; text-align: left; font-size: 11px; }
          .summary { margin-top: 16px; margin-left: auto; width: 340px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
          .summary-row { display: flex; justify-content: space-between; margin: 5px 0; }
          .summary-total { font-weight: 700; font-size: 14px; border-top: 1px solid #cbd5e1; padding-top: 6px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>Pedido Bienestar · Control Interno y Costos</h1>
            <div class="meta">Folio: ${escapeHtml(data.folio)} · Tienda #${escapeHtml(data.tiendaNum)} · ${escapeHtml(data.tiendaNombre)} · Almacén: ${escapeHtml(data.almacenNombre)} · ENTREGA ${escapeHtml(data.entregaCol)} · MES: ${escapeHtml(data.mesPedido)} · Fecha: ${escapeHtml(fecha)}</div>
          </div>
          <img class="logo" src="${activeLogo}" alt="Logo Bienestar" />
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:42px;text-align:center;">#</th>
              <th style="width:120px;">Clave / Cód. 2</th>
              <th>Artículo</th>
              <th style="width:110px;text-align:right;">CANTIDAD SOLICITADA</th>
              <th style="width:115px;text-align:right;">Costo / Sug.</th>
              <th style="width:105px;text-align:right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="summary">
          <div class="summary-row"><span>Total de piezas:</span><strong>${piezasTotal} PIEZAS</strong></div>
          <div class="summary-row"><span>Subtotal general:</span><strong>${formatCurrency(subGeneral)}</strong></div>
          <div class="summary-row"><span>Bonificación (${bonifPct}%):</span><strong>${formatCurrency(bonifMonto)}</strong></div>
          <div class="summary-row summary-total"><span>Total estimado:</span><span>${formatCurrency(subGeneral)}</span></div>
        </div>
      </body>
      </html>
    `;
    openPrintDocument(html, `Pedido Bienestar - Control Interno - ${data.folio}`);
  };

  const buildWarehousePdfForRecord = (data: {
    folio: string;
    tiendaNum: string;
    tiendaNombre: string;
    almacenNombre: string;
    entregaCol: EntregaColumn;
    mesPedido: MesNombre;
    items: BienestarOrderItem[];
    fechaTexto?: string;
  }) => {
    if (data.items.length === 0) {
      setError('Agrega al menos un artículo antes de generar los PDF.');
      return;
    }
    const fecha =
      data.fechaTexto ||
      new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

    const rowsHtml = data.items
      .map(
        (it, idx) => `
        <tr>
          <td class="num-col">${idx + 1}</td>
          <td class="clave-col">${escapeHtml(it.claveBienestar)}</td>
          <td class="art-col">${escapeHtml(it.name)}</td>
          <td class="cant-col">${it.quantity} PIEZAS</td>
        </tr>
      `
      )
      .join('');

    const html = `
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Pedido Bienestar · Formato Almacén · ${escapeHtml(data.folio)}</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 14px 18px; font-size: 12px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2.5px solid #0f766e; padding-bottom: 8px; margin-bottom: 10px; gap: 12px; }
          .logo { max-height: 52px; width: auto; }
          h1 { margin: 0 0 4px; font-size: 19px; font-weight: 800; color: #0f172a; }
          .meta { color: #1e293b; font-size: 12px; font-weight: 600; line-height: 1.3; }
          .entrega-mes { margin-top: 3px; font-size: 13px; font-weight: 800; color: #0f766e; }
          table { width: 100%; border-collapse: collapse; margin-top: 6px; }
          th, td { border: 1px solid #94a3b8; padding: 5px 8px; font-size: 12px; line-height: 1.2; }
          th { background: #e2e8f0; color: #0f172a; font-size: 12px; font-weight: 800; text-align: left; }
          th.num-col, td.num-col { width: 42px; text-align: center; font-weight: 700; }
          th.clave-col, td.clave-col { width: 145px; font-family: monospace, sans-serif; font-size: 12px; font-weight: 700; }
          th.art-col, td.art-col { text-align: left; font-weight: 600; }
          th.cant-col, td.cant-col { width: 150px; text-align: right; font-weight: 800; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>Pedido Bienestar · Formato de Almacén</h1>
            <div class="meta">Folio: ${escapeHtml(data.folio)} · Tienda #${escapeHtml(data.tiendaNum)} · ${escapeHtml(data.tiendaNombre)} · Almacén: ${escapeHtml(data.almacenNombre)} · Fecha: ${escapeHtml(fecha)}</div>
            <div class="entrega-mes">ENTREGA ${escapeHtml(data.entregaCol)} MES: ${escapeHtml(data.mesPedido)}</div>
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
    openPrintDocument(html, `Pedido Bienestar - Formato Almacen - ${data.folio}`);
  };

  const handleDownloadInternalPdf = () => {
    buildInternalPdfForRecord({
      folio: currentFolio,
      tiendaNum,
      tiendaNombre,
      almacenNombre,
      entregaCol,
      mesPedido,
      bonusPercent,
      items: orderItems,
    });
  };

  const handleDownloadWarehousePdf = () => {
    buildWarehousePdfForRecord({
      folio: currentFolio,
      tiendaNum,
      tiendaNombre,
      almacenNombre,
      entregaCol,
      mesPedido,
      items: orderItems,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Encabezado */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <img src={activeLogo} alt="Logo Bienestar" className="h-10 w-auto rounded object-contain" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">Pedido Bienestar</h2>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-600">
                  {currentFolio}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Captura por código, SKU o nombre · Productos extra · Guardado y consulta de PDFs
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowHistorial((prev) => !prev);
                setInspectedPedido(null);
              }}
            >
              <FolderOpen size={15} /> Guardados ({savedPedidos.length})
            </Button>
            <Button type="button" variant="secondary" onClick={handleStartNewPedido}>
              <FilePlus2 size={15} /> Nuevo
            </Button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoUpload}
            />
            <Button type="button" variant="secondary" onClick={() => logoInputRef.current?.click()}>
              <ImagePlus size={15} /> Logo
            </Button>
            {customLogo && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleResetLogo}
                title="Restaurar logo predeterminado"
              >
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

        {/* Cuerpo principal */}
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
              {notice}
            </div>
          )}

          {/* Panel de pedidos guardados / borradores para consultar, ver y descargar PDFs */}
          {showHistorial && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">
                  Pedidos Guardados y Borradores
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowHistorial(false);
                    setInspectedPedido(null);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Ocultar
                </button>
              </div>

              {savedPedidos.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">
                  No hay borradores ni pedidos guardados todavía. Usa &ldquo;Guardar borrador&rdquo; o &ldquo;Guardar pedido&rdquo;.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-100 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Folio</th>
                        <th className="px-3 py-2">Estado</th>
                        <th className="px-3 py-2">Entrega / Mes</th>
                        <th className="px-3 py-2">Fecha</th>
                        <th className="px-3 py-2 text-center">Artículos</th>
                        <th className="px-3 py-2 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {savedPedidos.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono font-semibold text-slate-800">{p.folio}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                p.status === 'BORRADOR'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {p.entregaCol} · {p.mesPedido}
                          </td>
                          <td className="px-3 py-2 text-slate-500">{p.savedAt}</td>
                          <td className="px-3 py-2 text-center font-semibold text-slate-700">
                            {p.items.length}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setInspectedPedido(p)}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
                              >
                                <Eye size={13} /> Ver
                              </button>
                              <button
                                type="button"
                                onClick={() => handleLoadPedidoIntoEditor(p)}
                                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-100"
                              >
                                Cargar
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  buildWarehousePdfForRecord({
                                    folio: p.folio,
                                    tiendaNum: p.tiendaNum,
                                    tiendaNombre: p.tiendaNombre,
                                    almacenNombre: p.almacenNombre,
                                    entregaCol: p.entregaCol,
                                    mesPedido: p.mesPedido,
                                    items: p.items,
                                    fechaTexto: p.savedAt,
                                  })
                                }
                                className="rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
                              >
                                PDF Almacén
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  buildInternalPdfForRecord({
                                    folio: p.folio,
                                    tiendaNum: p.tiendaNum,
                                    tiendaNombre: p.tiendaNombre,
                                    almacenNombre: p.almacenNombre,
                                    entregaCol: p.entregaCol,
                                    mesPedido: p.mesPedido,
                                    bonusPercent: p.bonusPercent,
                                    items: p.items,
                                    fechaTexto: p.savedAt,
                                  })
                                }
                                className="rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
                              >
                                PDF Interno
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSavedPedido(p.id)}
                                className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100"
                                title="Eliminar registro"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {inspectedPedido && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      Detalle de {inspectedPedido.folio} · Tienda #{inspectedPedido.tiendaNum} ({inspectedPedido.tiendaNombre}) · ENTREGA {inspectedPedido.entregaCol} MES: {inspectedPedido.mesPedido}
                    </span>
                    <button
                      type="button"
                      onClick={() => setInspectedPedido(null)}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Cerrar vista
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-1 pr-2">Clave</th>
                          <th className="py-1 px-2">Artículo</th>
                          <th className="py-1 px-2 text-right">Cantidad</th>
                          <th className="py-1 pl-2 text-right">Precio / Sugerido</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {inspectedPedido.items.map((it) => (
                          <tr key={it.id}>
                            <td className="py-1 pr-2 font-mono">{it.claveBienestar}</td>
                            <td className="py-1 px-2">
                              {it.name}{' '}
                              {it.isManual && (
                                <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-600">
                                  No en catálogo
                                </span>
                              )}
                            </td>
                            <td className="py-1 px-2 text-right font-semibold">{it.quantity} PIEZAS</td>
                            <td className="py-1 pl-2 text-right">
                              {it.unitCost !== null
                                ? `${formatCurrency(it.unitCost)}${it.isSuggestedPrice ? ' (Sugerido)' : ''}`
                                : 'En blanco'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Datos generales del pedido */}
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

          {/* Captura de producto existente + botón de producto no existente en sistema */}
          <div className="relative grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-12">
            <div className="relative sm:col-span-6">
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                {loadingProducts ? 'Cargando catálogo...' : 'Buscar o escanear producto (código, SKU o nombre)'}
              </label>
              <div className="relative">
                <ScanLine
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
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

            <div className="flex items-end sm:col-span-2">
              <Button type="button" onClick={handleAddItem} className="w-full justify-center">
                <Plus size={16} /> Agregar
              </Button>
            </div>

            <div className="flex items-end sm:col-span-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowManualForm((prev) => !prev);
                  setError(null);
                }}
                className="w-full justify-center"
              >
                <Plus size={15} /> No en sistema
              </Button>
            </div>

            {/* Formulario para producto no existente en sistema */}
            {showManualForm && (
              <div className="sm:col-span-12 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900">
                    Agregar producto no existente en sistema (solo para esta lista de pedido)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowManualForm(false)}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Cancelar
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Clave (opcional)</label>
                    <input
                      type="text"
                      value={manualClave}
                      onChange={(e) => setManualClave(e.target.value)}
                      placeholder="Ej. S/C"
                      className={`w-full ${fieldClass}`}
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Nombre del artículo</label>
                    <input
                      type="text"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="Ej. GALLETA SURTIDA 500G"
                      className={`w-full ${fieldClass}`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Cantidad</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={manualQty}
                      onChange={(e) => setManualQty(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                      className={`w-full ${fieldClass}`}
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Opción de precio</label>
                    <div className="flex gap-2">
                      <select
                        value={manualPriceMode}
                        onChange={(e) =>
                          setManualPriceMode(e.target.value as 'SUGERIDO' | 'BLANCO')
                        }
                        className={`${fieldClass}`}
                      >
                        <option value="SUGERIDO">Precio sugerido</option>
                        <option value="BLANCO">Dejar en blanco</option>
                      </select>
                      {manualPriceMode === 'SUGERIDO' && (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={manualPriceValue}
                          onChange={(e) => setManualPriceValue(e.target.value)}
                          placeholder="0.00"
                          className={`w-24 ${fieldClass}`}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button type="button" onClick={handleAddManualItem}>
                    <Plus size={15} /> Añadir a la lista del pedido
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Tabla de artículos del pedido */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">Clave</th>
                  <th className="px-3 py-2.5">Producto</th>
                  <th className="px-2 py-2.5 text-center">Cant.</th>
                  <th className="px-2 py-2.5 text-right">Costo / Sug.</th>
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
                  orderItems.map((it) => {
                    const rowSubtotal = it.unitCost !== null ? it.quantity * it.unitCost : null;
                    return (
                      <tr key={it.id} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">{it.claveBienestar}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          <span>{it.name}</span>
                          {it.isManual && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              {it.isSuggestedPrice ? 'Extra · Sugerido' : 'Extra · Sin precio'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="number"
                            min={1}
                            value={it.quantity}
                            onChange={(e) => updateItemQty(it.id, Number(e.target.value))}
                            className="w-16 rounded border border-slate-200 px-2 py-1 text-center text-xs"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={it.unitCost === null ? '' : it.unitCost}
                              placeholder={it.isManual && it.unitCost === null ? 'Blanco' : '0.00'}
                              onChange={(e) => updateItemCost(it.id, e.target.value)}
                              className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-xs"
                            />
                            {it.isManual && (
                              <button
                                type="button"
                                onClick={() => toggleManualBlankPrice(it.id)}
                                className="rounded border border-slate-200 px-1.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
                                title="Alternar entre precio sugerido o dejar en blanco"
                              >
                                {it.unitCost === null ? 'Precio' : 'Blanco'}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="text"
                            value={it.cap}
                            onChange={(e) => updateItemField(it.id, 'cap', e.target.value)}
                            className="w-14 rounded border border-slate-200 px-1.5 py-1 text-center text-xs"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="text"
                            value={it.med}
                            onChange={(e) => updateItemField(it.id, 'med', e.target.value)}
                            className="w-14 rounded border border-slate-200 px-1.5 py-1 text-center text-xs"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="text"
                            value={it.gram}
                            onChange={(e) => updateItemField(it.id, 'gram', e.target.value)}
                            className="w-14 rounded border border-slate-200 px-1.5 py-1 text-center text-xs"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="text"
                            value={it.emp}
                            onChange={(e) => updateItemField(it.id, 'emp', e.target.value)}
                            className="w-14 rounded border border-slate-200 px-1.5 py-1 text-center text-xs"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">
                          {rowSubtotal !== null ? formatCurrency(rowSubtotal) : '—'}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(it.id)}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label="Eliminar artículo"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Totales y bonificación */}
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
            <div className="flex flex-col justify-center rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="text-xs text-slate-500">Piezas: {totalPiezas} · Subtotal</span>
              <span className="text-base font-bold text-slate-900">{formatCurrency(subtotalGeneral)}</span>
            </div>
            <div className="flex flex-col justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <span className="text-xs text-emerald-700">Bonificación ({safeBonus}%)</span>
              <span className="text-base font-bold text-emerald-800">{formatCurrency(gananciaBonificacion)}</span>
            </div>
          </div>
        </div>

        {/* Pie con botones de guardar borrador, guardar pedido y generar PDFs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            <Button type="button" variant="secondary" onClick={() => persistPedido('BORRADOR')}>
              <BookmarkCheck size={16} /> Guardar borrador
            </Button>
            <Button type="button" onClick={() => persistPedido('GUARDADO')}>
              <BookmarkCheck size={16} /> Guardar pedido
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={handleDownloadWarehousePdf}>
              <Printer size={16} /> PDF Almacén
            </Button>
            <Button type="button" onClick={handleDownloadInternalPdf}>
              <FileText size={16} /> PDF Control Interno
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
