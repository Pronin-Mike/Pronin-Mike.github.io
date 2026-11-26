import { Clock, Utensils } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Availability, Dish, FridgeItem } from '../lib/types';
import { fridgeKey } from '../lib/availability';
import { formatTime, sectionEmoji } from '../lib/format';
import { getExpiryStatus } from '../lib/shelfLife';
import type { DishExpiryStatus } from '../lib/dishExpiry';
import { cn } from './ui';

export type RecipeCardMode = 1 | 3;

export interface DishCardProps {
  dish: Dish;
  availability: Availability;
  fridgeIndex: Map<string, FridgeItem>;
  expiryStatus: DishExpiryStatus;
  mode: RecipeCardMode;
  sectionTitle?: string;
}

export default function DishCard({ dish, availability, fridgeIndex, expiryStatus, mode, sectionTitle }: DishCardProps) {
  const href = `/${dish.sectionId}/${dish.id}`;
  const expiredNames = dish.ingredients
    .map((ingredient) => fridgeIndex.get(fridgeKey(ingredient.name, ingredient.unit)))
    .filter((item): item is FridgeItem => Boolean(item))
    .filter((item) => getExpiryStatus(item.expiresAt) === 'expired')
    .map((item) => item.name);
  const expired = expiredNames.length > 0;
  const soon = availability.available && (expiryStatus === 'soon' || expiryStatus === 'today');
  const status = expired ? 'Есть просроченный продукт' : soon ? 'Приготовь скорее' : availability.available ? 'Можно приготовить' : 'Не хватает ингредиентов';
  const tone = expired ? 'text-berry-700 bg-berry-50' : soon ? 'text-honey-700 bg-honey-50' : availability.available ? 'text-green-700 bg-green-50' : 'text-ink-soft bg-cream-200';

  return (
    <article className={cn('group relative overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-soft transition hover:-translate-y-0.5 hover:border-terra-200 hover:shadow-lift', mode === 1 ? 'grid grid-cols-[110px_1fr] sm:grid-cols-[minmax(150px,240px)_1fr]' : 'flex h-full flex-col')}>
      <Link
        to={href}
        aria-label={`Открыть рецепт «${dish.title}»`}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500 focus-visible:ring-inset"
      />
      <div className="grid aspect-[4/3] w-full place-items-center self-start bg-gradient-to-br from-terra-50 to-cream-200 text-terra-500">
        <Utensils className="size-10" aria-hidden="true" />
      </div>
      <div className={cn('flex min-w-0 flex-1 flex-col p-4', mode === 1 && 'sm:p-5')}>
        <div className="min-w-0">
          <h2 className="line-clamp-2 font-display text-[17px] font-extrabold leading-snug text-ink transition-colors group-hover:text-terra-700">{dish.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            {dish.timeMin ? <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{formatTime(dish.timeMin)}</span> : null}
            <span>{dish.ingredients.length} ингредиентов</span>
          </p>
        </div>
        <span className={cn('mt-3 w-fit rounded-full px-2.5 py-1 text-[11px] font-extrabold', tone)}>{status}</span>
        {!availability.available && !expired ? <p className="mt-2 line-clamp-1 text-xs text-ink-muted">Не хватает: {availability.missingText}</p> : null}
        {expired ? <p className="mt-2 line-clamp-1 text-xs text-berry-700">Просрочено: {[...new Set(expiredNames)].join(', ')}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="truncate text-xs font-bold text-ink-muted">{sectionEmoji(dish.sectionId)} {sectionTitle ?? dish.sectionId}</span>
        </div>
      </div>
    </article>
  );
}
