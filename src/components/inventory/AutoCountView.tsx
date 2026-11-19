import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ImageIcon, PackageCheck, XCircle } from 'lucide-react';
import type { Product } from '@/lib/types';
import Button from '@/components/Button';
import { Input } from '@/components/Field';
import { Spinner } from '@/components/ui';

interface AutoCountViewProps {
  products: Product[];
  counts: Record<string, string>;
  theoreticalOf: (productId: string) => number;
  onSave: (productId: string, value: string) => Promise<boolean>;
  onGoToProducts: () => void;
}

type Status = 'pending' | 'match' | 'shortage' | 'surplus';

function statusOf(physical: number | null, theoretical: number): Status {
  if (physical == null) return 'pending';
  const diff = physical - theoretical;
  if (diff === 0) return 'match';
  return diff < 0 ? 'shortage' : 'surplus';
}

const STATUS_STYLE: Record<Status, { label: string; className: string }> = {
  pending: { label: 'Pendiente', className: 'bg-slate-100 text-slate-600' },
  match: { label: 'Producto cuadrado', className: 'bg-emerald-100 text-emerald-700' },
  shortage: { label: 'Producto con faltante', className: 'bg-red-100 text-red-700' },
  surplus: { label: 'Producto con sobrante', className: 'bg-amber-100 text-amber-700' },
};

export default function AutoCountView({ products, counts, theoreticalOf, onSave, onGoToProducts }: AutoCountViewProps) {
  const isCounted = (id: string) => (counts[id] ?? '').trim() !== '';
  const firstPending = useMemo(() => products.findIndex((product) => !isCounted(product.id)), [products, counts]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = useMemo(() => {
    const byId = products.find((product) => product.id === currentId);
    if (byId) return byId;
    return firstPending >= 0 ? products[firstPending] : null;
  }, [products, currentId, firstPending]);

  useEffect(() => {
    setDraft(current ? (counts[current.id] ?? '') : '');
    setError(null);
  }, [current?.id]);

  const countedTotal = products.filter((product) => isCounted(product.id)).length;
  const pendingTotal = products.length - countedTotal;

  if (products.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No hay productos en esta categoría.</div>;
  }

  if (!current || pendingTotal === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <PackageCheck size={36} className="text-emerald-600" />
        </div>
        <div>
          <p className="text-xl font-bold text-emerald-700">Finalizado</p>
          <p className="mt-2 text-sm text-slate-600">Contaste los {products.length} productos de la categoría. Revísalos en Productos y después guarda y autoriza el inventario.</p>
        </div>
        <Button onClick={onGoToProducts}>Ir a Productos para revisar</Button>
      </div>
    );
  }

  const theoretical = theoreticalOf(current.id);
  const parsedDraft = draft.trim() === '' ? null : Number(draft);
  const physical = parsedDraft != null && Number.isFinite(parsedDraft) ? parsedDraft : null;
  const difference = physical == null ? null : physical - theoretical;
  const status = statusOf(physical, theoretical);
  const statusStyle = STATUS_STYLE[status];
  const position = products.findIndex((product) => product.id === current.id) + 1;

  const goNext = () => {
    const after = products.slice(position);
    const next = after.find((product) => product.id !== current.id && !isCounted(product.id)) ?? products.find((product) => !isCounted(product.id) && product.id !== current.id);
    setCurrentId(next?.id ?? null);
  };

  const saveAndNext = async () => {
    if (physical == null || physical < 0) {
      setError('Captura una existencia física válida.');
      return;
    }
    setSaving(true);
    setError(null);
    const saved = await onSave(current.id, draft.trim());
    setSaving(false);
    if (!saved) {
      setError('No se pudo guardar el conteo. Intenta de nuevo.');
      return;
    }
    goNext();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="text-sm font-semibold text-slate-700">Producto {position} de {products.length}</div>
        <div className="flex gap-3 text-sm">
          <span className="rounded-lg bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700">Contados {countedTotal}</span>
          <span className="rounded-lg bg-amber-50 px-3 py-1.5 font-semibold text-amber-700">Faltan {pendingTotal}</span>
        </div>
      </div>

      <div className="grid gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:p-8">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
          {current.image_url ? (
            <img src={current.image_url} alt={current.name} className="h-full w-full object-contain" />
          ) : (
            <ImageIcon size={72} className="text-slate-300" />
          )}
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-2xl font-bold leading-tight text-slate-900">{current.name}</h2>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Detail label="SKU" value={current.sku ?? 'Sin SKU'} />
              <Detail label="Código de barras" value={current.barcode ?? current.barcode_2 ?? 'Sin código'} mono />
              <Detail label="Departamento" value={current.department ?? 'Sin departamento'} />
              <Detail label="Categoría" value={current.category?.name ?? 'Sin categoría'} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Teórico (stock)</div>
              <div className="mt-1 text-3xl font-bold text-slate-800">{theoretical}</div>
              <div className="text-xs text-slate-400">{current.unit}</div>
            </div>
            <div className="rounded-2xl bg-blue-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Físico (contado)</div>
              <Input
                type="number"
                min="0"
                step={current.bulk ? '0.001' : '1'}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && !saving) void saveAndNext(); }}
                placeholder="0"
                autoFocus
                className="mt-1 h-12 border-blue-200 bg-white text-2xl font-bold text-slate-900"
              />
            </div>
          </div>

          <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${statusStyle.className}`}>
            {status === 'match' && <CheckCircle2 size={20} />}
            {status === 'shortage' && <XCircle size={20} />}
            {status === 'surplus' && <AlertTriangle size={20} />}
            <span>{statusStyle.label}{difference != null && status !== 'pending' ? ` · diferencia ${difference > 0 ? '+' : ''}${difference}` : ''}</span>
          </div>

          {error && <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <Button onClick={() => void saveAndNext()} disabled={saving} className="mt-auto h-12 text-base">
            {saving ? <><Spinner size={16} /> Guardando...</> : 'Guardar y siguiente'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={`truncate font-medium text-slate-700 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}
