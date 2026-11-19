import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { saveOperationalNotification } from '@/lib/operationalNotifications';
import type { Product, Category, Location } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Input, Select } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner } from '@/components/ui';
import AuthorizationModal from '@/components/AuthorizationModal';
import BarcodeScanner from '@/components/BarcodeScanner';
import CategoryInventoryGrid from '@/components/inventory/CategoryInventoryGrid';
import CategoryCountPanel, { type CategoryCountView } from '@/components/inventory/CategoryCountPanel';
import CategoryScopePicker, { type CountScope } from '@/components/inventory/CategoryScopePicker';
import LocationStageHub from '@/components/inventory/LocationStageHub';
import AutoCountView from '@/components/inventory/AutoCountView';
import { AlertTriangle, CheckCircle2, Filter, ShieldAlert, ShieldCheck, SkipForward, XCircle, ScanLine, Layers, RotateCcw, ShoppingCart, Zap } from 'lucide-react';

interface InventorySession {
  id: string;
  branch_id: string;
  status: 'open' | 'authorization_requested' | 'closed';
  started_at: string;
  authorization_requested_at: string | null;
  completed_at: string | null;
}

interface InventoryCount {
  id: string;
  session_id: string;
  product_id: string;
  branch_id: string;
  theoretical: number;
  physical: number | null;
  difference: number | null;
  affected_by_operation: boolean;
  affected_quantity: number;
  last_operation_at: string | null;
  counted_at: string | null;
}

interface FunctionResponse {
  session?: InventorySession;
  counts?: InventoryCount[];
  expiresAt?: string;
  error?: string;
  success?: boolean;
}

type InventoryMode = 'scan' | 'category';

async function loadActiveProducts(): Promise<Product[]> {
  const products: Product[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('products').select('*, category:categories(*)').is('deleted_at', null).eq('active', true).eq('track_inventory', true).order('name').range(from, from + 999);
    if (error) throw error;
    products.push(...((data ?? []) as Product[]));
    if ((data ?? []).length < 1000) return products;
  }
}

const UNASSIGNED_STAGE = '__unassigned__';

type CountFilter = 'all' | 'positive' | 'negative' | 'affected' | 'matched' | 'pending';

const COUNT_FILTERS: Array<{ id: CountFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'positive', label: 'Diferencia positiva' },
  { id: 'negative', label: 'Diferencia negativa' },
  { id: 'affected', label: 'Afectados por venta' },
  { id: 'matched', label: 'Cuadrados' },
  { id: 'pending', label: 'Pendientes' },
];

const byProductName = (a: Product, b: Product) => a.name.localeCompare(b.name, 'es');

