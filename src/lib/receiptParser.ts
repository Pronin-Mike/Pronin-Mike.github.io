import type { Unit } from './types';

export type ReceiptStore = 'Пятёрочка' | 'В1' | 'Перекрёсток' | 'ДА!' | 'Другой магазин';

export interface ParsedReceiptItem {
  lineNumber: number;
  rawName: string;
  rawText: string;
  quantity: number | null;
  receiptUnit: string | null;
  packageAmount: number | null;
  packageUnit: Unit | null;
  unitPrice: number | null;
  totalPrice: number | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface ParsedReceipt {
  rawText: string;
  store: ReceiptStore;
  purchasedAt: string | null;
  totalAmount: number | null;
  fiscalFn: string | null;
  fiscalFd: string | null;
  fiscalFp: string | null;
  items: ParsedReceiptItem[];
  warnings: string[];
}

const SERVICE_PATTERNS = [
  /^(кассир|касса|смена|чек|итог|итого|всего|налич|безнал|сдача|ндс|инн|ккт|фн\b|фд\b|фп\b|фпд|адрес|магазин|добро пожаловать|спасибо|скидка|бонус|оплата|сумма|subtotal|total)/i,
  /^(={3,}|-{3,}|\*{3,})$/,
  /^\d{2}[./-]\d{2}[./-]\d{2,4}(?:\s+\d{1,2}:\d{2})?$/
];

const STORE_RULES: Array<{ store: ReceiptStore; patterns: RegExp[] }> = [
  { store: 'Пятёрочка', patterns: [/пят[её]рочк/i, /x5 retail/i] },
  { store: 'Перекрёсток', patterns: [/перекр[её]сток/i, /perekrestok/i] },
  { store: 'В1', patterns: [/(?:^|\s)в1(?:\s|$)/im, /вкус.*перв/i] },
  { store: 'ДА!', patterns: [/(?:^|\s)да!(?:\s|$)/im, /магазин\s+да\b/i] }
];

// Tesseract часто смешивает кириллицу и латиницу: «130г» → «130r», «1кг» → «1Kr».
const OCR_UNIT_PATTERN = '(?:кг|kг|кr|kr|kg|мл|mл|ml|mji|шт|шt|г|r|g|л|l)';

function normalizeOcrUnit(token: string): 'кг' | 'г' | 'л' | 'мл' | 'шт' | null {
  const unit = token.toLocaleLowerCase('ru').replace(/\s/g, '');
  if (['кг', 'kг', 'кr', 'kr', 'kg'].includes(unit)) return 'кг';
  if (['мл', 'mл', 'ml', 'mji'].includes(unit)) return 'мл';
  if (['шт', 'шt'].includes(unit)) return 'шт';
  if (['г', 'r', 'g'].includes(unit)) return 'г';
  if (['л', 'l'].includes(unit)) return 'л';
  return null;
}

function hasKilogramMarker(value: string): boolean {
  return new RegExp(`(?:^|\\s)[‘'"“]?(?:кг|kг|кr|kr|kg)(?:\\s*\\d)?(?=\\s|[.,;:*)/\\-]|$)`, 'i').test(value);
}

function cleanLine(line: string): string {
  return line.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function number(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isServiceLine(line: string): boolean {
  return !line || SERVICE_PATTERNS.some((pattern) => pattern.test(line));
}

export function detectReceiptStore(text: string): ReceiptStore {
  return STORE_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text)))?.store ?? 'Другой магазин';
}

