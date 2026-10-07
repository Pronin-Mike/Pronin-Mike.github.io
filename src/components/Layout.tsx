import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Import,
  LogOut,
  PlusCircle,
  Refrigerator,
  Settings as SettingsIcon,
  SlidersHorizontal
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import Modal from './Modal';
import { Button, cn } from './ui';

/* ============================================================================
 * Layout.tsx — шапка, содержимое и навигация:
 *   desktop — ссылки в шапке, mobile — нижняя навигация + «Ещё».
 * ========================================================================== */

const NAV_ITEMS = [
  { to: '/', label: 'Рецепты', icon: BookOpen, end: true },
  { to: '/fridge', label: 'Холодильник', icon: Refrigerator, end: false },
  { to: '/dish/new', label: 'Добавить', icon: PlusCircle, end: false },
  { to: '/import', label: 'Импорт', icon: Import, end: false },
  { to: '/settings', label: 'Настройки', icon: SettingsIcon, end: false }
] as const;

const MOBILE_ITEMS = NAV_ITEMS.slice(0, 3);
const MORE_ITEMS = NAV_ITEMS.slice(3);

export default function Layout() {
  const { email, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      toast.show('Вы вышли из книги.', 'info');
      navigate('/login', { replace: true });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось выйти', 'error');
    } finally {
      setSigningOut(false);
      setMoreOpen(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-cream-300 bg-cream-100/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <span className="text-2xl" aria-hidden="true">
              🍳
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-[17px] leading-tight text-ink">
                Домашняя книга
              </span>
              <span className="block truncate text-xs text-ink-muted">{email ?? 'кулинарная книга'}</span>
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Основная навигация">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition',
                    isActive ? 'bg-terra-500 text-white shadow-soft' : 'text-ink-soft hover:bg-cream-200'
                  )
                }
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-32 md:pb-12">
        <Outlet />
      </main>

      {/* Нижняя навигация на мобильных */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 gap-1 border-t border-cream-300 bg-white/95 px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] backdrop-blur md:hidden"
        aria-label="Навигация"
      >
        {MOBILE_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold transition',
                isActive ? 'bg-terra-50 text-terra-700' : 'text-ink-muted'
              )
            }
          >
            <item.icon className="size-5" aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold transition',
            moreOpen ? 'bg-terra-50 text-terra-700' : 'text-ink-muted'
          )}
        >
          <SlidersHorizontal className="size-5" aria-hidden="true" />
          Ещё
        </button>
      </nav>

      <Modal open={moreOpen} title="Ещё" size="sm" onClose={() => setMoreOpen(false)}>
        <div className="flex flex-col gap-2">
          {MORE_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMoreOpen(false)}
              className="flex min-h-12 items-center gap-3 rounded-xl border border-cream-300 bg-white px-4 text-[15px] font-semibold text-ink transition hover:bg-cream-100"
            >
              <item.icon className="size-5 text-terra-500" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
          <Button variant="ghost" disabled={signingOut} onClick={() => void handleSignOut()} className="mt-2">
            <LogOut className="size-4" aria-hidden="true" />
            {signingOut ? 'Выходим…' : 'Выйти'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
