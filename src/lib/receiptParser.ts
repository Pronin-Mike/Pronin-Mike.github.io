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
  const matches = [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(кг|г|л|мл|шт)(?:\b|$)/gi)];
  const match = matches.at(-1);
  if (!match) return { amount: null, unit: null };
  const value = number(match[1]);
  const token = match[2].toLocaleLowerCase('ru');
  if (value === null) return { amount: null, unit: null };
  if (token === 'кг') return { amount: value * 1000, unit: 'г' };
  if (token === 'л') return { amount: value * 1000, unit: 'мл' };
  return { amount: value, unit: token as Unit };
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

  lines.forEach((line, index) => {
    if (isServiceLine(line)) {
      pending = null;
      return;
    }
    const priced = parsePricedLine(line);
    if (!priced) {
      if (/[a-zа-я]{3}/i.test(line) && !/^\d+$/.test(line)) pending = { text: line, lineNumber: index + 1 };
      return;
    }

    const rawName = [pending?.text, priced.name].filter(Boolean).join(' ').trim();
    if (!rawName || isServiceLine(rawName) || !/[a-zа-я]{2}/i.test(rawName)) {
      pending = null;
      return;
    }
    const pack = extractPackage(rawName);
    items.push({
      lineNumber: pending?.lineNumber ?? index + 1,
      rawName,
      rawText: pending ? `${pending.text}\n${line}` : line,
      quantity: priced.quantity,
      receiptUnit: priced.receiptUnit,
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
