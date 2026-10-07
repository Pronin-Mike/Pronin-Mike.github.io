import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Button, Card, Field, Input } from '../components/ui';
import { FullScreenSpinner } from '../components/Loading';

/* ============================================================================
 * Login.tsx — вход по email и паролю (регистрации нет: пользователь
 * создаётся вручную в Supabase → Authentication → Users).
 * ========================================================================== */

export default function Login() {
  const { session, loading, signIn } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (loading) return <FullScreenSpinner label="Проверяем сессию…" />;
  if (session) return <Navigate to={from} replace />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim() || !password) {
      setError('Введите email и пароль.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      toast.show('Добро пожаловать!', 'success');
      navigate(from, { replace: true });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Не удалось войти';
      setError(message);
      toast.show(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="text-4xl" aria-hidden="true">
            🍳
          </span>
          <h1 className="mt-3 font-display text-3xl text-ink">Домашняя книга</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Рецепты, холодильник и подсказка, что можно приготовить прямо сейчас.
          </p>
        </div>

        <Card className="p-5">
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                autoComplete="email"
                placeholder="you@example.com"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Field label="Пароль" htmlFor="password">
              <Input
                id="password"
                type="password"
                value={password}
                autoComplete="current-password"
                placeholder="••••••••"
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            {error ? (
              <p className="rounded-xl border border-berry-50 bg-berry-50 px-3 py-2 text-sm text-berry-700">
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" disabled={busy}>
              <LogIn className="size-4" aria-hidden="true" />
              {busy ? 'Входим…' : 'Войти'}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs leading-relaxed text-ink-muted">
          Новые пользователи создаются вручную в Supabase → Authentication → Users.
          Данные хранятся в вашей базе PostgreSQL и защищены RLS.
        </p>
      </div>
    </div>
  );
}
