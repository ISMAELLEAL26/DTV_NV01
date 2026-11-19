import { useEffect, useState } from 'react';
import { Check, ChevronDown, Send, Smartphone, X } from 'lucide-react';

export interface RechargeServiceData { company: string; phone: string; amount: string; reference: string; }
export interface RechargeResult { ok?: boolean; error?: string; missing?: string[]; balance?: number | null; providerFolio?: string | null; providerReference?: Record<string, unknown>; }
interface ExtensionBridgeProps { onChargeRequest?: (service: RechargeServiceData) => void; executeRecharge?: RechargeServiceData | null; onRechargeResult?: (result: RechargeResult) => void; }
interface CompanyOption { name: string; shortName: string; tone: string; amounts: string[]; }
interface FillResult extends RechargeResult { amounts?: string[]; }
type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'ok'; text: string } | { kind: 'error'; text: string };

const COMPANY_CATALOG: Array<[string, string, string, string[]]> = [
  ['Telcel','telcel','bg-blue-600',['10','20','30','50','100','150','200','300','500']], ['Movistar','movistar','bg-emerald-500',['10','20','30','50','100','150','200','300','500']], ['AT&T','at&t','bg-slate-900',['10','20','30','50','100','150','200','300','500']], ['Unefon','unefon','bg-orange-500',['10','20','30','50','100','150','200','300','500']], ['Bait','bait','bg-cyan-600',['10','20','30','50','100','150','200','250','300','500']], ['CFE Internet','cfe','bg-red-600',['30','50','100','150','200','300','500']], ['Virgin','virgin','bg-red-500',['10','20','30','50','100','150','200','300','500']], ['Amigo Sin Límite','amigo','bg-sky-600',['20','30','50','65','100','150','200','300','500']], ['Internet Amigo','internet','bg-teal-600',['30','50','100','150','200','300','500']], ['ABIB','abib','bg-amber-600',['10','20','30','50','100','150','200','300','500']], ['Axios Mobile','axios','bg-blue-700',['10','20','30','50','100','200','300','500']], ['Flash Mobile','flash','bg-yellow-500',['10','20','30','50','100','200','300','500']], ['Nextel','nextel','bg-lime-600',['10','20','30','50','100','200','300','500']], ['Oui','oui','bg-pink-600',['10','20','30','50','100','200','300','500']], ['Pillofon','pillo','bg-rose-600',['10','20','30','50','100','200','300','500']], ['Turbocel','turbo','bg-blue-800',['10','20','30','50','100','200','300','500']], ['Mi Móvil','mi movil','bg-green-600',['10','20','30','50','100','200','300','500']], ['Newww','newww','bg-slate-700',['10','20','30','50','100','200','300','500']], ['Ultracel','ultra','bg-cyan-800',['55','100','200','300','500']], ['Valor Telecom','valor','bg-orange-700',['10','20','30','50','100','150','200','300','500']], ['Wimo','wimo','bg-emerald-700',['10','20','30','50','100','150','200','300','500']],
];
const COMPANIES: CompanyOption[] = COMPANY_CATALOG.map(([name, shortName, tone, amounts]) => ({ name, shortName, tone, amounts }));
const DEFAULT_PROVIDER_URL = 'https://recargasdm.com/inicio.php';
const RESPONSE_TIMEOUT_MS = 20000;

