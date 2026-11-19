import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDate, startOfMonthISO } from '@/lib/format';
import type { Profile, Role, Branch, EmployeeSchedule } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select } from '@/components/Field';
import { PageHeader, SearchInput, Card, EmptyState, Spinner, Badge } from '@/components/ui';
import { UserCog, Plus, Pencil, Shield, KeyRound, CalendarDays, Save, Trash2, AlertTriangle } from 'lucide-react';
import { searchAndRank } from '@/lib/search';
import ImageUploadPicker, { type ImageUploadValue } from '@/components/ImageUploadPicker';
import { uploadImage } from '@/lib/imageUpload';

const APP_IMAGES_BUCKET = 'app-images';

const PERMISSION_GROUPS = [
  {
    label: 'Ventas y punto de venta',
    options: [
      { value: 'sales', label: 'Acceder al punto de venta' },
      { value: 'sales_create', label: 'Crear y cobrar ventas' },
      { value: 'sales_cancel', label: 'Cancelar ventas' },
      { value: 'sales_discount', label: 'Aplicar descuentos' },
      { value: 'sales_price_override', label: 'Modificar precio al vender' },
      { value: 'price_checker', label: 'Consultar precios' },
      { value: 'customers', label: 'Ver y administrar clientes' },
    ],
  },
  {
    label: 'Inventario y productos',
    options: [
      { value: 'products', label: 'Ver productos' },
      { value: 'products_create', label: 'Crear productos' },
      { value: 'products_edit', label: 'Editar productos' },
      { value: 'products_delete', label: 'Eliminar y recuperar productos' },
      { value: 'products_import', label: 'Importar productos' },
      { value: 'products_price', label: 'Cambiar precios' },
      { value: 'inventory_adjust', label: 'Ajustar inventario' },
      { value: 'inventory_authorize', label: 'Autorizar ajustes' },
      { value: 'inventory_history', label: 'Ver historial de inventarios' },
    ],
  },
  {
    label: 'Compras y proveedores',
    options: [
      { value: 'purchases', label: 'Ver compras' },
      { value: 'purchases_create', label: 'Registrar compras' },
      { value: 'purchases_edit', label: 'Editar compras' },
      { value: 'purchases_delete', label: 'Cancelar compras' },
      { value: 'supplier_view', label: 'Ver proveedores' },
      { value: 'supplier_edit', label: 'Administrar proveedores' },
      { value: 'supplier_orders', label: 'Administrar pedidos a proveedor' },
    ],
  },
  {
    label: 'Caja y turnos',
    options: [
      { value: 'cash_open', label: 'Abrir turno y fondo inicial' },
      { value: 'cash_balance', label: 'Ver saldo y corte de caja' },
      { value: 'cash_movements', label: 'Registrar movimientos de caja' },
      { value: 'cash_close', label: 'Cerrar turno' },
      { value: 'view_expected_balance', label: 'Ver saldo esperado en arqueo' },
    ],
  },
  {
    label: 'Personal y configuración',
    options: [
      { value: 'settings', label: 'Acceder a configuración' },
      { value: 'users_view', label: 'Ver usuarios' },
      { value: 'users_create', label: 'Crear usuarios' },
      { value: 'users_edit', label: 'Editar usuarios, roles y PIN' },
      { value: 'roles_manage', label: 'Crear y modificar roles' },
      { value: 'attendance', label: 'Administrar asistencia' },
      { value: 'branch_switch', label: 'Cambiar de sucursal' },
    ],
  },
  {
    label: 'Consultas y reportes',
    options: [
      { value: 'reports', label: 'Ver reportes' },
      { value: 'queries', label: 'Ver consultas de ventas' },
      { value: 'advanced_stats', label: 'Ver estadísticas avanzadas' },
    ],
  },
];


