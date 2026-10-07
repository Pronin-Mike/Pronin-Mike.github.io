import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { ToastProvider } from './components/Toast';
import { Card } from './components/ui';
import { AuthProvider } from './context/AuthContext';
import { isSupabaseConfigured } from './lib/supabase';
import DishDetail from './pages/DishDetail';
import DishEdit from './pages/DishEdit';
import Fridge from './pages/Fridge';
import Import from './pages/Import';
import Login from './pages/Login';
import Recipes from './pages/Recipes';
import Settings from './pages/Settings';

/* ============================================================================
 * App.tsx — провайдеры + роутер.
 *
 * HashRouter выбран специально: прямые ссылки на GitHub Pages не дают 404,
 * потому что маршрут живёт после «#».
 * ========================================================================== */

function ConfigNotice() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-10">
      <Card className="flex flex-col gap-3">
        <h1 className="font-display text-2xl text-ink">Нужны ключи Supabase</h1>
        <p className="text-sm leading-relaxed text-ink-soft">
          Не заданы переменные окружения <code className="rounded bg-cream-100 px-1.5 py-0.5">VITE_SUPABASE_URL</code> и{' '}
          <code className="rounded bg-cream-100 px-1.5 py-0.5">VITE_SUPABASE_ANON_KEY</code>.
        </p>
        <ol className="list-inside list-decimal space-y-1.5 text-sm text-ink-soft">
          <li>
            Скопируйте <code className="rounded bg-cream-100 px-1.5 py-0.5">.env.example</code> в{' '}
            <code className="rounded bg-cream-100 px-1.5 py-0.5">.env.local</code> и подставьте значения из
            Supabase → Project Settings → API.
          </li>
          <li>
            Для GitHub Pages добавьте те же значения в Settings → Secrets and variables → Actions
            (<code className="rounded bg-cream-100 px-1.5 py-0.5">VITE_SUPABASE_URL</code>,{' '}
            <code className="rounded bg-cream-100 px-1.5 py-0.5">VITE_SUPABASE_ANON_KEY</code>) и пересоберите сайт.
          </li>
          <li>Перезапустите dev-сервер: переменные окружения читаются при сборке.</li>
        </ol>
      </Card>
    </div>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigNotice />;

  return (
    <ToastProvider>
      <AuthProvider>
        <HashRouter future={{ v7_startTransition: true }}>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Recipes />} />
                <Route path="/fridge" element={<Fridge />} />
                <Route path="/dish/new" element={<DishEdit />} />
                <Route path="/dish/:dishId/edit" element={<DishEdit />} />
                <Route path="/import" element={<Import />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/:sectionId/:dishId" element={<DishDetail />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
