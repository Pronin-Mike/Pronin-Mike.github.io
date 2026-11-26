import { useMemo, useState } from 'react';
import { Grid3X3, List, Plus, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import DishCard, { type RecipeCardMode } from '../components/DishCard';
import { SkeletonCards } from '../components/Loading';
import { Button, Card, cn, Input, SectionTitle } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import { checkDish } from '../lib/availability';
import { getDishExpiryStatus } from '../lib/dishExpiry';

type AvailabilityFilter = 'all' | 'ready' | 'soon';

export default function Recipes() {
  const { sections, dishes, fridge, fridgeIndex, loading, error, reload } = useCookbook();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [mode, setModeState] = useState<RecipeCardMode>(() => localStorage.getItem('recipe-card-mode') === '1' ? 1 : 3);
  const sectionId = searchParams.get('section') ?? 'all';

  const setSectionId = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('section'); else params.set('section', next);
    setSearchParams(params, { replace: true });
  };
  const setMode = (next: RecipeCardMode) => {
    setModeState(next);
    localStorage.setItem('recipe-card-mode', String(next));
  };

  const decorated = useMemo(() => dishes.map((dish) => ({
    dish,
    availability: checkDish(dish, fridgeIndex),
    expiryStatus: getDishExpiryStatus(dish, fridgeIndex)
  })), [dishes, fridgeIndex]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return decorated.filter((item) => {
      if (sectionId !== 'all' && item.dish.sectionId !== sectionId) return false;
      if (needle && !item.dish.title.toLowerCase().includes(needle) && !item.dish.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(needle))) return false;
      if (availabilityFilter === 'ready') return item.availability.available && item.expiryStatus === 'none';
      if (availabilityFilter === 'soon') return item.availability.available && (item.expiryStatus === 'soon' || item.expiryStatus === 'today');
      return true;
    });
  }, [availabilityFilter, decorated, query, sectionId]);

  if (error && !loading) return <Card className="flex flex-col items-start gap-3"><h1 className="font-display text-xl text-ink">Не удалось загрузить книгу</h1><p className="text-sm text-ink-soft">{error}</p><Button onClick={() => void reload()}>Повторить</Button></Card>;

  return (
    <div className="flex flex-col gap-5 animate-rise-in">
      <header className="flex items-start justify-between gap-3">
        <div><h1 className="font-display text-[31px] font-extrabold leading-[1.2] tracking-[-1.2px] text-ink max-[720px]:text-[26px]">Мои рецепты</h1><p className="mt-1 text-sm text-ink-soft">{loading ? 'Загружаем…' : `${dishes.length} рецептов`}</p></div>
        <Link to="/dish/new" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[11px] bg-terra-500 px-4 font-bold text-white shadow-soft hover:bg-terra-600"><Plus className="size-4" />Добавить рецепт</Link>
      </header>

      {!loading && fridge.length === 0 ? <div className="rounded-2xl border border-terra-100 bg-terra-50 px-4 py-3 text-sm text-terra-700">Холодильник пуст. Доступность рецептов будет рассчитана после добавления продуктов.</div> : null}

      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1"><Input value={query} className="pr-10" placeholder="Поиск рецепта" aria-label="Поиск рецепта" onChange={(event) => setQuery(event.target.value)} />{query ? <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center text-ink-muted" aria-label="Очистить поиск"><X className="size-4" /></button> : null}</div>
          <div className="flex shrink-0 gap-1 rounded-[11px] border border-cream-300 bg-white p-1" aria-label="Режим карточек">
            <button type="button" aria-label="Одна карточка в ряд" aria-pressed={mode === 1} onClick={() => setMode(1)} className={cn('grid size-9 place-items-center rounded-lg', mode === 1 ? 'bg-terra-100 text-terra-700' : 'text-ink-muted')}><List className="size-4" /></button>
            <button type="button" aria-label="Три карточки в ряд" aria-pressed={mode === 3} onClick={() => setMode(3)} className={cn('grid size-9 place-items-center rounded-lg', mode === 3 ? 'bg-terra-100 text-terra-700' : 'text-ink-muted')}><Grid3X3 className="size-4" /></button>
          </div>
        </div>

        <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1" aria-label="Приём пищи">
          {[{ id: 'all', title: 'Все' }, ...sections].map((section) => <button key={section.id} type="button" onClick={() => setSectionId(section.id)} className={cn('min-h-10 shrink-0 rounded-[10px] border px-3.5 text-sm font-bold', sectionId === section.id ? 'border-terra-100 bg-terra-100 text-terra-700' : 'border-cream-300 bg-white text-ink-soft')}>{section.title}</button>)}
        </div>
        <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1" aria-label="Доступность">
          {([['all', 'Все рецепты'], ['ready', 'Можно приготовить'], ['soon', 'Приготовь скорее']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setAvailabilityFilter(value)} className={cn('min-h-10 shrink-0 rounded-[10px] border px-3.5 text-sm font-bold', availabilityFilter === value ? 'border-terra-100 bg-terra-100 text-terra-700' : 'border-cream-300 bg-white text-ink-soft')}>{label}</button>)}
        </div>
      </div>

      {loading ? <SkeletonCards /> : null}
      {!loading && visible.length ? <div className={cn('grid gap-4', mode === 3 ? 'md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1')}>
        {visible.map((item) => <DishCard key={item.dish.id} dish={item.dish} availability={item.availability} fridgeIndex={fridgeIndex} expiryStatus={item.expiryStatus} mode={mode} sectionTitle={sections.find((section) => section.id === item.dish.sectionId)?.title} />)}
      </div> : null}
      {!loading && !visible.length ? <Card className="flex flex-col items-center gap-3 py-10 text-center"><SectionTitle>{dishes.length ? 'Ничего не найдено' : 'Пока нет рецептов'}</SectionTitle><p className="text-sm text-ink-soft">Измените поиск или фильтры.</p></Card> : null}
    </div>
  );
}