export default function ExtensionBridgeTest({ onChargeRequest, executeRecharge, onRechargeResult }: ExtensionBridgeProps) {
  const [open, setOpen] = useState(false);
  const [service, setService] = useState<RechargeServiceData>({ company: 'Telcel', phone: '5512345678', amount: '', reference: 'TEST-0001' });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [balance, setBalance] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<Record<string, string[]>>({});
  const selectedCompany = COMPANIES.find((company) => company.name === service.company) ?? COMPANIES[0];
  const selectedAmounts = catalog[selectedCompany.name]?.length ? catalog[selectedCompany.name] : selectedCompany.amounts;

  const syncProvider = (company: string) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data?.type !== 'POS_PROVIDER_SYNC_RESPONSE' || event.data.requestId !== requestId) return;
      const result = (event.data.result ?? {}) as FillResult;
      if (typeof result.balance === 'number') setBalance(result.balance);
      if (result.amounts?.length) setCatalog((current) => ({ ...current, [company]: result.amounts ?? [] }));
      if (!result.ok && result.error) setStatus({ kind: 'error', text: result.error });
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'pos-app', type: 'POS_PROVIDER_SYNC_REQUEST', requestId, payload: { providerUrl: DEFAULT_PROVIDER_URL, company } }, window.location.origin);
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => syncProvider(service.company), 5000);
    return () => window.clearInterval(timer);
  }, [open, service.company]);

  const sendToExtension = (requestedService: RechargeServiceData = service) => {
    if (requestedService.phone.length !== 10) { setStatus({ kind: 'error', text: 'Escribe un teléfono válido de 10 dígitos.' }); return; }
    if (!requestedService.amount) { setStatus({ kind: 'error', text: 'Consulta y selecciona un monto real del proveedor.' }); return; }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== 'pos-extension' || event.data.type !== 'POS_EXTENSION_RESPONSE' || event.data.requestId !== requestId) return;
      const result = (event.data.result ?? {}) as FillResult;
      if (typeof result.balance === 'number') setBalance(result.balance);
      onRechargeResult?.(result);
      finish(result.ok ? { kind: 'ok', text: `Proveedor respondió: ${requestedService.company} · ${requestedService.amount}` } : { kind: 'error', text: result.error ?? `Faltan campos: ${(result.missing ?? []).join(', ')}` });
    };
    const finish = (next: Status) => { window.removeEventListener('message', onMessage); window.clearTimeout(timer); setStatus(next); };
    const timer = window.setTimeout(() => finish({ kind: 'error', text: 'La extensión no respondió.' }), RESPONSE_TIMEOUT_MS);
    setStatus({ kind: 'sending' }); window.addEventListener('message', onMessage);
    window.postMessage({ source: 'pos-app', type: 'POS_EXTENSION_REQUEST', requestId, payload: { providerUrl: DEFAULT_PROVIDER_URL, service: { ...requestedService, phoneConfirm: requestedService.phone } } }, window.location.origin);
  };

  useEffect(() => {
    if (executeRecharge) sendToExtension(executeRecharge);
  }, [executeRecharge]);

  return <div className="relative">
    <button onClick={() => { setOpen((value) => !value); syncProvider(service.company); }} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"><Smartphone size={16} /> Recargas <ChevronDown size={14} className={open ? 'rotate-180 transition' : 'transition'} /></button>
    {open && <section className="absolute left-0 top-full z-40 mt-2 flex max-h-[calc(100vh-7rem)] w-[min(48rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3"><div><p className="text-sm font-bold text-slate-800">Recargas y servicios</p><p className="text-xs text-slate-500">Selecciona una compañía y sus montos disponibles</p></div><div className="flex items-center gap-3"><div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-right"><p className="text-[9px] font-bold uppercase text-emerald-700">Saldo disponible</p><p className="text-sm font-black text-emerald-800">{balance === null ? 'Sin sincronizar' : `$${balance.toFixed(2)}`}</p></div><button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar"><X size={17} /></button></div></header>
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-4 overflow-y-auto p-4"><div className="col-span-7"><div className="mb-2 flex justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">Compañías</span><span className="text-xs text-slate-400">21 disponibles</span></div><div className="grid grid-cols-3 gap-2">{COMPANIES.map((company) => <button key={company.name} onClick={() => { setService({ ...service, company: company.name, amount: '' }); setStatus({ kind: 'idle' }); syncProvider(company.name); }} className={`relative flex min-h-[54px] items-center gap-2 rounded-xl border p-2 text-left transition ${service.company === company.name ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20' : 'border-slate-200 bg-white hover:border-emerald-300'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[8px] font-black uppercase leading-none text-white ${company.tone}`}>{company.shortName}</span><span className="truncate text-[11px] font-bold text-slate-700">{company.name}</span>{service.company === company.name && <Check size={12} className="absolute right-1 top-1 text-emerald-600" />}</button>)}</div></div><div className="col-span-5 rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Montos reales de {selectedCompany.name}</p><div className="mt-2 grid grid-cols-4 gap-2">{selectedAmounts.map((amount) => <button key={amount} onClick={() => setService({ ...service, amount })} className={`rounded-lg border py-2 text-sm font-black ${service.amount === amount ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 text-slate-700 hover:bg-emerald-50'}`}>${amount}</button>)}</div><label className="mt-4 block text-xs font-bold text-slate-600">Teléfono<input inputMode="numeric" value={service.phone} onChange={(e) => setService({ ...service, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none" /></label><p className="mt-1 text-[10px] text-slate-400">Se duplica automáticamente para confirmar.</p><input value={service.reference} onChange={(e) => setService({ ...service, reference: e.target.value })} placeholder="Referencia opcional" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none" /><button onClick={() => onChargeRequest ? onChargeRequest(service) : sendToExtension()} disabled={status.kind === 'sending'} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"><Send size={15} />{status.kind === 'sending' ? 'Enviando...' : onChargeRequest ? 'Cobrar y enviar recarga' : 'Enviar a la extensión'}</button>{status.kind !== 'idle' && <p className={`mt-2 text-xs font-semibold ${status.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{status.kind === 'sending' ? 'Esperando respuesta...' : status.text}</p>}</div></div>
    </section>}
  </div>;
}
