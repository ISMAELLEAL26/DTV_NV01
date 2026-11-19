import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { addDaysISO, formatCurrency, formatDateTime, mexicoDayEndISO, mexicoDayStartISO, startOfMonthISO, todayISO } from '@/lib/format';
import { downloadXLSX } from '@/lib/excel';
import { printTicket, type TicketData } from '@/components/TicketPrint';
import type { Sale, SaleItem, Branch, Customer, Profile, WalletSaleResult } from '@/lib/types';
import { PageHeader, Card, EmptyState, Spinner, StatCard, Badge } from '@/components/ui';
import { Input, Textarea } from '@/components/Field';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { DollarSign, ShoppingBag, TrendingUp, Receipt, Eye, Printer, Clock, User, CreditCard, RotateCcw, Ban, AlertTriangle, Download, Award } from 'lucide-react';
import { PROGRAM_LOGO } from '@/lib/branding';

interface SaleDetail extends Sale {
  branch?: Branch | null;
  customer?: Customer | null;
  sale_items?: SaleItem[];
  seller?: Profile | null;
  started_at?: string | null;
  completed_at?: string | null;
}

interface ReturnSelection {
  [itemId: string]: number;
}

interface ReportSale extends SaleDetail {
  cashRegisterName: string;
  costTotal: number;
}

interface ReportLine {
  sale_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  cost_price: number;
  tax_rate: number;
  ieps_rate: number;
  department?: string | null;
  categoryName?: string | null;
}

