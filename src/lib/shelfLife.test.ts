import { describe, expect, it } from 'vitest';
import {
  ETERNAL_PRODUCTS,
  SHELF_LIFE_DAYS,
  defaultExpiresAt,
  formatExpiryLabel,
  getExpiryStatus,
  getShelfLifeDays,
  humanExpiry
} from './shelfLife';

/* ============================================================================
 * Проверки сроков годности: таблица, нормализация названий, статусы и подписи.
 * ========================================================================== */

const TODAY = new Date('2026-10-08T12:00:00');

describe('SHELF_LIFE_DAYS', () => {
  it('содержит базовые сроки для молочного, мяса и овощей', () => {
    expect(SHELF_LIFE_DAYS['молоко']).toBe(7);
    expect(SHELF_LIFE_DAYS['курица']).toBe(5);
    expect(SHELF_LIFE_DAYS['яйца']).toBe(30);
    expect(SHELF_LIFE_DAYS['хлеб']).toBe(3);
  });
});

describe('ETERNAL_PRODUCTS', () => {
  it('не пересекается с таблицей сроков', () => {
    for (const product of ETERNAL_PRODUCTS) {
      expect(SHELF_LIFE_DAYS[product]).toBeUndefined();
    }
  });
});

describe('getShelfLifeDays', () => {
  it('находит срок по точному названию', () => {
    expect(getShelfLifeDays('молоко')).toBe(7);
  });

  it('находит срок внутри названия с процентами', () => {
    expect(getShelfLifeDays('Молоко 3,2%')).toBe(7);
  });

  it('возвращает null для «вечных» продуктов', () => {
    expect(getShelfLifeDays('соль')).toBeNull();
    expect(getShelfLifeDays('фасоль консервированная')).toBeNull();
    expect(getShelfLifeDays('мука пшеничная')).toBeNull();
  });

  it('возвращает null для неизвестного продукта', () => {
    expect(getShelfLifeDays('непонятный продукт')).toBeNull();
  });

  it('выбирает самое длинное совпадение', () => {
    expect(getShelfLifeDays('фарш куриный домашний')).toBe(5);
    expect(getShelfLifeDays('грудка куриная на кости')).toBe(5);
  });

  it('не ставит срок пустому названию', () => {
    expect(getShelfLifeDays('   ')).toBeNull();
  });
});

describe('defaultExpiresAt', () => {
  it('прибавляет срок хранения к дате отсчёта', () => {
    expect(defaultExpiresAt('творог', TODAY)).toBe('2026-10-15');
  });

  it('считает срок для рыбы в два дня', () => {
    expect(defaultExpiresAt('минтай', TODAY)).toBe('2026-10-10');
  });

  it('возвращает null для продукта без срока', () => {
    expect(defaultExpiresAt('соль', TODAY)).toBeNull();
  });
});

describe('getExpiryStatus', () => {
  it('просроченный продукт', () => {
    expect(getExpiryStatus('2026-10-07', TODAY)).toBe('expired');
  });

  it('истекает сегодня', () => {
    expect(getExpiryStatus('2026-10-08', TODAY)).toBe('today');
  });

  it('истекает скоро (завтра)', () => {
    expect(getExpiryStatus('2026-10-09', TODAY)).toBe('soon');
  });

  it('истекает скоро (через три дня)', () => {
    expect(getExpiryStatus('2026-10-11', TODAY)).toBe('soon');
  });

  it('ещё далеко — ok', () => {
    expect(getExpiryStatus('2026-10-18', TODAY)).toBe('ok');
  });

  it('без даты — none', () => {
    expect(getExpiryStatus(null, TODAY)).toBe('none');
  });
});

describe('humanExpiry', () => {
  it('просрочено', () => {
    expect(humanExpiry('2026-10-07', TODAY)).toBe('просрочено на 1 дн.');
  });

  it('сегодня', () => {
    expect(humanExpiry('2026-10-08', TODAY)).toBe('истекает сегодня');
  });

  it('завтра', () => {
    expect(humanExpiry('2026-10-09', TODAY)).toBe('истекает завтра');
  });

  it('через три дня — «дня»', () => {
    expect(humanExpiry('2026-10-11', TODAY)).toBe('через 3 дня');
  });

  it('через десять дней — «дней»', () => {
    expect(humanExpiry('2026-10-18', TODAY)).toBe('через 10 дней');
  });
});

describe('formatExpiryLabel', () => {
  it('собирает дату и срок в одну строку', () => {
    expect(formatExpiryLabel('2026-10-15', TODAY)).toBe('15 окт · через 7 дней');
  });

  it('подписывает сегодняшний день', () => {
    expect(formatExpiryLabel('2026-10-08', TODAY)).toBe('8 окт · истекает сегодня');
  });

  it('подписывает просрочку', () => {
    expect(formatExpiryLabel('2026-10-06', TODAY)).toBe('6 окт · просрочено на 2 дн.');
  });
});
