import { CheckCircle2, Circle, Loader2, MapPin } from 'lucide-react';
import Button from '@/components/Button';
import { PageHeader, Card } from '@/components/ui';

export interface LocationStageItem {
  id: string;
  name: string;
  total: number;
  done: boolean;
}

interface LocationStageHubProps {
  categoryName: string;
  stages: LocationStageItem[];
  starting: boolean;
  error: string | null;
  onStart: (stageId: string) => void;
  onExit: () => void;
}

export default function LocationStageHub({ categoryName, stages, starting, error, onStart, onExit }: LocationStageHubProps) {
  const doneCount = stages.filter((stage) => stage.done).length;
  const percent = stages.length === 0 ? 0 : Math.round((doneCount / stages.length) * 100);

  return (
    <div className="device-page p-6">
      <PageHeader title="Ajuste de Inventario" subtitle={`${categoryName} · Conteo por ubicación`} />
      <div className="mx-auto max-w-3xl space-y-6">
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-800">Progreso por ubicación</span>
            <span className="text-slate-500">{doneCount} de {stages.length} guardadas</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${percent}%` }} />
          </div>
        </Card>

        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="space-y-3">
          {stages.map((stage) => (
            <div key={stage.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${stage.done ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                {stage.done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2 font-semibold text-slate-800"><MapPin size={14} /> {stage.name}</div>
                <div className="text-xs text-slate-500">{stage.total} productos {stage.done ? '· guardada' : '· pendiente'}</div>
              </div>
              {stage.done ? (
                <span className="text-sm font-medium text-emerald-700">Guardada</span>
              ) : (
                <Button onClick={() => onStart(stage.id)} disabled={starting}>
                  {starting ? <Loader2 size={16} className="animate-spin" /> : null} Contar esta ubicación
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onExit}>Salir del inventario</Button>
        </div>
      </div>
    </div>
  );
}
