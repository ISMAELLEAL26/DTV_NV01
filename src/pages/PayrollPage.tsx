import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, formatDate, todayISO } from '@/lib/format';
import { PROGRAM_LOGO } from '@/lib/branding';
import type { Attendance, PayrollEntry, PayrollPeriod, Profile, Branch } from '@/lib/types';
import { printCashTicket } from '@/components/TicketPrint';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select, Textarea } from '@/components/Field';
import { PageHeader, Card, EmptyState, Spinner } from '@/components/ui';
import { Calculator, CalendarRange, FileText, Plus, Printer, Receipt, WalletCards, Ticket } from 'lucide-react';

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));

const printPayrollLetter = (period: PayrollPeriod, entries: PayrollEntry[]) => {
  const rows = entries.map((entry) => `<tr><td>${escapeHtml(entry.user?.full_name ?? 'Empleado')}</td><td>${entry.regular_hours.toFixed(2)}</td><td>${entry.overtime_hours.toFixed(2)}</td><td>$${entry.base_pay.toFixed(2)}</td><td>$${entry.overtime_pay.toFixed(2)}</td><td>$${entry.adjustments_total.toFixed(2)}</td><td><b>$${entry.total_pay.toFixed(2)}</b></td></tr>`).join('');
  const total = entries.reduce((sum, entry) => sum + Number(entry.total_pay), 0);
  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
  if (!win) return;
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Nómina ${escapeHtml(period.name)}</title><style>@page{size:letter;margin:16mm}body{font-family:Arial,sans-serif;color:#152238}h1{margin-bottom:4px}p{color:#526174}table{width:100%;border-collapse:collapse;margin-top:24px;font-size:12px}th,td{border-bottom:1px solid #dbe3ec;padding:8px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#eef4f8}.total{text-align:right;font-size:18px;margin-top:20px;font-weight:bold}</style></head><body><h1>Reporte de nómina</h1><p>${escapeHtml(period.name)} · Del ${escapeHtml(formatDate(period.start_date))} al ${escapeHtml(formatDate(period.end_date))}</p><table><thead><tr><th>Empleado</th><th>Horas</th><th>Extra</th><th>Base</th><th>Extra</th><th>Ajustes</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total a pagar: $${total.toFixed(2)}</div><script>window.onload=function(){window.print();}</script></body></html>`);
  win.document.close();
};

const printEmployeeTicket = (entry: PayrollEntry, period: PayrollPeriod, branch: Branch | null) => {
  const rows: { label: string; value: string }[] = [
    { label: 'Periodo', value: `${formatDate(period.start_date)} a ${formatDate(period.end_date)}` },
    { label: 'Pago', value: period.pay_date ? formatDate(period.pay_date) : 'Pendiente' },
    { label: 'Horas reg.', value: `${entry.regular_hours.toFixed(2)} h` },
    { label: 'Horas extra', value: `${entry.overtime_hours.toFixed(2)} h` },
    { label: 'Pago base', value: formatCurrency(Number(entry.base_pay)) },
    { label: 'Pago extra', value: formatCurrency(Number(entry.overtime_pay)) },
    { label: 'Ajustes', value: formatCurrency(entry.adjustments_total) },
  ];
  const fakeBranch: Branch = branch ?? {
    id: '', name: 'NÓMINA', address: null, street: null, exterior_number: null, interior_number: null,
    neighborhood: null, locality: null, municipality: null, state: null, postal_code: null,
    logo_url: null, phone: null, email: null, email_cc: null, active: true, created_at: '',
  };
  void printCashTicket({
    branch: fakeBranch,
    logoUrl: PROGRAM_LOGO,
    storeName: fakeBranch.name,
    title: 'Recibo de nómina',
    folio: period.name,
    cashierName: entry.user?.full_name ?? 'Empleado',
    createdAt: new Date().toLocaleString('es-MX'),
    currencySymbol: '$',
    rows,
    resultLabel: 'Total a pagar',
    resultValue: formatCurrency(entry.total_pay),
    signatureLine: true,
  });
};

export default function PayrollPage() {
  const { hasPermission, currentBranch } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [form, setForm] = useState({ name: 'Nómina semanal', start_date: todayISO(), end_date: todayISO(), pay_date: todayISO() });
  const [adjustment, setAdjustment] = useState({ user_id: '', type: 'descuento', concept: '', amount: '', notes: '' });

  const loadBase = useCallback(async () => {
    setLoading(true);
    const [{ data: profileData }, { data: periodData, error: periodError }] = await Promise.all([
      supabase.from('profiles').select('*').eq('active', true).order('full_name'),
      supabase.from('payroll_periods').select('*').order('start_date', { ascending: false }),
    ]);
    if (periodError) console.error('payroll periods load failed', periodError);
    setProfiles((profileData as Profile[]) ?? []);
    const loadedPeriods = (periodData as PayrollPeriod[]) ?? [];
    setPeriods(loadedPeriods);
    setSelectedPeriod((current) => current ? loadedPeriods.find((period) => period.id === current.id) ?? loadedPeriods[0] ?? null : loadedPeriods[0] ?? null);
    setLoading(false);
  }, []);

  const loadEntries = useCallback(async () => {
    if (!selectedPeriod) { setEntries([]); return; }
    const { data, error: entryError } = await supabase.from('payroll_entries').select('*, user:profiles(*)').eq('period_id', selectedPeriod.id).order('total_pay', { ascending: false });
    if (entryError) console.error('payroll entries load failed', entryError);
    setEntries((data as PayrollEntry[]) ?? []);
  }, [selectedPeriod]);

  useEffect(() => { loadBase(); }, [loadBase]);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  const calculate = async () => {
    if (!selectedPeriod) return;
    setSaving(true); setError(null);
    const [{ data: attendanceData, error: attendanceError }, { data: adjustmentData }] = await Promise.all([
      supabase.from('attendance').select('*').gte('created_at', `${selectedPeriod.start_date}T00:00:00`).lte('created_at', `${selectedPeriod.end_date}T23:59:59`),
      supabase.from('payroll_adjustments').select('user_id, type, amount').eq('period_id', selectedPeriod.id),
    ]);
    if (attendanceError) {
      console.error('payroll attendance load failed', attendanceError);
      setError('No se pudo calcular la nómina.'); setSaving(false); return;
    }
    const adjustmentMap = new Map<string, number>();
    for (const row of (adjustmentData as { user_id: string; type: string; amount: number }[]) ?? []) {
      const signed = row.type === 'descuento' || row.type === 'prestamo' || row.type === 'merma' || row.type === 'anticipo' ? -Number(row.amount) : Number(row.amount);
      adjustmentMap.set(row.user_id, (adjustmentMap.get(row.user_id) ?? 0) + signed);
    }
    const rows = profiles.map((profile) => {
      const records = ((attendanceData as Attendance[]) ?? []).filter((record) => record.user_id === profile.id && record.check_in && record.check_out);
      const totalMinutes = records.reduce((sum, record) => sum + Math.max(0, (new Date(record.check_out as string).getTime() - new Date(record.check_in as string).getTime()) / 60000), 0);
      const overtimeHours = records.reduce((sum, record) => sum + (record.overtime_authorized ? Number(record.overtime_minutes ?? 0) / 60 : 0), 0);
      const regularHours = Math.max(0, totalMinutes / 60 - overtimeHours);
      const hourlyRate = Number(profile.hourly_rate || (Number(profile.daily_rate) / Number(profile.hours_per_day || 8)));
      const basePay = regularHours * hourlyRate;
      const overtimePay = overtimeHours * hourlyRate * 1.5;
      const adjustmentsTotal = adjustmentMap.get(profile.id) ?? 0;
      return { period_id: selectedPeriod.id, user_id: profile.id, regular_hours: Number(regularHours.toFixed(2)), overtime_hours: Number(overtimeHours.toFixed(2)), hourly_rate: Number(hourlyRate.toFixed(2)), base_pay: Number(basePay.toFixed(2)), overtime_pay: Number(overtimePay.toFixed(2)), adjustments_total: Number(adjustmentsTotal.toFixed(2)), total_pay: Number((basePay + overtimePay + adjustmentsTotal).toFixed(2)), notes: null };
    });
    const { error: saveError } = await supabase.from('payroll_entries').upsert(rows, { onConflict: 'period_id,user_id' });
    if (saveError) { console.error('payroll save failed', saveError); setError('No se pudo guardar el cálculo de nómina.'); }
    else { await supabase.from('payroll_periods').update({ status: 'calculado' }).eq('id', selectedPeriod.id); await loadBase(); }
    setSaving(false);
  };

  const createPeriod = async () => {
    if (!form.name.trim()) return;
    setSaving(true); setError(null);
    const { data, error: createError } = await supabase.from('payroll_periods').insert({ name: form.name.trim(), start_date: form.start_date, end_date: form.end_date, pay_date: form.pay_date || null }).select('*').maybeSingle();
    if (createError || !data) { console.error('payroll period create failed', createError); setError('No se pudo crear el periodo.'); }
    else { setNewOpen(false); setSelectedPeriod(data as PayrollPeriod); await loadBase(); }
    setSaving(false);
  };

  const saveAdjustment = async () => {
    if (!selectedPeriod || !adjustment.user_id || !adjustment.concept.trim() || Number(adjustment.amount) <= 0) return;
    setSaving(true);
    const { error: adjustmentError } = await supabase.from('payroll_adjustments').insert({ period_id: selectedPeriod.id, user_id: adjustment.user_id, type: adjustment.type, concept: adjustment.concept.trim(), amount: Number(adjustment.amount), notes: adjustment.notes.trim() || null });
    if (adjustmentError) { console.error('payroll adjustment failed', adjustmentError); setError('No se pudo guardar el ajuste.'); }
    else { setAdjustmentOpen(false); setAdjustment({ user_id: '', type: 'descuento', concept: '', amount: '', notes: '' }); await calculate(); }
    setSaving(false);
  };

  const total = useMemo(() => entries.reduce((sum, entry) => sum + Number(entry.total_pay), 0), [entries]);
  const canManage = hasPermission('settings');
  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return <div className="p-6">
    <PageHeader title="Nómina" subtitle="Cortes, horas trabajadas, incidencias y pagos" />
    {!canManage && <Card className="p-6"><EmptyState title="Sin permiso" description="Solo un administrador puede consultar y cerrar nóminas." icon={<WalletCards size={48} />} /></Card>}
    {canManage && <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div className="flex items-end gap-3"><Field label="Periodo"><Select value={selectedPeriod?.id ?? ''} onChange={(event) => setSelectedPeriod(periods.find((period) => period.id === event.target.value) ?? null)}><option value="">Seleccionar periodo</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.name} · {formatDate(period.start_date)} - {formatDate(period.end_date)}</option>)}</Select></Field><Button onClick={() => setNewOpen(true)} variant="secondary"><Plus size={16} /> Nuevo corte</Button></div>{selectedPeriod && <div className="flex gap-2"><Button onClick={calculate} disabled={saving}><Calculator size={16} /> {saving ? 'Calculando...' : 'Calcular'}</Button><Button onClick={() => setAdjustmentOpen(true)} variant="secondary"><Receipt size={16} /> Ajuste</Button><Button onClick={() => printPayrollLetter(selectedPeriod, entries)} variant="secondary"><Printer size={16} /> Imprimir</Button></div>}</div>
      {selectedPeriod ? <>
        <div className="mb-4 grid gap-3 sm:grid-cols-3"><Card className="p-4"><div className="text-xs uppercase text-slate-500">Periodo</div><div className="mt-1 font-semibold text-slate-800">{selectedPeriod.name}</div><div className="text-sm text-slate-500">{formatDate(selectedPeriod.start_date)} al {formatDate(selectedPeriod.end_date)}</div></Card><Card className="p-4"><div className="text-xs uppercase text-slate-500">Fecha de pago</div><div className="mt-1 font-semibold text-slate-800">{formatDate(selectedPeriod.pay_date)}</div></Card><Card className="p-4"><div className="text-xs uppercase text-slate-500">Total calculado</div><div className="mt-1 text-xl font-bold text-emerald-700">{formatCurrency(total)}</div></Card></div>
        <Card className="overflow-hidden">{entries.length === 0 ? <EmptyState title="Nómina sin calcular" description="Presiona Calcular para generar el resumen del periodo. Solo se pagan horas extra autorizadas." icon={<CalendarRange size={48} />} /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Empleado</th><th className="px-4 py-3">Horas</th><th className="px-4 py-3">Extra</th><th className="px-4 py-3">Pago base</th><th className="px-4 py-3">Ajustes</th><th className="px-4 py-3">Total</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{entries.map((entry) => <tr key={entry.id} className="hover:bg-slate-50/50"><td className="px-4 py-3 font-medium text-slate-700">{entry.user?.full_name ?? 'Empleado'}</td><td className="px-4 py-3">{entry.regular_hours.toFixed(2)} h</td><td className="px-4 py-3">{entry.overtime_hours.toFixed(2)} h</td><td className="px-4 py-3">{formatCurrency(Number(entry.base_pay) + Number(entry.overtime_pay))}</td><td className={`px-4 py-3 ${entry.adjustments_total < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(entry.adjustments_total)}</td><td className="px-4 py-3 font-bold text-slate-800">{formatCurrency(entry.total_pay)}</td><td className="px-4 py-3 text-right"><button onClick={() => printEmployeeTicket(entry, selectedPeriod, currentBranch)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50" title="Imprimir recibo individual"><Ticket size={14} /> Recibo</button></td></tr>)}</tbody></table></div>}</Card>
      </> : <Card className="p-8"><EmptyState title="Crea tu primer corte" description="Define las fechas del periodo para calcular horas, extras, descuentos y pagos." icon={<FileText size={48} />} /></Card>}
    </>}
    {error && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

    <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nuevo corte de nómina" size="md"><div className="space-y-4"><Field label="Nombre"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Desde"><Input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} /></Field><Field label="Hasta"><Input type="date" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} /></Field></div><Field label="Día de pago"><Input type="date" value={form.pay_date} onChange={(event) => setForm({ ...form, pay_date: event.target.value })} /></Field><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setNewOpen(false)}>Cancelar</Button><Button onClick={createPeriod} disabled={saving}>Crear corte</Button></div></div></Modal>
    <Modal open={adjustmentOpen} onClose={() => setAdjustmentOpen(false)} title="Agregar ajuste de nómina" size="md"><div className="space-y-4"><Field label="Empleado"><Select value={adjustment.user_id} onChange={(event) => setAdjustment({ ...adjustment, user_id: event.target.value })}><option value="">Seleccionar</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</Select></Field><div className="grid grid-cols-2 gap-3"><Field label="Tipo"><Select value={adjustment.type} onChange={(event) => setAdjustment({ ...adjustment, type: event.target.value })}><option value="descuento">Descuento</option><option value="prestamo">Préstamo</option><option value="merma">Merma</option><option value="anticipo">Anticipo</option><option value="bono">Bono</option><option value="otro">Otro</option></Select></Field><Field label="Monto"><Input type="number" min="0" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment({ ...adjustment, amount: event.target.value })} /></Field></div><Field label="Concepto"><Input value={adjustment.concept} onChange={(event) => setAdjustment({ ...adjustment, concept: event.target.value })} placeholder="Ej. Préstamo personal" /></Field><Field label="Notas"><Textarea value={adjustment.notes} onChange={(event) => setAdjustment({ ...adjustment, notes: event.target.value })} rows={2} /></Field><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAdjustmentOpen(false)}>Cancelar</Button><Button onClick={saveAdjustment} disabled={saving}>Guardar ajuste</Button></div></div></Modal>
  </div>;
}
