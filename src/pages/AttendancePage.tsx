import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatDate, todayISO } from '@/lib/format';
import type { Attendance, AttendanceIncident, Profile, Branch } from '@/lib/types';
import Button from '@/components/Button';
import { Field, Input, Select, Textarea } from '@/components/Field';
import { PageHeader, Card, EmptyState, Spinner, StatCard } from '@/components/ui';
import Modal from '@/components/Modal';
import AuthorizationModal, { type AuthorizationPayload } from '@/components/AuthorizationModal';
import { Clock, LogIn, LogOut, CalendarDays, AlertTriangle, CheckCircle2, Pencil, ShieldCheck, ClipboardList, ChevronLeft, ChevronRight, UserCog } from 'lucide-react';

const INCIDENT_TYPES = [
  { value: 'correccion', label: 'Corregir marcación' },
  { value: 'permiso', label: 'Permiso justificado' },
  { value: 'vacaciones', label: 'Vacaciones' },
  { value: 'incapacidad', label: 'Incapacidad' },
  { value: 'falta_justificada', label: 'Falta justificada' },
  { value: 'descanso', label: 'Descanso' },
  { value: 'otro', label: 'Otro' },
];

const INCIDENT_LABELS: Record<string, string> = Object.fromEntries(INCIDENT_TYPES.map((t) => [t.value, t.label]));

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MEXICO_TIME_ZONE = 'America/Mexico_City';

function mexicoDateKey(value: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MEXICO_TIME_ZONE }).format(new Date(value));
}

function mexicoDayBoundary(date: string, end = false): string {
  return new Date(`${date}T${end ? '23:59:59' : '00:00:00'}-06:00`).toISOString();
}

