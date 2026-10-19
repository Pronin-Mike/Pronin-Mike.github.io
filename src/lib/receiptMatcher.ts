import { normalizeName } from './availability';
import { cleanReceiptProductName, receiptNameKey, type ParsedReceiptItem } from './receiptParser';
import type { FridgeItem, ProductAlias, ReceiptItem, Unit } from './types';

/**
 * Категории расположены от частных к общим. Сопоставление идёт по очищенному
 * ключу, поэтому бренд, пунктуация, регистр и фасовка не становятся частью
 * названия в холодильнике. Правила намеренно описывают только однозначные
 * продуктовые слова: неизвестная строка должна остаться на ручную проверку.
 */
const PRODUCT_RULES: Array<{ name: string; patterns: RegExp[] }> = [
  { name: 'Филе куриное', patterns: [/(?:^|\s)филе(?:\s+\S+){0,3}\s+(?:кур\S*|kyp\S*)(?:\s|$)/i, /(?:^|\s)(?:кур\S*|kyp\S*)(?:\s+\S+){0,3}\s+филе(?:\s|$)/i] },
  { name: 'Грудка куриная', patterns: [/(?:^|\s)грудк\S*(?:\s+\S+){0,2}\s+(?:кур\S*|kyp\S*)/i, /(?:^|\s)(?:кур\S*|kyp\S*)(?:\s+\S+){0,2}\s+грудк/i] },
  { name: 'Бедро куриное', patterns: [/(?:^|\s)(?:бедр|бёдр)\S*(?:\s+\S+){0,2}\s+(?:кур\S*|kyp\S*)/i, /(?:^|\s)(?:кур\S*|kyp\S*)(?:\s+\S+){0,2}\s+(?:бедр|бёдр)/i] },
  { name: 'Фарш куриный', patterns: [/(?:^|\s)фарш(?:\s+\S+){0,2}\s+(?:кур\S*|kyp\S*)/i, /(?:^|\s)(?:кур\S*|kyp\S*)(?:\s+\S+){0,2}\s+фарш/i] },
  { name: 'Печень куриная', patterns: [/(?:^|\s)печен\S*(?:\s+\S+){0,2}\s+(?:кур\S*|kyp\S*)/i, /(?:^|\s)(?:кур\S*|kyp\S*)(?:\s+\S+){0,2}\s+печен/i] },
  { name: 'Масло сливочное', patterns: [/(?:^|\s)масло\s+слив/i] },
  { name: 'Масло растительное', patterns: [/(?:^|\s)масло\s+(?:подсолн|раст|олив)/i, /(?:^|\s)(?:подсолн|раст|олив)\S*\s+масло/i] },
  { name: 'Томатная паста', patterns: [/(?:^|\s)(?:томат\S*\s+паст|паста\s+томат)/i] },
  { name: 'Фасоль консервированная', patterns: [/(?:^|\s)фасол\S*.*(?:консерв|ж б|бан)/i] },

  { name: 'Молоко', patterns: [/(?:^|\s)мол(?:око)?(?:\s|$)/i, /(?:^|\s)простокв\S*/i] },
  { name: 'Кефир', patterns: [/(?:^|\s)кефир\S*/i] },
  { name: 'Творог', patterns: [/(?:^|\s)творог\S*/i] },
  { name: 'Сметана', patterns: [/(?:^|\s)сметан\S*/i] },
  { name: 'Йогурт', patterns: [/(?:^|\s)йогурт\S*/i] },
  { name: 'Ряженка', patterns: [/(?:^|\s)ряженк\S*/i] },
  { name: 'Сыр', patterns: [/(?:^|\s)сыр(?:\s|$)/i] },
  { name: 'Яйца', patterns: [/(?:^|\s)яйц\S*/i] },

  { name: 'Курица', patterns: [/(?:^|\s)(?:куриц\S*|цыпл\S*)(?:\s|$)/i] },
  { name: 'Фарш', patterns: [/(?:^|\s)фарш(?:\s|$)/i] },
  { name: 'Свинина', patterns: [/(?:^|\s)свинин\S*/i] },
  { name: 'Говядина', patterns: [/(?:^|\s)говядин\S*/i] },
  { name: 'Индейка', patterns: [/(?:^|\s)индейк\S*/i] },
  { name: 'Печень', patterns: [/(?:^|\s)печен\S*/i] },
  { name: 'Рыба', patterns: [/(?:^|\s)рыб\S*/i] },
  { name: 'Минтай', patterns: [/(?:^|\s)минта\S*/i] },
  { name: 'Хек', patterns: [/(?:^|\s)хек(?:\s|$)/i] },

  { name: 'Помидоры', patterns: [/(?:^|\s)(?:томат|помидор)\S*/i] },
  { name: 'Огурцы', patterns: [/(?:^|\s)огур\S*/i] },
  { name: 'Картофель', patterns: [/(?:^|\s)картоф\S*/i] },
  { name: 'Морковь', patterns: [/(?:^|\s)морков\S*/i] },
  { name: 'Свёкла', patterns: [/(?:^|\s)(?:свекл|свёкл)\S*/i] },
  { name: 'Капуста', patterns: [/(?:^|\s)капуст\S*/i] },
  { name: 'Кабачки', patterns: [/(?:^|\s)кабач\S*/i] },
  { name: 'Баклажаны', patterns: [/(?:^|\s)баклаж\S*/i] },
  { name: 'Перец', patterns: [/(?:^|\s)перец(?:\s|$)/i] },
  { name: 'Лук', patterns: [/(?:^|\s)лук(?:\s|$)/i] },
  { name: 'Чеснок', patterns: [/(?:^|\s)чеснок\S*/i] },
  { name: 'Укроп', patterns: [/(?:^|\s)укроп\S*/i] },
  { name: 'Петрушка', patterns: [/(?:^|\s)петруш\S*/i] },
  { name: 'Зелень', patterns: [/(?:^|\s)зелен\S*/i] },

  { name: 'Яблоки', patterns: [/(?:^|\s)яблок\S*/i] },
  { name: 'Бананы', patterns: [/(?:^|\s)банан\S*/i] },
  { name: 'Апельсины', patterns: [/(?:^|\s)апельсин\S*/i] },
  { name: 'Лимоны', patterns: [/(?:^|\s)лимон\S*/i] },
  { name: 'Груши', patterns: [/(?:^|\s)груш\S*/i] },
  { name: 'Виноград', patterns: [/(?:^|\s)виноград\S*/i] },

  { name: 'Хлеб', patterns: [/(?:^|\s)хлеб\S*/i] },
  { name: 'Батон', patterns: [/(?:^|\s)батон\S*/i] },
  { name: 'Лаваш', patterns: [/(?:^|\s)лаваш\S*/i] },
  { name: 'Макароны', patterns: [/(?:^|\s)(?:макарон|паста)\S*/i] },
  { name: 'Рис', patterns: [/(?:^|\s)рис(?:\s|$)/i] },
  { name: 'Гречка', patterns: [/(?:^|\s)греч\S*/i] },
  { name: 'Овсяные хлопья', patterns: [/(?:^|\s)(?:овсян\S*\s+хлоп|геркулес)/i] },
  { name: 'Мука', patterns: [/(?:^|\s)мука(?:\s|$)/i] },
  { name: 'Сахар', patterns: [/(?:^|\s)сахар(?:\s|$)/i] },
  { name: 'Соль', patterns: [/(?:^|\s)соль(?:\s|$)/i] },

  { name: 'Колбаса', patterns: [/(?:^|\s)колбас\S*/i] },
  { name: 'Сосиски', patterns: [/(?:^|\s)сосиск\S*/i] },
  { name: 'Пельмени', patterns: [/(?:^|\s)пельмен\S*/i] },
  { name: 'Драже', patterns: [/(?:^|\s)драже(?:\s|$)/i, /(?:^|\s)m\s+ms(?:\s|$)/i] },
  { name: 'Конфеты', patterns: [/(?:^|\s)конфет\S*/i, /(?:^|\s)(?:кор|kop)\s+(?:кон|koh)(?:\s|$)/i, /(?:^|\s)шок\S*\s+др\S*/i] }
];

