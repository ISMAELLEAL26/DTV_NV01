import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Customer, Sale, WalletMovement } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Textarea } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { Users, Plus, Pencil, Trash2, Phone, Mail, MapPin, Wallet, ArrowLeft, TrendingUp, ArrowDownCircle, ArrowUpCircle, Receipt, ShoppingBag, Tag } from 'lucide-react';
import { searchAndRank } from '@/lib/search';
import PhoneDigitsInput from '@/components/PhoneDigitsInput';

const MOVEMENT_LABELS: Record<WalletMovement['tipo'], { label: string; icon: React.ReactNode; color: string }> = {
  ACUMULACION: { label: 'Puntos acumulados', icon: <TrendingUp size={14} />, color: 'text-emerald-600' },
  ABONO_CAMBIO: { label: 'Cambio al monedero', icon: <ArrowDownCircle size={14} />, color: 'text-blue-600' },
  PAGO_REDENCION: { label: 'Pago con monedero', icon: <ArrowUpCircle size={14} />, color: 'text-amber-600' },
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<Partial<Customer>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('customers').select('*').order('name');
    if (error) { console.error(error); }
    setCustomers((data as Customer[]) ?? []);

    const { data: sales } = await supabase.from('sales').select('customer_id, total, status');
    const t: Record<string, number> = {};
    (sales ?? []).forEach((s: { customer_id: string | null; total: number; status: string }) => {
      if (s.customer_id && s.status === 'completada') t[s.customer_id] = (t[s.customer_id] ?? 0) + Number(s.total);
    });
    setTotals(t);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return searchAndRank(search, customers, (c) => [c.name, c.phone, c.rfc]);
  }, [customers, search]);

  const openNew = () => { setEditing(null); setForm({}); setError(null); setOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm({ ...c }); setError(null); setOpen(true); };

  const save = async () => {
    setSaving(true); setError(null);
    if (!form.name?.trim()) { setError('El nombre es obligatorio'); setSaving(false); return; }
    const phoneVal = form.phone?.trim() || null;
    const payload = {
      name: form.name.trim(),
      codigo_cliente: form.codigo_cliente || null,
      paterno: form.paterno || null,
      materno: form.materno || null,
      phone: phoneVal,
      email: form.email || null,
      address: form.address || null,
      calle: form.calle || null,
      numero_ext: form.numero_ext || null,
      colonia: form.colonia || null,
      poblacion: form.poblacion || null,
      municipio: form.municipio || null,
      rfc: form.rfc || null,
    };
    if (editing) {
      const { error: e } = await supabase.from('customers').update(payload).eq('id', editing.id);
      if (e) {
        console.error(e);
        setError(e.code === '23505'
          ? 'Ya existe otro cliente con ese teléfono.'
          : 'No se pudo completar la operación. Revisa los datos e intenta de nuevo.');
        setSaving(false); return;
      }
    } else {
      const { error: e } = await supabase.from('customers').insert(payload);
      if (e) {
        console.error(e);
        setError(e.code === '23505'
          ? 'Ya existe otro cliente con ese teléfono.'
          : 'No se pudo completar la operación. Revisa los datos e intenta de nuevo.');
        setSaving(false); return;
      }
    }
    setSaving(false); setOpen(false); load();
  };

  const remove = async (c: Customer) => {
    if (!confirm(`¿Eliminar al cliente "${c.name}"?`)) return;
    await supabase.from('customers').delete().eq('id', c.id);
    load();
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  if (detailCustomer) {
    return <CustomerDetail customer={detailCustomer} onBack={() => setDetailCustomer(null)} onEdit={() => { openEdit(detailCustomer); setDetailCustomer(null); }} />;
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Clientes"
        subtitle={`${customers.length} clientes registrados`}
        actions={<Button onClick={openNew}><Plus size={16} /> Nuevo cliente</Button>}
      />
      <div className="mb-4"><SearchInput value={search} onChange={setSearch} /></div>

      {filtered.length === 0 ? (
        <Card><EmptyState title="Sin clientes" description="Registra tu primer cliente." icon={<Users size={48} />} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="cursor-pointer p-4 transition hover:shadow-md" >
              <div className="flex items-start justify-between" onClick={() => setDetailCustomer(c)}>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{c.name}</div>
                    <div className="flex items-center gap-2">
                      {c.codigo_cliente && <span className="flex items-center gap-1 text-xs text-slate-400"><Tag size={10} /> {c.codigo_cliente}</span>}
                      {c.rfc && <span className="text-xs text-slate-400">RFC: {c.rfc}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => openEdit(c)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><Pencil size={14} /></button>
                  <button onClick={() => remove(c)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-500" onClick={() => setDetailCustomer(c)}>
                {c.phone && <div className="flex items-center gap-1.5"><Phone size={12} /> {c.phone}</div>}
                {c.email && <div className="flex items-center gap-1.5"><Mail size={12} /> {c.email}</div>}
                {c.address && <div className="flex items-center gap-1.5"><MapPin size={12} /> {c.address}</div>}
                <div className="pt-1 text-slate-400">Cliente desde {formatDate(c.created_at)}</div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3" onClick={() => setDetailCustomer(c)}>
                <span className="text-xs text-slate-500">Total comprado</span>
                <Badge variant="success">{formatCurrency(totals[c.id] ?? 0)}</Badge>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2" onClick={() => setDetailCustomer(c)}>
                <span className="flex items-center gap-1.5 text-xs text-slate-500"><Wallet size={12} /> Monedero</span>
                <span className={`text-sm font-bold ${Number(c.saldo_monedero) > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{formatCurrency(c.saldo_monedero)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar cliente' : 'Nuevo cliente'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre *"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Código de cliente"><Input value={form.codigo_cliente ?? ''} onChange={(e) => setForm({ ...form, codigo_cliente: e.target.value })} placeholder="Se genera automático" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Apellido paterno"><Input value={form.paterno ?? ''} onChange={(e) => setForm({ ...form, paterno: e.target.value })} /></Field>
            <Field label="Apellido materno"><Input value={form.materno ?? ''} onChange={(e) => setForm({ ...form, materno: e.target.value })} /></Field>
          </div>
          <Field label="WhatsApp (10 dígitos)">
            <PhoneDigitsInput value={form.phone ?? ''} onChange={(val) => setForm({ ...form, phone: val })} />
          </Field>
          <Field label="Correo"><Input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Domicilio</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><Field label="Calle"><Input value={form.calle ?? ''} onChange={(e) => setForm({ ...form, calle: e.target.value })} /></Field></div>
              <Field label="Número"><Input value={form.numero_ext ?? ''} onChange={(e) => setForm({ ...form, numero_ext: e.target.value })} /></Field>
            </div>
            <Field label="Colonia"><Input value={form.colonia ?? ''} onChange={(e) => setForm({ ...form, colonia: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Población"><Input value={form.poblacion ?? ''} onChange={(e) => setForm({ ...form, poblacion: e.target.value })} /></Field>
              <Field label="Municipio"><Input value={form.municipio ?? ''} onChange={(e) => setForm({ ...form, municipio: e.target.value })} /></Field>
            </div>
          </div>
          <Field label="RFC"><Input value={form.rfc ?? ''} onChange={(e) => setForm({ ...form, rfc: e.target.value })} /></Field>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CustomerDetail({ customer, onBack, onEdit }: { customer: Customer; onBack: () => void; onEdit: () => void }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [movements, setMovements] = useState<WalletMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'purchases' | 'wallet'>('purchases');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [salesRes, walletRes] = await Promise.all([
        supabase.from('sales').select('*, sale_items(*)').eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('wallet_movements').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(50),
      ]);
      if (cancelled) return;
      setSales((salesRes.data as Sale[]) ?? []);
      setMovements((walletRes.data as WalletMovement[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [customer.id]);

  const totalPurchased = useMemo(
    () => sales.filter((s) => s.status === 'completada').reduce((sum, s) => sum + Number(s.total), 0),
    [sales],
  );

  const totalEarned = useMemo(
    () => movements.filter((m) => m.tipo === 'ACUMULACION').reduce((sum, m) => sum + Number(m.monto), 0),
    [movements],
  );
  const totalRedeemed = useMemo(
    () => movements.filter((m) => m.tipo === 'PAGO_REDENCION').reduce((sum, m) => sum + Number(m.monto), 0),
    [movements],
  );

  return (
    <div className="p-6">
      <button onClick={onBack} className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-emerald-600">
        <ArrowLeft size={16} /> Volver a clientes
      </button>

      <Card className="mb-4 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700">
              {customer.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{customer.name}</h2>
              <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                {customer.codigo_cliente && <div className="flex items-center gap-1.5"><Tag size={12} /> {customer.codigo_cliente}</div>}
                {customer.phone && <div className="flex items-center gap-1.5"><Phone size={12} /> {customer.phone}</div>}
                {customer.email && <div className="flex items-center gap-1.5"><Mail size={12} /> {customer.email}</div>}
                {customer.address && <div className="flex items-center gap-1.5"><MapPin size={12} /> {customer.address}</div>}
                {customer.rfc && <div className="text-slate-400">RFC: {customer.rfc}</div>}
                <div className="text-slate-400">Cliente desde {formatDate(customer.created_at)}</div>
              </div>
            </div>
          </div>
          <Button variant="secondary" onClick={onEdit}><Pencil size={14} /> Editar</Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-3 text-center">
            <div className="text-xs text-slate-500">Monedero actual</div>
            <div className={`mt-1 text-lg font-bold ${Number(customer.saldo_monedero) > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{formatCurrency(customer.saldo_monedero)}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-center">
            <div className="text-xs text-slate-500">Total comprado</div>
            <div className="mt-1 text-lg font-bold text-slate-700">{formatCurrency(totalPurchased)}</div>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3 text-center">
            <div className="text-xs text-emerald-600">Puntos acumulados</div>
            <div className="mt-1 text-lg font-bold text-emerald-700">{formatCurrency(totalEarned)}</div>
          </div>
          <div className="rounded-lg bg-amber-50 p-3 text-center">
            <div className="text-xs text-amber-600">Puntos usados</div>
            <div className="mt-1 text-lg font-bold text-amber-700">{formatCurrency(totalRedeemed)}</div>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('purchases')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === 'purchases' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          <ShoppingBag size={16} /> Historial de compras
        </button>
        <button
          onClick={() => setTab('wallet')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === 'wallet' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          <Wallet size={16} /> Movimientos del monedero
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center"><Spinner size={28} /></div>
      ) : tab === 'purchases' ? (
        <PurchaseHistory sales={sales} />
      ) : (
        <WalletHistory movements={movements} />
      )}
    </div>
  );
}

function PurchaseHistory({ sales }: { sales: Sale[] }) {
  if (sales.length === 0) {
    return <Card><EmptyState title="Sin compras" description="Este cliente aún no tiene ventas registradas." icon={<Receipt size={48} />} /></Card>;
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Folio</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3 text-center">Estado</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sales.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-slate-700">{s.folio ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(s.created_at)}</td>
                <td className="px-4 py-3 text-center">
                  {s.status === 'completada' ? <Badge variant="success">Completada</Badge>
                    : s.status === 'cancelada' ? <Badge variant="danger">Cancelada</Badge>
                    : <Badge variant="default">{s.status}</Badge>}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrency(s.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function WalletHistory({ movements }: { movements: WalletMovement[] }) {
  if (movements.length === 0) {
    return <Card><EmptyState title="Sin movimientos" description="Este cliente aún no tiene movimientos en el monedero." icon={<Wallet size={48} />} /></Card>;
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Folio venta</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3 text-right">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.map((m) => {
              const meta = MOVEMENT_LABELS[m.tipo];
              return (
                <tr key={m.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1.5 font-medium ${meta.color}`}>{meta.icon} {meta.label}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.folio_venta ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(m.created_at)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrency(m.monto)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
