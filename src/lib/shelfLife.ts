/* ============================================================================
 * shelfLife.ts — сроки годности продуктов (чистая логика).
 *
 * Ни сети, ни DOM: таблица типовых сроков, нормализация названия и расчёт
 * даты «годен до». Даты — строки формата YYYY-MM-DD, как колонка expires_at.
 * ========================================================================== */

/** Базовые сроки хранения (в днях) по нормализованному названию продукта. */
export const SHELF_LIFE_DAYS: Record<string, number> = {
  // молочное
  'молоко': 7,
  'творог': 7,
  'сметана': 7,
  'сыр': 14,
  'кефир': 7,
  'йогурт': 7,
  'ряженка': 7,
  // мясо и рыба
  'курица': 5,
  'куриная грудка': 5,
  'куриное бедро': 5,
  'бёдра куриные': 5,
  'грудка куриная': 5,
  'курица суповые части': 5,
  'фарш': 5,
  'фарш куриный': 5,
  'мясо': 5,
  'свинина': 5,
  'говядина': 5,
  'печень': 5,
  'печень куриная': 5,
  'рыба': 2,
  'минтай': 2,
  'хек': 2,
  // яйца
  'яйца': 30,
  // овощи
  'помидоры': 5,
  'огурцы': 5,
  'перец': 7,
  'кабачки': 7,
  'баклажаны': 7,
  'капуста': 14,
  'морковь': 14,
  'свёкла': 14,
  'лук': 30,
  'чеснок': 30,
  'картофель': 30,
  'тыква': 30,
  'зелень': 3,
  'укроп': 3,
  'петрушка': 3,
  // фрукты
  'яблоки': 14,
  'бананы': 5,
  'апельсины': 14,
  'лимоны': 30,
  'груши': 7,
  'виноград': 7,
  // хлеб
  'хлеб': 3,
  'батон': 3,
  'булка': 3,
  'лаваш': 5,
  // готовое
  'колбаса': 3,
  'сосиски': 3,
  'пельмени': 30
};

/** Продукты, которым срок годности никогда не ставится автоматически. */
export const ETERNAL_PRODUCTS: string[] = [
  'соль',
  'сахар',
  'мука',
  'крупа',
  'рис',
  'гречка',
  'овсянка',
  'пшено',
  'манка',
  'макароны',
  'вермишель',
  'горох',
  'чечевица',
  'фасоль консервированная',
  'консервы',
  'мёд',
  'специи',
  'масло растительное',
  'томатная паста',
  'изюм',
  'варенье'
];

/** Ключи таблицы, отсортированные от самого длинного к самому короткому. */
const SHELF_LIFE_KEYS = Object.keys(SHELF_LIFE_DAYS).sort((a, b) => b.length - a.length);

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Нижний регистр + сжатие пробелов. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/* -------------------------------------------------------------------------- *
 * Работа с датами
 * -------------------------------------------------------------------------- */

/**
 * Считает дату по календарным суткам UTC.
 * Так расчёт не зависит от часового пояса браузера и совпадает с current_date в БД.
 */
function todayUtc(from: Date): number {
  return Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
}

/** Разбирает YYYY-MM-DD в метку суток UTC; иначе null. */
function parseDateUtc(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  // Отсекаем «2026-02-31» — Date сам такое переносит на март.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return stamp;
}

/** Сколько суток осталось до даты (отрицательное — уже прошла). */
export function daysUntil(expiresAt: string, from: Date = new Date()): number | null {
  const stamp = parseDateUtc(expiresAt);
  if (stamp === null) return null;
  return Math.round((stamp - todayUtc(from)) / 86_400_000);
}

/** Метка суток UTC → YYYY-MM-DD. */
function toDateString(stamp: number): string {
  return new Date(stamp).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- *
 * Расчёт срока
 * -------------------------------------------------------------------------- */

/**
 * Срок хранения продукта в днях.
 * null — продукт «вечный» (крупы, специи, консервы) или неизвестен.
 */
export function getShelfLifeDays(name: string): number | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  const eternal = ETERNAL_PRODUCTS.some(
    (product) => normalized === product || normalized.startsWith(`${product} `)
  );
  if (eternal) return null;

  // Ищем самое длинное совпадение-подстроку: «молоко 3,2%» → «молоко».
  for (const key of SHELF_LIFE_KEYS) {
    if (normalized.includes(key)) return SHELF_LIFE_DAYS[key];
  }

  return null;
}

/** Дата «годен до» (YYYY-MM-DD) для продукта или null, если срок неизвестен. */
export function defaultExpiresAt(name: string, from: Date = new Date()): string | null {
  const days = getShelfLifeDays(name);
  if (days === null) return null;
  return toDateString(todayUtc(from) + days * 86_400_000);
}

/* -------------------------------------------------------------------------- *
 * Отображение
 * -------------------------------------------------------------------------- */

export type ExpiryStatus = 'ok' | 'soon' | 'today' | 'expired' | 'none';

export function getExpiryStatus(expiresAt: string | null, from: Date = new Date()): ExpiryStatus {
  if (!expiresAt) return 'none';

  const diff = daysUntil(expiresAt, from);
  if (diff === null) return 'none';

  if (diff < 0) return 'expired';
  if (diff === 0) return 'today';
  if (diff <= 3) return 'soon';
  return 'ok';
}

/** Человеческая формулировка срока: «истекает завтра», «через 3 дня». */
export function humanExpiry(expiresAt: string, from: Date = new Date()): string {
  const diff = daysUntil(expiresAt, from);
  if (diff === null) return '';

  if (diff < 0) return `просрочено на ${Math.abs(diff)} дн.`;
  if (diff === 0) return 'истекает сегодня';
  if (diff === 1) return 'истекает завтра';
  if (diff < 5) return `через ${diff} дня`;
  return `через ${diff} дней`;
}

/** Строка для бейджа: «17 окт · через 3 дня». */
export function formatExpiryLabel(expiresAt: string, from: Date = new Date()): string {
  const stamp = parseDateUtc(expiresAt);
  if (stamp === null) return '';

  const date = new Date(stamp);
  const day = date.getUTCDate();
  const month = MONTHS_SHORT[date.getUTCMonth()];
  return `${day} ${month} · ${humanExpiry(expiresAt, from)}`;
}
