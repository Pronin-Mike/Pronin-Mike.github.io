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
  Unit,
  ProductAlias,
  ProductAliasRow,
  Receipt,
  ReceiptConflictMode,
  ReceiptItem,
  ReceiptItemRow,
  ReceiptRow,
  ReceiptSource
} from './types';
import { isUnit } from './types';
import { receiptNameKey } from './receiptParser';
import { round3 } from './availability';
import { defaultExpiresAt } from './shelfLife';
import type { FridgeNameNormalizationGroup } from './receiptMatcher';
import type { FridgeImportCounts, FridgeImportPlan } from './fridgeImport';

/** Единая точка превращения ошибки Supabase в Error с понятным текстом. */
function raise(context: string, error: { message?: string } | null): never {
  throw new Error(error?.message ? `${context}: ${error.message}` : context);
}

function raiseReceipt(context: string, error: { message?: string; code?: string } | null): never {
  const message = error?.message?.toLocaleLowerCase('ru') ?? '';
  if (error?.code === '23514') {
    throw new Error(`Схема чеков несовместима с приложением. Повторно выполните актуальный sql/receipt-scanner.sql. Причина Supabase: ${error.message ?? error.code}`);
  }
  if (
    error?.code === 'PGRST202'
    || error?.code === '42P01'
    || error?.code === '42883'
    || message.includes('import_receipt')
    || message.includes('product_aliases')
    || message.includes('receipt_items')
    || message.includes('receipts')
  ) {
    const reason = [error?.code ? `[${error.code}]` : '', error?.message ?? 'неизвестная ошибка']
      .filter(Boolean)
      .join(' ');
    throw new Error(`Хранилище чеков недоступно. Причина Supabase: ${reason}`);
  }
  raise(context, error);
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
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? null,
    lastPurchasePrice: row.last_purchase_price === null ? null : Number(row.last_purchase_price),
    totalCost: Number(row.total_cost ?? 0),
    pricedAmount: Number(row.priced_amount ?? 0)
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

/**
 * Добавляет продукт. Если срок годности не задан явно, он берётся из таблицы
 * типовых сроков (lib/shelfLife.ts); для «вечных» продуктов остаётся null.
 */
export async function addFridgeItem(input: FridgeInput): Promise<FridgeItem> {
  const name = input.name.trim();
  const expiresAt = input.expiresAt ?? defaultExpiresAt(name) ?? null;
  const { data, error } = await supabase.rpc('mutate_fridge_item', {
    p_item_id: null,
    p_name: name,
    p_amount: round3(input.amount),
    p_unit: input.unit,
    p_expires_at: expiresAt,
    p_purchase_cost: input.purchaseCost ?? input.lastPurchasePrice ?? null,
    p_mode: 'create'
  });
  if (error || !data) raise('Не удалось добавить продукт', error);
  return toFridgeItem(data as FridgeItemRow);
}

export async function updateFridgeItem(
  id: string,
  patch: Partial<FridgeInput>
): Promise<FridgeItem> {
  const current = await supabase.from('fridge_items').select('*').eq('id', id).single();
  if (current.error || !current.data) raise('Не удалось найти продукт', current.error);
  const row = toFridgeItem(current.data);
  const { data, error } = await supabase.rpc('mutate_fridge_item', {
    p_item_id: id,
    p_name: patch.name?.trim() ?? row.name,
    p_amount: round3(patch.amount ?? row.amount),
    p_unit: patch.unit ?? row.unit,
    p_expires_at: patch.expiresAt === undefined ? row.expiresAt : patch.expiresAt,
    p_purchase_cost: patch.purchaseCost === undefined ? null : patch.purchaseCost,
    p_mode: 'adjust'
  });
  if (error || !data) raise('Не удалось обновить продукт', error);
  return toFridgeItem(data as FridgeItemRow);
}

export async function applyFridgePurchase(
  id: string,
  input: FridgeInput,
  mode: 'sum' | 'replace'
): Promise<FridgeItem> {
  const { data, error } = await supabase.rpc('mutate_fridge_item', {
    p_item_id: id,
    p_name: input.name.trim(),
    p_amount: round3(input.amount),
    p_unit: input.unit,
    p_expires_at: input.expiresAt ?? defaultExpiresAt(input.name) ?? null,
    p_purchase_cost: input.purchaseCost ?? null,
    p_mode: mode
  });
  if (error || !data) raise('Не удалось обновить покупку', error);
  return toFridgeItem(data as FridgeItemRow);
}

export async function deleteFridgeItem(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_fridge_item', { p_item_id: id });
  if (error) raise('Не удалось удалить продукт', error);
}

export async function clearFridge(): Promise<void> {
  const { error } = await supabase.rpc('clear_fridge', {});
  if (error) raise('Не удалось очистить холодильник', error);
}

export async function wasteProduct(id: string, amount: number): Promise<{ cost: number; costComplete: boolean }> {
  const { data, error } = await supabase.rpc('waste_product', { p_item_id: id, p_amount: round3(amount) });
  if (error) raise('Не удалось выбросить продукт', error);
  const result = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  return { cost: Number(result.cost ?? 0), costComplete: Boolean(result.cost_complete) };
}

export async function wasteExpiredProducts(): Promise<{ count: number; cost: number }> {
  const { data, error } = await supabase.rpc('waste_expired_products', {});
  if (error) raise('Не удалось выбросить просроченные продукты', error);
  const result = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  return { count: Number(result.count ?? 0), cost: Number(result.cost ?? 0) };
}

/**
 * Применяет план массового заполнения холодильника (см. lib/fridgeImport.ts).
 * План считается на клиенте: здесь только запись — удаления, изменения, вставки.
 */
export async function applyFridgeImport(plan: FridgeImportPlan): Promise<FridgeImportCounts> {
  const encode = (item: FridgeInput) => ({
    name: item.name.trim(), amount: round3(item.amount), unit: item.unit,
    expires_at: item.expiresAt ?? defaultExpiresAt(item.name) ?? null,
    total_cost: item.totalCost ?? item.purchaseCost ?? 0,
    priced_amount: item.pricedAmount ?? (item.purchaseCost == null ? 0 : item.amount),
    last_purchase_price: item.lastPurchasePrice ?? item.purchaseCost ?? null
  });
  const payload = {
    deletes: plan.deletes,
    updates: plan.updates.map((entry) => ({ id: entry.id, ...encode(entry.patch as FridgeInput) })),
    inserts: plan.inserts.map(encode)
  };
  const { error } = await supabase.rpc('apply_fridge_import', { p_plan: payload, p_source: 'csv' });
  if (error) raise('Не удалось импортировать холодильник', error);
  return plan.counts;
}

/* -------------------------------------------------------------------------- *
 * Чеки
 * -------------------------------------------------------------------------- */

function toReceipt(row: ReceiptRow): Receipt {
  return {
    id: row.id,
    store: row.store,
    source: ['camera', 'upload', 'pdf', 'text'].includes(row.source) ? row.source as ReceiptSource : 'text',
    purchasedAt: row.purchased_at,
    totalAmount: row.total_amount,
    fiscalFn: row.fiscal_fn,
    fiscalFd: row.fiscal_fd,
    fiscalFp: row.fiscal_fp,
    receiptKey: row.receipt_key,
    status: row.status === 'imported' ? 'imported' : 'draft',
    importedAt: row.imported_at,
    createdAt: row.created_at
  };
}

function toReceiptItem(row: ReceiptItemRow): ReceiptItem {
  return {
    id: row.id,
    lineNumber: row.line_number,
    rawName: row.raw_name,
    normalizedName: row.normalized_name,
    receiptQuantity: row.receipt_quantity,
    receiptUnit: row.receipt_unit,
    fridgeAmount: row.fridge_amount,
    fridgeUnit: isUnit(row.fridge_unit) ? row.fridge_unit : null,
    unitPrice: row.unit_price,
    totalPrice: row.total_price,
    includeInFridge: row.include_in_fridge,
    matchStatus: ['alias', 'fridge', 'normalized', 'manual'].includes(row.match_status)
      ? row.match_status as ReceiptItem['matchStatus']
      : 'unmatched',
    needsReview: !row.fridge_amount || !isUnit(row.fridge_unit) || row.match_status === 'unmatched'
  };
}

export async function fetchProductAliases(): Promise<ProductAlias[]> {
  const { data, error } = await supabase.from('product_aliases').select('*');
  if (error) raiseReceipt('Не удалось загрузить соответствия продуктов', error);
  return (data ?? []).map((row: ProductAliasRow) => ({
    id: row.id,
    store: row.store,
    rawNameKey: row.raw_name_key,
    productName: row.product_name,
    packageAmount: row.package_amount,
    packageUnit: isUnit(row.package_unit) ? row.package_unit : null
  }));
}

export interface ReceiptDraftInput {
  store: string | null;
  source: ReceiptSource;
  purchasedAt: string | null;
  totalAmount: number | null;
  fiscalFn: string | null;
  fiscalFd: string | null;
  fiscalFp: string | null;
  receiptKey: string | null;
  items: ReceiptItem[];
}

export async function createReceiptDraft(input: ReceiptDraftInput): Promise<Receipt> {
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Для сохранения чека нужно войти в приложение');

  if (input.receiptKey) {
    const duplicate = await supabase
      .from('receipts')
      .select('id, status')
      .eq('user_id', userResult.user.id)
      .eq('receipt_key', input.receiptKey)
      .maybeSingle();
    if (duplicate.error) raiseReceipt('Не удалось проверить повторный чек', duplicate.error);
    if (duplicate.data) throw new Error('Этот чек уже сохранён. Откройте его в истории чеков.');
  }

  const inserted = await supabase.from('receipts').insert({
    user_id: userResult.user.id,
    store: input.store,
    source: input.source,
    purchased_at: input.purchasedAt,
    total_amount: input.totalAmount,
    fiscal_fn: input.fiscalFn,
    fiscal_fd: input.fiscalFd,
    fiscal_fp: input.fiscalFp,
    receipt_key: input.receiptKey,
    status: 'draft'
  }).select('*').single();
  if (inserted.error || !inserted.data) raiseReceipt('Не удалось сохранить черновик чека', inserted.error);

  const receipt = toReceipt(inserted.data);
  const rows = input.items.map((item) => ({
    receipt_id: receipt.id,
    line_number: item.lineNumber,
    raw_name: item.rawName,
    normalized_name: item.normalizedName,
    receipt_quantity: item.receiptQuantity,
    receipt_unit: item.receiptUnit,
    fridge_amount: item.fridgeAmount,
    fridge_unit: item.fridgeUnit,
    unit_price: item.unitPrice,
    total_price: item.totalPrice,
    include_in_fridge: item.includeInFridge,
    match_status: item.matchStatus
  }));
  const itemsResult = await supabase.from('receipt_items').insert(rows);
  if (itemsResult.error) {
    await supabase.from('receipts').delete().eq('id', receipt.id).eq('status', 'draft');
    raiseReceipt('Не удалось сохранить позиции чека', itemsResult.error);
  }
  return receipt;
}

export async function importReceipt(
  receiptId: string,
  items: ReceiptItem[],
  store: string | null,
  conflictMode: ReceiptConflictMode = 'sum'
): Promise<void> {
  const aliases = items
    .filter((item) => item.includeInFridge && item.matchStatus === 'manual')
    .map((item) => ({
      store,
      raw_name_key: receiptNameKey(item.rawName),
      product_name: item.normalizedName.trim(),
      package_amount: item.fridgeAmount && item.receiptQuantity && item.receiptQuantity > 0
        ? item.fridgeAmount / item.receiptQuantity
        : item.fridgeAmount,
      package_unit: item.fridgeUnit
    }));
  const payload = items.map((item) => ({
    line_number: item.lineNumber,
    raw_name: item.rawName,
    normalized_name: item.normalizedName.trim(),
    receipt_quantity: item.receiptQuantity,
    receipt_unit: item.receiptUnit,
    fridge_amount: item.fridgeAmount,
    fridge_unit: item.fridgeUnit,
    unit_price: item.unitPrice,
    total_price: item.totalPrice,
    include_in_fridge: item.includeInFridge,
    match_status: item.matchStatus,
    fridge_ids: item.matchedFridgeIds ?? [],
    expires_at: item.includeInFridge ? defaultExpiresAt(item.normalizedName) : null
  }));
  const { error } = await supabase.rpc('import_receipt', {
    p_receipt_id: receiptId,
    p_items: payload,
    p_aliases: aliases,
    p_conflict_mode: conflictMode
  });
  if (error) raiseReceipt('Не удалось импортировать чек', error);
}

export async function normalizeFridgeNames(groups: FridgeNameNormalizationGroup[]): Promise<number> {
  if (!groups.length) return 0;
  const { data, error } = await supabase.rpc('normalize_fridge_names', {
    p_groups: groups.map((group) => ({
      name: group.name,
      unit: group.unit,
      ids: group.ids
    }))
  });
  if (error) raiseReceipt('Не удалось объединить магазинные названия', error);
  const result = data as { normalized?: number } | null;
  return result?.normalized ?? 0;
}

export async function fetchReceipts(): Promise<Receipt[]> {
  const receipts = await supabase.from('receipts').select('*').order('created_at', { ascending: false });
  if (receipts.error) raiseReceipt('Не удалось загрузить историю чеков', receipts.error);
  const itemRows = await supabase.from('receipt_items').select('receipt_id');
  if (itemRows.error) raiseReceipt('Не удалось загрузить позиции чеков', itemRows.error);
  const counts = new Map<string, number>();
  for (const row of itemRows.data ?? []) counts.set(row.receipt_id, (counts.get(row.receipt_id) ?? 0) + 1);
  return (receipts.data ?? []).map((row: ReceiptRow) => ({ ...toReceipt(row), itemCount: counts.get(row.id) ?? 0 }));
}

export async function fetchReceiptItems(receiptId: string): Promise<ReceiptItem[]> {
  const { data, error } = await supabase
    .from('receipt_items')
    .select('*')
    .eq('receipt_id', receiptId)
    .order('line_number', { ascending: true });
  if (error) raiseReceipt('Не удалось загрузить позиции чека', error);
  return (data ?? []).map((row: ReceiptItemRow) => toReceiptItem(row));
}

export async function deleteReceipt(receiptId: string): Promise<void> {
  const { data, error } = await supabase.from('receipts').delete().eq('id', receiptId).select('id').maybeSingle();
  if (error) raiseReceipt('Не удалось удалить чек', error);
  if (!data) throw new Error('Чек не найден или уже удалён');
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

  return {
    success: Boolean(record.success),
    missing,
    cost: Number.isFinite(Number(record.cost)) ? Number(record.cost) : undefined,
    costComplete: typeof record.cost_complete === 'boolean' ? record.cost_complete : undefined
  };
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
    version: 2,
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
  const fridgeRows = (Array.isArray(file.fridge_items) ? file.fridge_items : []).filter(
    (row) =>
      row &&
      typeof row.name === 'string' &&
      row.name.trim().length > 0 &&
      Number.isFinite(Number(row.amount)) &&
      Number(row.amount) > 0 &&
      isUnit(row.unit)
  );

  const restoredFridge = fridgeRows.map((row) => ({
      name: row.name.trim(), amount: round3(Number(row.amount)), unit: row.unit,
      expires_at: typeof row.expires_at === 'string' ? row.expires_at : defaultExpiresAt(row.name) ?? null,
      last_purchase_price: Number.isFinite(Number(row.last_purchase_price)) ? Number(row.last_purchase_price) : null,
      total_cost: Number.isFinite(Number(row.total_cost)) && Number(row.total_cost) >= 0 ? Number(row.total_cost) : 0,
      priced_amount: Number.isFinite(Number(row.priced_amount)) && Number(row.priced_amount) >= 0
        ? Math.min(Number(row.priced_amount), Number(row.amount)) : 0
    }));

  const ingredientsByDish = new Map<string, DishIngredientRow[]>();
  for (const row of Array.isArray(file.dish_ingredients) ? file.dish_ingredients : []) {
    if (!row || typeof row.dish_id !== 'string') continue;
    const list = ingredientsByDish.get(row.dish_id) ?? [];
    list.push(row);
    ingredientsByDish.set(row.dish_id, list);
  }

  const knownSections = new Set(knownSectionIds);
  let skipped = 0;
  const restoredDishes: Array<Record<string, unknown>> = [];

  for (const row of Array.isArray(file.dishes) ? file.dishes : []) {
    const title = typeof row?.title === 'string' ? row.title.trim() : '';
    if (!row || !title || !knownSections.has(row.section_id)) {
      skipped += 1;
      continue;
    }
    const ingredients = normalizeIngredients(ingredientsByDish.get(row.id) ?? []);
    if (ingredients.some((item) => item.amount <= 0)) {
      skipped += 1;
      continue;
    }
    restoredDishes.push({
      title,
      section_id: row.section_id,
      time_min: typeof row.time_min === 'number' && Number.isInteger(row.time_min) ? row.time_min : null,
      steps: Array.isArray(row.steps) ? row.steps.filter((step) => typeof step === 'string') : [],
      notes: typeof row.notes === 'string' ? row.notes : '',
      ingredients: ingredients.map((item) => ({
        name: item.name,
        amount: item.amount,
        unit: item.unit,
        sort_order: item.sortOrder
      }))
    });
  }

  const { data, error } = await supabase.rpc('restore_backup', {
    p_fridge: restoredFridge,
    p_dishes: restoredDishes
  });
  if (error) raise('Не удалось атомарно восстановить бэкап', error);
  const result = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  return {
    fridge: Number(result.fridge ?? restoredFridge.length),
    dishes: Number(result.dishes ?? restoredDishes.length),
    skipped
  };
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