/** Нормализованный ключ нужен только для точного поиска алиаса, не как имя продукта. */
export function receiptNameKey(value: string): string {
  return value
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function extractPackage(name: string): { amount: number | null; unit: Unit | null } {
  const matches = [...name.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${OCR_UNIT_PATTERN})(?=\\s|[.,;:*)/\\-]|$)`, 'gi'))];
  const match = matches.at(-1);
  if (!match) return { amount: null, unit: null };
  const value = number(match[1]);
  const token = normalizeOcrUnit(match[2]);
  if (value === null || token === null) return { amount: null, unit: null };
  if (token === 'кг') return { amount: value * 1000, unit: 'г' };
  if (token === 'л') return { amount: value * 1000, unit: 'мл' };
  return { amount: value, unit: token as Unit };
}

/** Убирает артикул, фасовку, количество и ценовые колонки, сохраняя само название. */
export function cleanReceiptProductName(value: string): string {
  let name = value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^[^a-zа-я0-9]*\d{5,14}\s+/i, '');
  // Всё от первой денежной колонки справа от названия — метаданные чека.
  name = name.replace(/\s*[,_.;:]?\s*\d+[.,]\d{2}(?:\s|$).*$/i, '');
  name = name.replace(new RegExp(`\\s+\\d+(?:[.,]\\d+)?\\s*${OCR_UNIT_PATTERN}(?:\\s+\\d{1,2})?\\s*$`, 'i'), '');
  // Весовые товары часто заканчиваются базой цены «кг»; OCR иногда добавляет одну цифру-шум.
  name = name.replace(new RegExp(`\\s+[‘'"“]?(?:кг|kг|кr|kr|kg)(?:\\s*\\d)?\\s*$`, 'i'), '');
  name = name.replace(/\s+[*xх×]\s*\d+(?:[.,]\d+)?\s*$/i, '');
  return name
    .replace(/\bM8Ms\b/gi, 'M&Ms')
    .replace(/^[,.;:_-]+|[,;:_-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFiscal(text: string, label: string): string | null {
  const match = text.match(new RegExp(`(?:^|\\s)${label}\\s*[:№#-]?\\s*(\\d{4,})`, 'im'));
  return match?.[1] ?? null;
}

function parseDate(text: string): string | null {
  const match = text.match(/\b(\d{2})[./-](\d{2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const stamp = `${year}-${match[2]}-${match[1]}T${(match[4] ?? '00').padStart(2, '0')}:${match[5] ?? '00'}:00`;
  return Number.isNaN(Date.parse(stamp)) ? null : stamp;
}

function totalFromText(text: string): number | null {
  const lines = text.split(/\r?\n/).map(cleanLine);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!/^(итог|итого|всего|к оплате|total)(?:\s|$)/i.test(lines[index])) continue;
    const values = [...lines[index].matchAll(/\d+[.,]\d{2}/g)];
    const value = number(values.at(-1)?.[0]);
    if (value !== null) return value;
  }
  return null;
}

interface PriceParts {
  name: string;
  quantity: number | null;
  receiptUnit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
}

function parsePricedLine(line: string): PriceParts | null {
  const prices = [...line.matchAll(/\d+[.,]\d{2}(?!\d)/g)];
  if (!prices.length) return null;
  const totalMatch = prices.at(-1);
  if (!totalMatch || totalMatch.index === undefined) return null;

  const totalPrice = number(totalMatch[0]);
  let prefix = line.slice(0, totalMatch.index).trim();
  let quantity: number | null = null;
  let receiptUnit: string | null = null;
  let unitPrice: number | null = null;

  const corruptedStarQuantity = line.match(/["'“]\s*5?(0[.,]\d{3})(?=\D|$)/);
  const starredQuantity = line.match(/[*xх×]\s*(\d+(?:[.,]\d+)?)(?=\D|$)/i);
  const weightQuantity = line.match(/(?:^|\s)(0?[.,]\d{3})(?=\D|$)/);
  const detectedQuantity = corruptedStarQuantity?.[1] ?? starredQuantity?.[1] ?? weightQuantity?.[1];
  if (detectedQuantity) quantity = number(detectedQuantity);

  const calculation = prefix.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(кг|г|л|мл|шт|x|х|\*)?\s*[xх*]\s*(\d+[.,]\d{2})\s*$/i)
    ?? prefix.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(кг|г|л|мл|шт)\s+(\d+[.,]\d{2})\s*$/i);
  if (calculation && calculation.index !== undefined) {
    quantity = number(calculation[1]);
    receiptUnit = calculation[2]?.toLocaleLowerCase('ru') ?? 'шт';
    unitPrice = number(calculation[3]);
    prefix = prefix.slice(0, calculation.index).trim();
  } else if (prices.length > 1) {
    const possibleUnitPrice = prices.at(-2);
    unitPrice = number(possibleUnitPrice?.[0]);
    if (possibleUnitPrice?.index !== undefined) prefix = line.slice(0, possibleUnitPrice.index).trim();
  }

  const name = prefix.replace(/^\d{1,3}[.)\s-]+/, '').replace(/[.·_-]{2,}$/g, '').trim();
  return name || quantity !== null ? { name, quantity, receiptUnit, unitPrice, totalPrice } : null;
}

export function parseReceipt(text: string): ParsedReceipt {
  const lines = text.split(/\r?\n/).map(cleanLine);
  const items: ParsedReceiptItem[] = [];
  let pending: { text: string; lineNumber: number } | null = null;
  let reachedSummary = false;

  lines.forEach((line, index) => {
    if (/^(скидка\s*:|ckhaka\s*:|округ\s*ление\s*:|подытог\s*:|наличными\s*:|электронными\s*:|итог\s*:|сдача\s*:)/i.test(line)) {
      reachedSummary = true;
    }
    if (reachedSummary) return;
    if (isServiceLine(line)) {
      pending = null;
      return;
    }
    const priced = parsePricedLine(line);
    if (!priced) {
      if (/[a-zа-я]{3}/i.test(line) && !/^\d+$/.test(line)) pending = { text: line, lineNumber: index + 1 };
      return;
    }

    const inlineName = pending && !/[a-zа-я]{2}/i.test(priced.name) ? '' : priced.name;
    const rawName = [pending?.text, inlineName].filter(Boolean).join(' ').trim();
    if (!rawName || isServiceLine(rawName) || !/[a-zа-я]{2}/i.test(rawName)) {
      pending = null;
      return;
    }
    const pack = extractPackage(rawName);
    const receiptUnit = priced.receiptUnit
      ?? (priced.quantity !== null ? (hasKilogramMarker(rawName) ? 'кг' : 'шт') : null);
    items.push({
      lineNumber: pending?.lineNumber ?? index + 1,
      rawName,
      rawText: pending ? `${pending.text}\n${line}` : line,
      quantity: priced.quantity,
      receiptUnit,
      packageAmount: pack.amount,
      packageUnit: pack.unit,
      unitPrice: priced.unitPrice,
      totalPrice: priced.totalPrice,
      confidence: priced.quantity !== null || pack.amount !== null ? 'high' : 'medium'
    });
    pending = null;
  });

  const fiscalFn = parseFiscal(text, 'ФН');
  const fiscalFd = parseFiscal(text, 'ФД');
  const fiscalFp = parseFiscal(text, 'ФП(?:Д)?');
  const warnings: string[] = [];
  if (!items.length) warnings.push('Не удалось уверенно выделить товарные позиции. Проверьте качество текста.');
  if (items.some((item) => item.quantity === null && item.packageAmount === null)) {
    warnings.push('У части товаров не определено количество — его нужно подтвердить вручную.');
  }

  return {
    rawText: text,
    store: detectReceiptStore(text),
    purchasedAt: parseDate(text),
    totalAmount: totalFromText(text),
    fiscalFn,
    fiscalFd,
    fiscalFp,
    items,
    warnings
  };
}

export function receiptKey(parsed: Pick<ParsedReceipt, 'fiscalFn' | 'fiscalFd' | 'fiscalFp'>): string | null {
  return parsed.fiscalFn && parsed.fiscalFd && parsed.fiscalFp
    ? `${parsed.fiscalFn}:${parsed.fiscalFd}:${parsed.fiscalFp}`
    : null;
}
