import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import type { Availability, Dish } from '../lib/types';
import { formatAmount, formatTime, sectionEmoji } from '../lib/format';
import { Button, cn } from './ui';

/* ============================================================================
 * DishCard.tsx — карточка блюда: активная или серая (не хватает продуктов).
 * ========================================================================== */

export interface DishCardProps {
  dish: Dish;
  availability: Availability;
  cooking?: boolean;
  onCook: (dish: Dish) => void;
}

export default function DishCard({ dish, availability, cooking = false, onCook }: DishCardProps) {
  const href = `/${dish.sectionId}/${dish.id}`;
  const available = availability.available;
  const ingredientsLine = dish.ingredients
    .map((item) => `${item.name} ${formatAmount(item.amount)} ${item.unit}`)
    .join(' · ');

  return (
    <article
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-2xl border shadow-soft transition',
        available ? 'border-cream-300 bg-white hover:-translate-y-0.5 hover:shadow-lift' : 'border-cream-400 bg-cream-200'
      )}
    >
      <div className={cn('flex flex-1 flex-col gap-3 p-4', !available && 'opacity-50')}>
        <Link to={href} className="flex flex-1 flex-col gap-3 rounded-xl focus-visible:outline-none">
          <span className="flex items-start gap-3">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-2xl bg-terra-50 text-2xl"
              aria-hidden="true"
            >
              {sectionEmoji(dish.sectionId)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words font-display text-[17px] leading-snug text-ink">
                {dish.title}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>{dish.ingredients.length} ингр.</span>
                {dish.timeMin ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden="true" />
                    {formatTime(dish.timeMin)}
                  </span>
                ) : null}
              </span>
            </span>
          </span>
          <span className="line-clamp-2 text-[13px] leading-relaxed text-ink-soft">{ingredientsLine}</span>
        </Link>

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink-muted">
            {available ? 'Всё есть' : `${availability.ready} из ${availability.total}`}
          </span>
          <Button
            variant={available ? 'olive' : 'ghost'}
            size="sm"
            disabled={!available || cooking}
            title={available ? 'Списать продукты и приготовить' : `Не хватает: ${availability.missingText}`}
            onClick={() => onCook(dish)}
          >
            {cooking ? 'Готовим…' : 'Приготовить'}
          </Button>
        </div>
      </div>

      {!available ? (
        <p className="border-t border-honey-100 bg-honey-50 px-4 py-2 text-xs font-semibold text-honey-700">
          Не хватает: {availability.missingText}
        </p>
      ) : null}
    </article>
  );
}
