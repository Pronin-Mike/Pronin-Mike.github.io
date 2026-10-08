import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, ShoppingBasket, X } from 'lucide-react';
import DishCard from '../components/DishCard';
import ExpiredBlock from '../components/ExpiredBlock';
import ExpiringBlock from '../components/ExpiringBlock';
import { SkeletonCards } from '../components/Loading';
import { useToast } from '../components/Toast';
import { Button, Card, cn, Input, SectionTitle } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import { checkDish, fridgeKey, missingText } from '../lib/availability';
import { sectionEmoji } from '../lib/format';
import { getExpiryStatus } from '../lib/shelfLife';
import type { Dish, FridgeItem } from '../lib/types';

/* ============================================================================
 * Recipes.tsx — список блюд по разделам с поиском и фильтром
 * «Что приготовить» (только полностью доступные блюда).
 * ========================================================================== */

const ALL_SECTIONS = 'all';

/** Сколько скоропортящихся продуктов блюдо «спасает» (soon или today). */
function rescueCount(dish: Dish, fridgeIndex: Map<string, FridgeItem>): number {
  const keys = new Set<string>();
  for (const ingredient of dish.ingredients) {
    const product = fridgeIndex.get(fridgeKey(ingredient.name, ingredient.unit));
    if (!product) continue;
    const status = getExpiryStatus(product.expiresAt);
    if (status === 'soon' || status === 'today') keys.add(fridgeKey(product.name, product.unit));
  }
  return keys.size;
}

