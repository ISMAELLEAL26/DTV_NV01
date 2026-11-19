import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { printCashTicket } from '@/components/TicketPrint';
import { PROGRAM_LOGO } from '@/lib/branding';
import type { CashRegister, CashMovement, CashCount, Profile, Branch } from '@/lib/types';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Field, Input, Select } from '@/components/Field';
import { PageHeader, Card, EmptyState, Spinner, Badge, StatCard } from '@/components/ui';
import { Wallet, Play, Square, ArrowUpCircle, ArrowDownCircle, CheckCircle2, Eye, Lock, Printer, Loader2 } from 'lucide-react';
import { saveOperationalNotification } from '@/lib/operationalNotifications';
import AuthorizationModal, { type AuthorizationPayload } from '@/components/AuthorizationModal';
import { sendCashReportEmail, type CashReportData } from '@/lib/cashReportEmail';
import { AlertTriangle, LogOut } from 'lucide-react';

const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.01];
const BILL_DENOMINATIONS = [1000, 500, 200, 100, 50, 20];
const COIN_DENOMINATIONS = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.01];
const PAYMENT_LABELS: Record<string, string> = {
  tarjeta: 'Tarjeta (vouchers)',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  vale: 'Vales',
  cheque: 'Cheques',
  monedero_electronico: 'Monedero electrónico',
};

interface MovementForm { type: string; amount: string; reason: string; }

