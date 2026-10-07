import { describe, expect, it } from 'vitest';
import {
  availableDishes,
  checkDish,
  formatMissing,
  fridgeKey,
  indexFridge,
  isDishAvailable,
  missingText,
  normalizeName
} from './availability';
import type { Dish, DishIngredient, FridgeItem } from './types';

/* ============================================================================
 * Проверки логики доступности: сопоставление строго по названию и единице.
 * ========================================================================== */

const fridge: FridgeItem[] = [
  { id: 'p1', name: 'яйца', amount: 10, unit: 'шт', updatedAt: null },
  { id: 'p2', name: 'сыр', amount: 120, unit: 'г', updatedAt: null },
  { id: 'p3', name: 'Масло сливочное', amount: 200, unit: 'мл', updatedAt: null }
];

function makeDish(ingredients: DishIngredient[], title = 'Тестовое блюдо'): Dish {
  return {
    id: 'd1',
    title,
    sectionId: 'breakfast',
    timeMin: 10,
    steps: [],
    notes: '',
    ingredients
  };
}

describe('normalizeName / fridgeKey', () => {
  it('игнорирует регистр, лишние пробелы и края', () => {
    expect(normalizeName('  Мука   Пшеничная ')).toBe('мука пшеничная');
    expect(fridgeKey(' МУКА ', 'г')).toBe('мука|г');
  });

  it('различает единицы измерения', () => {
    expect(fridgeKey('масло', 'г')).not.toBe(fridgeKey('масло', 'мл'));
  });
});

describe('checkDish', () => {
  it('блюдо доступно, когда всё есть', () => {
    const dish = makeDish([
      { name: 'яйца', amount: 3, unit: 'шт', sortOrder: 0 },
      { name: 'сыр', amount: 50, unit: 'г', sortOrder: 1 }
    ]);
    const availability = checkDish(dish, fridge);
    expect(availability.available).toBe(true);
    expect(availability.missing).toHaveLength(0);
    expect(availability.ready).toBe(2);
  });

  it('название сравнивается без учёта регистра и пробелов', () => {
    const dish = makeDish([{ name: ' ЯЙЦА ', amount: 3, unit: 'шт', sortOrder: 0 }]);
    expect(checkDish(dish, fridge).available).toBe(true);
  });

  it('другая единица измерения — продукт отсутствует', () => {
    const dish = makeDish([{ name: 'масло сливочное', amount: 30, unit: 'г', sortOrder: 0 }]);
    const availability = checkDish(dish, fridge);
    expect(availability.available).toBe(false);
    expect(availability.missing[0].reason).toBe('unit');
    expect(availability.missing[0].actualUnit).toBe('мл');
  });

  it('недостаточное количество помечается как нехватка', () => {
    const dish = makeDish([{ name: 'сыр', amount: 200, unit: 'г', sortOrder: 0 }]);
    const availability = checkDish(dish, fridge);
    expect(availability.missing[0].reason).toBe('short');
    expect(availability.missing[0].have).toBe(120);
  });

  it('неизвестный продукт считается отсутствующим', () => {
    const dish = makeDish([{ name: 'бекон', amount: 50, unit: 'г', sortOrder: 0 }]);
    const availability = checkDish(dish, fridge);
    expect(availability.missing[0].reason).toBe('absent');
    expect(availability.missing[0].have).toBe(0);
  });

  it('собирает список недостающего и текст для бейджа', () => {
    const dish = makeDish([
      { name: 'яйца', amount: 3, unit: 'шт', sortOrder: 0 },
      { name: 'сыр', amount: 200, unit: 'г', sortOrder: 1 },
      { name: 'бекон', amount: 50, unit: 'г', sortOrder: 2 }
    ]);
    const availability = checkDish(dish, fridge);
    expect(availability.ready).toBe(1);
    expect(availability.total).toBe(3);
    expect(missingText(availability.missing)).toBe('сыр 200 г, бекон 50 г');
    expect(formatMissing(availability.missing[0])).toBe('сыр 200 г (есть 120 г)');
  });

  it('блюдо без ингредиентов недоступно', () => {
    expect(checkDish(makeDish([]), fridge).available).toBe(false);
  });

  it('одинаковые продукты в холодильнике складываются', () => {
    const index = indexFridge([
      { id: 'a', name: 'мука', amount: 500, unit: 'г', updatedAt: null },
      { id: 'b', name: 'МУКА', amount: 700, unit: 'г', updatedAt: null }
    ]);
    const dish = makeDish([{ name: 'мука', amount: 1200, unit: 'г', sortOrder: 0 }]);
    expect(checkDish(dish, index).available).toBe(true);
  });

  it('принимает заранее построенный индекс', () => {
    const dish = makeDish([{ name: 'сыр', amount: 50, unit: 'г', sortOrder: 0 }]);
    expect(isDishAvailable(dish, indexFridge(fridge))).toBe(true);
  });
});

describe('availableDishes', () => {
  it('оставляет только полностью доступные блюда', () => {
    const ready = makeDish([{ name: 'сыр', amount: 50, unit: 'г', sortOrder: 0 }], 'Готовое');
    const notReady = makeDish([{ name: 'свёкла', amount: 300, unit: 'г', sortOrder: 0 }], 'Неготовое');
    expect(availableDishes([ready, notReady], fridge).map((dish) => dish.title)).toEqual(['Готовое']);
  });
});
