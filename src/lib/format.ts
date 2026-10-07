/* ============================================================================
 * format.ts — мелкие помощники оформления: числа, склонения, эмодзи разделов.
 * ========================================================================== */

/** Эмодзи по разделам (фотографий нет — визуальное разнообразие за счёт иконок). */
export const SECTION_EMOJI: Record<string, string> = {
  breakfast: '🍳',
  lunch: '🍲',
  dinner: '🍽'
};

export function sectionEmoji(sectionId: string): string {
  return SECTION_EMOJI[sectionId] ?? '🍴';
}

/** Округление до 3 знаков и вывод без хвостовых нулей. */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Math.round(value * 1000) / 1000);
}

export function formatTime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '';
  return `${formatAmount(minutes)} мин`;
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function dishWord(count: number): string {
  return `${count} ${plural(count, 'блюдо', 'блюда', 'блюд')}`;
}

export function productWord(count: number): string {
  return `${count} ${plural(count, 'продукт', 'продукта', 'продуктов')}`;
}

export function stepWord(count: number): string {
  return `${count} ${plural(count, 'шаг', 'шага', 'шагов')}`;
}

/** Обрезает длинный список для бейджа. */
export function shorten(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
