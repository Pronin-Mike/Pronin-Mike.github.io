/* ============================================================================
 * fridgeImport.ts — план массового заполнения холодильника из CSV.
 *
 * Чистая функция без запросов к Supabase: её результат показывает предпросмотр
 * («что будет») и ровно он же применяется к базе — разойтись они не могут.
 *
 * Режимы:
 *   merge   — совпадающие названия обновляются, новые добавляются;
 *   sum     — количества складываются (только при совпадении единицы);
 *   replace — холодильник заменяется содержимым файла.
 *
 * Срок годности (expires_at):
 *   merge   — дата из файла перекрывает текущую; пусто в файле — оставляем текущую;
 *   sum     — минимальная из двух дат (null + дата → дата);
 *   replace — только дата из файла.
 *   Если после этого даты нет нигде — берём типовой срок по названию.
 * ========================================================================== */

import type { FridgeInput, FridgeItem, Unit } from './types';
import { normalizeName, round3 } from './availability';
import { defaultExpiresAt } from './shelfLife';
import { validateFridgeInput } from './validation';
import { adjustStock } from './pricing';

export type FridgeImportMode = 'merge' | 'sum' | 'replace';

export type FridgeImportAction = 'new' | 'update' | 'sum' | 'skip' | 'invalid';

export interface FridgeImportEntry {
  row: number;
  name: string;
  amount: number;
  unit: Unit;
  action: FridgeImportAction;
  note: string;
  /** Количество, которое получится в холодильнике после импорта. */
  resulting: number;
  /** Срок годности, который получится после импорта. */
  expiresAt: string | null;
  /** Известная стоимость результата импорта. */
  totalCost: number;
  pricedAmount: number;
}

export interface FridgeImportCounts {
  added: number;
  updated: number;
  summed: number;
  skipped: number;
}

export interface FridgeImportPlan {
  mode: FridgeImportMode;
  entries: FridgeImportEntry[];
  counts: FridgeImportCounts;
  warnings: string[];
  /** Строки к добавлению. */
  inserts: FridgeInput[];
  /** Изменения существующих позиций. */
  updates: Array<{ id: string; patch: Partial<FridgeInput> }>;
  /** id позиций к удалению (режим replace). */
  deletes: string[];
  /** Сколько продуктов будет в холодильнике после импорта. */
  totalAfter: number;
}

interface WorkingItem {
  origin: 'existing' | 'new';
  id: string;
  name: string;
  amount: number;
  unit: Unit;
  originalAmount: number;
  originalUnit: Unit;
  /** Срок годности в БД (для 'existing') — до импорта. */
  originalExpiresAt: string | null;
  /** Срок годности после импорта. */
  expiresAt: string | null;
  totalCost: number;
  pricedAmount: number;
  lastPurchasePrice: number | null;
  originalTotalCost: number;
  originalPricedAmount: number;
  originalLastPurchasePrice: number | null;
}

/** Минимальная из двух дат; null не перекрывает дату. */
function minDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

