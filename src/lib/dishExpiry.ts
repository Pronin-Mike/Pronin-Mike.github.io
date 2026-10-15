import { fridgeKey } from './availability';
import { daysUntil, getExpiryStatus } from './shelfLife';
import type { Dish, FridgeItem } from './types';

/** Статус срока годности для карточки рецепта. */
export type DishExpiryStatus = 'expired' | 'today' | 'soon' | 'none';

/**
 * Самый важный срок среди ингредиентов рецепта.
 * Просроченный ингредиент имеет приоритет: такая карточка всегда красная и
 * переносится в конец списка, даже если у другого ингредиента срок истекает сегодня.
 */
export function getDishExpiryStatus(dish: Dish, fridgeIndex: Map<string, FridgeItem>): DishExpiryStatus {
  let hasToday = false;
  let hasSoon = false;

  for (const ingredient of dish.ingredients) {
    const item = fridgeIndex.get(fridgeKey(ingredient.name, ingredient.unit));
    if (!item) continue;

    if (getExpiryStatus(item.expiresAt) === 'expired') return 'expired';

    // Для рецептов «скоро» означает именно ближайшие два дня, не три.
    if (item.expiresAt) {
      const days = daysUntil(item.expiresAt);
      if (days === 0) hasToday = true;
      else if (days === 1 || days === 2) hasSoon = true;
    }
  }

  if (hasToday) return 'today';
  return hasSoon ? 'soon' : 'none';
}

/** Порядок рецептов: сегодня → ближайшие 2 дня → остальные → просроченные. */
export function dishExpirySortRank(status: DishExpiryStatus): number {
  return { today: 0, soon: 1, none: 2, expired: 3 }[status];
}
