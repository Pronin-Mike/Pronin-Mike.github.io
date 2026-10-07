/* ============================================================================
 * api.ts — ВСЕ обращения к Supabase собраны здесь.
 *
 * Компоненты и страницы не вызывают supabase напрямую: они получают отсюда
 * доменные объекты (Dish, FridgeItem, Section) и понятные ошибки.
 * ========================================================================== */

import { supabase } from './supabase';
import type {
  BackupFile,
  CookResult,
  Dish,
  DishFullRow,
  DishIngredient,
  DishIngredientInsert,
  DishIngredientRow,
  DishInput,
  DishInsert,
  DishRow,
  DishUpdate,
  FridgeInput,
  FridgeItem,
  FridgeItemRow,
  MissingIngredient,
  Section,
  SectionRow,
  Unit
} from './types';
import { isUnit } from './types';
import { round3 } from './availability';

/** Единая точка превращения ошибки Supabase в Error с понятным текстом. */
function raise(context: string, error: { message?: string } | null): never {
  throw new Error(error?.message ? `${context}: ${error.message}` : context);
}

export function toUnit(value: unknown): Unit {
  return isUnit(value) ? value : 'г';
}

/* -------------------------------------------------------------------------- *
 * Нормализация строк БД в доменные объекты
 * -------------------------------------------------------------------------- */

function toSection(row: SectionRow): Section {
  return { id: row.id, title: row.title_ru, sortOrder: row.sort_order };
}

function toFridgeItem(row: FridgeItemRow): FridgeItem {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    unit: toUnit(row.unit),
    updatedAt: row.updated_at
  };
}

function toIngredient(row: DishIngredientRow): DishIngredient {
  return {
    name: row.name,
    amount: round3(Number(row.amount)),
    unit: toUnit(row.unit),
    sortOrder: row.sort_order ?? 0
  };
}

/** Ингредиенты из view приходят jsonb-агрегатом (массив или строка JSON). */
export function normalizeIngredients(raw: unknown): DishIngredient[] {
  let value: unknown = raw;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) return [];

  return value
    .map((item, index): DishIngredient => {
      const record = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const amount = Number(record.amount);
      const sortOrder = Number(record.sort_order);
      return {
        name: String(record.name ?? '').trim(),
        amount: Number.isFinite(amount) ? round3(amount) : 0,
        unit: toUnit(record.unit),
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : index
      };
    })
    .filter((item) => item.name.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function toDish(row: DishRow, ingredients: DishIngredient[]): Dish {
  return {
    id: row.id,
    title: row.title,
    sectionId: row.section_id,
    timeMin: typeof row.time_min === 'number' ? row.time_min : null,
    steps: Array.isArray(row.steps) ? row.steps.filter((step) => typeof step === 'string') : [],
    notes: row.notes ?? '',
    ingredients
  };
}

function toDishFromFull(row: DishFullRow): Dish {
  return {
    id: row.id,
    title: row.title,
    sectionId: row.section_id,
    timeMin: typeof row.time_min === 'number' ? row.time_min : null,
    steps: Array.isArray(row.steps) ? row.steps.filter((step) => typeof step === 'string') : [],
    notes: row.notes ?? '',
    ingredients: normalizeIngredients(row.ingredients)
  };
}

function byTitle(a: Dish, b: Dish): number {
  return a.title.localeCompare(b.title, 'ru');
}

function byName(a: FridgeItem, b: FridgeItem): number {
  return a.name.localeCompare(b.name, 'ru');
}

/* -------------------------------------------------------------------------- *
 * Разделы
 * -------------------------------------------------------------------------- */

export async function fetchSections(): Promise<Section[]> {
  const { data, error } = await supabase
    .from('sections')
    .select('id, title_ru, sort_order')
    .order('sort_order', { ascending: true });

  if (error) raise('Не удалось загрузить разделы', error);
  return (data ?? []).map(toSection);
}

/* -------------------------------------------------------------------------- *
 * Холодильник
 * -------------------------------------------------------------------------- */

export async function fetchFridge(): Promise<FridgeItem[]> {
  const { data, error } = await supabase.from('fridge_items').select('*');
  if (error) raise('Не удалось загрузить холодильник', error);
  return (data ?? []).map(toFridgeItem).sort(byName);
}

export async function addFridgeItem(input: FridgeInput): Promise<FridgeItem> {
  const { data, error } = await supabase
    .from('fridge_items')
    .insert({ name: input.name.trim(), amount: round3(input.amount), unit: input.unit })
    .select('*')
    .single();

  if (error || !data) raise('Не удалось добавить продукт', error);
  return toFridgeItem(data);
}

export async function updateFridgeItem(
  id: string,
  patch: Partial<FridgeInput>
): Promise<FridgeItem> {
  const payload: { name?: string; amount?: number; unit?: string } = {};
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.amount !== undefined) payload.amount = round3(patch.amount);
  if (patch.unit !== undefined) payload.unit = patch.unit;

  const { data, error } = await supabase
    .from('fridge_items')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) raise('Не удалось обновить продукт', error);
  return toFridgeItem(data);
}

