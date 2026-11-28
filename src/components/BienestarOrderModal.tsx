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

  const suggestions = useMemo(() => {
    const q = searchInput.trim();
    if (!q) return [];
    return products
      .filter((p) =>
        matchesQuery(q, p.name, p.barcode ?? '', p.barcode_2 ?? '', p.sku ?? '')
      )
      .slice(0, 8);
  }, [products, searchInput]);

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

    const unitCost = Number(selectedProduct.cost_price) || 0
