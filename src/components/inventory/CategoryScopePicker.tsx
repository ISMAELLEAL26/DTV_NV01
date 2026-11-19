import { LayoutList, MapPin, Package, ArrowLeft } from 'lucide-react';
import Button from '@/components/Button';

export type CountScope = 'all' | 'location';

interface CategoryScopePickerProps {
  categoryName: string;
  total: number;
  locationNames: string[];
  onSelect: (scope: CountScope) => void;
  onBack: () => void;
}

export default function CategoryScopePicker({ categoryName, total, locationNames, onSelect, onBack }: CategoryScopePickerProps) {
  const hasLocations = locationNames.length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Categoría elegida</div>
          <div className="text-xl font-bold text-slate-800">{categoryName}</div>
        </div>
        <Button variant="secondary" onClick={onBack}><ArrowLeft size={16} /> Elegir otra categoría</Button>
      </div>

      <div className="text-sm font-semibold text-slate-700">¿Cómo quieres contar esta categoría?</div>

      <div className={`grid gap-4 ${hasLocations ? 'sm:grid-cols-2' : 'sm:grid-cols-1 sm:max-w-md'}`}>
        <button
          type="button"
          onClick={() => onSelect('all')}
          className="group flex flex-col gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-left transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-lg"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Package size={24} /></span>
          <span className="text-lg font-bold text-slate-800">Toda la categoría</span>
          <span className="text-sm text-slate-500">Cuenta los {total} productos de una sola vez.</span>
        </button>

        {hasLocations && (
          <button
            type="button"
            onClick={() => onSelect('location')}
            className="group flex flex-col gap-3 rounded-2xl border-2 border-slate-200 bg-white p-6 text-left transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-lg"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600"><MapPin size={24} /></span>
            <span className="text-lg font-bold text-slate-800">Por ubicación</span>
            <span className="text-sm text-slate-500">Cuenta y guarda cada ubicación por separado: {locationNames.join(', ')}.</span>
          </button>
        )}
      </div>

      {!hasLocations && (
        <p className="flex items-center gap-2 text-sm text-slate-500"><LayoutList size={16} /> Esta categoría no tiene productos con ubicación asignada, así que solo puedes contarla completa.</p>
      )}
    </div>
  );
}
