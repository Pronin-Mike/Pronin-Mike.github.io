/* ============================================================================
 * csv.ts — импорт из CSV (свой парсер, без внешних библиотек).
 *
 * Два формата:
 *   блюда       — title,section,ingredients,time,steps,notes
 *   холодильник — name,amount,unit,expires_at (последняя колонка необязательна)
 *
 * Разделитель колонок определяется автоматически: «,», «;» или табуляция.
 * ========================================================================== */

import type { DishIngredient, DishInput, FridgeInput, Unit } from './types';
import { isUnit } from './types';
import { defaultExpiresAt } from './shelfLife';
import { validateDishInput } from './validation';

export const DISH_CSV_COLUMNS = ['title', 'section', 'ingredients', 'time', 'steps', 'notes'] as const;
export const FRIDGE_CSV_COLUMNS = ['name', 'amount', 'unit'] as const;
/** Колонка срока годности — необязательная: файл без неё читается как раньше. */
export const FRIDGE_EXPIRES_COLUMN = 'expires_at';

export interface CsvError {
  row: number;
  message: string;
}

export interface ParsedDishRow {
  row: number;
  dish: DishInput;
}

export interface ParsedFridgeRow {
  row: number;
  item: FridgeInput;
}

export interface CsvParseResult {
  items: ParsedDishRow[];
  errors: CsvError[];
  dataRows: number;
  delimiter: string;
  hasHeader: boolean;
}

export interface FridgeCsvParseResult {
  items: ParsedFridgeRow[];
  errors: CsvError[];
  dataRows: number;
  delimiter: string;
  hasHeader: boolean;
}

/** Разделы БД: только три. */
const SECTION_ALIASES: Record<string, string> = {
  breakfast: 'breakfast',
  'завтрак': 'breakfast',
  'завтраки': 'breakfast',
  b: 'breakfast',
  lunch: 'lunch',
  'обед': 'lunch',
  'обеды': 'lunch',
  l: 'lunch',
  dinner: 'dinner',
  'ужин': 'dinner',
  'ужины': 'dinner',
  d: 'dinner'
};

const HEADER_ALIASES: Record<string, string> = {
  title: 'title',
  'название': 'title',
  'блюдо': 'title',
  'наименование': 'title',
  section: 'section',
  'раздел': 'section',
  'категория': 'section',
  ingredients: 'ingredients',
  'ингредиенты': 'ingredients',
  'состав': 'ingredients',
  time: 'time',
  'время': 'time',
  'минуты': 'time',
  steps: 'steps',
  'шаги': 'steps',
  'приготовление': 'steps',
  'рецепт': 'steps',
  notes: 'notes',
  'заметки': 'notes',
  'примечания': 'notes',
  'комментарий': 'notes'
};

/** Заголовки файла холодильника. */
const FRIDGE_HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  'название': 'name',
  'продукт': 'name',
  'наименование': 'name',
  amount: 'amount',
  'количество': 'amount',
  'кол-во': 'amount',
  'кол': 'amount',
  unit: 'unit',
  'единица': 'unit',
  'ед': 'unit',
  'ед.': 'unit',
  'единицаизмерения': 'unit',
  'expires_at': FRIDGE_EXPIRES_COLUMN,
  'expiresat': FRIDGE_EXPIRES_COLUMN,
  'expires': FRIDGE_EXPIRES_COLUMN,
  'срокгодности': FRIDGE_EXPIRES_COLUMN,
  'срок': FRIDGE_EXPIRES_COLUMN,
  'годендо': FRIDGE_EXPIRES_COLUMN,
  'дата': FRIDGE_EXPIRES_COLUMN
};

/**
 * Разбирает дату срока годности: YYYY-MM-DD или пусто.
 * @returns дата, null (пусто) либо 'invalid' — неверный формат.
 */