export async function deleteFridgeItem(id: string): Promise<void> {
  const { error } = await supabase.from('fridge_items').delete().eq('id', id);
  if (error) raise('Не удалось удалить продукт', error);
}

export async function clearFridge(): Promise<void> {
  const { error } = await supabase.from('fridge_items').delete().not('id', 'is', null);
  if (error) raise('Не удалось очистить холодильник', error);
}

/* -------------------------------------------------------------------------- *
 * Блюда
 * -------------------------------------------------------------------------- */

/**
 * Все блюда с ингредиентами.
 * Основной путь — view dishes_full; если она недоступна (нет прав/не создана),
 * тихо переходим на выборку из двух таблиц.
 */
export async function fetchDishes(): Promise<Dish[]> {
  const full = await supabase.from('dishes_full').select('*');

  if (!full.error && full.data) {
    return full.data.map(toDishFromFull).sort(byTitle);
  }

  const [dishesResult, ingredientsResult] = await Promise.all([
    supabase.from('dishes').select('*'),
    supabase.from('dish_ingredients').select('*').order('sort_order', { ascending: true })
  ]);

  if (dishesResult.error) raise('Не удалось загрузить блюда', dishesResult.error);
  if (ingredientsResult.error) raise('Не удалось загрузить ингредиенты', ingredientsResult.error);

  const ingredients = ingredientsResult.data ?? [];

  return (dishesResult.data ?? [])
    .map((row) =>
      toDish(row, ingredients.filter((item) => item.dish_id === row.id).map(toIngredient))
    )
    .sort(byTitle);
}

export async function fetchDish(id: string): Promise<Dish | null> {
  const { data, error } = await supabase.from('dishes_full').select('*').eq('id', id).maybeSingle();
  if (error) raise('Не удалось загрузить блюдо', error);
  if (data) return toDishFromFull(data);

  const [dishResult, ingredientsResult] = await Promise.all([
    supabase.from('dishes').select('*').eq('id', id).maybeSingle(),
    supabase.from('dish_ingredients').select('*').eq('dish_id', id).order('sort_order', { ascending: true })
  ]);

  if (dishResult.error) raise('Не удалось загрузить блюдо', dishResult.error);
  if (ingredientsResult.error) raise('Не удалось загрузить ингредиенты', ingredientsResult.error);
  if (!dishResult.data) return null;

  return toDish(dishResult.data, (ingredientsResult.data ?? []).map(toIngredient));
}

async function insertIngredients(dishId: string, ingredients: DishIngredient[]): Promise<void> {
  const rows: DishIngredientInsert[] = ingredients
    .filter((item) => item.name.trim().length > 0)
    .map((item, index) => ({
      dish_id: dishId,
      name: item.name.trim(),
      amount: round3(item.amount),
      unit: item.unit,
      sort_order: index
    }));

  if (!rows.length) return;

  const { error } = await supabase.from('dish_ingredients').insert(rows);
  if (error) raise('Не удалось сохранить ингредиенты', error);
}

function toDishPayload(input: DishInput): DishInsert {
  return {
    title: input.title.trim(),
    section_id: input.sectionId,
    time_min: input.timeMin,
    steps: input.steps.map((step) => step.trim()).filter(Boolean),
    notes: input.notes.trim() ? input.notes.trim() : null
  };
}

export async function createDish(input: DishInput): Promise<Dish> {
  const { data, error } = await supabase
    .from('dishes')
    .insert(toDishPayload(input))
    .select('*')
    .single();

  if (error || !data) raise('Не удалось сохранить блюдо', error);

  await insertIngredients(data.id, input.ingredients);
  return toDish(data, input.ingredients.map((item, index) => ({ ...item, sortOrder: index })));
}

export async function updateDish(id: string, input: DishInput): Promise<Dish> {
  const payload: DishUpdate = toDishPayload(input);

  const { data, error } = await supabase
    .from('dishes')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) raise('Не удалось обновить блюдо', error);

  // Ингредиенты проще переписать целиком, чем считать diff.
  const { error: deleteError } = await supabase.from('dish_ingredients').delete().eq('dish_id', id);
  if (deleteError) raise('Не удалось обновить ингредиенты', deleteError);

  await insertIngredients(id, input.ingredients);
  return toDish(data, input.ingredients.map((item, index) => ({ ...item, sortOrder: index })));
}

export async function deleteDish(id: string): Promise<void> {
  const { error } = await supabase.from('dishes').delete().eq('id', id);
  if (error) raise('Не удалось удалить блюдо', error);
}

/* -------------------------------------------------------------------------- *
 * Приготовление: RPC cook_dish
 * -------------------------------------------------------------------------- */

