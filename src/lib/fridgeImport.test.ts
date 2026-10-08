import { describe, expect, it } from 'vitest';
import { planFridgeImport } from './fridgeImport';
import type { FridgeItem } from './types';

/* ============================================================================
 * Проверки плана заполнения холодильника из CSV.
 * ========================================================================== */

/** Фиксированная дата отсчёта, чтобы типовые сроки были предсказуемы. */
const FROM = new Date('2026-10-08T12:00:00');

const current: FridgeItem[] = [
  { id: 'p1', name: 'мука', amount: 500, unit: 'г', updatedAt: null, expiresAt: null },
  { id: 'p2', name: 'молоко', amount: 500, unit: 'мл', updatedAt: null, expiresAt: null }
];

describe('planFridgeImport: режим merge', () => {
  it('обновляет совпадающие позиции и добавляет новые', () => {
    const plan = planFridgeImport(
      [
        { name: 'Мука', amount: 2000, unit: 'г' },
        { name: 'сыр', amount: 300, unit: 'г' }
      ],
      current,
      'merge',
      FROM
    );

    expect(plan.counts).toEqual({ added: 1, updated: 1, summed: 0, skipped: 0 });
    expect(plan.updates).toEqual([
      { id: 'p1', patch: { name: 'мука', amount: 2000, unit: 'г', expiresAt: null } }
    ]);
    // В файле даты нет — подставляется типовой срок сыра (14 дней).
    expect(plan.inserts).toEqual([
      { name: 'сыр', amount: 300, unit: 'г', expiresAt: '2026-10-22' }
    ]);
    expect(plan.deletes).toEqual([]);
    expect(plan.totalAfter).toBe(3);
  });

  it('меняет единицу измерения, если продукт есть в другой единице', () => {
    const plan = planFridgeImport([{ name: 'мука', amount: 2, unit: 'шт' }], current, 'merge', FROM);
    expect(plan.counts.updated).toBe(1);
    expect(plan.updates[0]).toEqual({
      id: 'p1',
      patch: { name: 'мука', amount: 2, unit: 'шт', expiresAt: null }
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.entries[0].note).toMatch(/единица изменится/);
  });

  it('одинаковые названия в файле с разными единицами дают две строки', () => {
    const plan = planFridgeImport(
      [
        { name: 'сахар', amount: 300, unit: 'г' },
        { name: 'сахар', amount: 10, unit: 'шт' }
      ],
      current,
      'merge',
      FROM
    );
    expect(plan.inserts).toHaveLength(2);
    expect(plan.counts).toEqual({ added: 2, updated: 0, summed: 0, skipped: 0 });
  });

  it('дубликат внутри файла по названию и единице обновляется, а не дублируется', () => {
    const plan = planFridgeImport(
      [
        { name: 'сахар', amount: 300, unit: 'г' },
        { name: 'сахар', amount: 700, unit: 'г' }
      ],
      current,
      'merge',
      FROM
    );
    expect(plan.inserts).toEqual([
      { name: 'сахар', amount: 700, unit: 'г', expiresAt: null }
    ]);
    expect(plan.counts).toEqual({ added: 1, updated: 1, summed: 0, skipped: 0 });
  });
});

describe('planFridgeImport: режим sum', () => {
  it('складывает количества при совпадении единицы', () => {
    const plan = planFridgeImport([{ name: 'мука', amount: 250, unit: 'г' }], current, 'sum', FROM);
    expect(plan.counts.summed).toBe(1);
    expect(plan.updates).toEqual([
      { id: 'p1', patch: { name: 'мука', amount: 750, unit: 'г', expiresAt: null } }
    ]);
    expect(plan.entries[0].resulting).toBe(750);
  });

  it('пропускает строку с другой единицей и предупреждает', () => {
    const plan = planFridgeImport([{ name: 'мука', amount: 1, unit: 'шт' }], current, 'sum', FROM);
    expect(plan.counts).toEqual({ added: 0, updated: 0, summed: 0, skipped: 1 });
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.warnings[0]).toMatch(/единица не совпадает/);
  });

  it('новый продукт добавляется как обычно', () => {
    const plan = planFridgeImport([{ name: 'сыр', amount: 300, unit: 'г' }], current, 'sum', FROM);
    expect(plan.counts.added).toBe(1);
    expect(plan.inserts).toEqual([
      { name: 'сыр', amount: 300, unit: 'г', expiresAt: '2026-10-22' }
    ]);
  });
});

