// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearCookingSession, COOKING_SESSION_KEY, createCookingSession, loadCookingSession, parseCookingSession, reconcileCookingSession, saveCookingSession } from './cookingSession';
import type { Dish } from './types';

const dish: Dish = {
  id: 'dish-1', title: 'Суп', sectionId: 'lunch', timeMin: 30, notes: '',
  ingredients: [{ name: 'Картофель', amount: 200, unit: 'г', sortOrder: 0 }],
  steps: ['Нарезать', 'Сварить']
};

describe('cooking session', () => {
  beforeEach(() => localStorage.clear());

  it('creates, saves and restores a versioned session', () => {
    const created = createCookingSession(dish, '2026-01-01T00:00:00.000Z');
    saveCookingSession({ ...created, phase: 'steps', currentStep: 1 }, '2026-01-01T00:01:00.000Z');
    expect(loadCookingSession()).toMatchObject({ dishId: 'dish-1', phase: 'steps', currentStep: 1, operationId: null });
  });

  it('rejects corrupt or unsupported data', () => {
    expect(parseCookingSession('{')).toBeNull();
    expect(parseCookingSession(JSON.stringify({ version: 99 }))).toBeNull();
  });

  it('restarts safely when recipe structure changed', () => {
    const session = { ...createCookingSession(dish), phase: 'steps' as const, currentStep: 1, preparedIngredients: [0, 5] };
    const changed = { ...dish, steps: ['Новый шаг'] };
    expect(reconcileCookingSession(session, changed)).toMatchObject({ phase: 'prep', currentStep: 0, preparedIngredients: [0], operationId: null });
  });

  it('clears only the cooking key', () => {
    localStorage.setItem('other', 'kept');
    localStorage.setItem(COOKING_SESSION_KEY, JSON.stringify(createCookingSession(dish)));
    clearCookingSession();
    expect(localStorage.getItem(COOKING_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem('other')).toBe('kept');
  });
});