function normalizeCookResult(raw: unknown): CookResult {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const missingRaw = Array.isArray(record.missing) ? record.missing : [];

  const missing: MissingIngredient[] = missingRaw
    .map((item): MissingIngredient => {
      const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const need = Number(row.need ?? row.amount ?? 0);
      const have = Number(row.have ?? 0);
      return {
        name: String(row.name ?? '').trim(),
        need: Number.isFinite(need) ? round3(need) : 0,
        have: Number.isFinite(have) ? round3(have) : 0,
        unit: toUnit(row.unit),
        reason: have > 0 ? 'short' : 'absent'
      };
    })
    .filter((item) => item.name.length > 0);

  return { success: Boolean(record.success), missing };
}

export async function cookDish(dishId: string): Promise<CookResult> {
  const { data, error } = await supabase.rpc('cook_dish', { p_dish_id: dishId });
  if (error) raise('Не удалось приготовить блюдо', error);
  return normalizeCookResult(data);
}

/* -------------------------------------------------------------------------- *
 * Бэкап: экспорт и импорт JSON
 * -------------------------------------------------------------------------- */

export async function exportBackup(): Promise<BackupFile> {
  const [fridge, dishes, ingredients] = await Promise.all([
    supabase.from('fridge_items').select('*'),
    supabase.from('dishes').select('*'),
    supabase.from('dish_ingredients').select('*')
  ]);

  if (fridge.error) raise('Не удалось выгрузить холодильник', fridge.error);
  if (dishes.error) raise('Не удалось выгрузить блюда', dishes.error);
  if (ingredients.error) raise('Не удалось выгрузить ингредиенты', ingredients.error);

  return {
    app: 'home-cookbook',
    version: 1,
    exportedAt: new Date().toISOString(),
    fridge_items: fridge.data ?? [],
    dishes: dishes.data ?? [],
    dish_ingredients: ingredients.data ?? []
  };
}

/**
 * Полная замена содержимого базы данными из файла.
 * Идентификаторы генерируются заново, связи «блюдо → ингредиенты» сохраняются.
 */
export async function importBackup(
  file: Partial<BackupFile>,
  knownSectionIds: string[]
): Promise<{ fridge: number; dishes: number; skipped: number }> {
  const clearDishes = await supabase.from('dishes').delete().not('id', 'is', null);
  if (clearDishes.error) raise('Не удалось очистить блюда', clearDishes.error);

  const clearFridgeResult = await supabase.from('fridge_items').delete().not('id', 'is', null);
  if (clearFridgeResult.error) raise('Не удалось очистить холодильник', clearFridgeResult.error);

  const fridgeRows = (Array.isArray(file.fridge_items) ? file.fridge_items : []).filter(
    (row) =>
      row &&
      typeof row.name === 'string' &&
      row.name.trim().length > 0 &&
      Number.isFinite(Number(row.amount)) &&
      Number(row.amount) > 0 &&
      isUnit(row.unit)
  );

  if (fridgeRows.length) {
    const { error } = await supabase.from('fridge_items').insert(
      fridgeRows.map((row) => ({
        name: row.name.trim(),
        amount: round3(Number(row.amount)),
        unit: row.unit
      }))
    );
    if (error) raise('Не удалось загрузить холодильник', error);
  }

  const ingredientsByDish = new Map<string, DishIngredientRow[]>();
  for (const row of Array.isArray(file.dish_ingredients) ? file.dish_ingredients : []) {
    if (!row || typeof row.dish_id !== 'string') continue;
    const list = ingredientsByDish.get(row.dish_id) ?? [];
    list.push(row);
    ingredientsByDish.set(row.dish_id, list);
  }

  const knownSections = new Set(knownSectionIds);
  let dishes = 0;
  let skipped = 0;

  for (const row of Array.isArray(file.dishes) ? file.dishes : []) {
    const title = typeof row?.title === 'string' ? row.title.trim() : '';
    if (!row || !title || !knownSections.has(row.section_id)) {
      skipped += 1;
      continue;
    }

    try {
      await createDish({
        title,
        sectionId: row.section_id,
        timeMin: typeof row.time_min === 'number' ? row.time_min : null,
        steps: Array.isArray(row.steps) ? row.steps.filter((step) => typeof step === 'string') : [],
        notes: typeof row.notes === 'string' ? row.notes : '',
        ingredients: normalizeIngredients(ingredientsByDish.get(row.id) ?? [])
      });
      dishes += 1;
    } catch {
      skipped += 1;
    }
  }

  return { fridge: fridgeRows.length, dishes, skipped };
}

/* -------------------------------------------------------------------------- *
 * Массовый импорт блюд (CSV)
 * -------------------------------------------------------------------------- */

export async function importDishes(
  inputs: DishInput[]
): Promise<{ added: number; errors: string[] }> {
  const errors: string[] = [];
  let added = 0;

  for (const input of inputs) {
    try {
      await createDish(input);
      added += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка';
      errors.push(`${input.title}: ${message}`);
    }
  }

  return { added, errors };
}