export function parseFridgeDate(value: unknown): string | null | 'invalid' {
  const text = cleanText(value);
  if (!text) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return 'invalid';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const sane =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return sane ? text : 'invalid';
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** «1,5» → 1.5; мусор → NaN. */
export function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  const text = cleanText(value).replace(/\s/g, '').replace(',', '.');
  if (!text) return Number.NaN;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Приводит единицу к г/мл/шт; '' — если единица не поддерживается. */
export function parseUnit(value: unknown): Unit | '' {
  const key = cleanText(value).toLowerCase().replace(/\.+$/, '');
  const aliases: Record<string, Unit> = {
    'г': 'г',
    'гр': 'г',
    g: 'г',
    gr: 'г',
    'мл': 'мл',
    ml: 'мл',
    'шт': 'шт',
    pcs: 'шт',
    pc: 'шт',
    'ед': 'шт'
  };
  return aliases[key] ?? '';
}

/** Разделитель колонок по строке заголовков. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '';
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;

  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }

  return best;
}

/** Разбор CSV в массив строк (поддержаны кавычки и переносы строк внутри полей). */
export function parseRows(text: string, delimiter: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);

  return rows.filter((cells) => cells.some((cell) => cleanText(cell) !== ''));
}

function mapHeader(cell: string): string {
  const key = cleanText(cell).toLowerCase().replace(/[«»"']/g, '');
  return HEADER_ALIASES[key] ?? '';
}

function mapSection(value: string): string {
  return SECTION_ALIASES[cleanText(value).toLowerCase()] ?? '';
}

/** «яйца|3|шт;сыр|50|г» → ингредиенты. */
export function parseIngredients(value: string): { ingredients: DishIngredient[]; errors: string[] } {
  const errors: string[] = [];
  const ingredients: DishIngredient[] = [];

  const chunks = cleanText(value)
    .split(/[;\n]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (!chunks.length) {
    errors.push('не заполнено поле «ingredients»');
    return { ingredients, errors };
  }

  chunks.forEach((chunk, position) => {
    // Дробное количество с запятой: «молоко|1,5|мл» → «молоко|1.5|мл»
    const normalized = chunk.replace(/\|(\d+),(\d+)\|/g, '|$1.$2|');
    const parts = normalized.split('|').map((part) => part.trim());
    const name = parts[0] ?? '';
    const amountRaw = parts[1] ?? '';
    const unitRaw = parts[2] ?? '';

    if (parts.length < 3) {
      errors.push(`ингредиент «${chunk}»: нужен формат название|количество|единица`);
      return;
    }
    if (!name) {
      errors.push(`ингредиент «${chunk}»: нет названия`);
      return;
    }

    const amount = parseAmount(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`ингредиент «${name}»: количество «${amountRaw}» не число больше нуля`);
      return;
    }

    const unit = parseUnit(unitRaw);
    if (!unit || !isUnit(unit)) {
      errors.push(`ингредиент «${name}»: единица «${unitRaw}» не поддерживается (г, мл, шт)`);
      return;
    }

    ingredients.push({ name, amount, unit, sortOrder: position });
  });

  return { ingredients, errors };
}

function parseSteps(value: string): string[] {
  return cleanText(value)
    .split(/[;\n]/)
    .map((step) => step.trim())
    .filter(Boolean);
}

/**
 * Разбирает CSV в готовые к сохранению блюда.
 * Каждая проблемная строка попадает в errors с номером строки файла.
 */
export function parseDishesCSV(text: string): CsvParseResult {
  const delimiter = detectDelimiter(text);
  const rows = parseRows(text, delimiter);
  const errors: CsvError[] = [];
  const items: ParsedDishRow[] = [];

  if (!rows.length) {
    return {
      items,
      errors: [{ row: 0, message: 'Файл пустой.' }],
      dataRows: 0,
      delimiter,
      hasHeader: false
    };
  }

  const header = (rows[0] ?? []).map(mapHeader);
  const hasHeader = header.includes('title');

  if (!hasHeader) {
    return {
      items,
      errors: [{
        row: 1,
        message: looksLikeFridgeCsv(rows[0] ?? [])
          ? 'Похоже, это CSV холодильника (name,amount,unit) — используйте блок «Холодильник из CSV».'
          : `Не найдена колонка «title». Ожидаются заголовки: ${DISH_CSV_COLUMNS.join(', ')}`
      }],
      dataRows: rows.length,
      delimiter,
      hasHeader: false
    };
  }

  const dataRows = rows.slice(1);

  dataRows.forEach((cells, index) => {
    const rowNumber = index + 2;
    const record: Record<string, string> = {};

    header.forEach((column, position) => {
      if (!column) return;
      record[column] = cells[position] ?? '';
    });

    const title = cleanText(record.title);
    if (!title) {
      errors.push({ row: rowNumber, message: 'не заполнено название блюда' });
      return;
    }

    const sectionId = mapSection(record.section ?? '');
    if (!sectionId) {
      errors.push({
        row: rowNumber,
        message: `раздел «${cleanText(record.section)}» неизвестен (breakfast, lunch, dinner)`
      });
      return;
    }

    const ingredientResult = parseIngredients(record.ingredients ?? '');
    if (ingredientResult.errors.length) {
      ingredientResult.errors.forEach((message) => {
        errors.push({ row: rowNumber, message: `${title}: ${message}` });
      });
      return;
    }

    const timeRaw = cleanText(record.time);
    let timeMin: number | null = null;
    if (timeRaw) {
      const parsed = parseAmount(timeRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.push({ row: rowNumber, message: `${title}: время «${timeRaw}» не число` });
        return;
      }
      timeMin = Math.round(parsed);
    }

    const dish: DishInput = {
      title,
      sectionId,
      timeMin,
      steps: parseSteps(record.steps ?? ''),
      notes: cleanText(record.notes ?? ''),
      ingredients: ingredientResult.ingredients
    };

    const validation = validateDishInput(dish);
    if (!validation.ok) {
      validation.errors.forEach((message) => {
        errors.push({ row: rowNumber, message: `${title}: ${message}` });
      });
      return;
    }

    items.push({ row: rowNumber, dish });
  });

  return { items, errors, dataRows: dataRows.length, delimiter, hasHeader };
}

/* -------------------------------------------------------------------------- *
 * Холодильник: name,amount,unit
 * -------------------------------------------------------------------------- */

function mapFridgeHeader(cell: string): string {
  const key = cleanText(cell).toLowerCase().replace(/[«»"'.]/g, '');
  return FRIDGE_HEADER_ALIASES[key] ?? '';
}

/** Похоже ли, что первая строка — заголовки файла холодильника. */
function looksLikeFridgeCsv(cells: string[]): boolean {
  const mapped = cells.map((cell) => mapFridgeHeader(cell));
  return mapped.includes('name') || (mapped.includes('amount') && mapped.includes('unit'));
}

/** Валидные строки файла холодильника: name, amount > 0, unit из г/мл/шт. */
function parseFridgeRecord(record: Record<string, string>): { item: FridgeInput | null; errors: string[] } {
  const name = cleanText(record.name);
  const amount = parseAmount(record.amount);
  const unit = parseUnit(record.unit);
  const expires = parseFridgeDate(record[FRIDGE_EXPIRES_COLUMN]);
  const errors: string[] = [];

  if (!name) errors.push('Укажите название продукта.');
  else if (name.length > 80) errors.push('Название продукта длиннее 80 символов.');

  if (!Number.isFinite(amount)) errors.push('Укажите количество числом.');
  else if (amount <= 0) errors.push('Количество должно быть больше нуля.');

  if (!unit) errors.push('Единица измерения — только г, мл или шт.');

  if (expires === 'invalid') errors.push('Срок годности — в формате ГГГГ-ММ-ДД.');

  if (errors.length || !unit) return { item: null, errors };

  return { item: { name, amount, unit, expiresAt: expires === 'invalid' ? null : expires }, errors: [] };
}

/**
 * Разбирает CSV холодильника (name,amount,unit).
 * Строка заголовков необязательна: файл из одних данных читается так же.
 * Единицы понимаются в записи г/мл/шт, а также g/ml/pcs.
 */
export function parseFridgeCSV(text: string): FridgeCsvParseResult {
  const delimiter = detectDelimiter(text);
  const rows = parseRows(text, delimiter);
  const errors: CsvError[] = [];
  const items: ParsedFridgeRow[] = [];

  if (!rows.length) {
    return { items, errors: [{ row: 0, message: 'Файл пустой.' }], dataRows: 0, delimiter, hasHeader: false };
  }

  const header = (rows[0] ?? []).map(mapFridgeHeader);
  const hasHeader = header.includes('name');

  if (hasHeader) {
    // expires_at — необязательная колонка, обязательны только три первых.
    const missing = FRIDGE_CSV_COLUMNS.filter((column) => !header.includes(column));
    if (missing.length) {
      return {
        items,
        errors: [{
          row: 1,
          message: `Не найдены колонки: ${missing.join(', ')}. Ожидаются name, amount, unit (и необязательная expires_at).`
        }],
        dataRows: 0,
        delimiter,
        hasHeader: true
      };
    }
  }

  const map = hasHeader ? [...header] : [...FRIDGE_CSV_COLUMNS];
  const start = hasHeader ? 1 : 0;
  const dataRows = rows.slice(start);

  dataRows.forEach((cells, index) => {
    const rowNumber = start === 1 ? index + 2 : index + 1;
    const record: Record<string, string> = {};

    map.forEach((column, position) => {
      if (!column) return;
      record[column] = cells[position] ?? '';
    });

    const parsed = parseFridgeRecord(record);
    if (!parsed.item) {
      errors.push({ row: rowNumber, message: parsed.errors.join(' ') });
      return;
    }

    items.push({ row: rowNumber, item: parsed.item });
  });

  return { items, errors, dataRows: dataRows.length, delimiter, hasHeader };
}

/** @returns {string} CSV холодильника (для экспорта и шаблона). */
export function toFridgeCSV(items: FridgeInput[]): string {
  const lines = [[...FRIDGE_CSV_COLUMNS, FRIDGE_EXPIRES_COLUMN].join(',')];
  items.forEach((item) => {
    const name = /[",;\n]/.test(item.name) ? `"${item.name.replace(/"/g, '""')}"` : item.name;
    lines.push(`${name},${item.amount},${item.unit},${item.expiresAt ?? ''}`);
  });
  // BOM, чтобы Excel открыл файл в UTF-8
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function fridgeCsvTemplate(): string {
  const rows: FridgeInput[] = [
    { name: 'творог', amount: 500, unit: 'г' },
    { name: 'молоко', amount: 1000, unit: 'мл' },
    { name: 'соль', amount: 300, unit: 'г' },
    { name: 'яйца', amount: 10, unit: 'шт' }
  ];
  // В шаблоне показываем типовой срок годности — колонка необязательная.
  return toFridgeCSV(rows.map((row) => ({ ...row, expiresAt: defaultExpiresAt(row.name) })));
}

/** Шаблон CSV с примером — отдаётся кнопкой «Скачать шаблон». */
export function dishesCsvTemplate(): string {
  const lines = [
    DISH_CSV_COLUMNS.join(','),
    'Омлет с сыром,breakfast,яйца|3|шт;сыр|50|г;молоко|50|мл,15,"Взбить яйца с молоком;Добавить сыр;Обжарить под крышкой",Солить в самом конце',
    'Салат из огурцов,lunch,огурцы|200|г;помидоры|200|г;масло|20|мл,10,"Нарезать овощи;Заправить маслом",'
  ];
  // BOM, чтобы Excel открыл файл в UTF-8
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
