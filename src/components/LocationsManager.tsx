import { useState } from 'react';
import { MapPin, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Branch, Location } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select } from '@/components/Field';

interface LocationsManagerProps {
  open: boolean;
  onClose: () => void;
  branches: Branch[];
  locations: Location[];
  productsByLocation: Map<string, number>;
  onChanged: () => void;
}

export default function LocationsManager({ open, onClose, branches, locations, productsByLocation, onChanged }: LocationsManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setEditingId(null); setName(''); setBranchId(''); setError(null); };

  const handleClose = () => { reset(); onClose(); };

  const save = async () => {
    const trimmed = name.trim();
    const targetBranch = branchId || branches[0]?.id || '';
    if (!trimmed) { setError('El nombre es obligatorio.'); return; }
    if (!targetBranch) { setError('Primero necesitas una sucursal.'); return; }
    setSaving(true);
    setError(null);
    const { error: saveError } = editingId
      ? await supabase.from('locations').update({ name: trimmed, branch_id: targetBranch }).eq('id', editingId)
      : await supabase.from('locations').insert({ name: trimmed, branch_id: targetBranch });
    setSaving(false);
    if (saveError) { setError(saveError.code === '23505' ? 'Ya existe una ubicación con ese nombre en esta sucursal.' : 'No se pudo guardar la ubicación. Intenta de nuevo.'); return; }
    reset();
    onChanged();
  };

  const toggleActive = async (location: Location) => {
    setError(null);
    const { error: toggleError } = await supabase.from('locations').update({ active: !location.active }).eq('id', location.id);
    if (toggleError) { setError('No se pudo actualizar la ubicación.'); return; }
    onChanged();
  };

  const remove = async (location: Location) => {
    const linked = productsByLocation.get(location.id) ?? 0;
    if (linked > 0) { setError(`No se puede eliminar: ${linked} producto(s) están en esta ubicación. Reasígnalos primero.`); return; }
    if (!confirm(`¿Eliminar la ubicación "${location.name}"?`)) return;
    const { error: deleteError } = await supabase.from('locations').delete().eq('id', location.id);
    if (deleteError) { setError('No se pudo eliminar la ubicación. Solo un administrador puede hacerlo.'); return; }
    onChanged();
  };

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name.replace('BIENESTAR ', '') ?? 'Sin sucursal';

  return (
    <Modal open={open} onClose={handleClose} title="Ubicaciones por sucursal" size="lg">
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
            <Field label="Sucursal">
              <Select value={branchId || branches[0]?.id || ''} onChange={(event) => setBranchId(event.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label={editingId ? 'Editar ubicación' : 'Nueva ubicación'}>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Bodega, Piso de venta" maxLength={80} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Agregar'}</Button>
            {editingId && <Button variant="secondary" onClick={reset}>Cancelar</Button>}
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        {locations.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Aún no hay ubicaciones. Agrega la primera arriba.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {locations.map((location) => (
              <li key={location.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><MapPin size={18} /></span>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">{location.name}</div>
                    <div className="text-xs text-slate-500">{branchName(location.branch_id)} · {productsByLocation.get(location.id) ?? 0} producto(s){location.active ? '' : ' · Inactiva'}</div>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button type="button" onClick={() => toggleActive(location)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100">{location.active ? 'Desactivar' : 'Activar'}</button>
                  <button type="button" onClick={() => { setEditingId(location.id); setName(location.name); setBranchId(location.branch_id); setError(null); }} title="Editar" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"><Pencil size={16} /></button>
                  <button type="button" onClick={() => remove(location)} title="Eliminar" className="rounded-lg p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
