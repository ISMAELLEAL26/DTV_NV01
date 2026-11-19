export function formatCurrency(amount: number, symbol = '$'): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return `${symbol}${value.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const MEXICO_TIME_ZONE = 'America/Mexico_City';

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(/^\\d{4}-\\d{2}-\\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', {
    timeZone: MEXICO_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-MX', {
    timeZone: MEXICO_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MEXICO_TIME_ZONE }).format(new Date());
}

export function startOfMonthISO(): string {
  return `${todayISO().slice(0, 7)}-01`;
}

export function addDaysISO(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Mexico City has used a fixed UTC-6 offset since 2022, so day boundaries are written with that offset.
export function mexicoDayStartISO(date: string): string {
  return `${date}T00:00:00-06:00`;
}

export function mexicoDayEndISO(date: string): string {
  return `${date}T23:59:59.999-06:00`;
}

export function generateFolio(prefix: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return `${prefix}-${stamp}`;
}
