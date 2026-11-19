import { useMemo, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { downloadXLSXTemplate, readSpreadsheet } from '@/lib/excel';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import type { Branch, Category, Location, Product, ProductBranchPrice, ProductStock } from '@/lib/types';
import { buildMassUpdateHeaders, buildMassUpdateTemplateRows, evaluateMassUpdate, type MassUpdateRow } from '@/lib/productMassUpdate';
import { buildBranchPriceRows, upsertBranchPriceRows } from '@/lib/branchPrices';

interface ProductMassUpdateModalProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  categories: Category[];
  locations: Location[];
  branches: Branch[];
  stockRows: ProductStock[];
  branchPrices: ProductBranchPrice[];
  onApplied: () => void;
}

type Step = 'upload' | 'preview' | 'saving' | 'done';

export default function ProductMassUpdateModal({ open, onClose, products, categories, locations, branches, stockRows, branchPrices, onApplied }: ProductMassUpdateModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<MassUpdateRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [readError, setReadError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ updated: number; failed: number } | null>(null);

  const reset = () => {
    setStep('upload');
    setRows([]);
    setFileName('');
    setReadError(null);
    setApplyResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const summary = useMemo(() => ({
    toUpdate: rows.filter((r) => r.status === 'update').length,
    same: rows.filter((r) => r.status === 'same').length,
    errors: rows.filter((r) => r.status === 'error').length,
  }), [rows]);

  const downloadTemplate = () => {
    downloadXLSXTemplate('plantilla-actualizacion-masiva.xlsx', buildMassUpdateHeaders(branches), buildMassUpdateTemplateRows({ products, categories, locations, branches, stockRows, branchPrices }));
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReadError(null);
    try {
      const table = await readSpreadsheet(file);
      const evaluated = evaluateMassUpdate(table, { products, categories, locations, branches, stockRows, branchPrices });
      if (evaluated.length === 0) {
        setReadError('El archivo no tiene filas de productos.');
        return;
      }
      setFileName(file.name);
      setRows(evaluated);
      setStep('preview');
    } catch {
      setReadError('No se pudo leer el archivo. Usa la plantilla en formato Excel o CSV.');
    }
  };

  const apply = async () => {
    const pending = rows.filter((r) => r.status === 'update' && r.productId);
    setStep('saving');
    let updated = 0;
    let failed = 0;
    for (const row of pending) {
      let rowFailed = false;
      if (Object.keys(row.changes).length > 0) {
        const { error } = await supabase.from('products').update(row.changes).eq('id', row.productId!);
        if (error) rowFailed = true;
      }
      for (const [branchId, locationId] of Object.entries(row.locationChanges)) {
        const existing = stockRows.find((r) => r.product_id === row.productId && r.branch_id === branchId);
        const { error } = existing
          ? await supabase.from('product_stock').update({ location_id: locationId }).eq('id', existing.id)
          : await supabase.from('product_stock').insert({ product_id: row.productId, branch_id: branchId, location_id: locationId, quantity: 0, min_stock: 0 });
        if (error) rowFailed = true;
      }
      const product = products.find((p) => p.id === row.productId);
      const finalShared = row.changes.prices_shared ?? product?.prices_shared ?? true;
      if (product && !finalShared && (row.changes.prices_shared === false || Object.keys(row.branchPriceInputs).length > 0)) {
        const shared = {
          cost_price: row.changes.cost_price ?? product.cost_price,
          sale_price: row.changes.sale_price ?? product.sale_price,
          price_2: row.changes.price_2 ?? product.price_2,
          price_3: row.changes.price_3 ?? product.price_3,
        };
        const rows = buildBranchPriceRows(product.id, branches.map((b) => b.id), shared, branchPrices.filter((r) => r.product_id === product.id), row.branchPriceInputs);
        if (!(await upsertBranchPriceRows(rows))) rowFailed = true;
      }
      if (rowFailed) failed += 1;
      else updated += 1;
    }
    setApplyResult({ updated, failed });
    setStep('done');
    onApplied();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Actualización masiva de productos" size="lg">
      {step === 'upload' && (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">
            Descarga la plantilla con todos los productos, edítala y súbela de nuevo. Identificamos cada producto por su código de barras 1, que es fijo; el SKU sí se puede editar. Las celdas vacías no cambian. Esta actualización no modifica existencias.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={downloadTemplate} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Download size={20} /></span>
              <span>
                <span className="block text-sm font-semibold text-slate-800">Descargar plantilla</span>
                <span className="block text-xs text-slate-500">Excel con todos los campos editables</span>
              </span>
            </button>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Upload size={20} /></span>
              <span>
                <span className="block text-sm font-semibold text-slate-800">Subir archivo llenado</span>
                <span className="block text-xs text-slate-500">Excel o CSV, revisaremos antes de aplicar</span>
              </span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} className="sr-only" />
            </label>
          </div>
          {readError && <p className="text-sm text-red-600">{readError}</p>}
        </div>
      )}

      {(step === 'preview' || step === 'saving') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <FileSpreadsheet size={16} /> <span className="font-medium text-slate-800">{fileName}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-center"><div className="text-2xl font-bold text-emerald-700">{summary.toUpdate}</div><div className="text-xs text-emerald-700">Por actualizar</div></div>
            <div className="rounded-lg bg-slate-100 p-3 text-center"><div className="text-2xl font-bold text-slate-700">{summary.same}</div><div className="text-xs text-slate-600">Sin cambios</div></div>
            <div className="rounded-lg bg-red-50 p-3 text-center"><div className="text-2xl font-bold text-red-700">{summary.errors}</div><div className="text-xs text-red-700">Con error</div></div>
          </div>
          {summary.errors > 0 && (
            <p className="text-sm text-red-600">Corrige las filas con error y vuelve a subir el archivo. No se aplicará ningún cambio mientras existan errores.</p>
          )}
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fila</th>
                  <th className="px-3 py-2">Código de barras 1</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Cambios</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={`${row.line}-${row.barcode}`} className={row.status === 'error' ? 'bg-red-50/60' : ''}>
                    <td className="px-3 py-2 text-slate-500">{row.line}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.barcode || '—'}</td>
                    <td className="px-3 py-2">{row.productName || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{row.status === 'error' ? '' : row.changedLabels.join(', ') || 'Ninguno'}</td>
                    <td className="px-3 py-2">
                      {row.status === 'error' ? (
                        <span className="inline-flex items-center gap-1 text-red-600"><XCircle size={14} /> {row.error}</span>
                      ) : row.status === 'update' ? (
                        <span className="text-emerald-700">Actualizar</span>
                      ) : (
                        <span className="text-slate-500">Sin cambios</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset} disabled={step === 'saving'}>Subir otro archivo</Button>
            <Button onClick={apply} disabled={step === 'saving' || summary.errors > 0 || summary.toUpdate === 0}>
              {step === 'saving' ? 'Aplicando...' : `Aplicar ${summary.toUpdate} cambios`}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && applyResult && (
        <div className="space-y-4 text-center">
          <CheckCircle2 size={44} className="mx-auto text-emerald-600" />
          <p className="text-base font-semibold text-slate-800">{applyResult.updated} productos actualizados</p>
          {applyResult.failed > 0 && <p className="text-sm text-red-600">{applyResult.failed} productos no pudieron guardarse. Revisa e intenta de nuevo.</p>}
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={reset}>Nueva actualización</Button>
            <Button onClick={handleClose}>Cerrar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
