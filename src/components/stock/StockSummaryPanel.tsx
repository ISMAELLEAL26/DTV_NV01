import { useEffect, useMemo, useState } from 'react';
import { Boxes, Coins, Eye, RefreshCw, TrendingUp, Warehouse } from 'lucide-react';
import MultiSelectFilter from '@/components/stock/MultiSelectFilter';
import StockGroupedModal from '@/components/stock/StockGroupedModal';
import { formatCurrency } from '@/lib/format';
import {
  EMPTY_STOCK_REPORT_FILTERS,
  computeStockSummary,
  fetchOwnerStockReport,
  locationOptionLabel,
  type StockReportData,
  type StockReportFilters,
} from '@/lib/stockReport';
import type { Branch, Category, Department, Location } from '@/lib/types';

interface StockSummaryPanelProps {
  refreshKey: number;
  departments: Department[];
  categories: Category[];
  locations: Location[];
  branches: Branch[];
}

export default function StockSummaryPanel({ refreshKey, departments, categories, locations, branches }: StockSummaryPanelProps) {
  const [filters, setFilters] = useState<StockReportFilters>(EMPTY_STOCK_REPORT_FILTERS);
  const [groupedOpen, setGroupedOpen] = useState(false);
  const [report, setReport] = useState<StockReportData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchOwnerStockReport()
      .then((data) => { if (!cancelled) setReport(data); })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error(err);
        setLoadError(err instanceof Error ? err.message : 'No se pudo cargar el resumen');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey, attempt]);

  const summary = useMemo(
    () => (report ? computeStockSummary(report.products, report.stockRows, filters) : null),
    [report, filters],
  );

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '';
  const departmentOptions = departments.map((d) => ({ value: d.code, label: d.name }));
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));
  const locationOptions = locations.filter((l) => l.active).map((l) => ({ value: l.id, label: locationOptionLabel(l, branchName(l.branch_id)) }));

  const metrics = summary
    ? [
        { label: 'Productos', value: summary.productCount.toLocaleString('es-MX'), icon: Boxes, tone: 'bg-slate-100 text-slate-700' },
        { label: 'Costo en stock', value: formatCurrency(summary.costValue), icon: Coins, tone: 'bg-blue-50 text-blue-700' },
        { label: 'Ganancia potencial', value: formatCurrency(summary.potentialProfit), icon: TrendingUp, tone: 'bg-emerald-50 text-emerald-700' },
        { label: 'Stock a precio de venta', value: formatCurrency(summary.stockTotal), icon: Warehouse, tone: 'bg-amber-50 text-amber-700' },
      ]
    : [];

  const toggleBranch = (branchId: string) => {
    const branchIds = filters.branchIds.includes(branchId)
      ? filters.branchIds.filter((id) => id !== branchId)
      : [...filters.branchIds, branchId];
    setFilters({ ...filters, branchIds });
  };

  const hasFilters = Object.values(filters).some((values) => values.length > 0);

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">Resumen de inventario</h2>
          <p className="text-xs text-slate-500">Visible solo para el administrador. Las cifras cambian según los filtros.</p>
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button type="button" onClick={() => setFilters(EMPTY_STOCK_REPORT_FILTERS)} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100">
              Limpiar filtros
            </button>
          )}
          <button type="button" disabled={!report} onClick={() => setGroupedOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
            <Eye size={16} /> Ver todos
          </button>
        </div>
      </div>

      {!loading && report && (
        <div role="group" aria-label="Filtrar por sucursal" className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={filters.branchIds.length === 0}
            onClick={() => setFilters({ ...filters, branchIds: [] })}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${filters.branchIds.length === 0 ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-400 hover:text-emerald-700'}`}
          >
            Todas
          </button>
          {branches.map((branch) => {
            const active = filters.branchIds.includes(branch.id);
            return (
              <button
                key={branch.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleBranch(branch.id)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${active ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-400 hover:text-emerald-700'}`}
              >
                {branch.name}
              </button>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><RefreshCw size={16} className="animate-spin" /> Cargando resumen...</div>
      )}

      {!loading && loadError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>No se pudo cargar el resumen de inventario. {loadError}</span>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100">Reintentar</button>
        </div>
      )}

      {!loading && summary && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${metric.tone}`}><metric.icon size={15} /></span>
                  {metric.label}
                </div>
                <div className="mt-2 break-words text-lg font-bold text-slate-900">{metric.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MultiSelectFilter label="Departamento" options={departmentOptions} selected={filters.departmentCodes} onChange={(departmentCodes) => setFilters({ ...filters, departmentCodes })} />
            <MultiSelectFilter label="Categoría" options={categoryOptions} selected={filters.categoryIds} onChange={(categoryIds) => setFilters({ ...filters, categoryIds })} />
            <MultiSelectFilter label="Ubicación" options={locationOptions} selected={filters.locationIds} onChange={(locationIds) => setFilters({ ...filters, locationIds })} />
          </div>
        </>
      )}

      {report && (
        <StockGroupedModal
          open={groupedOpen}
          onClose={() => setGroupedOpen(false)}
          products={report.products}
          stockRows={report.stockRows}
          departments={departments}
          categories={categories}
          locations={locations}
          branches={branches}
        />
      )}
    </section>
  );
}
