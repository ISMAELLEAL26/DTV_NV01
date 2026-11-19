import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import type { ProductPresentation } from '@/lib/types';
import Button from '@/components/Button';
import { Field, Input } from '@/components/Field';
import { ImageIcon, Pencil, Plus, Trash2, X } from 'lucide-react';

const PHOTO_BUCKET = 'presentation-photos';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

interface ProductPresentationsEditorProps {
  productId: string;
  costPerPiece: number;
}

const EMPTY_FORM = { name: '', code: '', pieces: '', sale_price: '' };

interface PendingPhoto {
  file: File;
  url: string;
}

export default function ProductPresentationsEditor({ productId, costPerPiece }: ProductPresentationsEditorProps) {
  const [items, setItems] = useState<ProductPresentation[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('product_presentations')
      .select('*')
      .eq('product_id', productId)
      .order('pieces');
    if (loadError) {
      setError('No se pudieron cargar las presentaciones.');
      return;
    }
    setItems((data as ProductPresentation[]) ?? []);
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!pendingPhoto) return;
    return () => URL.revokeObjectURL(pendingPhoto.url);
  }, [pendingPhoto]);

  const pieces = Number(form.pieces);
  const price = Number(form.sale_price);
  const previewCost = pieces > 0 ? pieces * costPerPiece : 0;
  const previewProfit = price - previewCost;
  const previewMargin = price > 0 ? (previewProfit / price) * 100 : 0;
  const shownPhoto = pendingPhoto?.url ?? (photoRemoved ? null : existingPhotoUrl);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setExistingPhotoUrl(null);
    setPhotoRemoved(false);
    setPendingPhoto(null);
  };

  const startEdit = (item: ProductPresentation) => {
    setError(null);
    setSuccess(null);
    setEditingId(item.id);
    setForm({
      name: item.name,
      code: item.code,
      pieces: String(Number(item.pieces)),
      sale_price: String(Number(item.sale_price)),
    });
    setExistingPhotoUrl(item.image_url);
    setPhotoRemoved(false);
    setPendingPhoto(null);
  };

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('El archivo debe ser una imagen.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError('La foto no puede pesar más de 5 MB.');
      return;
    }
    setError(null);
    setPhotoRemoved(false);
    setPendingPhoto({ file, url: URL.createObjectURL(file) });
  };

  const uploadPhoto = async (file: File): Promise<string | null> => {
    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${productId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return null;
    return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  };

  const savePresentation = async () => {
    const code = form.code.trim();
    if (!form.name.trim() || !code || !(pieces > 0) || form.sale_price === '' || !(price >= 0)) {
      setError('Completa nombre, código, piezas y precio de venta.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    const { data: clash, error: clashError } = await supabase
      .from('products')
      .select('id')
      .or(`barcode.eq.${code},barcode_2.eq.${code},sku.eq.${code}`)
      .limit(1);
    if (clashError) {
      setSaving(false);
      setError('No se pudo validar el código.');
      return;
    }
    if (clash && clash.length > 0) {
      setSaving(false);
      setError('Ese código ya pertenece a otro producto.');
      return;
    }

    let imageUrl: string | null = photoRemoved ? null : existingPhotoUrl;
    if (pendingPhoto) {
      imageUrl = await uploadPhoto(pendingPhoto.file);
      if (!imageUrl) {
        setSaving(false);
        setError('No se pudo subir la foto.');
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      code,
      pieces,
      sale_price: price,
      image_url: imageUrl,
    };
    const { error: saveError } = editingId
      ? await supabase.from('product_presentations').update(payload).eq('id', editingId)
      : await supabase.from('product_presentations').insert({ ...payload, product_id: productId });
    setSaving(false);
    if (saveError) {
      console.error('product_presentations save failed', saveError);
      setError(
        saveError.code === '23505'
          ? 'Ese código ya existe en otra presentación.'
          : `No se pudo guardar la presentación: ${saveError.message}`,
      );
      return;
    }
    setSuccess(editingId ? 'Presentación actualizada.' : 'Presentación guardada.');
    resetForm();
    load();
  };

  const deletePresentation = async (item: ProductPresentation) => {
    if (!confirm(`¿Eliminar la presentación "${item.name}"? Las ventas anteriores se conservan.`)) return;
    setError(null);
    setSuccess(null);
    const { error: deleteError } = await supabase.from('product_presentations').delete().eq('id', item.id);
    if (deleteError) {
      setError('No se pudo eliminar la presentación.');
      return;
    }
    if (editingId === item.id) resetForm();
    setSuccess('Presentación eliminada.');
    load();
  };

  const toggleActive = async (item: ProductPresentation) => {
    const { error: updateError } = await supabase
      .from('product_presentations')
      .update({ active: !item.active })
      .eq('id', item.id);
    if (updateError) {
      setError('No se pudo actualizar la presentación.');
      return;
    }
    load();
  };

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
          Este producto aún no tiene presentaciones de venta.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Foto</th>
                <th className="px-3 py-2">Presentación</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2 text-right">Piezas</th>
                <th className="px-3 py-2 text-right">Costo</th>
                <th className="px-3 py-2 text-right">Precio venta</th>
                <th className="px-3 py-2 text-right">Ganancia</th>
                <th className="px-3 py-2 text-right">Margen</th>
                <th className="px-3 py-2 text-center">Activa</th>
                <th className="px-3 py-2 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const cost = item.pieces * costPerPiece;
                const profit = Number(item.sale_price) - cost;
                const margin = Number(item.sale_price) > 0 ? (profit / Number(item.sale_price)) * 100 : 0;
                return (
                  <tr key={item.id} className={`${item.active ? '' : 'text-slate-400'} ${editingId === item.id ? 'bg-emerald-50/60' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
                        ) : (
                          <ImageIcon size={16} className="text-slate-400" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium">{item.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.code}</td>
                    <td className="px-3 py-2 text-right">{Number(item.pieces)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(cost)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(Number(item.sale_price))}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(profit)}</td>
                    <td className="px-3 py-2 text-right">{margin.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={item.active} onChange={() => toggleActive(item)} className="h-4 w-4 accent-emerald-600" />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          aria-label="Editar presentación"
                          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-emerald-700"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePresentation(item)}
                          aria-label="Eliminar presentación"
                          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        {editingId && (
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Editando presentación</span>
            <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
              <X size={14} /> Cancelar edición
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Nombre *">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Casillero 30 pz" />
          </Field>
          <Field label="Código *">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Código propio" />
          </Field>
          <Field label="Piezas que contiene *">
            <Input type="number" step="0.001" min="0" value={form.pieces} onChange={(e) => setForm({ ...form, pieces: e.target.value })} />
          </Field>
          <Field label="Precio de venta *">
            <Input type="number" step="0.01" min="0" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} />
          </Field>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-white">
            {shownPhoto ? (
              <img src={shownPhoto} alt="Foto de la presentación" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon size={22} className="text-slate-400" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-100">
              {shownPhoto ? 'Cambiar foto' : 'Subir foto'}
              <input type="file" accept="image/*" onChange={onPhotoChange} className="sr-only" />
            </label>
            {shownPhoto && (
              <button
                type="button"
                onClick={() => {
                  setPendingPhoto(null);
                  setPhotoRemoved(true);
                }}
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
              >
                Quitar foto
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            Costo: <span className="font-semibold">{formatCurrency(previewCost)}</span>
            <span className="mx-2 text-slate-300">|</span>
            Ganancia: <span className="font-semibold">{formatCurrency(previewProfit)}</span>
            <span className="mx-2 text-slate-300">|</span>
            Margen: <span className="font-semibold">{previewMargin.toFixed(1)}%</span>
          </div>
          <Button onClick={savePresentation} disabled={saving}>
            <Plus size={14} /> {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar presentación'}
          </Button>
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {success && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div>}
      </div>
    </div>
  );
}
