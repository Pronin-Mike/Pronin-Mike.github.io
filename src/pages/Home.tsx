import { ArrowRight, BookOpen, Camera, Plus, Refrigerator, ScanLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import ShelfLifeBadge from '../components/ShelfLifeBadge';
import { Badge, Button, Card, SectionTitle } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import { checkDish } from '../lib/availability';
import { getDishExpiryStatus } from '../lib/dishExpiry';
import { formatTime } from '../lib/format';

export default function Home() {
  const { sections, dishes, fridge, fridgeIndex, expiring, expired, loading, error, reload } = useCookbook();

  const attention = [...expired, ...expiring].slice(0, 5);
  const sectionNames = new Map(sections.map((section) => [section.id, section.title]));
  const available = dishes
    .map((dish) => ({
      dish,
      availability: checkDish(dish, fridgeIndex),
      expiryStatus: getDishExpiryStatus(dish, fridgeIndex)
    }))
    .filter((item) => item.availability.available && item.expiryStatus !== 'expired');
  const suggested = [...available]
    .sort((a, b) => {
      const aSoon = a.expiryStatus === 'today' || a.expiryStatus === 'soon' ? 0 : 1;
      const bSoon = b.expiryStatus === 'today' || b.expiryStatus === 'soon' ? 0 : 1;
      return aSoon - bSoon || a.dish.title.localeCompare(b.dish.title, 'ru');
    })
    .slice(0, 3);

  if (error && !loading) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h1 className="font-display text-xl font-bold text-ink">Не удалось загрузить данные</h1>
        <p className="text-sm text-ink-soft">{error}</p>
        <Button onClick={() => void reload()}>Повторить</Button>
      </Card>
    );
  }

  const stats = [
    { label: 'Продукты', value: fridge.length, to: '/fridge' },
    { label: 'Сроки', value: expired.length + expiring.length, to: '/fridge?sort=expiry&expiring=1' },
    { label: 'Рецепты', value: available.length, to: '/recipes?available=1' }
  ];

  return (
    <div className="flex flex-col gap-6 animate-rise-in">
      <header>
        <p className="text-sm font-semibold text-terra-700">Обзор</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Мой холодильник
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Запасы, сроки годности и блюда, которые можно приготовить прямо сейчас.
        </p>
      </header>

      <section aria-label="Сводка" className="grid grid-cols-3 gap-2 sm:gap-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            to={stat.to}
            className="min-w-0 rounded-2xl border border-cream-300 bg-white p-3 shadow-soft transition hover:border-terra-300 hover:shadow-lift focus-visible:outline-none sm:p-5"
          >
            <span className="block truncate text-xs font-semibold text-ink-muted sm:text-sm">{stat.label}</span>
            <strong className="mt-1 block text-4xl font-extrabold leading-none tracking-tight text-ink sm:text-5xl">
              {loading ? '—' : stat.value}
            </strong>
          </Link>
        ))}
      </section>

      <section aria-label="Быстрые действия">
        <SectionTitle>Быстрые действия</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Link
            to="/fridge?add=1"
            className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-terra-500 px-4 text-[15px] font-bold text-white shadow-soft transition-colors hover:bg-terra-600"
          >
            <Plus className="size-5" aria-hidden="true" />
            Добавить продукт
          </Link>
          <Link
            to="/dish/new"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] border border-cream-300 bg-white px-4 text-[15px] font-bold text-ink-soft transition-colors hover:bg-cream-100"
          >
            <BookOpen className="size-5" aria-hidden="true" />
            Добавить рецепт
          </Link>
        </div>
      </section>

      {!loading && attention.length ? (
        <Card className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-cream-300 px-4 py-3">
            <SectionTitle count={expired.length + expiring.length}>Требуют внимания</SectionTitle>
            <Link to="/fridge?sort=expiry&expiring=1" className="text-sm font-bold text-terra-700 hover:text-terra-600">
              Все
            </Link>
          </div>
          <ul className="divide-y divide-cream-300">
            {attention.map((item) => (
              <li key={item.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{item.name}</span>
                <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                  {item.amount} {item.unit}
                </span>
                <ShelfLifeBadge expiresAt={item.expiresAt} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section aria-label="Доступные рецепты">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle count={available.length}>Можно приготовить</SectionTitle>
          <Link to="/recipes?available=1" className="inline-flex items-center gap-1 text-sm font-bold text-terra-700 hover:text-terra-600">
            Все рецепты <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        {loading ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-cream-200" />)}
          </div>
        ) : suggested.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {suggested.map(({ dish, expiryStatus }) => (
              <Link
                key={dish.id}
                to={`/${dish.sectionId}/${dish.id}`}
                className="flex min-h-28 flex-col rounded-2xl border border-cream-300 bg-white p-4 shadow-soft transition hover:border-terra-300 hover:shadow-lift"
              >
                <strong className="line-clamp-2 font-display text-base font-bold leading-snug text-ink">{dish.title}</strong>
                <span className="mt-2 text-xs text-ink-muted">
                  {sectionNames.get(dish.sectionId) ?? 'Рецепт'}{dish.timeMin ? ` · ${formatTime(dish.timeMin)}` : ''}
                </span>
                <Badge tone={expiryStatus === 'today' || expiryStatus === 'soon' ? 'warn' : 'ok'} className="mt-auto self-start">
                  {expiryStatus === 'today' || expiryStatus === 'soon' ? 'Приготовь скорее' : 'Можно приготовить'}
                </Badge>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="mt-3 flex items-center gap-3">
            <Refrigerator className="size-6 shrink-0 text-terra-500" aria-hidden="true" />
            <p className="text-sm text-ink-soft">
              {fridge.length ? 'Пока не хватает продуктов для рецептов.' : 'Добавьте продукты, и здесь появятся подходящие рецепты.'}
            </p>
          </Card>
        )}
      </section>

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-terra-100 text-terra-700">
            <ScanLine className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Добавить продукты из чека</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              Сфотографируйте чек или выберите файл, проверьте распознанные позиции и только затем добавьте их.
            </p>
          </div>
        </div>
        <Link
          to="/receipts"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-terra-500 bg-white px-4 text-sm font-bold text-terra-700 transition-colors hover:bg-terra-50"
        >
          <Camera className="size-4" aria-hidden="true" />
          Сканировать чек
        </Link>
      </Card>
    </div>
  );
}
