/* ============================================================================
 * validation.ts — правила проверки данных формы (и CSV-импорта).
 * Одно место правды: и форма, и импорт проверяют блюдо одинаково.
 * ========================================================================== */

import type { DishInput, FridgeInput } from './types';
import { isUnit } from './types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateDishInput(input: DishInput): ValidationResult {
  const errors: string[] = [];
  const title = input.title.trim();

  if (!title) errors.push('Укажите название блюда.');
  else if (title.length > 120) errors.push('Название блюда длиннее 120 символов.');

  if (!input.sectionId) errors.push('Выберите раздел.');

  const time = input.timeMin;
  if (time !== null && (!Number.isFinite(time) || time < 0)) {
    errors.push('Время приготовления — число минут (или пусто).');
  } else if (time !== null && time > 1440) {
    errors.push('Время приготовления больше 1440 минут.');
  }

  const ingredients = input.ingredients.filter((item) => item.name.trim().length > 0);

  if (!ingredients.length) {
    errors.push('Добавьте хотя бы один ингредиент.');
  }

  const seen = new Set<string>();
  ingredients.forEach((item, position) => {
    const number = position + 1;
    const name = item.name.trim();

    if (!Number.isFinite(item.amount) || item.amount <= 0) {
      errors.push(`Ингредиент №${number} («${name}»): количество должно быть больше нуля.`);
    }
    if (!isUnit(item.unit)) {
      errors.push(`Ингредиент №${number} («${name}»): единица измерения — г, мл или шт.`);
    }

    const key = `${name.toLowerCase()}|${item.unit}`;
    if (seen.has(key)) {
      errors.push(`Ингредиент «${name}» указан дважды с одной единицей.`);
    }
    seen.add(key);
  });

  return { ok: errors.length === 0, errors };
}

export function validateFridgeInput(input: FridgeInput): ValidationResult {
  const errors: string[] = [];
  const name = input.name.trim();

  if (!name) errors.push('Укажите название продукта.');
  else if (name.length > 80) errors.push('Название продукта длиннее 80 символов.');

  if (!Number.isFinite(input.amount)) errors.push('Укажите количество числом.');
  else if (input.amount <= 0) errors.push('Количество должно быть больше нуля.');
  else if (input.amount > 10_000_000) errors.push('Слишком большое количество.');

  if (!isUnit(input.unit)) errors.push('Единица измерения — только г, мл или шт.');

  if (input.purchaseCost !== undefined && input.purchaseCost !== null) {
    if (!Number.isFinite(input.purchaseCost)) errors.push('Укажите стоимость числом.');
    else if (input.purchaseCost < 0) errors.push('Стоимость не может быть отрицательной.');
    else if (input.purchaseCost > 1_000_000_000) errors.push('Слишком большая стоимость.');
  }

  if (input.totalCost !== undefined && (!Number.isFinite(input.totalCost) || input.totalCost < 0)) {
    errors.push('Общая стоимость должна быть неотрицательным числом.');
  }
  if (input.pricedAmount !== undefined && (
    !Number.isFinite(input.pricedAmount) || input.pricedAmount < 0 || input.pricedAmount > input.amount
  )) {
    errors.push('Оценённое количество должно быть от нуля до общего количества.');
  }
  if (input.pricedAmount === 0 && (input.totalCost ?? 0) !== 0) {
    errors.push('Без оценённого количества известная стоимость должна быть равна нулю.');
  }

  return { ok: errors.length === 0, errors };
}