function mexicoInputValue(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MEXICO_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour === '24' ? '00' : values.hour}:${values.minute}`;
}

function mexicoInputToIso(value: string): string {
  return new Date(`${value}:00-06:00`).toISOString();
}

function getWeekStart(date: string): string {
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getWeekDays(weekStart: string): string[] {
  const days: string[] = [];
  const d = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function shiftWeek(weekStart: string, direction: number): string {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + direction * 7);
  return d.toISOString().slice(0, 10);
}

function statusLabel(record: Attendance): string {
  if (record.status === 'retardo') return `Retardo · ${record.late_minutes ?? 0} min`;
  if (record.status === 'horas_extra_pendientes') return `Extra pendiente · ${record.overtime_minutes ?? 0} min`;
  if (record.status === 'horas_extra_autorizadas') return `Extra autorizada · ${record.overtime_minutes ?? 0} min`;
  if (record.status === 'justificada') return 'Justificada';
  if (record.status === 'sin_horario') return 'Sin horario asignado';
  if (record.status === 'puntual') return 'Marcación correcta';
  return record.check_out ? 'Completado' : 'Entrada activa';
}

function DigitalClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-900 px-6 py-4 text-center text-white shadow-sm">
      <div className="text-3xl font-bold tracking-widest tabular-nums">{now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-300">{now.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
    </div>
  );
}

export default function AttendancePage() {
  const { user, profile, currentBranch, branches, setCurrentBranchId, hasPermission } = useAuth();
  const [records, setRecords] = useState<Attendance[]>([]);
  const [incidents, setIncidents] = useState<AttendanceIncident[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => getWeekStart(todayISO()));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentTarget, setIncidentTarget] = useState<Attendance | null>(null);
  const [incidentType, setIncidentType] = useState('correccion');
  const [incidentReason, setIncidentReason] = useState('');
  const [correctedIn, setCorrectedIn] = useState('');
  const [correctedOut, setCorrectedOut] = useState('');
  const [showIncidents, setShowIncidents] = useState(false);
  const [adminMarkOpen, setAdminMarkOpen] = useState(false);
  const [adminTargetUser, setAdminTargetUser] = useState('');
  const [adminAction, setAdminAction] = useState<'entrada' | 'salida'>('entrada');
  const [adminTime, setAdminTime] = useState(() => mexicoInputValue());
  const [adminNotes, setAdminNotes] = useState('');
  const [authorizationOpen, setAuthorizationOpen] = useState(false);
  const [authorizationPayload, setAuthorizationPayload] = useState<AuthorizationPayload | null>(null);
  const [pendingAuthorizationAction, setPendingAuthorizationAction] = useState<'entrada' | 'salida' | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canManage = hasPermission('settings');
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  const load = useCallback(async () => {
    if (!currentBranch) return;
    setLoading(true);
    const start = mexicoDayBoundary(weekStart);
    const end = mexicoDayBoundary(weekDays[6], true);
    const [attRes, profRes, incRes] = await Promise.all([
      supabase.from('attendance').select('*, branch:branches(*)').eq('branch_id', currentBranch.id).gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false }),
      canManage
        ? supabase.from('profiles').select('*').order('full_name')
        : supabase.from('profiles').select('*').eq('id', user?.id ?? ''),
      supabase.from('attendance_incidents').select('*, user:profiles(*)').eq('branch_id', currentBranch.id).gte('incident_date', weekStart).lte('incident_date', weekDays[6]).order('created_at', { ascending: false }),
    ]);
    if (attRes.error) console.error('attendance load failed', attRes.error);
    const profileMap = new Map(((profRes.data as Profile[]) ?? []).map((p) => [p.id, p]));
    setRecords(((attRes.data as Attendance[]) ?? []).map((r) => ({ ...r, user: r.user_id ? profileMap.get(r.user_id) ?? null : null })));
    setProfiles((profRes.data as Profile[]) ?? []);
    setIncidents((incRes.data as AttendanceIncident[]) ?? []);
    setLoading(false);
  }, [canManage, currentBranch, user, weekStart, weekDays]);

  useEffect(() => { load(); }, [load]);

  const myRecords = useMemo(() => records.filter((r) => r.user_id === user?.id), [records, user]);
  const myOpenRecord = useMemo(() => myRecords.find((r) => r.check_in && !r.check_out), [myRecords]);

  const myWeeklyMap = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const r of myRecords) {
      if (r.check_in) {
        const dayKey = mexicoDateKey(r.check_in);
        if (!map.has(dayKey) || r.check_out) map.set(dayKey, r);
      }
    }
    return map;
  }, [myRecords]);

  const pendingOvertime = useMemo(() => records.filter((r) => r.status === 'horas_extra_pendientes' && !r.overtime_authorized), [records]);

  const mark = async (action: 'entrada' | 'salida', authorizationRequestId: string | null = null) => {
    if (!currentBranch) return;
    setSaving(true); setError(null);
    const { error: markError } = await supabase.rpc('register_attendance', {
      p_branch_id: currentBranch.id,
      p_action: action,
      p_notes: notes || null,
      p_authorization_request_id: authorizationRequestId,
    });
    if (markError) {
      console.error('attendance mark failed', markError);
      if (markError.message === 'ATTENDANCE_AUTH_REQUIRED' && !authorizationRequestId) {
        setPendingAuthorizationAction(action);
        setAuthorizationPayload({
          operationType: 'attendance_incident',
          branchId: currentBranch.id,
          summary: `${action === 'entrada' ? 'Entrada' : 'Salida'} fuera del horario establecido`,
          payload: { action, branchId: currentBranch.id },
        });
        setAuthorizationOpen(true);
      } else {
        setError('No se pudo registrar la marcación. Revisa si ya tienes una entrada o salida abierta.');
      }
    } else {
      setNotes('');
      setSuccessMessage(action === 'entrada' ? 'Entrada registrada correctamente.' : 'Salida registrada correctamente.');
      await load();
    }
    setSaving(false);
  };

  const adminMark = async () => {
    if (!currentBranch || !adminTargetUser) return;
    setSaving(true); setError(null);
    const checkTime = mexicoInputToIso(adminTime);
    const { error: adminErr } = await supabase.rpc('admin_register_attendance', {
      p_target_user_id: adminTargetUser,
      p_branch_id: currentBranch.id,
      p_action: adminAction,
      p_check_in_time: checkTime,
      p_check_out_time: checkTime,
      p_notes: adminNotes || null,
    });
    if (adminErr) {
      console.error('admin attendance failed', adminErr);
      setError('No se pudo registrar la marcación del empleado.');
    } else {
      setAdminMarkOpen(false);
      setAdminNotes('');
      setSuccessMessage(`${adminAction === 'entrada' ? 'Entrada' : 'Salida'} del empleado registrada correctamente.`);
      await load();
    }
    setSaving(false);
  };

  const authorizeOvertime = async (recordId: string) => {
    setSaving(true); setError(null);
    const { error: authError } = await supabase.rpc('authorize_overtime', { p_attendance_id: recordId });
    if (authError) {
      console.error('overtime authorize failed', authError);
      setError('No se pudo autorizar las horas extra.');
    } else {
      await load();
    }
    setSaving(false);
  };

  const openIncident = (record: Attendance | null) => {
    setIncidentTarget(record);
    setIncidentType('correccion');
    setIncidentReason('');
    setCorrectedIn(record?.check_in ? new Date(record.check_in).toISOString().slice(0, 16) : `${todayISO()}T09:00`);
    setCorrectedOut(record?.check_out ? new Date(record.check_out).toISOString().slice(0, 16) : `${todayISO()}T17:00`);
    setIncidentOpen(true);
  };

  const saveIncident = async () => {
    if (!incidentReason.trim() || !incidentTarget?.user_id || !currentBranch) return;
    setSaving(true); setError(null);
    const incidentDate = incidentTarget.check_in ? mexicoDateKey(incidentTarget.check_in) : todayISO();
    const { error: incidentError } = await supabase.from('attendance_incidents').insert({
      user_id: incidentTarget.user_id,
      attendance_id: incidentTarget.id,
      branch_id: currentBranch.id,
      incident_date: incidentDate,
      type: incidentType,
      corrected_check_in: incidentType === 'correccion' ? new Date(correctedIn).toISOString() : null,
      corrected_check_out: incidentType === 'correccion' ? new Date(correctedOut).toISOString() : null,
      reason: incidentReason.trim(),
    });
    if (incidentError) {
      console.error('attendance incident failed', incidentError);
      setError('No se pudo guardar la incidencia.');
    } else {
      setIncidentOpen(false);
      await load();
    }
    setSaving(false);
  };

  const applyIncident = async (incidentId: string) => {
    setSaving(true); setError(null);
    const { error: applyError } = await supabase.rpc('apply_attendance_incident', { p_incident_id: incidentId });
    if (applyError) {
      console.error('apply incident failed', applyError);
      setError('No se pudo aplicar la incidencia al registro de asistencia.');
    } else {
      await load();
    }
    setSaving(false);
  };

  const presentCount = records.filter((r) => r.check_in && !r.check_out).length;
  const checkedOutCount = records.filter((r) => r.check_out).length;
  const lateCount = records.filter((r) => r.status === 'retardo').length;

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader title="Asistencia de Personal" subtitle={currentBranch?.name} />
      {successMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg">
          <CheckCircle2 size={18} />
          <span>{successMessage}</span>
          <button type="button" onClick={() => setSuccessMessage(null)} className="ml-2 text-emerald-100 hover:text-white" aria-label="Cerrar confirmación">×</button>
        </div>
      )}

      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_320px]">
        {canManage ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Presentes ahora" value={String(presentCount)} icon={<LogIn size={18} />} accent="emerald" />
            <StatCard label="Ya salieron" value={String(checkedOutCount)} icon={<LogOut size={18} />} accent="slate" />
            <StatCard label="Retardos de la semana" value={String(lateCount)} icon={<AlertTriangle size={18} />} accent="amber" />
          </div>
        ) : <div />}
        <DigitalClock />
      </div>

      {pendingOvertime.length > 0 && canManage && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800"><ShieldCheck size={18} /> {pendingOvertime.length} horas extra pendientes de autorizar</div>
          <div className="mt-2 space-y-1.5">
            {pendingOvertime.map((record) => (
              <div key={record.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                <span className="text-slate-700">{record.user?.full_name ?? 'Empleado'} · {record.overtime_minutes ?? 0} min extra</span>
                <Button size="sm" onClick={() => authorizeOvertime(record.id)} disabled={saving}><ShieldCheck size={14} /> Autorizar</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {canManage && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {branches.map((branch: Branch) => <button key={branch.id} onClick={() => setCurrentBranchId(branch.id)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${branch.id === currentBranch?.id ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{branch.name.replace('BIENESTAR ', '')}</button>)}
        </div>
      )}

      {/* Self check-in / check-out */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Notas (opcional)" className="flex-1"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Comentario de la marcación..." /></Field>
          {!myOpenRecord ? <Button onClick={() => mark('entrada')} disabled={saving}><LogIn size={16} /> Registrar entrada</Button> : <Button variant="danger" onClick={() => mark('salida')} disabled={saving}><LogOut size={16} /> Registrar salida</Button>}
          {canManage && <Button variant="secondary" onClick={() => setAdminMarkOpen(true)}><UserCog size={16} /> Marcar empleado</Button>}
          {canManage && <Button variant="secondary" onClick={() => openIncident(records[0] ?? null)}><Pencil size={16} /> Incidencia</Button>}
          {canManage && incidents.length > 0 && <Button variant="secondary" onClick={() => setShowIncidents((v) => !v)}><ClipboardList size={16} /> Incidencias ({incidents.length})</Button>}
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      </Card>

      {/* Weekly view — my attendance */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-slate-700">Mi asistencia semanal</h3>
            <span className="text-xs text-slate-400">{profile?.full_name ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekStart(shiftWeek(weekStart, -1))} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50" aria-label="Semana anterior"><ChevronLeft size={18} /></button>
            <span className="text-xs font-medium text-slate-500">{formatDate(weekStart)} — {formatDate(weekDays[6])}</span>
            <button onClick={() => setWeekStart(shiftWeek(weekStart, 1))} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50" aria-label="Semana siguiente"><ChevronRight size={18} /></button>
            <button onClick={() => setWeekStart(getWeekStart(todayISO()))} className="ml-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100">Hoy</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Día</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Entrada</th>
                <th className="px-4 py-3">Salida</th>
                <th className="px-4 py-3">Tiempo</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {weekDays.map((day, i) => {
                const record = myWeeklyMap.get(day);
                const isToday = day === todayISO();
                const duration = record?.check_in && record?.check_out ? Math.round((new Date(record.check_out).getTime() - new Date(record.check_in).getTime()) / 60000) : null;
                const good = record && (record.status === 'puntual' || record.status === 'completada' || record.status === 'horas_extra_autorizadas' || record.status === 'justificada');
                const isLate = record?.status === 'retardo';
                return (
                  <tr key={day} className={`hover:bg-slate-50/50 ${isToday ? 'bg-emerald-50/30' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-700">{WEEKDAYS[i]}{isToday && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">HOY</span>}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(day)}</td>
                    <td className="px-4 py-3 text-slate-600">{record ? formatDateTime(record.check_in) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{record ? formatDateTime(record.check_out) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{duration != null ? `${Math.floor(duration / 60)}h ${duration % 60}m` : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3">
                      {record ? (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${good ? 'bg-emerald-50 text-emerald-700' : isLate ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                          {good ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{statusLabel(record)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">Sin registro</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Admin: all employees weekly overview */}
      {canManage && (
        <Card className="mb-4 overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">Asistencia de todos los empleados — Semana del {formatDate(weekStart)}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Empleado</th>
                  <th className="px-4 py-3">Puesto</th>
                  {weekDays.map((day, i) => <th key={day} className="px-2 py-3 text-center">{WEEKDAYS[i].slice(0, 3)}<br /><span className="text-[10px] font-normal text-slate-400">{day.slice(8)}</span></th>)}
                  <th className="px-4 py-3 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profiles.map((p) => {
                  const empRecords = records.filter((r) => r.user_id === p.id);
                  const empOpen = empRecords.find((r) => r.check_in && !r.check_out);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-700">{p.full_name}</td>
                      <td className="px-4 py-3 text-slate-500">{p.position ?? p.role?.name ?? '—'}</td>
                      {weekDays.map((day) => {
                        const dayRec = empRecords.find((r) => r.check_in && r.check_in.slice(0, 10) === day);
                        const hasEntry = !!dayRec;
                        const hasExit = !!dayRec?.check_out;
                        const isLate = dayRec?.status === 'retardo';
                        return (
                          <td key={day} className="px-2 py-3 text-center">
                            {hasEntry ? (
                              <span className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${hasExit ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'} ${isLate ? 'ring-1 ring-red-300' : ''}`} title={dayRec ? statusLabel(dayRec) : ''}>
                                {hasExit ? '✓' : 'E'}
                              </span>
                            ) : (
                              <span className="text-slate-200">·</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => {
                            setAdminTargetUser(p.id);
                            setAdminAction(empOpen ? 'salida' : 'entrada');
                            setAdminTime(mexicoInputValue());
                            setAdminMarkOpen(true);
                          }}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          {empOpen ? 'Registrar salida' : 'Registrar entrada'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {profiles.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-400">No hay empleados registrados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canManage && (
      <>
      {/* Detailed records list */}
      <Card className="mb-4 overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">Registros detallados de la semana</div>
        {records.length === 0 ? <EmptyState title="Sin registros" description="No hay asistencia registrada en esta semana." icon={<Clock size={48} />} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Empleado</th><th className="px-4 py-3">Entrada</th><th className="px-4 py-3">Salida</th><th className="px-4 py-3">Tiempo</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((record) => {
                  const duration = record.check_in && record.check_out ? Math.round((new Date(record.check_out).getTime() - new Date(record.check_in).getTime()) / 60000) : null;
                  const good = record.status === 'puntual' || record.status === 'completada' || record.status === 'horas_extra_autorizadas' || record.status === 'justificada';
                  const isLate = record.status === 'retardo';
                  const isPendingExtra = record.status === 'horas_extra_pendientes' && !record.overtime_authorized;
                  return <tr key={record.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{(record.user?.full_name ?? '?').charAt(0).toUpperCase()}</div><div><div className="font-medium text-slate-700">{record.user?.full_name ?? 'Desconocido'}</div><div className="text-xs text-slate-400">{record.user?.position ?? '—'}</div>{record.correction_reason && <div className="text-xs text-amber-600">Corregido: {record.correction_reason}</div>}{!record.correction_reason && record.notes && <div className="text-xs text-slate-400">{record.notes}</div>}</div></div></td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(record.check_in)}</td><td className="px-4 py-3 text-slate-600">{formatDateTime(record.check_out)}</td><td className="px-4 py-3 text-slate-600">{duration != null ? `${Math.floor(duration / 60)}h ${duration % 60}m` : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${good ? 'bg-emerald-50 text-emerald-700' : isLate ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{good ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{statusLabel(record)}</span>
                      {isPendingExtra && canManage && <button onClick={() => authorizeOvertime(record.id)} disabled={saving} className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-amber-700"><ShieldCheck size={12} /> Autorizar</button>}
                    </td>
                    <td className="px-4 py-3 text-right">{canManage && <button onClick={() => openIncident(record)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600" title="Agregar incidencia"><Pencil size={15} /></button>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      </>
      )}

      {showIncidents && incidents.length > 0 && (
        <Card className="mt-4 overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">Incidencias de la semana</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Empleado</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Motivo</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {incidents.map((incident) => (
                  <tr key={incident.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-700">{incident.user?.full_name ?? 'Empleado'}</td>
                    <td className="px-4 py-3 text-slate-600">{INCIDENT_LABELS[incident.type] ?? incident.type}</td>
                    <td className="px-4 py-3 text-slate-600">{incident.reason}</td>
                    <td className="px-4 py-3">{incident.approved_at ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"><CheckCircle2 size={12} /> Aplicada</span> : <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"><AlertTriangle size={12} /> Pendiente</span>}</td>
                    <td className="px-4 py-3 text-right">{canManage && !incident.approved_at && <Button size="sm" onClick={() => applyIncident(incident.id)} disabled={saving}>Aplicar</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AuthorizationModal
        open={authorizationOpen}
        onClose={() => {
          setAuthorizationOpen(false);
          setPendingAuthorizationAction(null);
        }}
        payload={authorizationPayload}
        onAuthorized={async (request) => {
          if (!pendingAuthorizationAction) return;
          const action = pendingAuthorizationAction;
          setAuthorizationOpen(false);
          setPendingAuthorizationAction(null);
          await mark(action, request.id);
        }}
      />

      {/* Admin mark modal */}
      <Modal open={adminMarkOpen} onClose={() => setAdminMarkOpen(false)} title="Registrar asistencia de empleado" size="md">
        <div className="space-y-4">
          <Field label="Empleado">
            <Select value={adminTargetUser} onChange={(e) => setAdminTargetUser(e.target.value)}>
              <option value="">Selecciona un empleado</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {p.position ?? p.role?.name ?? 'Sin puesto'}</option>)}
            </Select>
          </Field>
          <Field label="Acción">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setAdminAction('entrada')} className={`rounded-lg border py-3 text-sm font-medium ${adminAction === 'entrada' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 text-slate-600'}`}><LogIn size={18} className="mx-auto mb-1" /> Entrada</button>
              <button onClick={() => setAdminAction('salida')} className={`rounded-lg border py-3 text-sm font-medium ${adminAction === 'salida' ? 'border-red-600 bg-red-600 text-white' : 'border-slate-200 text-slate-600'}`}><LogOut size={18} className="mx-auto mb-1" /> Salida</button>
            </div>
          </Field>
          <Field label="Fecha y hora"><Input type="datetime-local" value={adminTime} onChange={(e) => setAdminTime(e.target.value)} /></Field>
          <Field label="Notas (opcional)"><Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Motivo del registro manual..." rows={2} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAdminMarkOpen(false)}>Cancelar</Button><Button onClick={adminMark} disabled={saving || !adminTargetUser}>{saving ? 'Guardando...' : 'Registrar'}</Button></div>
        </div>
      </Modal>

      {/* Incident modal */}
      <Modal open={incidentOpen} onClose={() => setIncidentOpen(false)} title="Incidencia de asistencia" size="md">
        <div className="space-y-4">
          <Field label="Empleado"><Select value={incidentTarget?.user_id ?? ''} disabled={!canManage} onChange={(e) => setIncidentTarget(records.find((r) => r.user_id === e.target.value) ?? null)}><option value="">Selecciona un empleado</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select></Field>
          <Field label="Tipo"><Select value={incidentType} onChange={(e) => setIncidentType(e.target.value)}>{INCIDENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</Select></Field>
          {incidentType === 'correccion' && <div className="grid grid-cols-2 gap-3"><Field label="Entrada corregida"><Input type="datetime-local" value={correctedIn} onChange={(e) => setCorrectedIn(e.target.value)} /></Field><Field label="Salida corregida"><Input type="datetime-local" value={correctedOut} onChange={(e) => setCorrectedOut(e.target.value)} /></Field></div>}
          <Field label="Motivo"><Textarea value={incidentReason} onChange={(e) => setIncidentReason(e.target.value)} placeholder="Describe la autorización o corrección..." rows={3} /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setIncidentOpen(false)}>Cancelar</Button><Button onClick={saveIncident} disabled={saving || !incidentTarget?.user_id || !incidentReason.trim()}>{saving ? 'Guardando...' : 'Guardar incidencia'}</Button></div>
        </div>
      </Modal>
    </div>
  );
}
