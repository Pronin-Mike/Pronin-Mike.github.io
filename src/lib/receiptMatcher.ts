import { normalizeName } from './availability';
import { cleanReceiptProductName, receiptNameKey, type ParsedReceiptItem } from './receiptParser';
import type { FridgeItem, ProductAlias, ReceiptItem, Unit } from './types';

const PRODUCT_RULES: Array<{ name: string; patterns: RegExp[] }> = [
  { name: 'Молоко', patterns: [/(?:^|\s)мол(?:око)?(?:\s|$)/i, /простокв/i] },
  { name: 'Яйца', patterns: [/(?:^|\s)яйц/i] },
  { name: 'Картофель', patterns: [/(?:^|\s)картоф/i] },
  { name: 'Сыр', patterns: [/(?:^|\s)сыр(?:\s|$)/i] },
  { name: 'Кефир', patterns: [/(?:^|\s)кефир/i] },
  { name: 'Творог', patterns: [/(?:^|\s)творог/i] },
  { name: 'Хлеб', patterns: [/(?:^|\s)хлеб/i] },
  { name: 'Масло сливочное', patterns: [/масло\s+слив/i] },
  { name: 'Масло растительное', patterns: [/масло\s+(?:подсолн|раст)/i] }
];

const NON_FOOD = /(?:^|\s)(пакет|карта лояльности|салфет|бумага туал|шампун|мыло|порошок|гель для|батарей|корм для|сигарет)/i;

export function normalizeReceiptProduct(rawName: string): string | null {
  const matched = PRODUCT_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(rawName)));
  return matched?.name ?? null;
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
      includeInFridge: !NON_FOOD.test(parsed.rawName),
      matchStatus: 'alias',
      needsReview: amount.amount === null || amount.unit === null
    };
  }

  const cleanedName = cleanReceiptProductName(parsed.rawName);
  const exact = fridge.find((item) => normalizeName(item.name) === normalizeName(cleanedName));
  const normalized = exact?.name ?? normalizeReceiptProduct(cleanedName) ?? cleanedName;
  const status = exact ? 'fridge' : normalizeReceiptProduct(cleanedName) ? 'normalized' : 'unmatched';
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
    includeInFridge: !NON_FOOD.test(parsed.rawName),
    matchStatus: status,
    needsReview: status === 'unmatched' || amount.amount === null || amount.unit === null
  };
}