describe('planFridgeImport: режим replace', () => {
  it('удаляет всё текущее и вставляет содержимое файла', () => {
    const plan = planFridgeImport(
      [
        { name: 'яйца', amount: 10, unit: 'шт' },
        { name: 'сыр', amount: 300, unit: 'г' }
      ],
      current,
      'replace',
      FROM
    );
    expect(plan.deletes.sort()).toEqual(['p1', 'p2']);
    expect(plan.inserts).toHaveLength(2);
    expect(plan.counts).toEqual({ added: 2, updated: 0, summed: 0, skipped: 0 });
    expect(plan.totalAfter).toBe(2);
  });
});

describe('planFridgeImport: срок годности', () => {
  it('берёт дату из файла как есть', () => {
    const plan = planFridgeImport(
      [{ name: 'творог', amount: 500, unit: 'г', expiresAt: '2026-10-15' }],
      current,
      'merge',
      FROM
    );
    expect(plan.inserts).toEqual([
      { name: 'творог', amount: 500, unit: 'г', expiresAt: '2026-10-15' }
    ]);
  });

  it('пустая дата заменяется типовым сроком хранения', () => {
    const plan = planFridgeImport(
      [{ name: 'творог', amount: 500, unit: 'г', expiresAt: null }],
      current,
      'merge',
      FROM
    );
    expect(plan.inserts[0].expiresAt).toBe('2026-10-15');
  });

  it('не ставит дату «вечным» продуктам', () => {
    const plan = planFridgeImport([{ name: 'соль', amount: 300, unit: 'г' }], current, 'merge', FROM);
    expect(plan.inserts[0].expiresAt).toBeNull();
  });

  it('merge не перезаписывает дату, если в файле пусто', () => {
    const withDate: FridgeItem[] = [
      { id: 'p1', name: 'творог', amount: 500, unit: 'г', updatedAt: null, expiresAt: '2026-10-15' }
    ];
    const plan = planFridgeImport([{ name: 'творог', amount: 900, unit: 'г' }], withDate, 'merge', FROM);
    expect(plan.updates[0].patch).toEqual({
      name: 'творог',
      amount: 900,
      unit: 'г',
      expiresAt: '2026-10-15'
    });
  });

  it('sum оставляет минимальную из двух дат', () => {
    const withDate: FridgeItem[] = [
      { id: 'p1', name: 'творог', amount: 500, unit: 'г', updatedAt: null, expiresAt: '2026-10-20' }
    ];
    const plan = planFridgeImport(
      [{ name: 'творог', amount: 500, unit: 'г', expiresAt: '2026-10-12' }],
      withDate,
      'sum',
      FROM
    );
    expect(plan.updates[0].patch.expiresAt).toBe('2026-10-12');
    expect(plan.updates[0].patch.amount).toBe(1000);
  });

  it('sum: null + дата даёт дату', () => {
    const plan = planFridgeImport(
      [{ name: 'мука', amount: 250, unit: 'г', expiresAt: '2026-11-01' }],
      current,
      'sum',
      FROM
    );
    expect(plan.updates[0].patch.expiresAt).toBe('2026-11-01');
  });

  it('replace берёт дату только из файла, пустую заменяет типовой', () => {
    const plan = planFridgeImport(
      [
        { name: 'творог', amount: 500, unit: 'г', expiresAt: '2026-10-15' },
        { name: 'сыр', amount: 300, unit: 'г', expiresAt: null }
      ],
      current,
      'replace',
      FROM
    );
    expect(plan.inserts.map((item) => item.expiresAt)).toEqual(['2026-10-15', '2026-10-22']);
  });
});

describe('planFridgeImport: проверка данных', () => {
  it('пропускает некорректные строки с пояснением', () => {
    const plan = planFridgeImport(
      [
        { name: 'сыр', amount: 300, unit: 'г' },
        { name: 'соль', amount: 0, unit: 'г' },
        { name: '', amount: 10, unit: 'шт' }
      ],
      current,
      'merge',
      FROM
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.counts.skipped).toBe(2);
    expect(plan.entries.filter((entry) => entry.action === 'invalid')).toHaveLength(2);
  });

  it('ничего не планирует, если строк нет', () => {
    const plan = planFridgeImport([], current, 'merge', FROM);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.totalAfter).toBe(2);
  });
});
