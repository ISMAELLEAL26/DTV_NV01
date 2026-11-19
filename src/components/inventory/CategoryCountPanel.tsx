import { AlertTriangle, ArrowLeftRight, LayoutList, MapPin, Sparkles } from 'lucide-react';
import Button from '@/components/Button';

export type CategoryCountView = 'list' | 'auto';

export interface CountStage {
  id: string;
  name: string;
  total: number;
  counted: number;
}

interface CategoryCountPanelProps {
  categoryName: string;
  total: number;
  counted: number;
  view: CategoryCountView;
  onViewChange: (view: CategoryCountView) => void;
  onChangeCategory: () => void;
  stages: CountStage[] | null;
  activeStage: string | null;
  onSelectStage: (stageId: string) => void;
  affectedCount: number;
  recountAffected: boolean;
  onToggleRecount: () => void;
}

export default function CategoryCountPanel({
  categoryName, total, counted, view, onViewChange, onChangeCategory,
  stages, activeStage, onSelectStage, affectedCount, recountAffected, onToggleRecount,
}: CategoryCountPanelProps) {
  const pending = Math.max(0, total - counted);
  const percent = total > 0 ? Math.round((counted / total) * 100) : 0;

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Avance de la categoría</div>
          <div className="truncate text-lg font-bold text-slate-800">{categoryName}</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-600">Son <span className="font-semibold text-slate-800">{total}</span> productos</span>
            <span className="text-emerald-700">Contados <span className="font-semibold">{counted}</span></span>
            <span className="text-amber-700">Faltan <span className="font-semibold">{pending}</span></span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => onViewChange('list')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${view === 'list' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutList size={15} /> Lista
            </button>
            <button
              type="button"
              onClick={() => onViewChange('auto')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${view === 'auto' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Sparkles size={15} /> Vista automática
            </button>
          </div>
          <Button variant="secondary" onClick={onChangeCategory}><ArrowLeftRight size={16} /> Cambiar categoría</Button>
        </div>
      </div>

      {affectedCount > 0 && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-sm text-blue-800">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-blue-600" />
            <span>{affectedCount} producto(s) cambiaron por operaciones de caja durante el conteo. Vuelve a contarlos.</span>
          </div>
          <Button variant="secondary" onClick={onToggleRecount}>{recountAffected ? 'Ver todos los productos' : 'Recontar afectados'}</Button>
        </div>
      )}

      {stages && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ubicaciones</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {stages.map((stage) => {
              const active = stage.id === activeStage;
              const done = stage.total > 0 && stage.counted === stage.total;
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => onSelectStage(stage.id)}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <MapPin size={16} className={done ? 'text-emerald-600' : 'text-slate-500'} />
                    <span className="truncate text-sm font-semibold text-slate-800">{stage.name}</span>
                  </span>
                  <span className={`flex-shrink-0 text-xs font-semibold ${done ? 'text-emerald-700' : 'text-slate-500'}`}>{done ? 'Completa' : `${stage.counted} de ${stage.total}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