export default function InventoryAdjustmentPage() {
  const { branches, currentBranch, hasPermission } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [inventorySession, setInventorySession] = useState<InventorySession | null>(null);
  const [inventoryCounts, setInventoryCounts] = useState<InventoryCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<InventoryMode | null>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [categoryView, setCategoryView] = useState<CategoryCountView>('list');
  const [scope, setScope] = useState<CountScope | null>(null);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [recountAffected, setRecountAffected] = useState(false);
  const [validation, setValidation] = useState<{ status: 'idle' } | { status: 'recount'; count: number } | { status: 'ready'; recounted: boolean }>({ status: 'idle' });
  const [recountPrompt, setRecountPrompt] = useState<string[] | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [stockLocationByProduct, setStockLocationByProduct] = useState<Map<string, string>>(new Map());
  const [filterBranch, setFilterBranch] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [authorizationOpen, setAuthorizationOpen] = useState(false);
  const [closeWithoutValidation, setCloseWithoutValidation] = useState(false);
  const [countFilter, setCountFilter] = useState<CountFilter>('all');
  const [authError, setAuthError] = useState<string | null>(null);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<InventoryMode | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [scanInput, setScanInput] = useState('');
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const selectedBranchId = filterBranch || currentBranch?.id || '';
  const selectedBranch = useMemo(() => branches.find((branch) => branch.id === selectedBranchId) ?? currentBranch, [branches, selectedBranchId, currentBranch]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useMemo(() => ({ current: 0 as number }), []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, [toastTimer]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedProducts, categoriesRes, locationsRes] = await Promise.all([
        loadActiveProducts(),
        supabase.from('categories').select('*').order('name'),
        supabase.from('locations').select('*').eq('active', true).order('name'),
      ]);
      setProducts(loadedProducts);
      setCategories((categoriesRes.data as Category[]) ?? []);
      setLocations((locationsRes.data as Location[]) ?? []);
    } catch {
      setError('Ocurrió un error al cargar los productos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedBranchId) return;
    let cancelled = false;
    (async () => {
      const rows: { product_id: string; location_id: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('product_stock').select('product_id, location_id').eq('branch_id', selectedBranchId).not('location_id', 'is', null).range(from, from + 999);
        if (error) { if (!cancelled) setError('No se pudieron cargar las ubicaciones de la sucursal.'); return; }
        rows.push(...((data ?? []) as { product_id: string; location_id: string }[]));
        if ((data ?? []).length < 1000) break;
      }
      if (!cancelled) setStockLocationByProduct(new Map(rows.map((r) => [r.product_id, r.location_id])));
    })();
    return () => { cancelled = true; };
  }, [selectedBranchId]);

  useEffect(() => {
    if (!inventorySession?.started_at || inventorySession.status === 'closed' || !timerRunning) return;
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(inventorySession.started_at).getTime()) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [inventorySession, timerRunning]);

  const formatElapsed = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const startInventory = useCallback(async () => {
    if (!selectedBranchId) {
      setError('Selecciona una sucursal primero.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('authorize-inventory', { body: { action: 'start', branchId: selectedBranchId } });
      const response = data as FunctionResponse | null;
      if (fnError || !response?.session) {
        setError(response?.error ?? fnError?.message ?? 'No se pudo iniciar la sesión de inventario. Verifica tu conexión e intenta de nuevo.');
      } else {
        setInventorySession(response.session);
        setElapsedSeconds(0);
        setTimerRunning(true);
        setAuthorizationOpen(false);
        const rows = response.counts ?? [];
        setInventoryCounts(rows);
        setCounts(Object.fromEntries(rows.filter((row) => row.physical != null).map((row) => [row.product_id, String(row.physical)])));
      }
    } catch {
      setError('Ocurrió un error al iniciar el inventario.');
    } finally {
      setStarting(false);
    }
  }, [selectedBranchId]);

  const exitInventory = useCallback(() => {
    setMode(null);
    setInventorySession(null);
    setTimerRunning(false);
    setElapsedSeconds(0);
    setInventoryCounts([]);
    setCounts({});
    setFilterCat('');
    setCategoryView('list');
    setScope(null);
    setActiveStage(null);
    setCompletedStages([]);
    setRecountAffected(false);
    setValidation({ status: 'idle' });
    setSearch('');
    setScannedProduct(null);
    setScanInput('');
    setError(null);
  }, []);

  const selectMode = (selected: InventoryMode) => {
    setError(null);
    setPendingMode(selected);
    setStartConfirmOpen(true);
  };

  const confirmStartInventory = () => {
    if (!pendingMode) return;
    setMode(pendingMode);
    setCounts({});
    setScannedProduct(null);
    setScanInput('');
    setStartConfirmOpen(false);
    void startInventory();
  };

  const countMap = useMemo(() => new Map(inventoryCounts.map((row) => [row.product_id, row])), [inventoryCounts]);

  const categoryProducts = useMemo(() => (mode === 'category' && filterCat ? products.filter((product) => product.category_id === filterCat) : []), [products, mode, filterCat]);

  const stageDefinitions = useMemo(() => {
    const branchLocations = locations.filter((location) => location.branch_id === selectedBranchId);
    const stages = branchLocations
      .map((location) => ({ id: location.id, name: location.name, products: categoryProducts.filter((product) => stockLocationByProduct.get(product.id) === location.id) }))
      .filter((stage) => stage.products.length > 0);
    const unassigned = categoryProducts.filter((product) => !stockLocationByProduct.has(product.id));
    if (unassigned.length > 0) stages.push({ id: UNASSIGNED_STAGE, name: 'Sin ubicación asignada', products: unassigned });
    return stages;
  }, [locations, categoryProducts, stockLocationByProduct, selectedBranchId]);

  const activeLocationId = scope === 'location' && activeStage && activeStage !== UNASSIGNED_STAGE ? activeStage : undefined;

  const filtered = useMemo(() => {
    if (mode === 'scan') {
      return scannedProduct ? [scannedProduct] : [];
    }
    if (mode === 'category') {
      const inCategory = products.filter((product) => product.category_id === filterCat);
      if (scope !== 'location') return inCategory.sort(byProductName);
      return inCategory.filter((product) => (stockLocationByProduct.get(product.id) ?? UNASSIGNED_STAGE) === activeStage).sort(byProductName);
    }
    return [];
  }, [products, mode, scannedProduct, filterCat, scope, activeStage, stockLocationByProduct]);

  const getRow = (productId: string): InventoryCount | undefined => countMap.get(productId);
  const getTheoretical = (productId: string): number => getRow(productId)?.theoretical ?? 0;
  const isCounted = (productId: string): boolean => counts[productId] != null && counts[productId].trim() !== '';
  const getPhysical = (productId: string): number => Number(counts[productId] ?? 0);
  const getDifference = (productId: string): number => getPhysical(productId) - getTheoretical(productId);

  const pendingCount = useMemo(() => filtered.filter((product) => !isCounted(product.id)).length, [filtered, counts]);
  const affectedCount = useMemo(() => inventoryCounts.filter((row) => row.affected_by_operation && filtered.some((product) => product.id === row.product_id)).length, [inventoryCounts, filtered]);
  const affectedProducts = useMemo(() => {
    const affectedIds = new Set(inventoryCounts.filter((row) => row.affected_by_operation).map((row) => row.product_id));
    return products.filter((product) => affectedIds.has(product.id)).sort(byProductName);
  }, [inventoryCounts, products]);
  const matchedCount = useMemo(() => filtered.filter((product) => isCounted(product.id) && getDifference(product.id) === 0).length, [filtered, counts]);
  const mismatchCount = useMemo(() => filtered.filter((product) => isCounted(product.id) && getDifference(product.id) !== 0).length, [filtered, counts]);

  const visibleProducts = useMemo(() => (recountAffected ? filtered.filter((product) => getRow(product.id)?.affected_by_operation) : filtered), [filtered, recountAffected, inventoryCounts]);

  const listProducts = useMemo(() => visibleProducts.filter((product) => {
    if (countFilter === 'all') return true;
    if (countFilter === 'affected') return Boolean(getRow(product.id)?.affected_by_operation);
    if (countFilter === 'pending') return !isCounted(product.id);
    if (!isCounted(product.id)) return false;
    const difference = getDifference(product.id);
    if (countFilter === 'positive') return difference > 0;
    if (countFilter === 'negative') return difference < 0;
    return difference === 0;
  }), [visibleProducts, countFilter, counts, inventoryCounts]);

  useEffect(() => {
    if (affectedCount === 0) setRecountAffected(false);
  }, [affectedCount]);

  const toggleRecount = () => {
    if (recountAffected) {
      setRecountAffected(false);
      return;
    }
    const affectedIds = filtered.filter((product) => getRow(product.id)?.affected_by_operation).map((product) => product.id);
    setCounts((previous) => {
      const next = { ...previous };
      for (const id of affectedIds) delete next[id];
      return next;
    });
    setRecountAffected(true);
    setCategoryView('auto');
  };

  const scannedProductIds = useMemo(() => {
    if (mode !== 'scan') return null;
    const ids = new Set<string>();
    for (const id of Object.keys(counts)) {
      if (counts[id].trim() !== '') ids.add(id);
    }
    return ids.size > 0 ? Array.from(ids) : null;
  }, [mode, counts]);

  const resetSelection = async () => {
    if (!inventorySession) return;
    const selectionIds = mode === 'scan' ? scannedProductIds ?? [] : filtered.map((product) => product.id);
    if (selectionIds.length === 0) return;
    const selectionName = mode === 'scan' ? 'los productos escaneados' : `la selección de ${categories.find((category) => category.id === filterCat)?.name ?? 'esta categoría'}`;
    if (!window.confirm(`¿Abortar ${selectionName}? Solo se borrarán los conteos de estos productos; los demás conteos se conservan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('authorize-inventory', { body: { action: 'reset_selection', sessionId: inventorySession.id, productIds: selectionIds } });
      const response = data as FunctionResponse | null;
      if (functionError || !response?.success) {
        setError(response?.error ?? functionError?.message ?? 'No se pudo abortar la selección.');
        return;
      }
      const resetIds = new Set(selectionIds);
      setCounts((previous) => {
        const next = { ...previous };
        for (const id of resetIds) delete next[id];
        return next;
      });
      setInventoryCounts((previous) => previous.map((row) => (resetIds.has(row.product_id) ? { ...row, physical: null, difference: null, counted_at: null, affected_by_operation: false, affected_quantity: 0, last_operation_at: null } : row)));
      setRecountAffected(false);
      setValidation({ status: 'idle' });
      setScannedProduct(null);
      setScanInput('');
      setCountFilter('all');
      setCategoryView('list');
      setScope(null);
      setActiveStage(null);
      showToast('Selección abortada. Los demás conteos se conservan.');
    } catch {
      setError('No se pudo abortar la selección. Revisa tu conexión.');
    } finally {
      setSaving(false);
    }
  };

  const savePhysical = async (productId: string, rawValue?: string): Promise<boolean> => {
    const value = (rawValue ?? counts[productId] ?? '').trim();
    if (!inventorySession || value === '') return false;
    const physical = Number(value);
    if (!Number.isFinite(physical) || physical < 0) {
      setError('La existencia física debe ser un número válido.');
      return false;
    }
    try {
      const { data, error: functionError } = await supabase.functions.invoke('authorize-inventory', {
        body: { action: 'save_count', sessionId: inventorySession.id, productId, physical },
      });
      const response = data as FunctionResponse | null;
      if (functionError || response?.error) {
        setError(response?.error ?? 'No se pudo guardar el conteo.');
        return false;
      }
      showToast('Conteo guardado');
      setValidation((previous) => (previous.status === 'ready' ? { status: 'idle' } : previous));
      return true;
    } catch {
      setError('No se pudo guardar el conteo. Revisa tu conexión.');
      return false;
    }
  };

  const handleScan = (codeArg?: string) => {
    const code = (codeArg ?? scanInput).trim().toLowerCase();
    if (!code) return;
    const found = products.find((product) =>
      (product.barcode ?? '').toLowerCase() === code ||
      (product.barcode_2 ?? '').toLowerCase() === code ||
      (product.sku ?? '').toLowerCase() === code
    );
    if (found) {
      setScannedProduct(found);
      setScanInput('');
      setError(null);
      showToast(`Producto: ${found.name}`);
    } else {
      setError('No se encontró ningún producto con ese código.');
      setScannedProduct(null);
    }
  };


  const recordInventoryNotification = () => {
    const countedRows = inventoryCounts.filter((row) => isCounted(row.product_id));
    const discrepancies = countedRows.filter((row) => getDifference(row.product_id) !== 0);
    const message = `${countedRows.length} productos contados | ${discrepancies.length} discrepancias | Sucursal: ${selectedBranch?.name ?? '—'}`;
    void saveOperationalNotification({
      type: 'inventory_alert',
      title: 'Inventario autorizado y guardado',
      message,
      branchId: selectedBranchId,
      metadata: {
        sessionId: inventorySession?.id ?? null,
        counted: countedRows.length,
        discrepancies: discrepancies.length,
        discrepancyProducts: discrepancies.map((row) => ({ productId: row.product_id, difference: getDifference(row.product_id) })),
      },
    }).then((saved) => {
      if (!saved) showToast('Inventario guardado; no se pudo registrar la notificación.');
    });
  };

  const closeAllOpenSessions = async () => {
    if (!window.confirm('¿Cerrar todos los inventarios abiertos de todas las sucursales? Se borrarán sus conteos en proceso.')) return;
    setSaving(true);
    setError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('authorize-inventory', { body: { action: 'close_all_sessions' } });
      const response = data as (FunctionResponse & { cancelled?: number }) | null;
      if (functionError || !response?.success) {
        setError(response?.error ?? functionError?.message ?? 'No se pudieron cerrar los inventarios abiertos.');
        return;
      }
      exitInventory();
      showToast(`Se cerraron ${response.cancelled ?? 0} inventario(s) abierto(s).`);
    } catch {
      setError('No se pudieron cerrar los inventarios abiertos. Revisa tu conexión.');
    } finally {
      setSaving(false);
    }
  };

  const reloadInventoryCounts = async (sessionId: string) => {
    const { data, error: fnError } = await supabase.functions.invoke('authorize-inventory', { body: { action: 'get', sessionId } });
    const response = data as FunctionResponse | null;
    if (fnError || !response?.session || !Array.isArray(response.counts)) throw new Error(response?.error ?? 'No se pudo actualizar el inventario.');
    const rows = response.counts;
    setInventoryCounts(rows);
    setCounts(Object.fromEntries(rows.filter((row) => row.physical != null).map((row) => [row.product_id, String(row.physical)])));
  };

  const autoCountSelection = async () => {
    if (!inventorySession) return;
    if (!window.confirm(`Se marcarán ${selectionProductIds.length} producto(s) como contados con la existencia actual del sistema. ¿Continuar?`)) return;
    setSaving(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('authorize-inventory', { body: { action: 'auto_count_all', sessionId: inventorySession.id, productIds: selectionProductIds } });
      const response = data as FunctionResponse | null;
      if (fnError || !response?.success) {
        setError(response?.error ?? 'No se pudo contar la selección automáticamente.');
        return;
      }
      await reloadInventoryCounts(inventorySession.id);
      showToast('Selección contada con la existencia del sistema');
    } catch (caughtError) {
      setError(caughtError instanceof Error && caughtError.message ? caughtError.message : 'No se pudo contar la selección. Revisa tu conexión.');
    } finally {
      setSaving(false);
    }
  };

  const startCloseWithoutValidation = async () => {
    if (!inventorySession) return;
    if (!window.confirm(`Se omitirán ${pendingCount} producto(s) pendiente(s) de la selección y solo se ajustarán los contados. Se pedirá el token de autorización para continuar.`)) return;
    const unsavedIds = selectionProductIds.filter((id) => getRow(id)?.physical == null && (counts[id] ?? '').trim() !== '');
    for (const id of unsavedIds) {
      if (!(await savePhysical(id, counts[id]))) return;
    }
    setAuthError(null);
    setCloseWithoutValidation(true);
    setAuthorizationOpen(true);
  };

  const requestAuthorization = () => {
    if (!inventorySession) return;
    setAuthError(null);
    setAuthorizationOpen(true);
  };

  const validateSelection = async () => {
    if (!inventorySession) return;
    if (pendingCount > 0) {
      setError(`Faltan ${pendingCount} producto(s) por contar. Completa el conteo antes de validar.`);
      setValidation({ status: 'idle' });
      return;
    }
    setError(null);
    setAuthError(null);
    const checkedIds = mode === 'scan' ? scannedProductIds ?? [] : filtered.map((product) => product.id);
    setSaving(true);
    try {
      const unsavedIds = checkedIds.filter((id) => getRow(id)?.physical == null && (counts[id] ?? '').trim() !== '');
      for (const id of unsavedIds) {
        if (!(await savePhysical(id, counts[id]))) return;
      }
      const { data, error: functionError } = await supabase.functions.invoke('authorize-inventory', {
        body: { action: 'check_affected', sessionId: inventorySession.id, productIds: checkedIds },
      });
      const response = data as { success?: boolean; affectedProductIds?: string[]; error?: string } | null;
      if (functionError || !response || response.error || !Array.isArray(response.affectedProductIds)) {
        setError(response?.error ?? functionError?.message ?? 'No se pudo verificar las ventas durante el conteo.');
        return;
      }
      const affectedSet = new Set(response.affectedProductIds);
      const checkedSet = new Set(checkedIds);
      setInventoryCounts((previous) => previous.map((row) => (checkedSet.has(row.product_id) ? { ...row, affected_by_operation: affectedSet.has(row.product_id) } : row)));
      if (affectedSet.size > 0) {
        setRecountPrompt(Array.from(affectedSet));
        return;
      }
      setValidation({ status: 'ready', recounted: validation.status === 'recount' });
    } finally {
      setSaving(false);
    }
  };

  const startRecount = (affectedIds: string[]) => {
    const affectedSet = new Set(affectedIds);
    setRecountPrompt(null);
    setCounts((previous) => {
      const next = { ...previous };
      for (const id of affectedSet) delete next[id];
      return next;
    });
    setRecountAffected(mode === 'category');
    if (mode === 'category') setCategoryView('auto');
    setValidation({ status: 'recount', count: affectedSet.size });
  };

  useEffect(() => {
    if (validation.status === 'recount' && pendingCount === 0 && !saving) void validateSelection();
  }, [validation.status, pendingCount]);

  const selectionProductIds = mode === 'scan' ? scannedProductIds ?? [] : filtered.map((product) => product.id);

  const authorizationPayload = useMemo(() => {
    if (!inventorySession) return null;
    const countedRows = inventoryCounts.filter((row) => isCounted(row.product_id));
    const discrepancies = countedRows.filter((row) => getDifference(row.product_id) !== 0);
    const summary = `${countedRows.length} productos contados · ${discrepancies.length} discrepancias · ${selectedBranch?.name ?? 'Sucursal'}${closeWithoutValidation ? ` · Cierre sin validar (${pendingCount} omitidos)` : ''}`;
    const items = filtered.map((product) => ({
      productId: product.id,
      name: product.name,
      theoretical: getTheoretical(product.id),
      physical: getPhysical(product.id),
      difference: getDifference(product.id),
    }));
    return {
      operationType: 'inventory' as const,
      branchId: inventorySession.branch_id,
      summary,
      payload: {
        sessionId: inventorySession.id,
        mode,
        categoryId: mode === 'category' ? filterCat : undefined,
        locationId: activeLocationId,
        productIds: selectionProductIds,
        items,
      },
    };
  }, [inventorySession, inventoryCounts, filtered, mode, filterCat, activeLocationId, scannedProductIds, selectedBranch, selectionProductIds, closeWithoutValidation, pendingCount]);

  const applyAuthorized = async (authRequest: { id: string }) => {
    if (!inventorySession) return;
    setSaving(true);
    setAuthError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('authorize-inventory', {
        body: {
          action: 'apply_authorized',
          sessionId: inventorySession.id,
          authorizationId: authRequest.id,
          mode,
          categoryId: mode === 'category' ? filterCat : undefined,
          locationId: activeLocationId,
          productIds: selectionProductIds,
          skipPending: closeWithoutValidation,
        },
      });
      const response = data as (FunctionResponse & { affectedProductIds?: string[] }) | null;
      if (functionError || response?.error) {
        const message = response?.error ?? functionError?.message ?? 'No se pudo aplicar el inventario autorizado.';
        const affectedIds = new Set(response?.affectedProductIds ?? []);
        if (affectedIds.size > 0) {
          setInventoryCounts((previous) => previous.map((row) => (affectedIds.has(row.product_id) ? { ...row, affected_by_operation: true } : row)));
        }
        setAuthError(message);
        throw new Error(message);
      } else {
        setAuthorizationOpen(false);
        setCloseWithoutValidation(false);
        setValidation({ status: 'idle' });
        recordInventoryNotification();
        if (scope === 'location' && activeStage) {
          const nextCompleted = [...completedStages, activeStage];
          setCompletedStages(nextCompleted);
          setInventorySession(null);
          setInventoryCounts([]);
          setCounts({});
          setTimerRunning(false);
          setActiveStage(null);
          if (stageDefinitions.every((stage) => nextCompleted.includes(stage.id))) {
            showToast(closeWithoutValidation ? 'Inventario actualizado con éxito' : 'Inventario guardado con éxito');
            exitInventory();
          } else {
            showToast('Ubicación guardada. Elige la siguiente ubicación para continuar.');
          }
        } else {
          showToast(closeWithoutValidation ? 'Inventario actualizado con éxito' : 'Inventario guardado con éxito');
          exitInventory();
        }
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error && caughtError.message ? caughtError.message : 'No se pudo aplicar el inventario autorizado. Revisa tu conexión e intenta de nuevo.';
      setAuthError(message);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  };

  // Location hub between saved locations
  if (mode === 'category' && filterCat && scope === 'location' && !inventorySession) {
    return (
      <LocationStageHub
        categoryName={categories.find((category) => category.id === filterCat)?.name ?? ''}
        stages={stageDefinitions.map((stage) => ({ id: stage.id, name: stage.name, total: stage.products.length, done: completedStages.includes(stage.id) }))}
        starting={starting}
        error={error}
        onStart={(stageId) => { setActiveStage(stageId); void startInventory(); }}
        onExit={exitInventory}
      />
    );
  }

  // Method selection screen
  if (!mode || !inventorySession) {
    return (
      <div className="device-page p-6">
        <PageHeader
          title="Ajuste de Inventario"
          subtitle={`${selectedBranch?.name ?? ''} · Selecciona el método de conteo`}
          actions={hasPermission('settings') ? <Button variant="secondary" onClick={() => void closeAllOpenSessions()} disabled={saving}><ShieldAlert size={16} /> Cerrar todos los inventarios abiertos</Button> : undefined}
        />

        {error && <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-600" /><span>{error}</span></div>}
        {starting && <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800"><Spinner size={18} /> Preparando el inventario y cargando existencias...</div>}

        <div className="mb-6 max-w-xs">
          <Select value={filterBranch} onChange={(event) => setFilterBranch(event.target.value)}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Scan mode */}
          <div className="group flex flex-col items-center rounded-2xl border-2 border-slate-200 bg-white p-8 text-center transition hover:border-blue-400 hover:shadow-lg">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
              <ScanLine size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-800">Escaneo</h3>
            <p className="mt-2 text-sm text-slate-500">Escanea o captura el código de barras de cada producto para contarlo individualmente, igual que en la pantalla de venta.</p>
            <Button className="mt-4 w-full" onClick={() => selectMode('scan')} disabled={starting}>Iniciar conteo</Button>
          </div>

          {/* Category mode */}
          <div className="flex flex-col items-center rounded-2xl border-2 border-slate-200 bg-white p-8 text-center transition hover:border-amber-400 hover:shadow-lg">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600">
              <Layers size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-800">Por Categoría</h3>
            <p className="mt-2 text-sm text-slate-500">Elige la categoría y cuéntala completa o por ubicación, con su vista automática.</p>
            <Button className="mt-4 w-full" onClick={() => selectMode('category')} disabled={starting}>
              Iniciar conteo
            </Button>
          </div>
        </div>

        <Modal open={startConfirmOpen} onClose={() => setStartConfirmOpen(false)} title="Confirmar inicio de inventario" size="sm">
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">¿Deseas iniciar el inventario en este momento?</p>
              <p className="mt-2">El cronómetro comenzará al aceptar y permanecerá visible durante todo el conteo.</p>
              <p className="mt-2 font-medium">Método: {pendingMode === 'scan' ? 'Escaneo' : 'Por Categoría'}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStartConfirmOpen(false)}>Cancelar</Button>
              <Button onClick={confirmStartInventory} disabled={starting}>Sí, iniciar inventario</Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // Counting screen
  return (
    <div className="device-page p-6">
      <div className="mb-4 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-800"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-600" /> Tiempo transcurrido</div>
        <div className="font-mono text-xl font-bold tracking-wider text-blue-900">{formatElapsed(elapsedSeconds)}</div>
      </div>
      <Modal open={recountPrompt !== null} onClose={() => setRecountPrompt(null)} title="Productos afectados por venta" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">Hay <span className="font-semibold">{recountPrompt?.length ?? 0}</span> producto(s) vendidos durante el conteo. ¿Deseas reiniciar el reconteo de esos productos?</p>
          <p className="text-xs text-slate-500">Se abrirá la vista automática solo con esos productos. Al contar el último, se activará "Guardar y autorizar".</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRecountPrompt(null)}>Más tarde</Button>
            <Button onClick={() => startRecount(recountPrompt ?? [])}>Reiniciar reconteo</Button>
          </div>
        </div>
      </Modal>

      <PageHeader
        title="Ajuste de Inventario"
        subtitle={`${selectedBranch?.name ?? ''} · ${mode === 'scan' ? 'Escaneo' : filterCat ? `Categoría: ${categories.find((c) => c.id === filterCat)?.name ?? ''}` : 'Por categoría'}`}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={exitInventory}><RotateCcw size={16} /> Cambiar método</Button>
            <Button variant="secondary" onClick={() => void resetSelection()} disabled={saving || (mode === 'scan' ? !scannedProductIds : filtered.length === 0)}><XCircle size={16} /> Abortar selección</Button>
            {pendingCount > 0 && hasPermission('settings') && <Button variant="secondary" onClick={() => void autoCountSelection()} disabled={saving || inventorySession?.status === 'closed'}><Zap size={16} /> {saving ? 'Contando...' : 'Auto contar todo'}</Button>}
            {pendingCount > 0 && <Button variant="secondary" onClick={() => void startCloseWithoutValidation()} disabled={saving || inventorySession?.status === 'closed' || filtered.length === pendingCount || (mode === 'category' && !filterCat)}><SkipForward size={16} /> Cerrar sin validar</Button>}
            {validation.status === 'ready' ? (
              <Button onClick={requestAuthorization} disabled={saving || inventorySession?.status === 'closed'}><ShieldCheck size={16} /> Guardar y autorizar</Button>
            ) : (
              <Button onClick={() => void validateSelection()} disabled={saving || inventorySession?.status === 'closed' || (mode === 'category' && !filterCat)}><CheckCircle2 size={16} /> {saving ? 'Validando...' : 'Validar inventario'}</Button>
            )}
          </div>
        }
      />

      {error && <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-600" /><span>{error}</span></div>}

      {validation.status === 'recount' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-blue-600" /><span>Hay {validation.count} producto(s) afectados por venta durante el conteo. Vuelve a contar solo esos productos y, al terminar, presiona "Validar inventario".</span></div>
      )}
      {validation.status === 'ready' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-emerald-600" /><span>{validation.recounted ? 'Reconteo terminado con éxito. Ya puedes presionar "Guardar y autorizar".' : 'Validación exitosa: todo está contado y sin afectaciones por venta. Ya puedes presionar "Guardar y autorizar".'}</span></div>
      )}

      {affectedProducts.length > 0 && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-blue-600" />Producto con afectación por venta ({affectedProducts.length})</div>
          <p className="mb-3 text-xs text-blue-700">Estos productos se vendieron durante el conteo. Vuelve a contarlos y, al terminar, presiona "Guardar y autorizar" otra vez.</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {affectedProducts.map((product) => (
              <li key={product.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-words">{product.name}</span>
                <span className="flex-shrink-0 font-mono text-xs text-blue-700">{product.barcode ?? product.sku ?? ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'scan' && (
        <Card className="mb-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Escanear o capturar código</label>
              <div className="flex gap-2">
                <input
                  ref={scanRef}
                  type="text"
                  value={scanInput}
                  onChange={(event) => setScanInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') handleScan(); }}
                  placeholder="Escanee código de barras o escriba SKU..."
                  className="w-full rounded-lg border border-slate-300 py-2.5 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  autoFocus
                />
                <button type="button" onClick={() => setScannerOpen(true)} title="Escanear con la cámara" className="flex-shrink-0 rounded-lg bg-blue-600 px-3 text-white transition hover:bg-blue-700"><ScanLine size={18} /></button>
                <Button onClick={() => handleScan()}>Buscar</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {mode === 'category' && !filterCat ? (
        <CategoryInventoryGrid
          categories={categories}
          products={products}
          isCounted={isCounted}
          onSelect={(categoryId) => { setFilterCat(categoryId); setSearch(''); setCategoryView('list'); setScope(null); setActiveStage(null); }}
        />
      ) : mode === 'category' && !scope ? (
        <CategoryScopePicker
          categoryName={categories.find((category) => category.id === filterCat)?.name ?? ''}
          total={categoryProducts.length}
          locationNames={stageDefinitions.filter((stage) => stage.id !== UNASSIGNED_STAGE).map((stage) => stage.name)}
          onSelect={(chosen) => setScope(chosen)}
          onBack={() => { setFilterCat(''); setScope(null); setActiveStage(null); }}
        />
      ) : (
      <>
      {mode === 'category' && (
        <CategoryCountPanel
          categoryName={categories.find((category) => category.id === filterCat)?.name ?? ''}
          total={filtered.length}
          counted={filtered.filter((product) => isCounted(product.id)).length}
          view={categoryView}
          onViewChange={setCategoryView}
          onChangeCategory={() => { setFilterCat(''); setScope(null); setActiveStage(null); setRecountAffected(false); setCategoryView('list'); }}
          stages={scope === 'location' ? stageDefinitions.map((stage) => ({ id: stage.id, name: stage.name, total: stage.products.length, counted: completedStages.includes(stage.id) ? stage.products.length : stage.products.filter((product) => isCounted(product.id)).length })) : null}
          activeStage={activeStage}
          onSelectStage={(stageId) => { setActiveStage(stageId); setSearch(''); }}
          affectedCount={affectedCount}
          recountAffected={recountAffected}
          onToggleRecount={toggleRecount}
        />
      )}

      {mode !== 'scan' && categoryView === 'list' && (
        <div className="mb-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar dentro de la lista..." />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm"><CheckCircle2 size={16} className="text-emerald-600" /><span className="font-semibold text-emerald-700">{matchedCount}</span><span className="text-slate-500">cuadrados</span></div>
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm"><XCircle size={16} className="text-red-600" /><span className="font-semibold text-red-700">{mismatchCount}</span><span className="text-slate-500">discrepancias</span></div>
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm"><AlertTriangle size={16} className="text-amber-600" /><span className="font-semibold text-amber-700">{pendingCount}</span><span className="text-slate-500">pendientes</span></div>
        {affectedCount > 0 && <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm"><AlertTriangle size={16} className="text-blue-600" /><span className="font-semibold text-blue-700">{affectedCount}</span><span className="text-slate-500">afectados por caja</span></div>}
      </div>

      {filtered.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {COUNT_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setCountFilter(option.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${countFilter === option.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'category' && categoryView === 'auto' ? (
        <AutoCountView
          products={listProducts}
          counts={counts}
          theoreticalOf={getTheoretical}
          onSave={async (productId, value) => {
            const saved = await savePhysical(productId, value);
            if (saved) {
              setCounts((previous) => ({ ...previous, [productId]: value }));
              setInventoryCounts((previous) => previous.map((row) => (row.product_id === productId ? { ...row, affected_by_operation: false, affected_quantity: 0 } : row)));
            }
            return saved;
          }}
          onGoToProducts={() => window.dispatchEvent(new CustomEvent('app-navigate', { detail: 'products' }))}
        />
      ) : (
      <Card className="mb-4 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title={mode === 'scan' ? 'Escanea un producto' : 'Sin productos'}
            description={mode === 'scan' ? 'Usa el escáner o escribe un código arriba para empezar a contar.' : 'No hay productos para el filtro seleccionado.'}
            icon={mode === 'scan' ? <ScanLine size={48} /> : <Filter size={48} />}
          />
        ) : (
          <>
            <div className="device-desktop-only hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Producto</th><th className="px-4 py-3">Código de barras</th><th className="px-4 py-3 text-right">Existencia teórica</th><th className="px-4 py-3 text-right">Existencia física</th><th className="px-4 py-3 text-right">Diferencia</th><th className="px-4 py-3 text-center">Estado</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{listProducts.map((product) => {
                  const row = getRow(product.id); const filled = isCounted(product.id); const difference = getDifference(product.id); const affected = row?.affected_by_operation;
                  return <tr key={product.id} className={affected ? 'bg-blue-50/40' : difference < 0 ? 'bg-red-50/30' : difference > 0 ? 'bg-emerald-50/30' : ''}>
                    <td className="px-4 py-3"><div className="font-medium text-slate-800">{product.name}</div><div className="text-xs text-slate-400">{product.sku ?? 'Sin SKU'} · {product.unit}</div></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{product.barcode ?? product.barcode_2 ?? 'Sin código'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{getTheoretical(product.id)}</td>
                    <td className="px-4 py-3 text-right"><Input type="number" min="0" step={product.bulk ? '0.001' : '1'} className="w-24 text-right" value={counts[product.id] ?? ''} onChange={(event) => setCounts({ ...counts, [product.id]: event.target.value })} onBlur={() => savePhysical(product.id)} placeholder="0" disabled={inventorySession?.status === 'closed'} /></td>
                    <td className={`px-4 py-3 text-right font-semibold ${affected ? 'text-blue-700' : !filled ? 'text-amber-600' : difference < 0 ? 'text-red-600' : difference > 0 ? 'text-emerald-600' : 'text-slate-600'}`}>{filled ? (difference > 0 ? '+' : '') + difference : 'Pendiente'}</td>
                    <td className="px-4 py-3 text-center text-xs font-medium">{affected ? <span className="text-blue-700">Producto con afectación por venta</span> : filled ? difference === 0 ? <span className="text-emerald-600">Cuadrado</span> : <span className="text-slate-600">Revisar</span> : <span className="text-amber-600">Pendiente</span>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="device-mobile-only hidden divide-y divide-slate-100">{listProducts.map((product) => {
              const row = getRow(product.id); const filled = isCounted(product.id); const difference = getDifference(product.id); const affected = row?.affected_by_operation;
              return <article key={product.id} className={`p-3 ${affected ? 'bg-blue-50/40' : difference < 0 ? 'bg-red-50/30' : difference > 0 ? 'bg-emerald-50/30' : 'bg-white'}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="break-words text-sm font-semibold leading-5 text-slate-800">{product.name}</div><div className="mt-0.5 text-xs text-slate-500">{product.department ?? 'Sin departamento'} · {product.sku ?? 'Sin SKU'} · {product.unit}</div><div className="mt-1 font-mono text-xs text-blue-700">Código: {product.barcode ?? product.barcode_2 ?? 'Sin código'}</div></div>{affected ? <span className="flex-shrink-0 text-xs font-medium text-blue-700">Producto con afectación por venta</span> : !filled ? <span className="flex-shrink-0 text-xs font-medium text-amber-600">Pendiente</span> : difference === 0 ? <CheckCircle2 size={20} className="flex-shrink-0 text-emerald-600" /> : difference < 0 ? <XCircle size={20} className="flex-shrink-0 text-red-600" /> : <CheckCircle2 size={20} className="flex-shrink-0 text-emerald-600" />}</div>
                <div className="mt-2 space-y-2 text-xs"><div className="flex items-center justify-between border-t border-slate-100 pt-2"><span className="text-slate-400">Existencia teórica</span><span className="font-semibold text-slate-700">{getTheoretical(product.id)}</span></div><label className="flex items-center justify-between gap-3"><span className="text-slate-400">Existencia física</span><Input type="number" min="0" step={product.bulk ? '0.001' : '1'} className="h-9 w-28 text-right" value={counts[product.id] ?? ''} onChange={(event) => setCounts({ ...counts, [product.id]: event.target.value })} onBlur={() => savePhysical(product.id)} placeholder="0" /></label><div className="flex items-center justify-between"><span className="text-slate-400">Diferencia</span><span className={`font-semibold ${affected ? 'text-blue-700' : !filled ? 'text-amber-600' : difference < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{filled ? (difference > 0 ? '+' : '') + difference : 'Pendiente'}</span></div></div>
              </article>;
            })}</div>
          </>
        )}
      </Card>
      )}
      </>
      )}

      {pendingCount > 0 && <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" /><span>Faltan {pendingCount} producto(s) por contar antes de poder cerrar el inventario.</span></div>}
      {authError && <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-600" /><span>{authError}</span></div>}

      <AuthorizationModal
        open={authorizationOpen}
        onClose={() => { setAuthorizationOpen(false); setCloseWithoutValidation(false); }}
        payload={authorizationPayload}
        onAuthorized={applyAuthorized}
        onRequestCreated={() => setTimerRunning(false)}
      />

      {toast && <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl bg-emerald-600 px-5 py-3 text-white shadow-lg shadow-emerald-600/20 animate-in fade-in slide-in-from-bottom-2 duration-300"><CheckCircle2 size={20} className="flex-shrink-0" /><span className="font-medium">{toast}</span></div>}

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetect={(code) => { setScanInput(code); handleScan(code); }}
        title="Escanear producto"
      />
    </div>
  );
}