function saleDuration(sale: SaleDetail): string {
  const start = new Date(sale.started_at ?? sale.created_at).getTime();
  const end = new Date(sale.completed_at ?? sale.created_at).getTime();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function lineTax(line: Pick<ReportLine, 'line_total' | 'tax_rate'>): number {
  const rate = Number(line.tax_rate ?? 0) / 100;
  return rate > 0 ? Number(line.line_total) - Number(line.line_total) / (1 + rate) : 0;
}

function lineIeps(line: Pick<ReportLine, 'line_total' | 'tax_rate' | 'ieps_rate'>): number {
  const totalRate = Number(line.tax_rate ?? 0) + Number(line.ieps_rate ?? 0);
  return totalRate > 0 ? Number(line.line_total) * Number(line.ieps_rate ?? 0) / (100 + totalRate) : 0;
}

function paymentLabel(method: string): string {
  if (method === 'monedero_electronico') return 'Monedero electrónico';
  if (method === 'mixto') return 'Pago mixto';
  return method.replace(/_/g, ' ').replace(/^./, (letter: string) => letter.toUpperCase());
}

function walletFromDetails(details: Sale['payment_details']): WalletSaleResult | null {
  if (!details || (details.wallet_redeemed === undefined && details.wallet_points_earned === undefined)) return null;
  return {
    redeemed: Number(details.wallet_redeemed ?? 0),
    points_earned: Number(details.wallet_points_earned ?? 0),
    change_saved: Number(details.wallet_change_saved ?? 0),
    balance: Number(details.wallet_balance_after ?? 0),
  };
}

function paymentDetailRows(details: Sale['payment_details']): Array<[string, string]> {
  if (!details) return [];
  const rows: Array<[string, string]> = [];
  if (details.mixed_payments) {
    try {
      const payments = JSON.parse(String(details.mixed_payments)) as Array<{ method: string; amount: number }>;
      payments.forEach((payment) => rows.push([paymentLabel(payment.method), formatCurrency(Number(payment.amount))]));
    } catch {
      rows.push(['Desglose de pago mixto', String(details.mixed_payments)]);
    }
  }
  Object.entries(details)
    .filter(([key, value]) => key !== 'mixed_payments' && value !== null && value !== '' && value !== undefined && !String(value).includes('/'))
    .forEach(([key, value]) => rows.push([key.replace(/_/g, ' '), typeof value === 'boolean' ? (value ? 'Sí' : 'No') : String(value)]));
  return rows;
}

export default function ReportsPage() {
  const { currentBranch, branches, profile, setCurrentBranchId } = useAuth();
  const [sales, setSales] = useState<ReportSale[]>([]);
  const [reportLines, setReportLines] = useState<ReportLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [periodPreset, setPeriodPreset] = useState('dia');
  const [userFilter, setUserFilter] = useState('all');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailSale, setDetailSale] = useState<SaleDetail | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnSelection, setReturnSelection] = useState<ReturnSelection>({});
  const [returnReason, setReturnReason] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);

  const load = useCallback(async () => {
    if (!currentBranch) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('sales')
      .select('*, customer:customers(*)')
      .eq('branch_id', currentBranch.id)
      .in('status', ['completada', 'cancelada'])
      .gte('created_at', mexicoDayStartISO(from))
      .lte('created_at', mexicoDayEndISO(to))
      .order('created_at', { ascending: false });
    if (!error) {
      const saleRows = (data as SaleDetail[]) ?? [];
      const userIds = [...new Set(saleRows.map((sale) => sale.user_id).filter((id): id is string => !!id))];
      const registerIds = [...new Set(saleRows.map((sale) => sale.cash_register_id).filter((id): id is string => !!id))];
      const saleIds = saleRows.map((sale) => sale.id);
      const [{ data: profiles }, { data: registers }, { data: lines }] = await Promise.all([
        userIds.length ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds) : Promise.resolve({ data: [] }),
        registerIds.length ? supabase.from('cash_registers').select('id, folio, cash_box:cash_boxes(name)').in('id', registerIds) : Promise.resolve({ data: [] }),
        saleIds.length ? supabase.from('sale_items').select('sale_id, product_name, quantity, unit_price, line_total, product:products(cost_price, tax_rate, ieps_rate, department, category:categories(name))').in('sale_id', saleIds) : Promise.resolve({ data: [] }),
      ]);
      const profileMap = new Map((profiles ?? []).map((item: { id: string; full_name: string; avatar_url: string | null }) => [item.id, item]));
      const registerMap = new Map((registers ?? []).map((item: { id: string; folio: string | null; cash_box?: Array<{ name: string }> }) => [item.id, item.cash_box?.[0]?.name ?? item.folio ?? 'Caja']));
      const reportLines = (lines ?? []) as unknown as Array<ReportLine & { product?: { cost_price: number; tax_rate: number; ieps_rate: number; department?: string | null } | null }>; 
      const costBySale = new Map<string, number>();
      reportLines.forEach((line) => costBySale.set(line.sale_id, (costBySale.get(line.sale_id) ?? 0) + Number(line.quantity) * Number(line.product?.cost_price ?? 0)));
      saleRows.forEach((sale) => {
        if (sale.payment_details?.recharge === true) {
          costBySale.set(sale.id, Math.max(0, Number(sale.total) - Number(sale.payment_details.margin_value ?? 0)));
        }
      });
      setReportLines(reportLines.map((line) => ({ ...line, cost_price: Number(line.product?.cost_price ?? 0), tax_rate: Number(line.product?.tax_rate ?? 0), ieps_rate: Number(line.product?.ieps_rate ?? 0), department: line.product?.department ?? null, categoryName: (line.product as { category?: Array<{ name: string }> | { name: string } | null } | null)?.category ? (Array.isArray((line.product as { category?: Array<{ name: string }> | { name: string } | null }).category) ? (line.product as { category?: Array<{ name: string }> }).category?.[0]?.name : (line.product as { category?: { name: string } }).category?.name) ?? null : null })));
      setSales(saleRows.map((sale) => ({ ...sale, seller: (sale.user_id ? profileMap.get(sale.user_id) ?? null : null) as Profile | null, cashRegisterName: sale.cash_register_id ? registerMap.get(sale.cash_register_id) ?? 'Caja' : 'Caja', costTotal: costBySale.get(sale.id) ?? 0 })));
    }
    setLoading(false);
  }, [currentBranch, from, to]);

  useEffect(() => { void load(); }, [load]);

  const visibleSales = userFilter === 'all' ? sales : sales.filter((sale) => sale.user_id === userFilter);
  const activeSales = visibleSales.filter((s) => s.status === 'completada');
  const taxBySale = new Map<string, number>();
  reportLines.forEach((line) => taxBySale.set(line.sale_id, (taxBySale.get(line.sale_id) ?? 0) + lineTax(line)));
  const totalSales = activeSales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const totalTax = activeSales.reduce((sum, sale) => sum + (taxBySale.get(sale.id) ?? 0), 0);
  const totalIeps = reportLines.filter((line) => activeSales.some((sale) => sale.id === line.sale_id)).reduce((sum, line) => sum + lineIeps(line), 0);
  const totalProfit = activeSales.reduce((sum, sale) => {
    const saleTax = reportLines.filter((line) => line.sale_id === sale.id).reduce((taxSum, line) => taxSum + lineTax(line) + lineIeps(line), 0);
    return sum + Number(sale.total) - saleTax - sale.costTotal;
  }, 0);
  const hourlyTotals = activeSales.reduce<Record<string, number>>((totals, sale) => { const hour = new Date(sale.created_at).getHours().toString().padStart(2, '0') + ':00'; totals[hour] = (totals[hour] ?? 0) + Number(sale.total); return totals; }, {});
  const weekdayTotals = activeSales.reduce<Record<string, number>>((totals, sale) => { const day = new Date(sale.created_at).toLocaleDateString('es-MX', { weekday: 'long' }); totals[day] = (totals[day] ?? 0) + Number(sale.total); return totals; }, {});
  const avgTicket = activeSales.length > 0 ? totalSales / activeSales.length : 0;
  const cashSales = activeSales.filter((sale) => sale.payment_method === 'efectivo').reduce((sum, sale) => sum + Number(sale.total), 0);
  const cardSales = activeSales.filter((sale) => sale.payment_method === 'tarjeta').reduce((sum, sale) => sum + Number(sale.total), 0);
  const availableUsers = [...new Map(sales.filter((sale) => sale.seller).map((sale) => [sale.user_id, sale.seller!])).values()];
  const paymentTotals = activeSales.reduce<Record<string, number>>((totals, sale) => { totals[sale.payment_method] = (totals[sale.payment_method] ?? 0) + Number(sale.total); return totals; }, {});

  const activeSaleIds = new Set(activeSales.map((sale) => sale.id));
  const rechargeSaleIds = new Set(activeSales.filter((sale) => sale.payment_details?.recharge === true).map((sale) => sale.id));

  const departmentStats = reportLines
    .filter((line) => activeSaleIds.has(line.sale_id))
    .reduce<Record<string, { total: number; profit: number }>>((acc, line) => {
      const dept = rechargeSaleIds.has(line.sale_id) ? 'Recargas' : (line.department || 'Sin departamento');
      if (!acc[dept]) acc[dept] = { total: 0, profit: 0 };
      acc[dept].total += Number(line.line_total);
      if (!rechargeSaleIds.has(line.sale_id)) {
        acc[dept].profit += Number(line.line_total) - Number(line.quantity) * Number(line.cost_price) - lineTax(line) - lineIeps(line);
      }
      return acc;
    }, {});
  const categoryStats = reportLines
    .filter((line) => activeSaleIds.has(line.sale_id))
    .reduce<Record<string, { total: number; profit: number }>>((acc, line) => {
      const cat = rechargeSaleIds.has(line.sale_id) ? 'Recargas' : (line.categoryName || 'Sin categoría');
      if (!acc[cat]) acc[cat] = { total: 0, profit: 0 };
      acc[cat].total += Number(line.line_total);
      if (!rechargeSaleIds.has(line.sale_id)) {
        acc[cat].profit += Number(line.line_total) - Number(line.quantity) * Number(line.cost_price) - lineTax(line) - lineIeps(line);
      }
      return acc;
    }, {});

  activeSales
    .filter((sale) => rechargeSaleIds.has(sale.id))
    .forEach((sale) => {
      const margin = Number(sale.payment_details?.margin_value ?? 0);
      if (!departmentStats['Recargas']) departmentStats['Recargas'] = { total: 0, profit: 0 };
      departmentStats['Recargas'].profit += margin;
      if (!categoryStats['Recargas']) categoryStats['Recargas'] = { total: 0, profit: 0 };
      categoryStats['Recargas'].profit += margin;
    });

  const departmentRows = Object.entries(departmentStats).map(([name, v]) => [name, v.total, v.profit] as [string, number, number]).sort(([, a], [, b]) => b - a);
  const categoryRows = Object.entries(categoryStats).map(([name, v]) => [name, v.total, v.profit] as [string, number, number]).sort(([, a], [, b]) => b - a);
  const departmentMax = departmentRows.length > 0 ? departmentRows[0][1] : 0;
  const categoryMax = categoryRows.length > 0 ? categoryRows[0][1] : 0;
  const departmentGrandTotal = departmentRows.reduce((sum, [, amount]) => sum + amount, 0);
  const categoryGrandTotal = categoryRows.reduce((sum, [, amount]) => sum + amount, 0);
  const departmentGrandProfit = departmentRows.reduce((sum, [, , profit]) => sum + profit, 0);
  const categoryGrandProfit = categoryRows.reduce((sum, [, , profit]) => sum + profit, 0);

  const topProducts = reportLines
    .filter((line) => activeSaleIds.has(line.sale_id))
    .reduce<Map<string, { name: string; quantity: number; total: number }>>((acc, line) => {
      const existing = acc.get(line.product_name);
      if (existing) {
        existing.quantity += Number(line.quantity);
        existing.total += Number(line.line_total);
      } else {
        acc.set(line.product_name, { name: line.product_name, quantity: Number(line.quantity), total: Number(line.line_total) });
      }
      return acc;
    }, new Map());
  const topProductRows = [...topProducts.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 20);
  const topProductMaxQty = topProductRows.length > 0 ? topProductRows[0].quantity : 0;

  const viewSale = async (saleId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetailSale(null);
    setActionError(null);
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .select('*, customer:customers(*), branch:branches(*)')
      .eq('id', saleId)
      .maybeSingle();
    const { data: items, error: itemsError } = await supabase
      .from('sale_items')
      .select('*')
      .eq('sale_id', saleId)
      .order('product_name');
    if (saleError || itemsError || !sale) {
      setDetailError('No se pudo cargar el detalle completo de la venta.');
      setDetailLoading(false);
      return;
    }
    let seller: Profile | null = null;
    if (sale.user_id) {
      const { data } = await supabase.from('profiles').select('*').eq('id', sale.user_id).maybeSingle();
      seller = data as Profile | null;
    }
    setDetailSale({ ...(sale as SaleDetail), sale_items: (items as SaleItem[]) ?? [], seller });
    setDetailLoading(false);
  };

  const reprint = (sale: SaleDetail) => {
    const branch = sale.branch ?? currentBranch;
    if (!branch) return;
    const ticket: TicketData = {
      branch,
      logoUrl: PROGRAM_LOGO,
      ticketWidth: '80',
      storeName: branch.name,
      folio: sale.folio ?? sale.id,
      createdAt: new Date(sale.created_at).toLocaleString('es-MX'),
      customerName: sale.customer?.name ?? 'Público en General',
      items: (sale.sale_items ?? []).map((item) => ({ product_name: item.product_name, sku: null, quantity: Number(item.quantity), unit_price: Number(item.unit_price), line_total: Number(item.line_total) })),
      subtotal: Number(sale.subtotal),
      tax: Number(sale.tax),
      discount: Number(sale.discount),
      total: Number(sale.total),
      paymentMethod: sale.payment_method,
      amountReceived: Number(sale.amount_received),
      change: Number(sale.change),
      currencySymbol: '$',
      sellerName: sale.seller?.full_name ?? profile?.full_name ?? 'Vendedor',
      paymentDetails: sale.payment_details,
      wallet: walletFromDetails(sale.payment_details),
    };
    void printTicket(ticket);
  };

  const isCanceled = detailSale?.status === 'cancelada';
  const hasReturns = (detailSale?.sale_items ?? []).some((item) => Number(item.returned_quantity ?? 0) > 0);
  const canCancel = !!detailSale && !isCanceled && !hasReturns;
  const canReturn = !!detailSale && !isCanceled && (detailSale.sale_items ?? []).some((item) => Number(item.returned_quantity ?? 0) < Number(item.quantity));

  const openCancelModal = () => {
    setActionError(null);
    setCancelReason('');
    setCancelOpen(true);
  };

  const confirmCancel = async () => {
    if (!detailSale) return;
    setCancelLoading(true);
    setActionError(null);
    try {
      const { data, error } = await supabase.rpc('process_sale_return', {
        p_sale_id: detailSale.id,
        p_full: true,
        p_items: null,
        p_reason: cancelReason,
      });
      if (error) throw error;
      if (!data || (data as Array<{ status: string }>)[0]?.status !== 'cancelada') {
        throw new Error('No se pudo cancelar la venta.');
      }
      setCancelOpen(false);
      setDetailOpen(false);
      await load();
    } catch (cause) {
      console.error('cancel sale failed', cause);
      setActionError('No se pudo cancelar la venta. Verifica que tengas permisos y que la venta siga activa.');
    } finally {
      setCancelLoading(false);
    }
  };

  const openReturnModal = () => {
    setActionError(null);
    setReturnReason('');
    const initial: ReturnSelection = {};
    for (const item of detailSale?.sale_items ?? []) {
      if (item.id) initial[item.id] = 0;
    }
    setReturnSelection(initial);
    setReturnOpen(true);
  };

  const confirmReturn = async () => {
    if (!detailSale) return;
    const items = Object.entries(returnSelection)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantity]) => ({ item_id: itemId, quantity }));
    if (items.length === 0) {
      setActionError('Selecciona al menos un producto y cantidad para devolver.');
      return;
    }
    setReturnLoading(true);
    setActionError(null);
    try {
      const { data, error } = await supabase.rpc('process_sale_return', {
        p_sale_id: detailSale.id,
        p_full: false,
        p_items: JSON.stringify(items),
        p_reason: returnReason,
      });
      if (error) throw error;
      if (!data) throw new Error('No se pudo procesar la devolución.');
      setReturnOpen(false);
      setDetailOpen(false);
      await load();
    } catch (cause) {
      console.error('return items failed', cause);
      setActionError('No se pudo procesar la devolución. Verifica las cantidades y permisos.');
    } finally {
      setReturnLoading(false);
    }
  };

  const applyPeriod = (preset: string) => {
    const end = todayISO();
    const start = preset === 'semana' ? addDaysISO(end, -6)
      : preset === 'mes' ? startOfMonthISO()
      : preset === 'anio' ? `${end.slice(0, 4)}-01-01`
      : end;
    setPeriodPreset(preset);
    setFrom(start);
    setTo(end);
  };

  const exportReport = () => {
    const saleById = new Map(visibleSales.map((sale) => [sale.id, sale]));
    const soldProductRows = reportLines
      .filter((line) => saleById.has(line.sale_id))
      .map((line) => {
        const sale = saleById.get(line.sale_id);
        return [
          sale?.folio ?? sale?.id ?? '',
          formatDateTime(sale?.created_at ?? null),
          sale?.seller?.full_name ?? 'Sin usuario',
          sale?.status === 'cancelada' ? 'Cancelada' : 'Completada',
          line.product_name,
          Number(line.quantity),
          Number(line.unit_price),
          Number(line.line_total),
        ];
      });
    downloadXLSX(`reporte_ventas_${from}_${to}.xlsx`, [
      { name: 'Resumen', headers: ['Métrica', 'Valor'], rows: [['Ventas totales', totalSales], ['Transacciones', activeSales.length], ['Ticket promedio', avgTicket], ['IVA recaudado', totalTax], ['IEPS recaudado', totalIeps], ['Utilidad generada', totalProfit]] },
      { name: 'Productos vendidos', headers: ['Número de venta', 'Fecha', 'Empleado', 'Estado', 'Producto', 'Cantidad', 'Precio unitario', 'Total'], rows: soldProductRows },
      { name: 'Ventas', headers: ['Folio', 'Fecha', 'Empleado', 'Caja', 'Cliente', 'Método de pago', 'Estado', 'Subtotal', 'IVA', 'Total', 'Utilidad'], rows: visibleSales.map((sale) => [sale.folio ?? '', formatDateTime(sale.created_at), sale.seller?.full_name ?? 'Sin usuario', sale.cashRegisterName, sale.customer?.name ?? 'Público en General', paymentLabel(sale.payment_method), sale.status, Number(sale.subtotal), (taxBySale.get(sale.id) ?? 0) + reportLines.filter((line) => line.sale_id === sale.id).reduce((sum, line) => sum + lineIeps(line), 0), Number(sale.total), Number(sale.total) - (taxBySale.get(sale.id) ?? 0) - reportLines.filter((line) => line.sale_id === sale.id).reduce((sum, line) => sum + lineIeps(line), 0) - sale.costTotal]) },
      { name: 'Métodos de pago', headers: ['Método', 'Monto'], rows: Object.entries(paymentTotals).sort(([, a], [, b]) => b - a).map(([method, amount]) => [paymentLabel(method), amount]) },
      { name: 'Por hora', headers: ['Hora', 'Ventas'], rows: Object.entries(hourlyTotals).sort(([a], [b]) => a.localeCompare(b)) },
      { name: 'Por día', headers: ['Día de la semana', 'Ventas'], rows: Object.entries(weekdayTotals).sort(([, a], [, b]) => b - a) },
      { name: 'Por departamento', headers: ['Departamento', 'Total', 'Ganancia', 'Margen %'], rows: departmentRows.map(([name, total, profit]) => [name, total, profit, total > 0 ? (profit / total) * 100 : 0]) },
      { name: 'Por categoría', headers: ['Categoría', 'Total', 'Ganancia', 'Margen %'], rows: categoryRows.map(([name, total, profit]) => [name, total, profit, total > 0 ? (profit / total) * 100 : 0]) },
      { name: 'Top 20 productos', headers: ['Producto', 'Cantidad', 'Total'], rows: topProductRows.map((p) => [p.name, p.quantity, p.total]) },
    ]);
  };

  const returnableItems = useMemo(() => {
    return (detailSale?.sale_items ?? []).filter((item) => Number(item.returned_quantity ?? 0) < Number(item.quantity));
  }, [detailSale]);

  if (loading) return <div className="p-6"><Spinner size={32} /></div>;

  return (
    <div className="p-6">
      <PageHeader title="Reporte de Ventas" subtitle={currentBranch?.name} actions={<Button variant="secondary" onClick={exportReport}><Download size={16} /> Descargar Excel</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {branches.map((branch) => <button key={branch.id} onClick={() => setCurrentBranchId(branch.id)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${branch.id === currentBranch?.id ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{branch.name.replace('BIENESTAR ', '')}</button>)}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div><label className="mb-1.5 block text-sm font-medium text-slate-700">Periodo</label><select value={periodPreset} onChange={(event) => applyPeriod(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="dia">Día</option><option value="semana">Semana</option><option value="mes">Mes</option><option value="anio">Año</option><option value="personalizado">Personalizado</option></select></div>
        <div><label className="mb-1.5 block text-sm font-medium text-slate-700">Desde</label><Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPeriodPreset('personalizado'); }} className="w-44" /></div>
        <div><label className="mb-1.5 block text-sm font-medium text-slate-700">Hasta</label><Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPeriodPreset('personalizado'); }} className="w-44" /></div>
        <div><label className="mb-1.5 block text-sm font-medium text-slate-700">Empleado</label><select value={userFilter} onChange={(event) => setUserFilter(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="all">Todos los empleados</option>{availableUsers.map((seller) => <option key={seller.id} value={seller.id}>{seller.full_name}</option>)}</select></div>
        <Button variant="secondary" onClick={() => void load()}>Actualizar</Button>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ventas totales" value={formatCurrency(totalSales)} icon={<DollarSign size={18} />} accent="emerald" />
        <StatCard label="Transacciones" value={String(activeSales.length)} icon={<ShoppingBag size={18} />} accent="blue" />
        <StatCard label="Ticket promedio" value={formatCurrency(avgTicket)} icon={<Receipt size={18} />} accent="slate" />
        <StatCard label="IVA recaudado" value={formatCurrency(totalTax)} icon={<TrendingUp size={18} />} accent="amber" />
        <StatCard label="IEPS recaudado" value={formatCurrency(totalIeps)} icon={<TrendingUp size={18} />} accent="blue" />
        <StatCard label="Utilidad generada" value={formatCurrency(totalProfit)} icon={<TrendingUp size={18} />} accent="emerald" />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><StatCard label="Efectivo" value={formatCurrency(cashSales)} icon={<DollarSign size={18} />} accent="emerald" /><StatCard label="Tarjeta" value={formatCurrency(cardSales)} icon={<CreditCard size={18} />} accent="blue" /></div>
      <Card className="mb-4 p-4"><h2 className="mb-3 font-semibold text-slate-800">Métodos de pago</h2><div className="flex flex-wrap gap-3">{Object.entries(paymentTotals).sort(([, a], [, b]) => b - a).map(([method, amount]) => <div key={method} className="rounded-lg bg-slate-50 px-4 py-2 text-sm"><span className="text-slate-500">{paymentLabel(method)}</span><strong className="ml-2 text-slate-800">{formatCurrency(amount)}</strong></div>)}</div></Card>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2"><Card className="p-4"><h2 className="mb-3 font-semibold text-slate-800">Ventas por hora</h2>{Object.entries(hourlyTotals).sort(([a], [b]) => a.localeCompare(b)).map(([hour, amount]) => <div key={hour} className="flex justify-between border-b border-slate-100 py-1.5 text-sm"><span>{hour}</span><strong>{formatCurrency(amount)}</strong></div>)}</Card><Card className="p-4"><h2 className="mb-3 font-semibold text-slate-800">Ventas por día de la semana</h2>{Object.entries(weekdayTotals).sort(([, a], [, b]) => b - a).map(([day, amount]) => <div key={day} className="flex justify-between border-b border-slate-100 py-1.5 text-sm capitalize"><span>{day}</span><strong>{formatCurrency(amount)}</strong></div>)}</Card></div>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-800">Ventas por departamento</h2><div className="text-right"><div className="text-sm font-medium text-slate-500">Total: {formatCurrency(departmentGrandTotal)}</div><div className="text-xs text-emerald-600">Ganancia: {formatCurrency(departmentGrandProfit)}</div></div></div>
          {departmentRows.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">Sin datos en el periodo</p> : <div className="space-y-2">{departmentRows.map(([dept, amount, profit]) => {
            const pct = departmentGrandTotal > 0 ? (amount / departmentGrandTotal) * 100 : 0;
            const marginPct = amount > 0 ? (profit / amount) * 100 : 0;
            const barWidth = departmentMax > 0 ? (amount / departmentMax) * 100 : 0;
            return <div key={dept} className="group"><div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium text-slate-700">{dept}</span><div className="flex items-center gap-3"><span className={`text-xs font-medium ${marginPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{marginPct.toFixed(1)}% margen</span><span className="text-xs text-slate-400">{pct.toFixed(1)}%</span><strong className="text-slate-800">{formatCurrency(amount)}</strong></div></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all duration-300 group-hover:bg-emerald-600" style={{ width: `${barWidth}%` }} /></div><div className="mt-0.5 text-right text-xs text-slate-400">Ganancia: {formatCurrency(profit)}</div></div>;
          })}</div>}
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-800">Ventas por categoría</h2><div className="text-right"><div className="text-sm font-medium text-slate-500">Total: {formatCurrency(categoryGrandTotal)}</div><div className="text-xs text-emerald-600">Ganancia: {formatCurrency(categoryGrandProfit)}</div></div></div>
          {categoryRows.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">Sin datos en el periodo</p> : <div className="space-y-2">{categoryRows.map(([cat, amount, profit]) => {
            const pct = categoryGrandTotal > 0 ? (amount / categoryGrandTotal) * 100 : 0;
            const marginPct = amount > 0 ? (profit / amount) * 100 : 0;
            const barWidth = categoryMax > 0 ? (amount / categoryMax) * 100 : 0;
            return <div key={cat} className="group"><div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium text-slate-700">{cat}</span><div className="flex items-center gap-3"><span className={`text-xs font-medium ${marginPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{marginPct.toFixed(1)}% margen</span><span className="text-xs text-slate-400">{pct.toFixed(1)}%</span><strong className="text-slate-800">{formatCurrency(amount)}</strong></div></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500 transition-all duration-300 group-hover:bg-blue-600" style={{ width: `${barWidth}%` }} /></div><div className="mt-0.5 text-right text-xs text-slate-400">Ganancia: {formatCurrency(profit)}</div></div>;
          })}</div>}
        </Card>
      </div>
      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center gap-2"><Award size={18} className="text-amber-500" /><h2 className="font-semibold text-slate-800">Top 20 productos más vendidos</h2></div>
        {topProductRows.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">Sin datos en el periodo</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Cantidad</th><th className="px-3 py-2 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{topProductRows.map((p, i) => { const barWidth = topProductMaxQty > 0 ? (p.quantity / topProductMaxQty) * 100 : 0; return <tr key={p.name} className="hover:bg-slate-50/50"><td className="px-3 py-2 font-semibold text-slate-400">{i + 1}</td><td className="px-3 py-2"><div className="font-medium text-slate-700">{p.name}</div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-400" style={{ width: `${barWidth}%` }} /></div></td><td className="px-3 py-2 text-right font-semibold text-slate-800">{p.quantity}</td><td className="px-3 py-2 text-right text-slate-600">{formatCurrency(p.total)}</td></tr>; })}</tbody></table></div>}
      </Card>
      <Card className="overflow-hidden">
        {sales.length === 0 ? <EmptyState title="Sin ventas en el periodo" description="No hay ventas registradas en este rango de fechas." icon={<ShoppingBag size={48} />} /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">Folio</th><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Empleado</th><th className="px-4 py-3">Caja</th><th className="px-4 py-3">Pago</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3 text-right">Subtotal</th><th className="px-4 py-3 text-right">IVA</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{visibleSales.map((sale) => <tr key={sale.id} className="hover:bg-slate-50/50"><td className="px-4 py-3 font-medium text-slate-700">{sale.folio ?? '—'}</td><td className="px-4 py-3 text-slate-500">{formatDateTime(sale.created_at)}</td><td className="px-4 py-3 text-slate-600">{sale.customer?.name ?? 'General'}</td><td className="px-4 py-3 text-slate-600"><div className="flex items-center gap-2">{sale.seller?.avatar_url ? <img src={sale.seller.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" /> : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">{(sale.seller?.full_name ?? '?').slice(0, 1)}</div>}<span>{sale.seller?.full_name ?? '—'}</span></div></td><td className="px-4 py-3 text-slate-600">{sale.cashRegisterName}</td><td className="px-4 py-3"><Badge variant={sale.payment_method === 'efectivo' ? 'success' : 'info'}>{paymentLabel(sale.payment_method)}</Badge></td><td className="px-4 py-3"><Badge variant={sale.status === 'cancelada' ? 'danger' : 'success'}>{sale.status === 'cancelada' ? 'Cancelada' : 'Completada'}</Badge></td><td className="px-4 py-3 text-right text-slate-600">{formatCurrency(sale.subtotal)}</td><td className="px-4 py-3 text-right text-slate-600">{formatCurrency(taxBySale.get(sale.id) ?? 0)}</td><td className="px-4 py-3 text-right font-bold text-slate-800">{formatCurrency(sale.total)}</td><td className="px-4 py-3 text-right"><button onClick={() => void viewSale(sale.id)} title="Ver detalle completo" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><Eye size={16} /></button></td></tr>)}</tbody><tfoot className="bg-slate-50 font-semibold text-slate-700"><tr><td colSpan={7} className="px-4 py-3">Totales</td><td className="px-4 py-3 text-right">{formatCurrency(activeSales.reduce((sum, sale) => sum + Number(sale.subtotal), 0))}</td><td className="px-4 py-3 text-right">{formatCurrency(totalTax)}</td><td className="px-4 py-3 text-right text-emerald-600">{formatCurrency(totalSales)}</td><td /></tr></tfoot></table></div>}
      </Card>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={`Detalle de venta ${detailSale?.folio ?? ''}`} size="xl">
        {detailLoading ? <div className="py-8"><Spinner size={32} /></div> : detailError ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{detailError}</div> : detailSale ? <div className="space-y-4">
          {isCanceled && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><div className="flex items-center gap-2 font-semibold"><Ban size={16} /> Venta cancelada</div>{detailSale.cancellation_reason ? <p className="mt-1 text-red-600">Motivo: {detailSale.cancellation_reason}</p> : null}</div>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard label="Duración" value={saleDuration(detailSale)} icon={<Clock size={18} />} accent="blue" /><StatCard label="Subtotal" value={formatCurrency(detailSale.subtotal)} icon={<Receipt size={18} />} accent="slate" /><StatCard label="IVA" value={formatCurrency(detailSale.tax)} icon={<TrendingUp size={18} />} accent="amber" /><StatCard label="Total" value={formatCurrency(detailSale.total)} icon={<DollarSign size={18} />} accent="emerald" /></div>
          <div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-slate-200 p-4 text-sm"><h3 className="mb-3 font-semibold text-slate-800">Información de la venta</h3><dl className="space-y-1.5"><div className="flex justify-between"><dt className="text-slate-500">Folio</dt><dd className="font-medium">{detailSale.folio ?? '—'}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Fecha</dt><dd>{formatDateTime(detailSale.created_at)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Cliente</dt><dd>{detailSale.customer?.name ?? 'Público en General'}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Vendedor</dt><dd>{detailSale.seller?.full_name ?? '—'}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Método de pago</dt><dd>{paymentLabel(detailSale.payment_method)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Recibido</dt><dd>{formatCurrency(detailSale.amount_received)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Cambio</dt><dd>{formatCurrency(detailSale.change)}</dd></div></dl></div><div className="rounded-lg border border-slate-200 p-4 text-sm"><h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-800"><CreditCard size={16} /> Datos adicionales del pago</h3>{paymentDetailRows(detailSale.payment_details).length === 0 ? <p className="text-slate-500">No hay datos adicionales registrados.</p> : <dl className="space-y-1.5">{paymentDetailRows(detailSale.payment_details).map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="capitalize text-slate-500">{label}</dt><dd className="text-right font-medium text-slate-800">{value}</dd></div>)}</dl>}</div></div>
          <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Cantidad</th><th className="px-3 py-2 text-right">Devuelto</th><th className="px-3 py-2 text-right">Precio</th><th className="px-3 py-2 text-right">Descuento</th><th className="px-3 py-2 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{(detailSale.sale_items ?? []).map((item) => <tr key={item.id ?? item.product_id}><td className="px-3 py-2 font-medium">{item.product_name}</td><td className="px-3 py-2 text-right">{item.quantity}</td><td className="px-3 py-2 text-right">{Number(item.returned_quantity ?? 0) > 0 ? <span className="text-amber-600">{item.returned_quantity}</span> : '—'}</td><td className="px-3 py-2 text-right">{formatCurrency(item.unit_price)}</td><td className="px-3 py-2 text-right">{Number(item.discount ?? 0)}%</td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.line_total)}</td></tr>)}</tbody></table></div>
          {actionError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => reprint(detailSale)}><Printer size={16} /> Reimprimir ticket</Button>
            <Button variant="secondary" onClick={openReturnModal} disabled={!canReturn}><RotateCcw size={16} /> {isCanceled ? 'Devolver (no disponible)' : 'Devolver productos'}</Button>
            <Button variant="danger" onClick={openCancelModal} disabled={!canCancel}><Ban size={16} /> {isCanceled ? 'Venta cancelada' : 'Cancelar compra'}</Button>
          </div>
        </div> : null}
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancelar venta completa" size="md">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle size={20} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Esta acción no se puede deshacer.</p><p className="mt-1">Se cancelará toda la venta, se regresará el inventario al stock y se ajustará la caja si el pago fue en efectivo.</p></div></div>
          <div><label className="mb-1.5 block text-sm font-medium text-slate-700">Motivo de cancelación (opcional)</label><Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="Describe el motivo de la cancelación..." /></div>
          {actionError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setCancelOpen(false)}>Cerrar</Button><Button variant="danger" onClick={() => void confirmCancel()} disabled={cancelLoading}>{cancelLoading ? <Spinner size={16} /> : <Ban size={16} />} Confirmar cancelación</Button></div>
        </div>
      </Modal>

      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="Devolver productos" size="lg">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Selecciona los productos y cantidades a devolver. El inventario se restaurará y los totales se ajustarán automáticamente.</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Vendido</th><th className="px-3 py-2 text-right">Devuelto</th><th className="px-3 py-2 text-right">Disponible</th><th className="px-3 py-2 text-right">Devolver</th></tr></thead><tbody className="divide-y divide-slate-100">{returnableItems.map((item) => { const remaining = Number(item.quantity) - Number(item.returned_quantity ?? 0); return <tr key={item.id}><td className="px-3 py-2 font-medium">{item.product_name}</td><td className="px-3 py-2 text-right">{item.quantity}</td><td className="px-3 py-2 text-right">{Number(item.returned_quantity ?? 0)}</td><td className="px-3 py-2 text-right font-semibold">{remaining}</td><td className="px-3 py-2 text-right"><Input type="number" min={0} max={remaining} value={returnSelection[item.id ?? ''] ?? 0} onChange={(e) => setReturnSelection((prev) => ({ ...prev, [item.id ?? '']: Math.min(Math.max(0, Number(e.target.value)), remaining) }))} className="w-20 text-right" /></td></tr>; })}</tbody></table></div>
          <div><label className="mb-1.5 block text-sm font-medium text-slate-700">Motivo de la devolución (opcional)</label><Textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} rows={2} placeholder="Describe el motivo de la devolución..." /></div>
          {actionError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setReturnOpen(false)}>Cerrar</Button><Button onClick={() => void confirmReturn()} disabled={returnLoading}>{returnLoading ? <Spinner size={16} /> : <RotateCcw size={16} />} Confirmar devolución</Button></div>
        </div>
      </Modal>
    </div>
  );
}
