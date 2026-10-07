import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Button, Card, SectionTitle } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { dateStamp, downloadTextFile } from '../lib/download';
import { dishWord } from '../lib/format';

/* ============================================================================
 * Settings.tsx — пользователь, экспорт бэкапа и выход.
 * ========================================================================== */

export default function Settings() {
  const { email, signOut } = useAuth();
  const { dishes, fridge } = useCookbook();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const backup = await api.exportBackup();
      downloadTextFile(
        `cookbook-backup-${dateStamp()}.json`,
        JSON.stringify(backup, null, 2),
        'application/json'
      );
      toast.show('Бэкап сохранён в файл.', 'success');
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось выгрузить базу', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
      toast.show('Вы вышли из книги.', 'info');
      navigate('/login', { replace: true });
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось выйти', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-rise-in">
      <header>
        <h1 className="font-display text-3xl text-ink">Настройки</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {dishWord(dishes.length)} и {fridge.length} продуктов в вашей базе Supabase.
        </p>
      </header>

      <Card className="flex flex-col gap-3">
        <SectionTitle>Аккаунт</SectionTitle>
        <p className="flex items-center gap-2 text-[15px] text-ink">
          <UserRound className="size-4 text-terra-500" aria-hidden="true" />
          {email ?? 'неизвестный пользователь'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => void handleSignOut()}>
            <LogOut className="size-4" aria-hidden="true" />
            Выйти
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionTitle>Бэкап</SectionTitle>
        <p className="text-sm leading-relaxed text-ink-soft">
          JSON-файл содержит холодильник, блюда и ингредиенты. Его можно загрузить обратно на вкладке
          «Импорт» — данные заменятся целиком.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void handleExport()}>
            <Download className="size-4" aria-hidden="true" />
            Экспорт JSON
          </Button>
          <Link
            to="/import"
            className="inline-flex min-h-11 items-center rounded-full border border-cream-300 bg-white px-4 font-semibold text-ink-soft transition hover:bg-cream-100"
          >
            Импорт и CSV
          </Link>
        </div>
      </Card>

      <Card className="bg-cream-50">
        <SectionTitle>Как это работает</SectionTitle>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>Данные лежат в Supabase (PostgreSQL) и доступны только вам: RLS разрешает работу роли authenticated.</li>
          <li>Ингредиент считается доступным, если название (без учёта регистра и пробелов) и единица измерения совпадают точно, а количества хватает.</li>
          <li>Пересчётов и синонимов нет: «1 ст.л.» и «200 мл» — разные единицы, продукт будет считаться отсутствующим.</li>
          <li>Кнопка «Приготовить» вызывает серверную функцию <code className="rounded bg-cream-100 px-1.5 py-0.5">cook_dish</code>: она списывает продукты, удаляет обнулившиеся позиции и пишет запись в журнал готовки.</li>
          <li>Пользователи не регистрируются сами: аккаунт заводится вручную в Supabase → Authentication → Users.</li>
        </ul>
      </Card>
    </div>
  );
}
