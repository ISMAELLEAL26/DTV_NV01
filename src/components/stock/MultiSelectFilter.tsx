import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}

export default function MultiSelectFilter({ label, options, selected, onChange }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const summary = selected.length === 0 ? 'Todos' : selected.length === 1 ? options.find((o) => o.value === selected[0])?.label ?? '1 seleccionado' : `${selected.length} seleccionados`;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-emerald-400"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={16} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {options.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">Sin opciones</p>}
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mb-1 w-full rounded-md px-3 py-1.5 text-left text-xs font-medium text-emerald-700 hover:bg-emerald-50">
              Quitar selección
            </button>
          )}
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
              >
                <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'}`}>
                  {checked && <Check size={12} />}
                </span>
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