const NON_FOOD = /(?:^|\s)(пакет|карта лояльности|салфет|бумага туал|шампун|мыло|порошок|гель для|батарей|корм для|сигарет)/i;

export interface FridgeNameNormalizationGroup {
  name: string;
  unit: Unit;
  ids: string[];
}

export function normalizeReceiptProduct(rawName: string): string | null {
  const key = receiptNameKey(cleanReceiptProductName(rawName));
  const matched = PRODUCT_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(key)));
  return matched?.name ?? null;
}

/** Группы уже сохранённых строк, которые можно безопасно привести к общей категории. */
export function planFridgeNameNormalization(fridge: FridgeItem[]): FridgeNameNormalizationGroup[] {
  const groups = new Map<string, FridgeNameNormalizationGroup>();
  for (const item of fridge) {
    const name = normalizeReceiptProduct(item.name);
    if (!name) continue;
    const key = `${normalizeName(name)}|${item.unit}`;
    const group = groups.get(key) ?? { name, unit: item.unit, ids: [] };
    group.ids.push(item.id);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => {
    if (group.ids.length > 1) return true;
    const source = fridge.find((item) => item.id === group.ids[0]);
    return source ? normalizeName(source.name) !== normalizeName(group.name) : false;
  });
}

function matchingFridgeIds(name: string, unit: Unit | null, fridge: FridgeItem[], useCategory: boolean): string[] {
  if (!unit) return [];
  const normalizedTarget = normalizeName(name);
  return fridge
    .filter((item) => {
      if (item.unit !== unit) return false;
      const cleaned = cleanReceiptProductName(item.name);
      if (normalizeName(cleaned) === normalizedTarget) return true;
      return useCategory && normalizeName(normalizeReceiptProduct(cleaned) ?? '') === normalizedTarget;
    })
    .map((item) => item.id);
}