export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchAccess, setBranchAccess] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'users' | 'roles' | 'schedules'>('users');
  const [scheduleUserId, setScheduleUserId] = useState('');
  const [scheduleMonth, setScheduleMonth] = useState(startOfMonthISO());
  const [scheduleRows, setScheduleRows] = useState<EmployeeSchedule[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [form, setForm] = useState<Partial<Profile> & { pin?: string; branch_ids?: string[] }>({});
  const [avatarImage, setAvatarImage] = useState<ImageUploadValue>({ file: null, currentUrl: null, removed: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleEditing, setRoleEditing] = useState<Role | null>(null);
  const [roleForm, setRoleForm] = useState<{ name: string; description: string; permissions: string[] }>({ name: '', description: '', permissions: [] });
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: pData }, { data: rData }, { data: bData }, { data: aData }] = await Promise.all([
      supabase.from('profiles').select('*, role:roles(*), branch:branches!profiles_branch_id_fkey(*)').order('full_name'),
      supabase.from('roles').select('*').order('name'),
      supabase.from('branches').select('*').order('name'),
      supabase.from('user_branch_access').select('user_id, branch_id'),
    ]);
    setProfiles((pData as Profile[]) ?? []);
    setRoles((rData as Role[]) ?? []);
    setBranches((bData as Branch[]) ?? []);
    const accessMap: Record<string, string[]> = {};
    for (const row of (aData as { user_id: string; branch_id: string }[]) ?? []) {
      accessMap[row.user_id] = [...(accessMap[row.user_id] ?? []), row.branch_id];
    }
    setBranchAccess(accessMap);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!scheduleUserId && profiles[0]) setScheduleUserId(profiles[0].id);
  }, [profiles, scheduleUserId]);

  const loadSchedules = useCallback(async () => {
    if (!scheduleUserId) return;
    setScheduleLoading(true);
    const { data, error: scheduleError } = await supabase.from('employee_schedules').select('*').eq('user_id', scheduleUserId).eq('month_start', scheduleMonth).order('day_of_week');
    if (scheduleError) console.error('schedule load failed', scheduleError);
    const existing = (data as EmployeeSchedule[]) ?? [];
    const rows = Array.from({ length: 7 }, (_, day) => existing.find((row) => row.day_of_week === day) ?? ({ user_id: scheduleUserId, month_start: scheduleMonth, day_of_week: day, branch_id: '', start_time: '09:00:00', end_time: '17:00:00', break_minutes: 0, tolerance_minutes: 10, exit_grace_minutes: 0, rest_day: day === 0, active: true } as EmployeeSchedule));
    setScheduleRows(rows);
    setScheduleLoading(false);
  }, [scheduleMonth, scheduleUserId]);

  useEffect(() => { if (tab === 'schedules') loadSchedules(); }, [loadSchedules, tab]);

  const updateScheduleRow = (day: number, patch: Partial<EmployeeSchedule>) => {
    setScheduleRows((rows) => rows.map((row) => row.day_of_week === day ? { ...row, ...patch } : row));
  };

  const saveSchedules = async () => {
    setSaving(true); setError(null);
    const { error: saveError } = await supabase.from('employee_schedules').upsert(scheduleRows.map((row) => ({ user_id: scheduleUserId, month_start: scheduleMonth, day_of_week: row.day_of_week, branch_id: row.branch_id || null, start_time: row.rest_day ? null : row.start_time, end_time: row.rest_day ? null : row.end_time, break_minutes: Number(row.break_minutes), tolerance_minutes: Number(row.tolerance_minutes), exit_grace_minutes: Number(row.exit_grace_minutes), rest_day: row.rest_day, active: true })), { onConflict: 'user_id,month_start,day_of_week' });
    if (saveError) { console.error('schedule save failed', saveError); setError('No se pudo guardar el horario mensual.'); }
    setSaving(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return searchAndRank(search, profiles, (p) => [p.full_name, p.username]);
  }, [profiles, search]);

  const openNewUser = () => {
    setEditing(null);
    setForm({ full_name: '', username: '', pin: '', role_id: '', branch_id: '', branch_ids: [], phone: '', position: '', daily_rate: 0, hours_per_day: 8, hourly_rate: 0, active: false });
    setAvatarImage({ file: null, currentUrl: null, removed: false });
    setError(null);
    setOpen(true);
  };

  const openEdit = (p: Profile) => {
    setEditing(p);
    setForm({ ...p, branch_ids: branchAccess[p.id] ?? (p.branch_id ? [p.branch_id] : []) });
    setAvatarImage({ file: null, currentUrl: p.avatar_url ?? null, removed: false });
    setError(null);
    setOpen(true);
  };

  const saveProfile = async () => {
    setSaving(true); setError(null);
    const normalizedUsername = form.username?.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9_-]{3,32}$/.test(normalizedUsername) || (!editing && !/^\d{6}$/.test(form.pin ?? '')) || (editing && form.pin && !/^\d{6}$/.test(form.pin)) || Number(form.daily_rate ?? 0) < 0 || Number(form.hours_per_day ?? 0) <= 0 || Number(form.hours_per_day ?? 0) > 24) {
      setError(editing ? 'Revisa el usuario, el PIN y las horas de la jornada.' : 'Captura un usuario válido, un PIN de 6 dígitos y horas válidas de jornada.');
      setSaving(false);
      return;
    }
    let avatarUrl: string | null = editing?.avatar_url ?? null;
    if (avatarImage.file) {
      avatarUrl = await uploadImage(APP_IMAGES_BUCKET, avatarImage.file);
      if (!avatarUrl) { setError('No se pudo subir la fotografía. Intenta de nuevo.'); setSaving(false); return; }
    } else if (avatarImage.removed) {
      avatarUrl = null;
    }
    if (!editing) {
      const dailyRate = Number(form.daily_rate ?? 0);
      const hoursPerDay = Number(form.hours_per_day ?? 8);
      const hourlyRate = hoursPerDay > 0 ? dailyRate / hoursPerDay : 0;
      const { error: createError } = await supabase.functions.invoke('admin-create-user', {
        body: { username: normalizedUsername, pin: form.pin, fullName: form.full_name, roleId: form.role_id || null, branchId: form.branch_ids?.[0] || null, branchIds: form.branch_ids ?? [], phone: form.phone || null, position: form.position || null, avatarUrl, dailyRate, hoursPerDay, hourlyRate },
      });
      if (createError) {
        console.error('admin-create-user failed', createError);
        let message = 'No se pudo crear el usuario. Revisa los datos e intenta de nuevo.';
        try {
          const response = (createError as { context?: Response }).context;
          const payload = response ? await response.clone().json() as { error?: string } : null;
          if (payload?.error) message = payload.error;
        } catch {
          // Keep the friendly fallback when the function response has no readable body.
        }
        setError(message); setSaving(false); return;
      }
      setSaving(false); setOpen(false); load(); return;
    }
    const { error: e } = await supabase.rpc('admin_update_user', {
      target_id: editing.id,
      p_full_name: form.full_name ?? editing.full_name,
      p_role_id: form.role_id || null,
      p_branch_id: form.branch_ids?.[0] || null,
      p_active: form.active ?? true,
      p_phone: form.phone || null,
      p_position: form.position || null,
      p_avatar_url: avatarUrl,
      p_branch_ids: form.branch_ids ?? [],
      p_username: normalizedUsername || editing.username,
      p_pin: form.pin || null,
      p_daily_rate: Number(form.daily_rate ?? 0),
      p_hours_per_day: Number(form.hours_per_day ?? 8),
      p_hourly_rate: Number(form.hourly_rate ?? 0),
    });
    if (e) {
      console.error('admin_update_user failed', e);
      const rpcMessage = e.message.toLowerCase();
      setError(rpcMessage.includes('no autorizado') ? 'Tu cuenta no tiene permisos de administrador para guardar este cambio.' : rpcMessage.includes('usuario ya existe') ? 'Ese nombre de usuario ya está ocupado.' : rpcMessage.includes('usuario inválido') ? 'El nombre de usuario no es válido.' : rpcMessage.includes('pin inválido') ? 'El PIN debe tener 6 dígitos.' : rpcMessage.includes('pago u horario inválido') ? 'Revisa el pago diario y las horas de la jornada.' : `No se pudo guardar el usuario: ${e.message}`);
      setSaving(false);
      return;
    }
    setSaving(false); setOpen(false); load();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setError(null);
    const { error: deleteError } = await supabase.rpc('admin_delete_user', { p_target_id: deleteTarget.id });
    if (deleteError) {
      console.error('admin_delete_user failed', deleteError);
      setError(deleteError.message.includes('nómina') ? 'Este empleado tiene registros de nómina. Inactívalo en lugar de eliminarlo para conservar el historial.' : 'No se pudo eliminar el empleado.');
    } else {
      setDeleteTarget(null);
      await load();
    }
    setDeleting(false);
  };

  const openRoleNew = () => {
    setRoleEditing(null);
    setRoleForm({ name: '', description: '', permissions: [] });
    setError(null);
    setRoleOpen(true);
  };
  const openRoleEdit = (r: Role) => {
    setRoleEditing(r);
    setRoleForm({ name: r.name, description: r.description ?? '', permissions: r.permissions ?? [] });
    setError(null);
    setRoleOpen(true);
  };
  const saveRole = async () => {
    setSaving(true); setError(null);
    if (!roleForm.name.trim()) { setError('El nombre es obligatorio'); setSaving(false); return; }
    const payload = { name: roleForm.name.trim(), description: roleForm.description, permissions: roleForm.permissions };
    if (roleEditing) {
      const { error: e } = await supabase.from('roles').update(payload).eq('id', roleEditing.id);
      if (e) { console.error('role update failed', e); setError('No se pudo guardar el rol. Solo un administrador puede modificar permisos.'); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('roles').insert(payload);
      if (e) { console.error('role insert failed', e); setError('No se pudo crear el rol. Solo un administrador puede crear roles.'); setSaving(false); return; }
    }
    setSaving(false); setRoleOpen(false); load();
  };
  const togglePerm = (perm: string) => {
    setRoleForm((f) => {
      if (perm === 'all') return { ...f, permissions: f.permissions.includes('all') ? [] : ['all'] };
      let next = f.permissions.filter((p) => p !== 'all');
      if (next.includes(perm)) next = next.filter((p) => p !== perm);
      else next = [...next, perm];
      return { ...f, permissions: next };
    });
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader title="Usuarios y Roles" subtitle="Gestión de personal y permisos" />

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('users')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === 'users' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
        >
          Usuarios ({profiles.length})
        </button>
        <button
          onClick={() => setTab('roles')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === 'roles' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
        >
          Roles ({roles.length})
        </button>
        <button
          onClick={() => setTab('schedules')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === 'schedules' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
        >
          Horarios y pago
        </button>
      </div>

      {tab === 'users' && (
        <>
          <div className="mb-4 flex items-center gap-3"><SearchInput value={search} onChange={setSearch} className="flex-1" /><Button onClick={openNewUser}><Plus size={16} /> Nuevo usuario</Button></div>
          <Card className="overflow-hidden">
            {filtered.length === 0 ? (
              <EmptyState title="Sin usuarios" description="Los usuarios se crean al registrarse." icon={<UserCog size={48} />} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Usuario</th>
                      <th className="px-4 py-3">Rol</th>
                      <th className="px-4 py-3">Sucursal</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Registro</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {p.avatar_url ? <img src={p.avatar_url} alt={p.full_name} className="h-8 w-8 rounded-full object-cover" /> : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{p.full_name.charAt(0).toUpperCase()}</div>}
                            <div>
                              <div className="font-medium text-slate-800">{p.full_name}</div>
                              <div className="text-xs text-slate-400">{p.position ? `${p.position} · ` : ''}{p.username}</div>
                            </div>
                            {p.id === currentUser?.id && <Badge variant="info">Tú</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3">{p.role ? <Badge variant="info">{p.role.name}</Badge> : '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{p.role?.permissions?.includes('all') || p.role?.permissions?.includes('branch_switch') ? 'Todas' : (branchAccess[p.id] ?? []).map((id) => branches.find((branch) => branch.id === id)?.name).filter(Boolean).join(', ') || 'Sin asignar'}</td>
                        <td className="px-4 py-3">{p.active ? <Badge variant="success">Activo</Badge> : <Badge variant="danger">Inactivo</Badge>}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(p.created_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(p)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600" title="Editar"><Pencil size={15} /></button>
                            {p.id !== currentUser?.id && (
                              <button onClick={() => { setDeleteTarget(p); setError(null); }} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Eliminar"><Trash2 size={15} /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'roles' && (
        <>
          <div className="mb-4 flex justify-end"><Button onClick={openRoleNew}><Plus size={16} /> Nuevo rol</Button></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2"><Shield size={18} className="text-emerald-600" /><div className="font-semibold text-slate-800">{r.name}</div></div>
                  <button onClick={() => openRoleEdit(r)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><Pencil size={14} /></button>
                </div>
                <p className="mt-2 text-xs text-slate-500">{r.description ?? 'Sin descripción'}</p>
                <div className="mt-3 flex flex-wrap gap-1">{(r.permissions ?? []).map((perm) => <Badge key={perm} variant="default">{perm}</Badge>)}</div>
              </Card>
            ))}
          </div>
        </>
      )}

      {tab === 'schedules' && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
              <Field label="Empleado"><Select value={scheduleUserId} onChange={(event) => setScheduleUserId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name} · {profile.username}</option>)}</Select></Field>
              <Field label="Mes"><Input type="month" value={scheduleMonth.slice(0, 7)} onChange={(event) => setScheduleMonth(`${event.target.value}-01`)} /></Field>
              <Button onClick={saveSchedules} disabled={saving || scheduleLoading}><Save size={16} /> {saving ? 'Guardando...' : 'Guardar horario'}</Button>
            </div>
            <p className="mt-3 text-xs text-slate-500">Configura la semana que se repetirá durante el mes. Marca descanso para días rotativos y define la tolerancia de entrada y salida.</p>
          </Card>
          <Card className="overflow-hidden">
            {scheduleLoading ? <div className="p-6"><Spinner size={28} /></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-3 py-3">Día</th><th className="px-3 py-3">Sucursal</th><th className="px-3 py-3">Entrada</th><th className="px-3 py-3">Salida</th><th className="px-3 py-3">Tolerancia</th><th className="px-3 py-3">Descanso</th></tr></thead><tbody className="divide-y divide-slate-100">{scheduleRows.map((row) => <tr key={row.day_of_week}><td className="px-3 py-2 font-medium text-slate-700">{['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][row.day_of_week]}</td><td className="px-3 py-2"><Select value={row.branch_id ?? ''} onChange={(event) => updateScheduleRow(row.day_of_week, { branch_id: event.target.value })}><option value="">Sucursal base</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name.replace('BIENESTAR ', '')}</option>)}</Select></td><td className="px-3 py-2"><Input type="time" disabled={row.rest_day} value={row.start_time?.slice(0, 5) ?? ''} onChange={(event) => updateScheduleRow(row.day_of_week, { start_time: event.target.value })} /></td><td className="px-3 py-2"><Input type="time" disabled={row.rest_day} value={row.end_time?.slice(0, 5) ?? ''} onChange={(event) => updateScheduleRow(row.day_of_week, { end_time: event.target.value })} /></td><td className="px-3 py-2"><Input type="number" min="0" max="180" value={row.tolerance_minutes} onChange={(event) => updateScheduleRow(row.day_of_week, { tolerance_minutes: Number(event.target.value) })} /></td><td className="px-3 py-2 text-center"><input type="checkbox" checked={row.rest_day} onChange={(event) => updateScheduleRow(row.day_of_week, { rest_day: event.target.checked })} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" /></td></tr>)}</tbody></table></div>}
          </Card>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar usuario' : 'Nuevo usuario'} size="md">
        <div className="space-y-4">
          <Field label="Nombre"><Input value={form.full_name ?? ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="Usuario"><Input value={form.username ?? ''} onChange={(e) => setForm({ ...form, username: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="Ej. CAJERO01" maxLength={32} /></Field>
          <Field label={editing ? 'Nuevo PIN (opcional)' : 'PIN de 6 dígitos'}><Input type="password" inputMode="numeric" maxLength={6} value={form.pin ?? ''} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder={editing ? 'Dejar vacío para conservarlo' : 'Seis números'} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Rol">
              <Select value={form.role_id ?? ''} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
                <option value="">Sin rol</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Sucursales autorizadas">
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                {branches.map((branch) => {
                  const selected = (form.branch_ids ?? []).includes(branch.id);
                  return <label key={branch.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={selected} onChange={() => setForm({ ...form, branch_ids: selected ? (form.branch_ids ?? []).filter((id) => id !== branch.id) : [...(form.branch_ids ?? []), branch.id] })} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    {branch.name}
                  </label>;
                })}
                <p className="text-xs text-slate-400">El usuario solo podrá entrar a las sucursales seleccionadas. Administradores y encargados con permiso especial pueden cambiar de sucursal.</p>
              </div>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Pago diario"><Input type="number" min="0" step="0.01" value={form.daily_rate ?? 0} onChange={(e) => setForm({ ...form, daily_rate: Number(e.target.value) })} /></Field>
            <Field label="Horas por jornada"><Input type="number" min="1" max="24" step="0.5" value={form.hours_per_day ?? 8} onChange={(e) => setForm({ ...form, hours_per_day: Number(e.target.value) })} /></Field>
            <Field label="Pago por hora"><Input type="number" value={Number(form.hours_per_day ?? 0) > 0 ? (Number(form.daily_rate ?? 0) / Number(form.hours_per_day ?? 1)).toFixed(2) : '0.00'} readOnly className="bg-slate-50" /></Field>
          </div>
          <Field label="Teléfono"><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Puesto"><Input value={form.position ?? ''} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Cajero, gerente, supervisor..." /></Field>
          <Field label="Fotografía del empleado"><ImageUploadPicker value={avatarImage} onChange={setAvatarImage} onError={setError} alt="Fotografía del empleado" noun="fotografía" /></Field>
          <Field label="Estado">
            <Select value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </Select>
          </Field>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={saveProfile} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={roleOpen} onClose={() => setRoleOpen(false)} title={roleEditing ? 'Editar rol' : 'Nuevo rol'} size="md">
        <div className="space-y-4">
          <Field label="Nombre *"><Input value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} /></Field>
          <Field label="Descripción"><Input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} /></Field>
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700"><KeyRound size={14} /> Permisos</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 cursor-pointer">
                <input type="checkbox" checked={roleForm.permissions.includes('all')} onChange={() => togglePerm('all')} className="rounded border-amber-300 text-emerald-600 focus:ring-emerald-500" />
                Todos los permisos (Administrador)
              </label>
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.label} className="col-span-2 rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{group.label}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.options.map((p) => (
                      <label key={p.value} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                        <input type="checkbox" checked={roleForm.permissions.includes(p.value)} onChange={() => togglePerm(p.value)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                        <span className="text-slate-700">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRoleOpen(false)}>Cancelar</Button>
            <Button onClick={saveRole} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar empleado" size="sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-red-50 p-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-600" />
            <div className="text-sm text-red-800">
              Vas a eliminar a <b>{deleteTarget?.full_name}</b> ({deleteTarget?.username}).
              Se borrarán sus horarios, incidencias y marcaciones de asistencia.
              {deleteTarget?.active && <div className="mt-1 text-red-600">Si tiene ventas o nómina registrada, considera inactivarlo en lugar de eliminarlo.</div>}
            </div>
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Eliminando...' : 'Sí, eliminar'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
