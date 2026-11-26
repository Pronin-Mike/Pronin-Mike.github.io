import type { Dish } from './types';

export const COOKING_SESSION_KEY = 'fridge-cooking-v2';
export const COOKING_SESSION_VERSION = 1;

export type CookingPhase = 'prep' | 'steps' | 'confirm';

export interface CookingSession {
  version: typeof COOKING_SESSION_VERSION;
  dishId: string;
  dishTitle: string;
  recipeFingerprint: string;
  phase: CookingPhase;
  currentStep: number;
  preparedIngredients: number[];
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  operationId: string | null;
}

export function recipeFingerprint(dish: Dish): string {
  return JSON.stringify({
    ingredients: dish.ingredients.map(({ name, amount, unit }) => [name.trim().toLocaleLowerCase('ru'), amount, unit]),
    steps: dish.steps.map((step) => step.trim())
  });
}

export function createCookingSession(dish: Dish, now = new Date().toISOString()): CookingSession {
  return {
    version: COOKING_SESSION_VERSION,
    dishId: dish.id,
    dishTitle: dish.title,
    recipeFingerprint: recipeFingerprint(dish),
    phase: 'prep',
    currentStep: 0,
    preparedIngredients: [],
    createdAt: now,
    updatedAt: now,
    completed: false,
    operationId: null
  };
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function parseCookingSession(raw: string | null): CookingSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CookingSession>;
    if (
      value.version !== COOKING_SESSION_VERSION ||
      !isString(value.dishId) ||
      !isString(value.dishTitle) ||
      !isString(value.recipeFingerprint) ||
      !['prep', 'steps', 'confirm'].includes(value.phase ?? '') ||
      !Number.isInteger(value.currentStep) ||
      !Array.isArray(value.preparedIngredients) ||
      !isString(value.createdAt) ||
      !isString(value.updatedAt) ||
      typeof value.completed !== 'boolean' ||
      !(value.operationId === null || typeof value.operationId === 'string')
    ) return null;

    return {
      ...value,
      preparedIngredients: [...new Set(value.preparedIngredients.filter((index) => Number.isInteger(index) && index >= 0))],
      currentStep: Math.max(0, Number(value.currentStep))
    } as CookingSession;
  } catch {
    return null;
  }
}

export function loadCookingSession(): CookingSession | null {
  return parseCookingSession(localStorage.getItem(COOKING_SESSION_KEY));
}

export function saveCookingSession(session: CookingSession, now = new Date().toISOString()): CookingSession {
  const saved = { ...session, updatedAt: now };
  localStorage.setItem(COOKING_SESSION_KEY, JSON.stringify(saved));
  return saved;
}

export function clearCookingSession(): void {
  localStorage.removeItem(COOKING_SESSION_KEY);
}

export function reconcileCookingSession(session: CookingSession, dish: Dish): CookingSession {
  const nextFingerprint = recipeFingerprint(dish);
  if (session.recipeFingerprint === nextFingerprint) {
    return { ...session, dishTitle: dish.title, currentStep: Math.min(session.currentStep, Math.max(0, dish.steps.length - 1)) };
  }
  return {
    ...session,
    dishTitle: dish.title,
    recipeFingerprint: nextFingerprint,
    phase: 'prep',
    currentStep: 0,
    preparedIngredients: session.preparedIngredients.filter((index) => index < dish.ingredients.length),
    operationId: null
  };
}
