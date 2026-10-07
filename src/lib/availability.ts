/* ============================================================================
 * availability.ts — вся логика сопоставления блюда и холодильника.
 *
 * Правила строгие, без пересчётов и синонимов:
 *   1. название сравнивается без учёта регистра и лишних пробелов;
 *   2. единица измерения должна совпадать точно (г ≠ мл ≠ шт);
 *   3. количество в холодильнике должно быть не меньше требуемого.
 *
 * Модуль чистый: без запросов к Supabase и без DOM — легко тестируется.
 * ========================================================================== */

import type {
  Availability,
  Dish,
  FridgeItem,
  MissingIngredient,
  Unit
} from './types';
import { isUnit } from './types';

/** Погрешность сравнения дробных количеств. */
const EPS = 1e-9;

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Ключ названия: регистр и повторные пробелы не важны. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Ключ позиции холодильника: название + единица измерения. */
export function fridgeKey(name: string, unit: string): string {
  return `${normalizeName(name)}|${unit}`;
}

/**
 * Индекс холодильника по ключу «название|единица».
 * Одинаковые позиции складываются — на случай дублей в БД.
 */
export function indexFridge(fridge: FridgeItem[]): Map<string, FridgeItem> {
  const index = new Map<string, FridgeItem>();

  for (const item of fridge) {
    const key = fridgeKey(item.name, item.unit);
    const existing = index.get(key);
    if (existing) {
      index.set(key, { ...existing, amount: round3(existing.amount + item.amount) });
    } else {
      index.set(key, item);
    }
  }

  return index;
}

/** Поиск продукта в холодильнике (по индексу или по массиву). */
export function findFridgeItem(
  fridge: FridgeItem[] | Map<string, FridgeItem>,
  name: string,
  unit: string
): FridgeItem | undefined {
  if (fridge instanceof Map) {
    return fridge.get(fridgeKey(name, unit));
  }
  const key = fridgeKey(name, unit);
  return fridge.find((item) => fridgeKey(item.name, item.unit) === key);
}

/**
 * Считает доступность блюда по текущему холодильнику.
 *
 * @param dish блюдо с ингредиентами
 * @param fridge список продуктов (или уже построенный индекс)
 */
export function checkDish(
  dish: Dish,
  fridge: FridgeItem[] | Map<string, FridgeItem>
): Availability {
  const index = fridge instanceof Map ? fridge : indexFridge(fridge);
  const missing: MissingIngredient[] = [];

  for (const ingredient of dish.ingredients) {
    const need = round3(ingredient.amount);
    const product = index.get(fridgeKey(ingredient.name, ingredient.unit));

    if (!product) {
      // Продукт с таким названием есть, но в другой единице измерения?
      const sameName = [...index.values()].find(
        (item) => normalizeName(item.name) === normalizeName(ingredient.name)
      );

      missing.push({
        name: ingredient.name,
        need,
        have: sameName ? round3(sameName.amount) : 0,
        unit: ingredient.unit,
        reason: sameName ? 'unit' : 'absent',
        actualUnit: sameName && isUnit(sameName.unit) ? (sameName.unit as Unit) : undefined
      });
      continue;
    }

    if (product.amount + EPS < need) {
      missing.push({
        name: ingredient.name,
        need,
        have: round3(product.amount),
        unit: ingredient.unit,
        reason: 'short'
      });
    }
  }

  const total = dish.ingredients.length;
  const text = missingText(missing);

  return {
    available: missing.length === 0 && total > 0,
    missing,
    missingText: text,
    ready: total - missing.length,
    total
  };
}

/** Читаемое пояснение по одному недостающему ингредиенту. */
export function formatMissing(item: MissingIngredient): string {
  if (item.reason === 'absent') return `${item.name} ${item.need} ${item.unit}`;
  if (item.reason === 'unit') {
    return `${item.name} ${item.need} ${item.unit} (в холодильнике ${item.actualUnit ?? '?'})`;
  }
  return `${item.name} ${item.need} ${item.unit} (есть ${item.have} ${item.unit})`;
}

/** «сыр 50 г, молоко 200 мл» — для бейджа «Не хватает». */
export function missingText(missing: MissingIngredient[]): string {
  return missing.map((item) => `${item.name} ${item.need} ${item.unit}`).join(', ');
}

export function isDishAvailable(
  dish: Dish,
  fridge: FridgeItem[] | Map<string, FridgeItem>
): boolean {
  return checkDish(dish, fridge).available;
}

/** Только те блюда, которые можно приготовить прямо сейчас. */
export function availableDishes(dishList: Dish[], fridge: FridgeItem[]): Dish[] {
  const index = indexFridge(fridge);
  return dishList.filter((dish) => checkDish(dish, index).available);
}
