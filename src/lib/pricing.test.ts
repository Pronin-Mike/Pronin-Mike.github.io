import { describe, expect, it } from 'vitest';
import { addPurchase, adjustStock, consumeStock, dishCost, formatCost, ingredientCost, validStock } from './pricing';
import type { Dish, FridgeItem } from './types';

const item = (patch: Partial<FridgeItem> = {}): FridgeItem => ({
  id: 'p1', name: 'мука', amount: 1000, unit: 'г', updatedAt: null, expiresAt: null,
  lastPurchasePrice: null, totalCost: 60, pricedAmount: 500, ...patch
});

describe('стоимость остатка', () => {
  it('складывает покупки по средневзвешенной модели', () => {
    expect(addPurchase({ amount: 1000, totalCost: 200, pricedAmount: 1000 }, 500, 150))
      .toEqual({ amount: 1500, totalCost: 350, pricedAmount: 1500 });
  });

  it('не считает покупку без цены бесплатной', () => {
    expect(addPurchase({ amount: 500, totalCost: 0, pricedAmount: 0 }, 500, 60))
      .toEqual({ amount: 1000, totalCost: 60, pricedAmount: 500 });
  });

  it('нулевая известная цена остаётся известной', () => {
    expect(addPurchase({ amount: 0, totalCost: 0, pricedAmount: 0 }, 2, 0))
      .toEqual({ amount: 2, totalCost: 0, pricedAmount: 2 });
  });

  it('списывает цену и оценённую долю пропорционально', () => {
    const result = consumeStock({ amount: 1000, totalCost: 60, pricedAmount: 500 }, 200);
    expect(result.consumedCost).toBe(12);
    expect(result.consumedPricedAmount).toBe(100);
    expect(result.remaining).toEqual({ amount: 800, totalCost: 48, pricedAmount: 400 });
    expect(result.costComplete).toBe(false);
  });

  it('полное списание не оставляет хвост стоимости', () => {
    expect(consumeStock({ amount: 3, totalCost: 10, pricedAmount: 3 }, 3).remaining)
      .toEqual({ amount: 0, totalCost: 0, pricedAmount: 0 });
  });

  it('уменьшает ручную корректировку пропорционально и увеличение делает неизвестным', () => {
    expect(adjustStock({ amount: 1000, totalCost: 200, pricedAmount: 1000 }, 700))
      .toEqual({ amount: 700, totalCost: 140, pricedAmount: 700 });
    expect(adjustStock({ amount: 700, totalCost: 140, pricedAmount: 700 }, 900))
      .toEqual({ amount: 900, totalCost: 140, pricedAmount: 700 });
  });

  it('отвергает отрицательные и превышающие количества', () => {
    expect(validStock({ amount: 10, totalCost: -1, pricedAmount: 10 })).toBe(false);
    expect(() => consumeStock({ amount: 10, totalCost: 5, pricedAmount: 10 }, 11)).toThrow();
    expect(() => addPurchase({ amount: 10, totalCost: 5, pricedAmount: 10 }, -1, 1)).toThrow();
  });
});

describe('стоимость рецепта', () => {
  const dish: Dish = {
    id: 'd1', title: 'Тесто', sectionId: 'lunch', timeMin: null, steps: [], notes: '',
    ingredients: [{ name: 'мука', amount: 200, unit: 'г', sortOrder: 0 }]
  };

  it('показывает точную, частичную и неизвестную стоимость', () => {
    expect(ingredientCost(dish.ingredients[0], new Map([['мука|г', item({ totalCost: 200, pricedAmount: 1000 })]])))
      .toEqual({ knownCost: 40, status: 'exact' });
    expect(ingredientCost(dish.ingredients[0], new Map([['мука|г', item()]])))
      .toEqual({ knownCost: 12, status: 'partial' });
    expect(formatCost(ingredientCost(dish.ingredients[0], new Map([['мука|г', item({ totalCost: 0, pricedAmount: 0 })]]))))
      .toBe('Н/Д');
  });

  it('не выдаёт точную цену при недостатке или отсутствии', () => {
    expect(dishCost(dish, new Map()).status).toBe('unavailable');
    expect(dishCost(dish, new Map([['мука|г', item({ amount: 100 })]])).status).toBe('unavailable');
  });

  it('форматирует частичную оценку с тильдой', () => {
    expect(formatCost({ knownCost: 12, status: 'partial' })).toBe('~12 ₽');
  });
});
