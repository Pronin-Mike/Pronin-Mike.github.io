import { describe, expect, it, vi } from 'vitest';
import { getDishExpiryStatus, dishExpirySortRank } from './dishExpiry';
import type { DishExpiryStatus } from './dishExpiry';
import { indexFridge } from './availability';
import type { Dish, FridgeItem } from './types';

const baseDish: Dish = {
  id: 'dish', title: 'Тест', sectionId: 'main', timeMin: null, steps: [], notes: '',
  ingredients: [{ name: 'молоко', amount: 1, unit: 'мл', sortOrder: 0 }]
};

const item = (expiresAt: string | null): FridgeItem => ({
  id: 'milk', name: 'молоко', amount: 10, unit: 'мл', updatedAt: null, expiresAt
});

describe('getDishExpiryStatus', () => {
  it('выделяет сегодня, ближайшие два дня и просроченные продукты', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15));

    expect(getDishExpiryStatus(baseDish, indexFridge([item('2026-10-15')]))).toBe('today');
    expect(getDishExpiryStatus(baseDish, indexFridge([item('2026-10-17')]))).toBe('soon');
    expect(getDishExpiryStatus(baseDish, indexFridge([item('2026-10-18')]))).toBe('none');
    expect(getDishExpiryStatus(baseDish, indexFridge([item('2026-10-14')]))).toBe('expired');

    vi.useRealTimers();
  });

  it('располагает рецепты в нужном порядке', () => {
    const statuses: DishExpiryStatus[] = ['today', 'soon', 'none', 'expired'];
    expect(statuses.map(dishExpirySortRank)).toEqual([0, 1, 2, 3]);
  });
});
