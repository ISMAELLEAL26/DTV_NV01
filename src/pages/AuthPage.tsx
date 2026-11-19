import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { UserRound, LockKeyhole, Loader2 } from 'lucide-react';
import { PROGRAM_LOGO } from '@/lib/branding';
import { supabase } from '@/lib/supabase';

interface LoginUser {
  username: string;
  full_name: string;
  avatar_url: string | null;
}

export default function AuthPage() {
  const { signIn } = useAuth();
  const [users, setUsers] = useState<LoginUser[]>([]);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.rpc('get_login_users').then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) {
        console.error('login users load failed', loadError);
        return;
      }
      setUsers((data as LoginUser[]) ?? []);
    });
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const normalizedUsername = username.trim().toUpperCase();
    if (!normalizedUsername || !/^\d{6}$/.test(pin)) {
      setError('Selecciona un usuario e ingresa un PIN de 6 dígitos.');
      return;
    }
    setBusy(true);
    const result = await signIn(normalizedUsername, pin);
    setBusy(false);
    if (result.error) {
      console.error('sign in failed', result.error);
      setError('Usuario o PIN incorrectos.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={PROGRAM_LOGO} alt="DRISRED Operadora" className="mb-4 h-auto w-full max-w-sm object-contain" />
          <p className="text-sm text-slate-500">Selecciona tu usuario para entrar</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
          {users.length > 0 && (
            <div className="mb-6">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Usuarios disponibles</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {users.map((loginUser) => (
                  <button
                    key={loginUser.username}
                    type="button"
                    onClick={() => { setUsername(loginUser.username); setError(null); }}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${username === loginUser.username ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50'}`}
                  >
                    {loginUser.avatar_url ? (
                      <img src={loginUser.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <UserRound size={17} />
                      </div>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">{loginUser.full_name}</span>
                      <span className="block text-xs text-slate-500">{loginUser.username}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Usuario</label>
              <div className="relative">
                <UserRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                  required
                  autoCapitalize="characters"
                  autoComplete="username"
                  placeholder="Ej. LEPI011208"
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm uppercase transition focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">PIN de 6 dígitos</label>
              <div className="relative">
                <LockKeyhole size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="current-password"
                  placeholder="••••••"
                  className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm tracking-[0.35em] transition focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            {error && <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

            <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60">
              {busy && <Loader2 size={16} className="animate-spin" />}
              Entrar
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">Sistema POS BIENESTAR · Acceso de personal</p>
      </div>
    </div>
  );
}
