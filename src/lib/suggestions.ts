/* ============================================================================
 * suggestions.ts — подсказки названий ингредиентов из холодильника.
 *
 * Задача: когда пользователь пишет название ингредиента в форме блюда,
 * показать продукты, которые уже есть в холодильнике.
 *
 * Правила:
 *   • короткий ввод ищем с начала, а от трёх символов — по любой части названия;
 *   • регистр и лишние пробелы не важны;
 *   • пустой ввод — подсказок нет, список закрыт;
 *   • если совпадений нет, список тоже закрыт, а поле остаётся обычным:
 *     ингредиент можно ввести руками, как раньше.
 *
 * Чистые функции без DOM — легко тестируются.
 * ========================================================================== */

import { normalizeName } from './availability';
import type { FridgeItem, Unit } from './types';

export interface IngredientSuggestion {
  name: string;
  unit: Unit;
  amount: number;
}

/** Сколько подсказок показываем максимум. */
export const SUGGESTION_LIMIT = 8;

/**
 * Строит список подсказок из продуктов холодильника.
 * Одинаковые названия с разными единицами дают две подсказки —
 * это честно, ведь совпадение единицы обязательно.
 */
export function buildIngredientSuggestions(fridge: FridgeItem[]): IngredientSuggestion[] {
  const byProduct = new Map<string, IngredientSuggestion>();

  for (const item of fridge) {
    const name = item.name.trim();
    if (!name) continue;

    const key = `${normalizeName(name)}|${item.unit}`;
    const existing = byProduct.get(key);
    if (existing) existing.amount += item.amount;
    else byProduct.set(key, { name, unit: item.unit, amount: item.amount });
  }

  return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/**
 * Фильтрует подсказки по введённому тексту. Совпадения с начала названия
 * идут перед совпадениями в середине («хле» найдёт и «Бородинский хлеб»).
 * @param query то, что пользователь уже напечатал
 * @param limit максимум подсказок
 */
export function filterIngredientSuggestions(
  suggestions: IngredientSuggestion[],
  query: string,
  limit: number = SUGGESTION_LIMIT
): IngredientSuggestion[] {
  const needle = normalizeName(query);
  if (!needle) return [];

  const allowMiddleMatch = needle.length >= 3;

  return suggestions
    .filter((item) => {
      const name = normalizeName(item.name);
      return name.startsWith(needle) || (allowMiddleMatch && name.includes(needle));
    })
    .sort((a, b) => {
      const aPrefix = normalizeName(a.name).startsWith(needle) ? 0 : 1;
      const bPrefix = normalizeName(b.name).startsWith(needle) ? 0 : 1;
      return aPrefix - bPrefix || a.name.localeCompare(b.name, 'ru');
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Нужно ли вообще открывать список.
 * Держим его закрытым, когда введено ровно название единственного продукта:
 * подсказывать уже выбранное незачем.
 */
export function shouldShowSuggestions(
  matches: IngredientSuggestion[],
  query: string
): boolean {
  if (!matches.length) return false;

  const needle = normalizeName(query);
  if (!needle) return false;

  const exact = matches.length === 1 && normalizeName(matches[0].name) === needle;
  return !exact;
}
