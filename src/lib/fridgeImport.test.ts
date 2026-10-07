import { describe, expect, it } from 'vitest';
import { planFridgeImport } from './fridgeImport';
import type { FridgeItem } from './types';

/* ============================================================================
 * Проверки плана заполнения холодильника из CSV.
 * ========================================================================== */

const current: FridgeItem[] = [
  { id: 'p1', name: 'мука', amount: 500, unit: 'г', updatedAt: null },
  { id: 'p2', name: 'молоко', amount: 500, unit: 'мл', updatedAt: null }
];

describe('planFridgeImport: режим merge', () => {
  it('обновляет совпадающие позиции и добавляет новые', () => {
    const plan = planFridgeImport(
      [
        { name: 'Мука', amount: 2000, unit: 'г' },
        { name: 'сыр', amount: 300, unit: 'г' }
      ],
      current,
      'merge'
    );

    expect(plan.counts).toEqual({ added: 1, updated: 1, summed: 0, skipped: 0 });
    expect(plan.updates).toEqual([{ id: 'p1', patch: { name: 'мука', amount: 2000, unit: 'г' } }]);
    expect(plan.inserts).toEqual([{ name: 'сыр', amount: 300, unit: 'г' }]);
    expect(plan.deletes).toEqual([]);
    expect(plan.totalAfter).toBe(3);
  });

  it('меняет единицу измерения, если продукт есть в другой единице', () => {
    const plan = planFridgeImport([{ name: 'мука', amount: 2, unit: 'шт' }], current, 'merge');
    expect(plan.counts.updated).toBe(1);
    expect(plan.updates[0]).toEqual({ id: 'p1', patch: { name: 'мука', amount: 2, unit: 'шт' } });
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
      'merge'
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
      'merge'
    );
    expect(plan.inserts).toEqual([{ name: 'сахар', amount: 700, unit: 'г' }]);
    expect(plan.counts).toEqual({ added: 1, updated: 1, summed: 0, skipped: 0 });
  });
});

describe('planFridgeImport: режим sum', () => {
  it('складывает количества при совпадении единицы', () => {
    const plan = planFridgeImport([{ name: 'мука', amount: 250, unit: 'г' }], current, 'sum');
    expect(plan.counts.summed).toBe(1);
    expect(plan.updates).toEqual([{ id: 'p1', patch: { name: 'мука', amount: 750, unit: 'г' } }]);
    expect(plan.entries[0].resulting).toBe(750);
  });

  it('пропускает строку с другой единицей и предупреждает', () => {
    const plan = planFridgeImport([{ name: 'мука', amount: 1, unit: 'шт' }], current, 'sum');
    expect(plan.counts).toEqual({ added: 0, updated: 0, summed: 0, skipped: 1 });
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.warnings[0]).toMatch(/единица не совпадает/);
  });

  it('новый продукт добавляется как обычно', () => {
    const plan = planFridgeImport([{ name: 'сыр', amount: 300, unit: 'г' }], current, 'sum');
    expect(plan.counts.added).toBe(1);
    expect(plan.inserts).toEqual([{ name: 'сыр', amount: 300, unit: 'г' }]);
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
      'replace'
    );
    expect(plan.deletes.sort()).toEqual(['p1', 'p2']);
    expect(plan.inserts).toHaveLength(2);
    expect(plan.counts).toEqual({ added: 2, updated: 0, summed: 0, skipped: 0 });
    expect(plan.totalAfter).toBe(2);
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
      'merge'
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.counts.skipped).toBe(2);
    expect(plan.entries.filter((entry) => entry.action === 'invalid')).toHaveLength(2);
  });

  it('ничего не планирует, если строк нет', () => {
    const plan = planFridgeImport([], current, 'merge');
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.totalAfter).toBe(2);
  });
});