export function planFridgeImport(
  rows: FridgeInput[],
  current: FridgeItem[],
  mode: FridgeImportMode = 'merge',
  /** Дата отсчёта для типового срока годности (в тестах — фиксированная). */
  from: Date = new Date()
): FridgeImportPlan {
  const entries: FridgeImportEntry[] = [];
  const warnings: string[] = [];
  const counts: FridgeImportCounts = { added: 0, updated: 0, summed: 0, skipped: 0 };

  const working: WorkingItem[] = mode === 'replace'
    ? []
    : current.map((item) => ({
        origin: 'existing',
        id: item.id,
        name: item.name,
        amount: item.amount,
        unit: item.unit,
        originalAmount: item.amount,
        originalUnit: item.unit,
        originalExpiresAt: item.expiresAt,
        expiresAt: item.expiresAt,
        totalCost: item.totalCost ?? 0,
        pricedAmount: item.pricedAmount ?? 0,
        lastPurchasePrice: item.lastPurchasePrice ?? null,
        originalTotalCost: item.totalCost ?? 0,
        originalPricedAmount: item.pricedAmount ?? 0,
        originalLastPurchasePrice: item.lastPurchasePrice ?? null
      }));

  const findExact = (name: string, unit: Unit) =>
    working.find((item) => normalizeName(item.name) === normalizeName(name) && item.unit === unit);

  const findByName = (name: string) =>
    working.filter((item) => normalizeName(item.name) === normalizeName(name));

  rows.forEach((raw, index) => {
    const row = index + 1;
    const validation = validateFridgeInput(raw);

    if (!validation.ok) {
      counts.skipped += 1;
      entries.push({
        row,
        name: raw.name ?? '',
        amount: 0,
        unit: raw.unit ?? 'г',
        action: 'invalid',
        note: validation.errors.join(' '),
        resulting: 0,
        expiresAt: null,
        totalCost: 0,
        pricedAmount: 0
      });
      return;
    }

    const name = raw.name.trim();
    const amount = round3(raw.amount);
    // Дата из файла: пусто → null (позже подставим типовой срок).
    const fileExpiresAt = raw.expiresAt ?? null;
    const unit = raw.unit;
    const hasSnapshotCost = raw.totalCost !== undefined || raw.pricedAmount !== undefined;
    const incomingTotal = raw.totalCost ?? raw.purchaseCost ?? 0;
    const incomingPriced = raw.pricedAmount ?? (raw.purchaseCost == null ? 0 : amount);

    /* ---------- режим «прибавить» ---------- */
    if (mode === 'sum') {
      const exact = findExact(name, unit);

      if (exact) {
        exact.amount = round3(exact.amount + amount);
        exact.totalCost += incomingTotal;
        exact.pricedAmount += incomingPriced;
        if (raw.purchaseCost !== undefined && raw.purchaseCost !== null) exact.lastPurchasePrice = raw.purchaseCost;
        // Складываем количества — оставляем более ранний срок годности.
        exact.expiresAt = minDate(exact.expiresAt, fileExpiresAt) ?? defaultExpiresAt(name, from);
        counts.summed += 1;
        entries.push({
          row,
          name: exact.name,
          amount,
          unit,
          action: 'sum',
          note: '',
          resulting: exact.amount,
          expiresAt: exact.expiresAt,
          totalCost: exact.totalCost,
          pricedAmount: exact.pricedAmount
        });
        return;
      }

      const sameName = findByName(name);
      if (sameName.length) {
        counts.skipped += 1;
        const note = `единица не совпадает: есть ${sameName[0].unit}, в файле ${unit}`;
        warnings.push(`«${name}» пропущен — ${note}.`);
        entries.push({
          row,
          name,
          amount,
          unit,
          action: 'skip',
          note,
          resulting: sameName[0].amount,
          expiresAt: sameName[0].expiresAt,
          totalCost: sameName[0].totalCost,
          pricedAmount: sameName[0].pricedAmount
        });
        return;
      }

      const expiresAt = fileExpiresAt ?? defaultExpiresAt(name, from);
      working.push({
        origin: 'new',
        id: '',
        name,
        amount,
        unit,
        originalAmount: 0,
        originalUnit: unit,
        originalExpiresAt: null,
        expiresAt,
        totalCost: incomingTotal,
        pricedAmount: incomingPriced,
        lastPurchasePrice: raw.purchaseCost ?? raw.lastPurchasePrice ?? null,
        originalTotalCost: 0,
        originalPricedAmount: 0,
        originalLastPurchasePrice: null,
      });
      counts.added += 1;
      entries.push({ row, name, amount, unit, action: 'new', note: '', resulting: amount, expiresAt, totalCost: incomingTotal, pricedAmount: incomingPriced });
      return;
    }

    /* ---------- режимы «обновить» и «заменить» ---------- */
    const exact = findExact(name, unit);

    if (exact) {
      exact.amount = amount;
      if (hasSnapshotCost || raw.purchaseCost !== undefined) {
        exact.totalCost = incomingTotal;
        exact.pricedAmount = incomingPriced;
        exact.lastPurchasePrice = raw.purchaseCost ?? raw.lastPurchasePrice ?? exact.lastPurchasePrice;
      } else {
        const adjusted = adjustStock({ amount: exact.originalAmount, totalCost: exact.originalTotalCost, pricedAmount: exact.originalPricedAmount }, amount);
        exact.totalCost = adjusted.totalCost;
        exact.pricedAmount = adjusted.pricedAmount;
      }
      // merge: дата из файла перекрывает текущую, пусто — оставляем как было.
      exact.expiresAt = fileExpiresAt ?? exact.expiresAt ?? defaultExpiresAt(name, from);
      counts.updated += 1;
      entries.push({
        row,
        name: exact.name,
        amount,
        unit,
        action: 'update',
        note: '',
        resulting: amount,
        expiresAt: exact.expiresAt,
        totalCost: exact.totalCost,
        pricedAmount: exact.pricedAmount
      });
      return;
    }

    const sameName = findByName(name);
    // Позиции, которые уже лежат в базе: их можно обновить (единицу и количество).
    // Строки из этого же файла с другим названием-единицей просто остаются отдельными.
    const existingSameName = sameName.filter((item) => item.origin === 'existing');

    if (existingSameName.length === 1) {
      const target = existingSameName[0];
      target.amount = amount;
      if (hasSnapshotCost || raw.purchaseCost !== undefined) {
        target.totalCost = incomingTotal;
        target.pricedAmount = incomingPriced;
        target.lastPurchasePrice = raw.purchaseCost ?? raw.lastPurchasePrice ?? target.lastPurchasePrice;
      } else {
        const adjusted = adjustStock({ amount: target.originalAmount, totalCost: target.originalTotalCost, pricedAmount: target.originalPricedAmount }, amount);
        target.totalCost = adjusted.totalCost;
        target.pricedAmount = adjusted.pricedAmount;
      }
      target.unit = unit;
      target.expiresAt = fileExpiresAt ?? target.expiresAt ?? defaultExpiresAt(name, from);
      counts.updated += 1;
      entries.push({
        row,
        name: target.name,
        amount,
        unit,
        action: 'update',
        note: `единица изменится: ${target.originalUnit} → ${unit}`,
        resulting: amount,
        expiresAt: target.expiresAt,
        totalCost: target.totalCost,
        pricedAmount: target.pricedAmount
      });
      return;
    }

    if (existingSameName.length > 1) {
      counts.skipped += 1;
      const note = 'в холодильнике несколько позиций с таким названием — поправьте вручную';
      warnings.push(`«${name}» пропущен — ${note}.`);
      entries.push({ row, name, amount, unit, action: 'skip', note, resulting: 0, expiresAt: null, totalCost: 0, pricedAmount: 0 });
      return;
    }

    const expiresAt = fileExpiresAt ?? defaultExpiresAt(name, from);
    working.push({
      origin: 'new',
      id: '',
      name,
      amount,
      unit,
      originalAmount: 0,
      originalUnit: unit,
      originalExpiresAt: null,
      expiresAt,
      totalCost: incomingTotal,
      pricedAmount: incomingPriced,
      lastPurchasePrice: raw.purchaseCost ?? raw.lastPurchasePrice ?? null,
      originalTotalCost: 0,
      originalPricedAmount: 0,
      originalLastPurchasePrice: null,
    });
    counts.added += 1;
    entries.push({ row, name, amount, unit, action: 'new', note: '', resulting: amount, expiresAt, totalCost: incomingTotal, pricedAmount: incomingPriced });
  });

  const inserts: FridgeInput[] = working
    .filter((item) => item.origin === 'new')
    .map((item) => {
      const base: FridgeInput = {
        name: item.name,
        amount: round3(item.amount),
        unit: item.unit,
        expiresAt: item.expiresAt
      };
      if (item.totalCost !== 0 || item.pricedAmount !== 0 || item.lastPurchasePrice !== null) {
        base.totalCost = item.totalCost;
        base.pricedAmount = item.pricedAmount;
        base.lastPurchasePrice = item.lastPurchasePrice;
      }
      return base;
    });

  const updates = working
    .filter(
      (item) =>
        item.origin === 'existing' &&
        (round3(item.amount) !== round3(item.originalAmount) ||
          item.unit !== item.originalUnit ||
          item.expiresAt !== item.originalExpiresAt ||
          item.totalCost !== item.originalTotalCost ||
          item.pricedAmount !== item.originalPricedAmount ||
          item.lastPurchasePrice !== item.originalLastPurchasePrice)
    )
    .map((item) => {
      const patch: Partial<FridgeInput> = {
        name: item.name,
        amount: round3(item.amount),
        unit: item.unit,
        expiresAt: item.expiresAt
      };
      if (
        item.totalCost !== 0 || item.pricedAmount !== 0 || item.lastPurchasePrice !== null
        || item.originalTotalCost !== 0 || item.originalPricedAmount !== 0 || item.originalLastPurchasePrice !== null
      ) {
        patch.totalCost = item.totalCost;
        patch.pricedAmount = item.pricedAmount;
        patch.lastPurchasePrice = item.lastPurchasePrice;
      }
      return { id: item.id, patch };
    });

  const deletes = mode === 'replace' ? current.map((item) => item.id) : [];
  const totalAfter = mode === 'replace'
    ? working.length
    : current.length + inserts.length - deletes.length;

  return { mode, entries, counts, warnings, inserts, updates, deletes, totalAfter };
}
