import { Fragment, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { Field, Select } from '@/components/Field';
import { formatCurrency } from '@/lib/format';
import { groupProductsForReport, EMPTY_STOCK_REPORT_FILTERS } from '@/lib/stockReport';
import type { Branch, Category, Department, Location } from '@/lib/types';
import type { StockReportProduct, StockReportRow } from '@/lib/stockReport';

interface StockGroupedModalProps {
  open: boolean;
  onClose: () => void;
  products: StockReportProduct[];
  stockRows: StockReportRow[];
  departments: Department[];
  categories: Category[];
  locations: Location[];
  branches: Branch[];
}

export default function StockGroupedModal({ open, onClose, products, stockRows, departments, categories, locations, branches }: StockGroupedModalProps) {
  const [branchId, setBranchId] = useState('');

  const visibleBranches = useMemo(() => branches.filter((b) => !branchId || b.id === branchId), [branches, branchId]);
  const groups = useMemo(() => groupProductsForReport(products, departments, categories, EMPTY_STOCK_REPORT_FILTERS), [products, departments, categories]);
  const stockByKey = useMemo(() => new Map(stockRows.map((r) => [`${r.product_id}|${r.branch_id}`, r])), [stockRows]);
  const locationNameById = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const shortName = (name: string) => name.replace('BIENESTAR ', '');

  return (
    <Modal open={open} onClose={onClose} title="Todos los productos por departamento y categoría" size="xl">
      <div className="space-y-4">
        <div className="max-w-xs">
          <Field label="Sucursal">
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">Todas las sucursales</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        </div>

        {groups.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">No hay productos para mostrar.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Costo</th>
                  <th className="px-3 py-2 text-right">Venta</th>
                  {visibleBranches.map((b) => (
                    <Fragment key={b.id}>
                      <th className="px-3 py-2 text-right">Stock {shortName(b.name)}</th>
                      <th className="px-3 py-2">Ubicación {shortName(b.name)}</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((group) => (
                  <Fragment key={group.departmentName}>
                    <tr className="bg-emerald-50/70">
                      <td colSpan={3 + visibleBranches.length * 2} className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-emerald-800">{group.departmentName}</td>
                    </tr>
                    {group.categories.map((category) => (
                      <Fragment key={`${group.departmentName}-${category.categoryName}`}>
                        <tr className="bg-slate-50">
                          <td colSpan={3 + visibleBranches.length * 2} className="px-3 py-1.5 text-xs font-semibold text-slate-600">{category.categoryName} · {category.products.length} producto(s)</td>
                        </tr>
                        {category.products.map((product) => (
                          <tr key={product.id} className="hover:bg-slate-50/70">
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800">{product.name}</div>
                              <div className="text-xs text-slate-500">{product.sku ?? 'Sin SKU'}</div>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(product.cost_price)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-800">{formatCurrency(product.sale_price)}</td>
                            {visibleBranches.map((b) => {
                              const stock = stockByKey.get(`${product.id}|${b.id}`);
                              return (
                                <Fragment key={b.id}>
                                  <td className="px-3 py-2 text-right text-slate-700">{Number(stock?.quantity ?? 0)}</td>
                                  <td className="px-3 py-2 text-slate-600">{stock?.location_id ? locationNameById.get(stock.location_id) ?? '—' : '—'}</td>
                                </Fragment>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