function DenominationSection({
  title,
  denominations,
  counts,
  onChange,
}: {
  title: string;
  denominations: number[];
  counts: Record<number, string>;
  onChange: (denomination: number, value: string) => void;
}) {
  const subtotal = denominations.reduce((sum, denomination) => sum + denomination * (parseInt(counts[denomination] ?? '0') || 0), 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">{title}</h4>
        <span className="text-xs font-semibold text-slate-400">Cantidad y subtotal</span>
      </div>
      <div className="space-y-2.5">
        {denominations.map((denomination) => {
          const quantity = parseInt(counts[denomination] ?? '0') || 0;
          return (
            <div key={denomination} className="grid grid-cols-[1fr_88px_1fr] items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-sm font-semibold text-slate-700">{formatCurrency(denomination)}</div>
              <Input type="number" min="0" className="w-full text-center" value={counts[denomination] ?? ''} onChange={(event) => onChange(denomination, event.target.value)} placeholder="0" aria-label={`Cantidad de ${formatCurrency(denomination)}`} />
              <div className="text-right text-sm font-medium text-slate-600">{formatCurrency(denomination * quantity)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-sm">
        <span className="font-medium text-slate-500">Subtotal {title.toLowerCase()}</span>
        <span className="font-bold text-slate-800">{formatCurrency(subtotal)}</span>
      </div>
    </div>
  );
}

export default function CashPage() {
  const { user, currentBranch, branches, setCurrentBranchId, hasPermission } = useAuth();
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [counts, setCounts] = useState<CashCount[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAmount, setOpenAmount] = useState('');
  const [openOpen, setOpenOpen] = useState(false);
  const [movementForm, setMovementForm] = useState<MovementForm>({ type: 'ingreso', amount: '', reason: '' });
  const [movementOpen, setMovementOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [denomCounts, setDenomCounts] = useState<Record<number, string>>({});
  const [systemTotal, setSystemTotal] = useState(0);
  const [vouchers, setVouchers] = useState<Record<string, { count: number; total: number }>>({});
  const [methodTotals, setMethodTotals] = useState<Record<string, string>>({});
  const [methodConfirmed, setMethodConfirmed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zeroOpenWarning, setZeroOpenWarning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [detailRegister, setDetailRegister] = useState<CashRegister | null>(null);
  const [detailData, setDetailData] = useState<{ movements: CashMovement[]; sales: { total: number; payment_method: string }[]; counts: CashCount[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [adminCloseTarget, setAdminCloseTarget] = useState<CashRegister | null>(null);
  const [adminCountedAmount, setAdminCountedAmount] = useState('');
  const [adminClosing, setAdminClosing] = useState(false);
  const canAdminClose = hasPermission('settings');
  const [authPayload, setAuthPayload] = useState<AuthorizationPayload | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [closeSessionOpen, setCloseSessionOpen] = useState(false);
  const { signOut } = useAuth();

  const activeRegister = useMemo(() => registers.find((r) => r.status === 'abierta'), [registers]);
  const myOpenRegister = useMemo(() => registers.find((r) => r.status === 'abierta' && r.user_id === user?.id), [registers, user]);
  const branchLocked = !!myOpenRegister;

  const load = useCallback(async () => {
    if (!currentBranch) return;
    setLoading(true);
    const { data: regs } = await supabase
      .from('cash_registers')
      .select('*')
      .eq('branch_id', currentBranch.id)
      .order('opened_at', { ascending: false })
      .limit(50);
    const registerRows = (regs as CashRegister[]) ?? [];
    const { data: profs } = await supabase.from('profiles').select('*');
    const profileMap = new Map(((profs as Profile[]) ?? []).map((p) => [p.id, p]));
    const registersWithUsers = registerRows.map((register) => ({
      ...register,
      user: register.user_id ? profileMap.get(register.user_id) ?? null : null,
    }));
    setRegisters(registersWithUsers);
    const active = registersWithUsers.find((r) => r.status === 'abierta');
    if (active) {
      const [{ data: mv }, { data: cn }, { data: sales }] = await Promise.all([
        supabase.from('cash_movements').select('*').eq('cash_register_id', active.id).order('created_at'),
        supabase.from('cash_counts').select('*').eq('cash_register_id', active.id),
        supabase.from('sales').select('total, payment_method').eq('cash_register_id', active.id).eq('status', 'completada'),
      ]);
      setMovements((mv as CashMovement[]) ?? []);
      setCounts((cn as CashCount[]) ?? []);
      const allSales = (sales as { total: number; payment_method: string }[]) ?? [];
      const cashSales = allSales
        .filter((s) => s.payment_method === 'efectivo')
        .reduce((s, x) => s + Number(x.total), 0);
      const voucherBreakdown = allSales.reduce<Record<string, { count: number; total: number }>>((acc, s) => {
        if (s.payment_method === 'efectivo') return acc;
        if (!acc[s.payment_method]) acc[s.payment_method] = { count: 0, total: 0 };
        acc[s.payment_method].count += 1;
        acc[s.payment_method].total += Number(s.total);
        return acc;
      }, {});
      setVouchers(voucherBreakdown);
      const ingresos = ((mv as CashMovement[]) ?? []).filter((m) => m.type === 'ingreso').reduce((s, m) => s + Number(m.amount), 0);
      const egresos = ((mv as CashMovement[]) ?? []).filter((m) => m.type === 'egreso' && !m.sale_id).reduce((s, m) => s + Number(m.amount), 0);
      setSystemTotal(Number(active.opening_amount) + cashSales + ingresos - egresos);
    } else {
      setMovements([]); setCounts([]); setSystemTotal(0);
    }
    setProfiles((profs as Profile[]) ?? []);
    setLoading(false);
  }, [currentBranch]);

  useEffect(() => { load(); }, [load]);

  const openRegister = async () => {
    if (!user || !currentBranch) return;
    const amount = parseFloat(openAmount) || 0;
    if (amount === 0 && !zeroOpenWarning) {
      setZeroOpenWarning(true);
      return;
    }
    setSaving(true); setError(null);
    if (amount < 0) { setError('Monto inválido'); setSaving(false); return; }
    const { error: e } = await supabase.from('cash_registers').insert({
      branch_id: currentBranch.id,
      user_id: user.id,
      opening_amount: amount,
      status: 'abierta',
      opened_at: new Date().toISOString(),
    });
    if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    setSaving(false); setOpenOpen(false); setOpenAmount(''); setZeroOpenWarning(false); load();
    window.dispatchEvent(new Event('cash-turn-changed'));
  };

  const addMovement = async () => {
    if (!activeRegister) return;
    setSaving(true); setError(null);
    const amt = parseFloat(movementForm.amount);
    if (!amt || amt <= 0) { setError('Monto inválido'); setSaving(false); return; }
    const { error: e } = await supabase.from('cash_movements').insert({
      cash_register_id: activeRegister.id,
      type: movementForm.type,
      amount: amt,
      reason: movementForm.reason || null,
    });
    if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    const savedMovement: CashMovement = {
      id: crypto.randomUUID(),
      cash_register_id: activeRegister.id,
      type: movementForm.type,
      amount: amt,
      reason: movementForm.reason || null,
      sale_id: null,
      created_at: new Date().toISOString(),
    };
    setMovementForm({ type: 'ingreso', amount: '', reason: '' });
    load();
    setEmailSending(true);
    const emailResult = await sendMovementEmail(savedMovement);
    setEmailSending(false);
    setSaving(false);
    setMovementOpen(false);
    if (emailResult.success) {
      setToast('Movimiento guardado y alerta enviada por correo.');
    } else {
      setToast(`Movimiento guardado, pero no se envió el correo: ${emailResult.error ?? 'error de Resend'}`);
    }
  };

  const countedTotal = useMemo(() => {
    return DENOMINATIONS.reduce((sum, d) => sum + d * (parseInt(denomCounts[d] ?? '0') || 0), 0);
  }, [denomCounts]);

  const sendMovementEmail = async (movement: CashMovement): Promise<{ success: boolean; error?: string }> => {
    if (!activeRegister || !currentBranch) return { success: false, error: 'No hay caja o sucursal activa' };
    try {
      const cashierName = profiles.find((p) => p.id === user?.id)?.full_name ?? user?.email ?? 'Cajero';
      const movementAmount = Number(movement.amount);
      const movementTotal = systemTotal + (movement.type === 'ingreso' ? movementAmount : -movementAmount);
      const reportData: CashReportData = {
        register: activeRegister,
        branch: currentBranch,
        cashierName,
        movements: [...movements, movement],
        systemTotal: movementTotal,
        reason: 'movement',
        movement,
      };
      const logoUrl = `${window.location.origin}${PROGRAM_LOGO}`;
      const storeName = currentBranch.name;
      return await sendCashReportEmail(reportData, null, logoUrl, storeName);
    } catch (err) {
      console.error('movement email failed', err);
      return { success: false, error: err instanceof Error ? err.message : 'Error de conexión' };
    }
  };

  const sendCashCutEmail = async (
    register: CashRegister,
    salesByMethod: { method: string; count: number; total: number }[],
    denomBreakdown: { denomination: number; quantity: number; subtotal: number }[],
    diff: number,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!currentBranch) return { success: false, error: 'No hay sucursal activa' };
    try {
      const cashierName = profiles.find((p) => p.id === user?.id)?.full_name ?? user?.email ?? 'Cajero';
      const reportData: CashReportData = {
        register,
        branch: currentBranch,
        cashierName,
        movements,
        systemTotal,
        countedTotal,
        difference: diff,
        salesByMethod,
        denominations: denomBreakdown,
        reason: 'cash_cut',
      };
      const logoUrl = `${window.location.origin}${PROGRAM_LOGO}`;
      const storeName = currentBranch.name;
      return await sendCashReportEmail(reportData, null, logoUrl, storeName);
    } catch (err) {
      console.error('cash cut email failed', err);
      return { success: false, error: err instanceof Error ? err.message : 'Error de conexión' };
    }
  };

  const closeRegister = async () => {
    if (!activeRegister) return;
    const incompleteMethod = Object.entries(vouchers).find(([method, info]) => {
      const declared = methodTotals[method]?.trim();
      return info.count > 0 && (!declared || !methodConfirmed[method]);
    });
    if (incompleteMethod) {
      const label = PAYMENT_LABELS[incompleteMethod[0]] ?? incompleteMethod[0];
      setError(`Completa la declaración de ${label}: confirma los comprobantes e ingresa el monto total.`);
      return;
    }
    setSaving(true); setError(null);
    const declaredMethods = Object.fromEntries(Object.entries(vouchers).map(([method, info]) => {
      const counted = parseFloat(methodTotals[method] ?? '') || 0;
      return [method, {
        expected: info.total,
        counted,
        difference: counted - info.total,
        vouchers: info.count,
        confirmed: !!methodConfirmed[method],
      }];
    }));
    const diff = countedTotal - systemTotal;
    const { error: e } = await supabase.from('cash_registers').update({
      status: 'cerrada',
      closing_amount: countedTotal,
      expected_amount: systemTotal,
      difference: diff,
      closed_at: new Date().toISOString(),
      closing_breakdown: {
        cash: { expected: systemTotal, counted: countedTotal, difference: diff },
        denominations: DENOMINATIONS.map((d) => ({ denomination: d, quantity: parseInt(denomCounts[d] ?? '0') || 0, subtotal: d * (parseInt(denomCounts[d] ?? '0') || 0) })),
        paymentMethods: declaredMethods,
      },
    }).eq('id', activeRegister.id);
    if (e) { console.error(e); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setSaving(false); return; }
    const countRows = DENOMINATIONS
      .filter((d) => (parseInt(denomCounts[d] ?? '0') || 0) > 0)
      .map((d) => ({
        cash_register_id: activeRegister.id,
        denomination: d,
        quantity: parseInt(denomCounts[d] ?? '0') || 0,
        subtotal: d * (parseInt(denomCounts[d] ?? '0') || 0),
      }));
    if (countRows.length > 0) {
      await supabase.from('cash_counts').insert(countRows);
    }
    const report = `Sistema: ${formatCurrency(systemTotal)} | Contado: ${formatCurrency(countedTotal)} | Diferencia: ${formatCurrency(diff)}`;
    const closedRegister = { ...activeRegister, status: 'cerrada', closing_amount: countedTotal, expected_amount: systemTotal, difference: diff, closed_at: new Date().toISOString() } as CashRegister;
    const salesByMethod = Object.entries(vouchers).map(([method, info]) => ({ method, count: info.count, total: info.total }));
    salesByMethod.unshift({ method: 'efectivo', count: 0, total: systemTotal - movements.filter((m) => m.type === 'ingreso').reduce((s, m) => s + Number(m.amount), 0) + movements.filter((m) => m.type === 'egreso' && !m.sale_id).reduce((s, m) => s + Number(m.amount), 0) - Number(activeRegister.opening_amount) });
    const denomBreakdown = DENOMINATIONS.map((d) => ({ denomination: d, quantity: parseInt(denomCounts[d] ?? '0') || 0, subtotal: d * (parseInt(denomCounts[d] ?? '0') || 0) }));
    setEmailSending(true);
    let emailResult: { success: boolean; error?: string };
    try {
      emailResult = await sendCashCutEmail(closedRegister, salesByMethod, denomBreakdown, diff);
    } catch (err) {
      emailResult = { success: false, error: err instanceof Error ? err.message : 'Error de correo' };
    } finally {
      setEmailSending(false);
    }
    setSaving(false); setCloseOpen(false); setDenomCounts({}); setMethodTotals({}); setMethodConfirmed({}); load();
    window.dispatchEvent(new Event('cash-turn-changed'));
    printRegisterTicket(closedRegister);
    setToast(emailResult.success ? 'Corte guardado, PDF impreso y correo enviado a gerencia.' : `Corte guardado e impreso, pero no se envió el correo: ${emailResult.error ?? 'error de Resend'}`);
    setCloseSessionOpen(true);
    void saveOperationalNotification({
      type: 'cash_cut',
      title: `Corte de caja ${activeRegister.folio ?? '—'}`,
      message: report,
      branchId: currentBranch?.id,
      metadata: {
        registerId: activeRegister.id,
        folio: activeRegister.folio ?? null,
        expected: systemTotal,
        counted: countedTotal,
        difference: diff,
      },
    }).then((saved) => {
      if (!saved) setToast('Corte guardado; no se pudo registrar la notificación.');
    });
  };

  const openDetail = async (register: CashRegister) => {
    setDetailRegister(register);
    setDetailData(null);
    setDetailLoading(true);
    const [{ data: mv }, { data: sales }, { data: cn }] = await Promise.all([
      supabase.from('cash_movements').select('*').eq('cash_register_id', register.id).order('created_at'),
      supabase.from('sales').select('total, payment_method').eq('cash_register_id', register.id).eq('status', 'completada'),
      supabase.from('cash_counts').select('*').eq('cash_register_id', register.id),
    ]);
    setDetailData({ movements: (mv as CashMovement[]) ?? [], sales: (sales as { total: number; payment_method: string }[]) ?? [], counts: (cn as CashCount[]) ?? [] });
    setDetailLoading(false);
  };

  const printRegisterTicket = (register: CashRegister) => {
    const rows: { label: string; value: string }[] = [
      { label: 'Cajero', value: register.user?.full_name ?? '—' },
      { label: 'Apertura', value: formatDateTime(register.opened_at) },
      { label: 'Cierre', value: register.closed_at ? formatDateTime(register.closed_at) : 'Abierta' },
      { label: 'Fondo inicial', value: formatCurrency(register.opening_amount) },
      { label: 'Esperado', value: register.expected_amount != null ? formatCurrency(register.expected_amount) : '—' },
      { label: 'Contado', value: register.closing_amount != null ? formatCurrency(register.closing_amount) : '—' },
    ];
    const fakeBranch: Branch = currentBranch ?? { id: '', name: 'CAJA', address: null, street: null, exterior_number: null, interior_number: null, neighborhood: null, locality: null, municipality: null, state: null, postal_code: null, logo_url: null, phone: null, email: null, email_cc: null, active: true, created_at: '' };
    void printCashTicket({
      branch: fakeBranch,
      logoUrl: PROGRAM_LOGO,
      storeName: fakeBranch.name,
      title: 'Corte de caja',
      folio: register.folio ?? '—',
      cashierName: register.user?.full_name ?? 'Cajero',
      createdAt: formatDateTime(register.closed_at ?? register.opened_at),
      currencySymbol: '$',
      rows,
      resultLabel: 'Diferencia',
      resultValue: register.difference != null ? formatCurrency(register.difference) : '—',
      resultKind: register.difference != null ? (register.difference === 0 ? 'ok' : register.difference > 0 ? 'over' : 'short') : undefined,
      signatureLine: true,
    });
  };

  const confirmAdminClose = async () => {
    if (!adminCloseTarget) return;
    setAdminClosing(true); setError(null);
    const { data, error: closeError } = await supabase.rpc('admin_close_cash_register', { p_register_id: adminCloseTarget.id, p_counted_amount: parseFloat(adminCountedAmount) || 0 });
    if (closeError || !data) {
      console.error('admin close failed', closeError);
      setError('No se pudo cerrar la caja. ' + (closeError?.message ?? ''));
      setAdminClosing(false);
      return;
    }
    const result = (Array.isArray(data) ? data[0] : data) as { expected_amount: number; counted_amount: number; difference: number; cashier_name: string; folio: string | null };
    const closedTarget = adminCloseTarget;
    setAdminCloseTarget(null);
    setAdminCountedAmount('');
    await load();
    window.dispatchEvent(new Event('cash-turn-changed'));
    setToast(`Caja cerrada por administrador. Diferencia: ${formatCurrency(result.difference)}`);
    void saveOperationalNotification({
      type: 'cash_cut',
      title: `Cierre administrativo ${result.folio ?? '—'}`,
      message: `Esperado: ${formatCurrency(result.expected_amount)} | Contado: ${formatCurrency(result.counted_amount)} | Diferencia: ${formatCurrency(result.difference)}`,
      branchId: currentBranch?.id,
      metadata: { registerId: closedTarget.id, adminClose: true },
    });
    setAdminClosing(false);
  };

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader title="Arqueo de Cajas" subtitle={currentBranch?.name} />
      {emailSending && <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl bg-slate-900 px-5 py-3 font-medium text-white shadow-xl"><Loader2 size={20} className="animate-spin text-emerald-400" /><span>Enviando correo a gerencia...</span></div>}
      {toast && !emailSending && <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 font-medium text-white shadow-lg ${toast.includes('pero no') ? 'bg-red-600' : 'bg-emerald-600'}`}>{toast}</div>}

      {/* Branch selector quick */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {branches.map((b) => (
          <button
            key={b.id}
            onClick={() => !branchLocked && setCurrentBranchId(b.id)}
            disabled={branchLocked}
            title={branchLocked ? 'Cierra tu turno (corte de caja) para cambiar de sucursal' : ''}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${b.id === currentBranch?.id ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'} ${branchLocked ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            {b.name.replace('BIENESTAR ', '')}
          </button>
        ))}
        {branchLocked && (
          <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
            Tienes un turno abierto. Realiza el corte de caja para cambiar de sucursal o abrir otra caja.
          </span>
        )}
      </div>

      {activeRegister ? (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Apertura" value={formatCurrency(activeRegister.opening_amount)} icon={<Wallet size={18} />} accent="blue" />
            <StatCard label="Total esperado (sistema)" value={formatCurrency(systemTotal)} icon={<CheckCircle2 size={18} />} accent="emerald" />
            <StatCard label="Estado" value="Caja abierta" icon={<Play size={18} />} accent="amber" hint={`Desde ${formatDateTime(activeRegister.opened_at)}`} />
          </div>

          <div className="mb-4 flex gap-2">
            <Button variant="secondary" onClick={() => setMovementOpen(true)}><ArrowUpCircle size={16} /> Movimiento</Button>
            <Button variant="danger" onClick={() => {
              setAuthPayload({
                operationType: 'cash_cut',
                branchId: currentBranch?.id ?? null,
                summary: `Cierre de caja ${activeRegister.folio ?? '—'} · Esperado: ${formatCurrency(systemTotal)}`,
                payload: { registerId: activeRegister.id, folio: activeRegister.folio, expected: systemTotal },
              });
              setAuthOpen(true);
            }}><Square size={16} /> Cerrar caja</Button>
          </div>

          <Card className="mb-4">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Movimientos de caja</div>
            {movements.length === 0 ? (
              <EmptyState title="Sin movimientos" description="Agrega ingresos o egresos." icon={<ArrowDownCircle size={40} />} />
            ) : (
              <div className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      {m.type === 'ingreso' ? <ArrowUpCircle size={18} className="text-emerald-500" /> : <ArrowDownCircle size={18} className="text-red-500" />}
                      <div>
                        <div className="text-sm font-medium text-slate-700">{m.type === 'ingreso' ? 'Ingreso' : 'Egreso'}</div>
                        <div className="text-xs text-slate-400">{m.reason ?? '—'} · {formatDateTime(m.created_at)}</div>
                      </div>
                    </div>
                    <div className={`text-sm font-bold ${m.type === 'ingreso' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {m.type === 'ingreso' ? '+' : '-'}{formatCurrency(m.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Voucher breakdown */}
          {Object.keys(vouchers).length > 0 && (
            <Card className="mb-4">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Vouches registrados (sin efectivo)</div>
              <div className="divide-y divide-slate-100">
                {Object.entries(vouchers).map(([method, info]) => (
                  <div key={method} className="flex items-center justify-between px-4 py-3">
                    <div className="text-sm font-medium text-slate-700 capitalize">{method.replace('_', ' ')}</div>
                    <div className="flex items-center gap-4">
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{info.count} {info.count === 1 ? 'voucher' : 'vouches'}</span>
                      <span className="text-sm font-bold text-slate-800">{formatCurrency(info.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : (
        <>
          <Card className="p-8">
            <EmptyState
              title="No hay caja abierta"
              description="Abre una caja para registrar ventas y movimientos."
              icon={<Wallet size={48} />}
              action={myOpenRegister ? null : <Button onClick={() => setOpenOpen(true)}><Play size={16} /> Abrir caja</Button>}
            />
            {myOpenRegister && (
              <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Ya tienes un turno abierto en esta sucursal. Realiza el corte de caja para abrir otra.
              </div>
            )}
          </Card>
        </>
      )}

      {/* History */}
      <h3 className="mb-3 mt-6 text-sm font-semibold text-slate-700">Historial de cajas</h3>
      <Card className="overflow-hidden">
        {registers.length === 0 ? (
          <EmptyState title="Sin historial" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Apertura</th>
                  <th className="px-4 py-3">Cierre</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3 text-right">Inicial</th>
                  <th className="px-4 py-3 text-right">Esperado</th>
                  <th className="px-4 py-3 text-right">Contado</th>
                  <th className="px-4 py-3 text-right">Diferencia</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registers.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-slate-600 font-medium">{r.folio ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(r.opened_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(r.closed_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.user?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.opening_amount)}</td>
                    <td className="px-4 py-3 text-right">{r.expected_amount != null ? formatCurrency(r.expected_amount) : '—'}</td>
                    <td className="px-4 py-3 text-right">{r.closing_amount != null ? formatCurrency(r.closing_amount) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {r.difference != null ? (
                        <span className={r.difference === 0 ? 'text-slate-600' : r.difference > 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                          {r.difference > 0 ? '+' : ''}{formatCurrency(r.difference)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.status === 'abierta' ? <Badge variant="warning">Abierta</Badge> : <Badge variant="success">Cerrada</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openDetail(r)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600" title="Ver detalles"><Eye size={15} /></button>
                        {r.status === 'abierta' && canAdminClose && (
                          <button onClick={() => { setAdminCloseTarget(r); setAdminCountedAmount(''); setError(null); }} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Cerrar caja (admin)"><Lock size={15} /></button>
                        )}
                        {r.status === 'cerrada' && (
                          <button onClick={() => printRegisterTicket(r)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600" title="Imprimir corte"><Printer size={15} /></button>
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

      {/* Open modal */}
      <Modal open={openOpen} onClose={() => setOpenOpen(false)} title="Abrir caja" size="sm">
        <div className="space-y-4">
          <Field label="Monto inicial en caja">
            <Input type="number" step="0.01" value={openAmount} onChange={(e) => setOpenAmount(e.target.value)} placeholder="0.00" autoFocus />
          </Field>
          {zeroOpenWarning && (parseFloat(openAmount) || 0) === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              De acuerdo con mandar en ceros tu fondo de caja. El turno se abrirá con un fondo inicial de $0.00.
            </div>
          )}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setOpenOpen(false); setZeroOpenWarning(false); }}>Cancelar</Button>
            <Button onClick={openRegister} disabled={saving}>{saving ? 'Abriendo...' : zeroOpenWarning && (parseFloat(openAmount) || 0) === 0 ? 'Confirmar apertura en ceros' : 'Abrir'}</Button>
          </div>
        </div>
      </Modal>

      {/* Movement modal */}
      <Modal open={movementOpen} onClose={() => !saving && setMovementOpen(false)} title="Registrar movimiento" size="sm">
        <div className="space-y-4">
          <Field label="Tipo">
            <Select value={movementForm.type} onChange={(e) => setMovementForm({ ...movementForm, type: e.target.value })}>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </Select>
          </Field>
          <Field label="Monto">
            <Input type="number" step="0.01" value={movementForm.amount} onChange={(e) => setMovementForm({ ...movementForm, amount: e.target.value })} />
          </Field>
          <Field label="Motivo">
            <Input value={movementForm.reason} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })} placeholder="Descripción" />
          </Field>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMovementOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={addMovement} disabled={saving}>{saving ? 'Guardando y enviando correo...' : 'Guardar y enviar correo'}</Button>
          </div>
        </div>
      </Modal>

      {/* Close modal */}
      <Modal open={closeOpen} onClose={() => setCloseOpen(false)} title="Cerrar caja — Arqueo" size="md">
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-4">
            <div className="flex justify-between text-sm"><span className="text-slate-600">Total esperado (sistema)</span><span className="font-bold text-slate-800">{formatCurrency(systemTotal)}</span></div>
          </div>
          {Object.keys(vouchers).length > 0 && (
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-700">Declaración por método de pago</div>
              <div className="space-y-3">
                {Object.entries(vouchers).map(([method, info]) => {
                  const label = PAYMENT_LABELS[method] ?? method.replace('_', ' ');
                  return (
                    <div key={method} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold capitalize text-slate-700">{label}</div>
                          <div className="text-xs text-slate-500">Tienes que contar {info.count} {info.count === 1 ? 'comprobante' : 'comprobantes'} · Esperado: {formatCurrency(info.total)}</div>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                          <input
                            type="checkbox"
                            checked={methodConfirmed[method] ?? false}
                            onChange={(event) => setMethodConfirmed({ ...methodConfirmed, [method]: event.target.checked })}
                            className="h-4 w-4 accent-emerald-600"
                          />
                          Confirmo que cuento con ellos
                        </label>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">Monto recaudado</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={methodTotals[method] ?? ''}
                          onChange={(event) => setMethodTotals({ ...methodTotals, [method]: event.target.value })}
                          placeholder="0.00"
                          className="max-w-40"
                          aria-label={`Monto recaudado de ${label}`}
                        />
                        <span className="text-xs text-slate-500">Diferencia: {formatCurrency((parseFloat(methodTotals[method] ?? '') || 0) - info.total)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Efectivo: conteo de billetes y monedas</div>
            <div className="grid gap-4 md:grid-cols-2">
              <DenominationSection title="Billetes" denominations={BILL_DENOMINATIONS} counts={denomCounts} onChange={(denomination, value) => setDenomCounts({ ...denomCounts, [denomination]: value })} />
              <DenominationSection title="Monedas" denominations={COIN_DENOMINATIONS} counts={denomCounts} onChange={(denomination, value) => setDenomCounts({ ...denomCounts, [denomination]: value })} />
            </div>
          </div>
          <div className="flex justify-between rounded-lg bg-emerald-50 p-4">
            <span className="text-sm font-medium text-slate-700">Total de efectivo contado</span>
            <span className="text-lg font-bold text-emerald-600">{formatCurrency(countedTotal)}</span>
          </div>
          <div className="flex justify-between rounded-lg border border-slate-200 p-4">
            <span className="text-sm font-medium text-slate-700">Diferencia</span>
            <span className={`text-lg font-bold ${countedTotal - systemTotal === 0 ? 'text-slate-700' : countedTotal - systemTotal > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {countedTotal - systemTotal > 0 ? '+' : ''}{formatCurrency(countedTotal - systemTotal)}
            </span>
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCloseOpen(false)} disabled={saving}>Cancelar</Button>
            <Button variant="danger" onClick={closeRegister} disabled={saving || emailSending}>{saving ? 'Guardando, enviando e imprimiendo...' : 'Guardar e imprimir'}</Button>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal open={!!detailRegister} onClose={() => setDetailRegister(null)} title={`Detalles de caja ${detailRegister?.folio ?? ''}`} size="md">
        {detailLoading ? <div className="p-6"><Spinner size={28} /></div> : detailRegister && detailData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Cajero</div><div className="mt-1 font-semibold text-slate-800">{detailRegister.user?.full_name ?? '—'}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Estado</div><div className="mt-1">{detailRegister.status === 'abierta' ? <Badge variant="warning">Abierta</Badge> : <Badge variant="success">Cerrada</Badge>}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Fondo inicial</div><div className="mt-1 font-semibold text-slate-800">{formatCurrency(detailRegister.opening_amount)}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Esperado</div><div className="mt-1 font-semibold text-slate-800">{detailRegister.expected_amount != null ? formatCurrency(detailRegister.expected_amount) : '—'}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Contado</div><div className="mt-1 font-semibold text-slate-800">{detailRegister.closing_amount != null ? formatCurrency(detailRegister.closing_amount) : '—'}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs uppercase text-slate-500">Diferencia</div><div className="mt-1 font-semibold text-slate-800">{detailRegister.difference != null ? formatCurrency(detailRegister.difference) : '—'}</div></div>
            </div>

            {detailData.sales.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-700">Ventas por método</div>
                <div className="space-y-1.5">
                  {Object.entries(detailData.sales.reduce<Record<string, { count: number; total: number }>>((acc, s) => {
                    if (!acc[s.payment_method]) acc[s.payment_method] = { count: 0, total: 0 };
                    acc[s.payment_method].count += 1;
                    acc[s.payment_method].total += Number(s.total);
                    return acc;
                  }, {})).map(([method, info]) => (
                    <div key={method} className="flex justify-between text-sm">
                      <span className="text-slate-600 capitalize">{method.replace('_', ' ')} ({info.count})</span>
                      <span className="font-medium text-slate-800">{formatCurrency(info.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailData.movements.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-700">Movimientos</div>
                <div className="space-y-1.5">
                  {detailData.movements.map((m) => (
                    <div key={m.id} className="flex justify-between text-sm">
                      <span className="text-slate-600">{m.type === 'ingreso' ? 'Ingreso' : 'Egreso'} · {m.reason ?? '—'}</span>
                      <span className={m.type === 'ingreso' ? 'text-emerald-600' : 'text-red-600'}>{m.type === 'ingreso' ? '+' : '-'}{formatCurrency(m.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetailRegister(null)}>Cerrar</Button>
              {detailRegister.status === 'cerrada' && <Button variant="secondary" onClick={() => printRegisterTicket(detailRegister)}><Printer size={16} /> Imprimir</Button>}
              {detailRegister.status === 'abierta' && canAdminClose && <Button variant="danger" onClick={() => { setAdminCloseTarget(detailRegister); setAdminCountedAmount(''); setDetailRegister(null); }}><Lock size={16} /> Cerrar caja</Button>}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Admin close modal */}
      <Modal open={!!adminCloseTarget} onClose={() => setAdminCloseTarget(null)} title="Cierre administrativo de caja" size="sm">
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            Vas a cerrar la caja <b>{adminCloseTarget?.folio ?? ''}</b> de <b>{adminCloseTarget?.user?.full_name ?? ''}</b>.
            La caja se liberará para uso inmediato. Ingresa el efectivo contado para registrar la diferencia.
          </div>
          <Field label="Efectivo contado"><Input type="number" step="0.01" min="0" value={adminCountedAmount} onChange={(e) => setAdminCountedAmount(e.target.value)} placeholder="0.00" autoFocus /></Field>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdminCloseTarget(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmAdminClose} disabled={adminClosing}>{adminClosing ? 'Cerrando...' : 'Cerrar caja'}</Button>
          </div>
        </div>
      </Modal>

      <AuthorizationModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        payload={authPayload}
        onAuthorized={async () => {
          setAuthOpen(false);
          setCloseOpen(true);
        }}
      />

      {/* Mandatory close-session modal after cash cut */}
      <Modal open={closeSessionOpen} onClose={() => {}} title="Cierre de sesión requerido" size="md" closeOnOverlay={false}>
        <div className="space-y-5">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle size={40} className="text-amber-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-800">Debes cerrar sesión</h3>
            <p className="mt-2 max-w-sm text-sm text-slate-600">
              El corte de caja se completó correctamente. Por seguridad, debes cerrar tu sesión antes de continuar.
              Esto protege la información de tu turno y evita que otro usuario use tu cuenta.
            </p>
          </div>
          <Button variant="danger" className="w-full" onClick={() => { setCloseSessionOpen(false); signOut(); }}>
            <LogOut size={20} /> Cerrar sesión ahora
          </Button>
        </div>
      </Modal>
    </div>
  );
}
