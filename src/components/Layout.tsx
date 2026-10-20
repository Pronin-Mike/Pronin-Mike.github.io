import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  CircleUserRound,
  Home,
  Import as ImportIcon,
  LogOut,
  Menu,
  Plus,
  Refrigerator,
  ScanLine,
  Settings as SettingsIcon
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Modal from './Modal';
import { useToast } from './Toast';
import { Button, cn } from './ui';

const PRIMARY_ITEMS = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/fridge', label: 'Продукты', icon: Refrigerator, end: false },
  { to: '/recipes', label: 'Рецепты', icon: BookOpen, end: false }
] as const;

const MORE_ITEMS = [
  { to: '/receipts', label: 'Сканер чеков', icon: ScanLine },
  { to: '/dish/new', label: 'Добавить рецепт', icon: Plus },
  { to: '/import', label: 'Импорт', icon: ImportIcon },
  { to: '/settings', label: 'Настройки', icon: SettingsIcon }
] as const;

export default function Layout() {
  const { email, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      toast.show('Вы вышли из приложения.', 'info');
      navigate('/login', { replace: true });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось выйти', 'error');
    } finally {
      setSigningOut(false);
      setMoreOpen(false);
    }
  };

  const recipeDetailOpen = /^\/[^/]+\/[^/]+$/.test(location.pathname)
    && location.pathname !== '/dish/new';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-cream-300 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-terra-500 text-white">
              <Refrigerator className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-[17px] font-extrabold leading-tight text-ink">
                Мой холодильник
              </span>
              <span className="block max-w-44 truncate text-xs text-ink-muted">{email ?? 'личные запасы'}</span>
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Основная навигация">
            {PRIMARY_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3.5 text-sm font-bold transition-colors',
                  (isActive || (item.to === '/recipes' && recipeDetailOpen))
                    ? 'bg-terra-100 text-terra-700'
                    : 'text-ink-soft hover:bg-cream-100'
                )}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
            <NavLink
              to="/receipts"
              className={({ isActive }) => cn(
                'inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3.5 text-sm font-bold transition-colors',
                isActive ? 'bg-terra-100 text-terra-700' : 'text-ink-soft hover:bg-cream-100'
              )}
            >
              <ScanLine className="size-4" aria-hidden="true" />
              Чек
            </NavLink>
            <NavLink
              to="/dish/new"
              className={({ isActive }) => cn(
                'inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3.5 text-sm font-bold transition-colors',
                isActive ? 'bg-terra-100 text-terra-700' : 'text-ink-soft hover:bg-cream-100'
              )}
            >
              <Plus className="size-4" aria-hidden="true" />
              Добавить
            </NavLink>
            <NavLink
              to="/import"
              className={({ isActive }) => cn(
                'inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3.5 text-sm font-bold transition-colors',
                isActive ? 'bg-terra-100 text-terra-700' : 'text-ink-soft hover:bg-cream-100'
              )}
            >
              <ImportIcon className="size-4" aria-hidden="true" />
              Импорт
            </NavLink>
            <NavLink
              to="/settings"
              aria-label="Настройки"
              className={({ isActive }) => cn(
                'grid size-11 place-items-center rounded-[10px] transition-colors',
                isActive ? 'bg-terra-100 text-terra-700' : 'text-ink-soft hover:bg-cream-100'
              )}
            >
              <SettingsIcon className="size-5" aria-hidden="true" />
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:pt-6 lg:pb-12">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 gap-1 border-t border-cream-300 bg-white/95 px-2 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] pt-1.5 backdrop-blur lg:hidden"
        aria-label="Навигация"
      >
        {PRIMARY_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => cn(
              'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-bold transition-colors',
              (isActive || (item.to === '/recipes' && recipeDetailOpen))
                ? 'bg-terra-100 text-terra-700'
                : 'text-ink-muted'
            )}
          >
            <item.icon className="size-5" aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-bold transition-colors',
            moreOpen ? 'bg-terra-100 text-terra-700' : 'text-ink-muted'
          )}
        >
          <Menu className="size-5" aria-hidden="true" />
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
              className="flex min-h-12 items-center gap-3 rounded-[10px] border border-cream-300 bg-white px-4 text-[15px] font-bold text-ink transition-colors hover:bg-cream-100"
            >
              <item.icon className="size-5 text-terra-500" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
          <div className="mt-2 flex items-center gap-3 rounded-[10px] bg-cream-100 px-4 py-3 text-sm text-ink-soft">
            <CircleUserRound className="size-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{email}</span>
          </div>
          <Button variant="ghost" disabled={signingOut} onClick={() => void handleSignOut()} className="mt-1">
            <LogOut className="size-4" aria-hidden="true" />
            {signingOut ? 'Выходим…' : 'Выйти'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