export default function Recipes() {
  const { sections, dishes, fridge, fridgeIndex, loading, error, reload, cook } = useCookbook();
  const toast = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [cookingId, setCookingId] = useState<string | null>(null);

  /** Раздел хранится в адресе (?section=lunch) — на него можно дать ссылку. */
  const sectionId = searchParams.get('section') ?? ALL_SECTIONS;
  const setSectionId = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === ALL_SECTIONS) params.delete('section');
    else params.set('section', next);
    setSearchParams(params, { replace: true });
  };

  const orderedSections = useMemo(
    () => [...sections].sort((a, b) => a.sortOrder - b.sortOrder),
    [sections]
  );

  const decorated = useMemo(
    () => dishes.map((dish) => ({ dish, availability: checkDish(dish, fridgeIndex) })),
    [dishes, fridgeIndex]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    let list = decorated;

    if (sectionId !== ALL_SECTIONS) {
      list = list.filter((item) => item.dish.sectionId === sectionId);
    }

    if (needle) {
      list = list.filter(
        (item) =>
          item.dish.title.toLowerCase().includes(needle) ||
          item.dish.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(needle))
      );
    }

    if (onlyAvailable) {
      list = list.filter((item) => item.availability.available);
    }

    return [...list].sort((a, b) => {
      if (a.availability.available !== b.availability.available) {
        return a.availability.available ? -1 : 1;
      }
      // В режиме «Что приготовить» выше те блюда, что спасают больше
      // скоропортящихся продуктов (soon/today).
      if (onlyAvailable) {
        const diff = rescueCount(b.dish, fridgeIndex) - rescueCount(a.dish, fridgeIndex);
        if (diff !== 0) return diff;
      }
      return a.dish.title.localeCompare(b.dish.title, 'ru');
    });
  }, [decorated, sectionId, query, onlyAvailable, fridgeIndex]);

  const availableCount = useMemo(
    () => decorated.filter((item) => item.availability.available).length,
    [decorated]
  );

  const handleCook = async (dish: Dish) => {
    setCookingId(dish.id);
    try {
      const result = await cook(dish.id);
      if (!result.success) {
        toast.show(`Не хватает: ${missingText(result.missing)}`, 'error');
      } else if (result.expiredWarning?.length) {
        toast.show(
          `«${dish.title}» приготовлено. Использованы просроченные продукты: ${result.expiredWarning.join(', ')}`,
          'warning'
        );
      } else {
        toast.show(`«${dish.title}» приготовлено — продукты списаны.`, 'success');
      }
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось приготовить блюдо', 'error');
    } finally {
      setCookingId(null);
    }
  };

  if (error && !loading) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h1 className="font-display text-xl text-ink">Не удалось загрузить книгу</h1>
        <p className="text-sm text-ink-soft">{error}</p>
        <Button onClick={() => void reload()}>Повторить</Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-rise-in">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl text-ink">Рецепты</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {loading
              ? 'Загружаем…'
              : `Всего ${dishes.length}, можно приготовить ${availableCount}`}
          </p>
        </div>
        <Link
          to="/dish/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-terra-500 px-4 text-[15px] font-semibold text-white shadow-soft transition hover:bg-terra-600"
        >
          <Plus className="size-4" aria-hidden="true" />
          Блюдо
        </Link>
      </header>

      {!loading && fridge.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-terra-100 bg-terra-50 px-4 py-3 text-sm text-terra-700">
          <ShoppingBasket className="size-5 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            Холодильник пуст. Добавьте продукты — и книга покажет, что можно приготовить.
          </span>
          <Link
            to="/fridge"
            className="inline-flex min-h-9 items-center rounded-full border border-terra-200 bg-white px-3 text-sm font-semibold text-terra-700"
          >
            Заполнить
          </Link>
        </div>
      ) : null}

      {!loading ? (
        <>
          <ExpiredBlock />
          <ExpiringBlock />
        </>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <Input
              value={query}
              className="pl-9"
              placeholder="Поиск по блюду или ингредиенту"
              aria-label="Поиск по блюду или ингредиенту"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-cream-100 text-ink-muted"
                aria-label="Очистить поиск"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-full border border-cream-300 bg-white px-4 shadow-soft">
            <input
              type="checkbox"
              className="size-4 accent-olive-500"
              checked={onlyAvailable}
              onChange={(event) => setOnlyAvailable(event.target.checked)}
            />
            <span className="text-sm font-semibold text-ink-soft">Что приготовить</span>
          </label>
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <button
            type="button"
            onClick={() => setSectionId(ALL_SECTIONS)}
            className={cn(
              'min-h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold transition',
              sectionId === ALL_SECTIONS
                ? 'border-terra-500 bg-terra-500 text-white shadow-soft'
                : 'border-cream-300 bg-white text-ink-soft hover:bg-cream-100'
            )}
          >
            Все
          </button>
          {orderedSections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setSectionId(section.id)}
              className={cn(
                'min-h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold transition',
                sectionId === section.id
                  ? 'border-terra-500 bg-terra-500 text-white shadow-soft'
                  : 'border-cream-300 bg-white text-ink-soft hover:bg-cream-100'
              )}
            >
              {sectionEmoji(section.id)} {section.title}
            </button>
          ))}
        </div>
      </div>

      {loading ? <SkeletonCards /> : null}

      {!loading && visible.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => (
            <DishCard
              key={item.dish.id}
              dish={item.dish}
              availability={item.availability}
              fridgeIndex={fridgeIndex}
              cooking={cookingId === item.dish.id}
              onCook={(dish) => void handleCook(dish)}
            />
          ))}
        </div>
      ) : null}

      {!loading && visible.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="text-4xl" aria-hidden="true">
            {dishes.length === 0 ? '🧺' : onlyAvailable ? '🛒' : '🔍'}
          </span>
          <SectionTitle>
            {dishes.length === 0
              ? 'Пока нет ни одного блюда'
              : onlyAvailable
                ? 'Готовить нечего'
                : 'Ничего не нашлось'}
          </SectionTitle>
          <p className="max-w-md text-sm text-ink-soft">
            {dishes.length === 0
              ? 'Добавьте блюдо вручную или загрузите CSV на вкладке «Импорт».'
              : onlyAvailable
                ? 'Ни одно блюдо не подходит под текущий холодильник. Пополните продукты или выключите фильтр.'
                : 'Попробуйте другое название блюда или ингредиента.'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {dishes.length === 0 ? (
              <>
                <Link
                  to="/dish/new"
                  className="inline-flex min-h-11 items-center rounded-full bg-terra-500 px-4 font-semibold text-white"
                >
                  Добавить блюдо
                </Link>
                <Link
                  to="/import"
                  className="inline-flex min-h-11 items-center rounded-full border border-cream-300 bg-white px-4 font-semibold text-ink-soft"
                >
                  Загрузить CSV
                </Link>
              </>
            ) : (
              <>
                {onlyAvailable ? (
                  <Button variant="ghost" onClick={() => setOnlyAvailable(false)}>
                    Показать все блюда
                  </Button>
                ) : null}
                {query ? (
                  <Button variant="ghost" onClick={() => setQuery('')}>
                    Сбросить поиск
                  </Button>
                ) : null}
                {sectionId !== ALL_SECTIONS ? (
                  <Button variant="ghost" onClick={() => setSectionId(ALL_SECTIONS)}>
                    Все разделы
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