export function calculateFridgeAmount(item: ParsedReceiptItem): { amount: number | null; unit: Unit | null } {
  if (item.packageAmount !== null && item.packageUnit) {
    const packages = item.quantity ?? 1;
    return { amount: item.packageAmount * packages, unit: item.packageUnit };
  }
  if (item.quantity !== null) {
    const token = item.receiptUnit?.toLocaleLowerCase('ru');
    if (token === 'кг') return { amount: item.quantity * 1000, unit: 'г' };
    if (token === 'л') return { amount: item.quantity * 1000, unit: 'мл' };
    if (token === 'г' || token === 'мл' || token === 'шт') return { amount: item.quantity, unit: token };
    if (token === 'x' || token === 'х' || token === '*') return { amount: item.quantity, unit: 'шт' };
  }
  return { amount: null, unit: null };
}

export function matchReceiptItem(
  parsed: ParsedReceiptItem,
  aliases: ProductAlias[],
  fridge: FridgeItem[],
  store: string | null = null
): ReceiptItem {
  const key = receiptNameKey(parsed.rawName);
  const alias = aliases.find((item) => item.rawNameKey === key && (item.store === store || item.store === null));
  const amount = alias?.packageAmount && alias.packageUnit
    ? { amount: alias.packageAmount * (parsed.quantity ?? 1), unit: alias.packageUnit }
    : calculateFridgeAmount(parsed);

  if (alias) {
    const fridgeIds = matchingFridgeIds(alias.productName, amount.unit, fridge, false);
    return {
      lineNumber: parsed.lineNumber,
      rawName: parsed.rawName,
      normalizedName: alias.productName,
      receiptQuantity: parsed.quantity,
      receiptUnit: parsed.receiptUnit,
      fridgeAmount: amount.amount,
      fridgeUnit: amount.unit,
      unitPrice: parsed.unitPrice,
      totalPrice: parsed.totalPrice,
      matchedFridgeIds: fridgeIds,
      includeInFridge: !NON_FOOD.test(parsed.rawName),
      matchStatus: 'alias',
      needsReview: amount.amount === null || amount.unit === null
    };
  }

  const cleanedName = cleanReceiptProductName(parsed.rawName);
  const category = normalizeReceiptProduct(cleanedName);
  const normalized = category ?? cleanedName;
  const fridgeIds = matchingFridgeIds(normalized, amount.unit, fridge, category !== null);
  const status = fridgeIds.length ? 'fridge' : category ? 'normalized' : 'unmatched';
  return {
    lineNumber: parsed.lineNumber,
    rawName: parsed.rawName,
    normalizedName: normalized,
    receiptQuantity: parsed.quantity,
    receiptUnit: parsed.receiptUnit,
    fridgeAmount: amount.amount,
    fridgeUnit: amount.unit,
    unitPrice: parsed.unitPrice,
    totalPrice: parsed.totalPrice,
    matchedFridgeIds: fridgeIds,
    includeInFridge: !NON_FOOD.test(parsed.rawName),
    matchStatus: status,
    needsReview: status === 'unmatched' || amount.amount === null || amount.unit === null
  };
}
