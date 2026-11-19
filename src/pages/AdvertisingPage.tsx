import { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, Pencil, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Ad } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import ImageUploadPicker, { type ImageUploadValue } from '@/components/ImageUploadPicker';
import { Field, Input, Select } from '@/components/Field';
import { uploadImage } from '@/lib/imageUpload';
import { PageHeader, Card, EmptyState, Spinner, Badge } from '@/components/ui';

const APP_IMAGES_BUCKET = 'app-images';
type AdForm = Partial<Ad> & { sort_order?: number };

export default function AdvertisingPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdForm | null>(null);
  const [form, setForm] = useState<AdForm>({});
  const [imageValue, setImageValue] = useState<ImageUploadValue>({ file: null, currentUrl: null, removed: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase.from('ads').select('*').order('sort_order').order('created_at', { ascending: false });
    if (loadError) {
      console.error(loadError);
      setError('No se pudieron cargar las publicaciones.');
    } else {
      setAds((data as Ad[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm({ title: '', link_url: '', active: true, sort_order: ads.length });
    setImageValue({ file: null, currentUrl: null, removed: false });
    setError(null);
    setOpen(true);
  };

  const openEdit = (ad: Ad) => {
    setEditing(ad);
    setForm({ ...ad });
    setImageValue({ file: null, currentUrl: ad.image_url, removed: false });
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const imageUrl = imageValue.file ? await uploadImage(APP_IMAGES_BUCKET, imageValue.file) : imageValue.removed ? null : imageValue.currentUrl;
      if (!String(form.title ?? '').trim() || !imageUrl) {
        setError('Escribe un título y selecciona una imagen.');
        return;
      }
      const payload = { title: String(form.title).trim(), image_url: imageUrl, link_url: String(form.link_url ?? '').trim() || null, active: form.active !== false, sort_order: Number(form.sort_order ?? 0) };
      const result = editing
        ? await supabase.from('ads').update(payload).eq('id', String(editing.id))
        : await supabase.from('ads').insert(payload);
      if (result.error) throw result.error;
      setOpen(false);
      await load();
    } catch (cause) {
      console.error(cause);
      setError('No se pudo guardar la publicación. Verifica tus permisos e intenta nuevamente.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (ad: Ad) => {
    if (!window.confirm(`¿Eliminar "${ad.title}"?`)) return;
    const { error: removeError } = await supabase.from('ads').delete().eq('id', ad.id);
    if (removeError) {
      console.error(removeError);
      setError('No se pudo eliminar la publicación.');
      return;
    }
    await load();
  };

  const toggle = async (ad: Ad) => {
    const { error: toggleError } = await supabase.from('ads').update({ active: !ad.active }).eq('id', ad.id);
    if (toggleError) {
      console.error(toggleError);
      setError('No se pudo cambiar el estado de la publicación.');
      return;
    }
    await load();
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return <div className="p-6">
    <PageHeader title="Publicidad" subtitle="Administra las imágenes que aparecen en el módulo de venta." />
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <p className="max-w-2xl text-sm text-slate-500">Carga imágenes directamente desde esta computadora, ordénalas y decide cuáles se muestran en el punto de venta.</p>
      <Button onClick={openNew}><Plus size={16} /> Nueva publicidad</Button>
    </div>
    {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    {ads.length === 0 ? <Card><EmptyState title="Sin publicidad" description="Agrega la primera imagen para mostrarla en el módulo de venta." icon={<ImageIcon size={48} />} /></Card> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{ads.map((ad) => <Card key={ad.id} className="overflow-hidden"><div className="relative h-44 bg-slate-100"><img src={ad.image_url} alt={ad.title} className="h-full w-full object-cover" /><button onClick={() => void toggle(ad)} className="absolute right-3 top-3 rounded-lg bg-white/95 p-1.5 shadow-sm" title={ad.active ? 'Desactivar' : 'Activar'}>{ad.active ? <ToggleRight size={19} className="text-emerald-600" /> : <ToggleLeft size={19} className="text-slate-400" />}</button></div><div className="p-4"><div className="flex items-center justify-between gap-2"><h2 className="truncate font-semibold text-slate-800">{ad.title}</h2><Badge variant={ad.active ? 'success' : 'default'}>{ad.active ? 'Activa' : 'Inactiva'}</Badge></div><div className="mt-2 text-xs text-slate-500">Orden de aparición: {ad.sort_order}</div><div className="mt-3 flex gap-1"><button onClick={() => openEdit(ad)} className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title="Editar"><Pencil size={16} /></button><button onClick={() => void remove(ad)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Eliminar"><Trash2 size={16} /></button></div></div></Card>)}</div>}

    <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar publicidad' : 'Nueva publicidad'} size="md"><div className="space-y-4"><Field label="Título *"><Input value={String(form.title ?? '')} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej. Promoción de la semana" /></Field><Field label="Imagen desde la computadora *"><ImageUploadPicker value={imageValue} onChange={setImageValue} onError={setError} alt="Vista previa de publicidad" noun="imagen" /></Field><Field label="Enlace opcional"><Input value={String(form.link_url ?? '')} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://..." /></Field><div className="grid grid-cols-2 gap-3"><Field label="Orden"><Input type="number" min="0" value={String(form.sort_order ?? 0)} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></Field><Field label="Estado"><Select value={form.active === false ? '0' : '1'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}><option value="1">Activa</option><option value="0">Inactiva</option></Select></Field></div>{error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Guardando...' : 'Guardar publicidad'}</Button></div></div></Modal>
  </div>;
}
