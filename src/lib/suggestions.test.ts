import { describe, expect, it } from 'vitest';
import {
  buildIngredientSuggestions,
  filterIngredientSuggestions,
  shouldShowSuggestions
} from './suggestions';
import type { FridgeItem } from './types';

/* ============================================================================
 * Подсказки ингредиентов из холодильника.
 * ========================================================================== */

const fridge: FridgeItem[] = [
  { id: 'p1', name: 'хлеб', amount: 500, unit: 'г', updatedAt: null, expiresAt: null },
  { id: 'p2', name: 'молоко', amount: 1000, unit: 'мл', updatedAt: null, expiresAt: null },
  { id: 'p3', name: 'огурцы', amount: 300, unit: 'г', updatedAt: null, expiresAt: null },
  { id: 'p4', name: 'орехи', amount: 100, unit: 'г', updatedAt: null, expiresAt: null }
];

describe('buildIngredientSuggestions', () => {
  it('собирает продукты и сортирует по названию', () => {
    expect(buildIngredientSuggestions(fridge)).toEqual([
      { name: 'молоко', unit: 'мл' },
      { name: 'огурцы', unit: 'г' },
      { name: 'орехи', unit: 'г' },
      { name: 'хлеб', unit: 'г' }
    ]);
  });

  it('одно название с разными единицами даёт две подсказки', () => {
    const result = buildIngredientSuggestions([
      { id: 'a', name: 'масло', amount: 200, unit: 'мл', updatedAt: null, expiresAt: null },
      { id: 'b', name: 'Масло', amount: 100, unit: 'г', updatedAt: null, expiresAt: null }
    ]);
    expect(result).toEqual([
      { name: 'масло', unit: 'мл' },
      { name: 'Масло', unit: 'г' }
    ]);
  });

  it('убирает повторы и пустые названия', () => {
    const result = buildIngredientSuggestions([
      { id: 'a', name: 'соль', amount: 100, unit: 'г', updatedAt: null, expiresAt: null },
      { id: 'b', name: ' Соль ', amount: 200, unit: 'г', updatedAt: null, expiresAt: null },
      { id: 'c', name: '   ', amount: 1, unit: 'г', updatedAt: null, expiresAt: null }
    ]);
    expect(result).toEqual([{ name: 'соль', unit: 'г' }]);
  });

  it('на пустом холодильнике подсказок нет', () => {
    expect(buildIngredientSuggestions([])).toEqual([]);
  });
});

describe('filterIngredientSuggestions', () => {
  const suggestions = buildIngredientSuggestions(fridge);

  it('ищет по началу названия: «о» → огурцы и орехи, но не молоко', () => {
    expect(filterIngredientSuggestions(suggestions, 'о')).toEqual([
      { name: 'огурцы', unit: 'г' },
      { name: 'орехи', unit: 'г' }
    ]);
  });

  it('уточнение сужает список: «ог» → только огурцы', () => {
    expect(filterIngredientSuggestions(suggestions, 'ог')).toEqual([{ name: 'огурцы', unit: 'г' }]);
  });

  it('регистр и лишние пробелы не важны', () => {
    expect(filterIngredientSuggestions(suggestions, '  ХЛЕ ')).toEqual([{ name: 'хлеб', unit: 'г' }]);
  });

  it('незнакомое начало даёт пустой список', () => {
    expect(filterIngredientSuggestions(suggestions, 'бекон')).toEqual([]);
  });

  it('пустой ввод не показывает ничего', () => {
    expect(filterIngredientSuggestions(suggestions, '')).toEqual([]);
    expect(filterIngredientSuggestions(suggestions, '   ')).toEqual([]);
  });

  it('ограничивает количество подсказок', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `p${index}`,
      name: `продукт ${index}`,
      amount: 1,
      unit: 'г' as const,
      updatedAt: null,
      expiresAt: null
    }));
    const list = buildIngredientSuggestions(many);
    expect(filterIngredientSuggestions(list, 'п')).toHaveLength(8);
    expect(filterIngredientSuggestions(list, 'п', 3)).toHaveLength(3);
  });
});

describe('shouldShowSuggestions', () => {
  it('список открыт, когда есть совпадения и текст не дописан до конца', () => {
    const matches = filterIngredientSuggestions(buildIngredientSuggestions(fridge), 'ог');
    expect(shouldShowSuggestions(matches, 'ог')).toBe(true);
  });

  it('закрыт, если совпадений нет', () => {
    expect(shouldShowSuggestions([], 'бекон')).toBe(false);
  });

  it('закрыт, если введено ровно название единственного совпадения', () => {
    const matches = filterIngredientSuggestions(buildIngredientSuggestions(fridge), 'огурцы');
    expect(shouldShowSuggestions(matches, 'огурцы')).toBe(false);
  });

  it('остаётся открытым, если у названия несколько единиц измерения', () => {
    const both = buildIngredientSuggestions([
      { id: 'a', name: 'масло', amount: 200, unit: 'мл', updatedAt: null, expiresAt: null },
      { id: 'b', name: 'масло', amount: 100, unit: 'г', updatedAt: null, expiresAt: null }
    ]);
    expect(shouldShowSuggestions(both, 'масло')).toBe(true);
  });
});
