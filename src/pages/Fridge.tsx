import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Eraser, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import ShelfLifeBadge from '../components/ShelfLifeBadge';
import { SkeletonRows } from '../components/Loading';
import { useToast } from '../components/Toast';
import { Button, Card, cn, Field, Input, Select } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { normalizeName, round3 } from '../lib/availability';
import { formatAmount, productWord } from '../lib/format';
import { ETERNAL_PRODUCTS, defaultExpiresAt, getExpiryStatus } from '../lib/shelfLife';
import { validateFridgeInput } from '../lib/validation';
import type { ExpiryStatus } from '../lib/shelfLife';
import type { FridgeInput, FridgeItem, Unit } from '../lib/types';

/* ============================================================================
 * Fridge.tsx — продукты: быстрое добавление, правка, удаление, поиск,
 * сортировка и фильтр по сроку годности.
 * При дубликате (название + единица) предлагаем «Заменить / Сложить / Отмена».
 * ========================================================================== */

interface FormState {
  name: string;
  amount: string;
  unit: Unit;
  expiresAt: string;
}

const EMPTY_FORM: FormState = { name: '', amount: '', unit: 'г', expiresAt: '' };

type SortMode = 'name' | 'expiry';

/** Быстрые чипы «+Nд» рядом с полем срока годности. */
const QUICK_DAYS = [1, 3, 7, 14, 30];

/** Порядок групп при сортировке по сроку: просроченное — вверху. */
const STATUS_ORDER: Record<ExpiryStatus, number> = {
  expired: 0,
  soon: 1,
  today: 2,
  ok: 3,
  none: 4
};

/** Дата today + N дней в формате YYYY-MM-DD (по календарным суткам UTC). */
function datePlusDays(days: number): string {
  const today = new Date();
  const stamp = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(stamp + days * 86_400_000).toISOString().slice(0, 10);
}

/** Продукт «вечный» — срок годности ему автоматически не ставим. */
function isEternal(name: string): boolean {
  const normalized = normalizeName(name);
  return ETERNAL_PRODUCTS.some(
    (product) => normalized === product || normalized.startsWith(`${product} `)
  );
}

export default function Fridge() {
  const { fridge, loading, error, reload, reloadFridge } = useCookbook();
  const toast = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [duplicate, setDuplicate] = useState<{ existing: FridgeItem; input: FridgeInput } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FridgeItem | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [pastDateOpen, setPastDateOpen] = useState(false);

  /** Пользователь правил дату руками — автоподстановка больше не срабатывает. */
  const dateTouched = useRef(false);
  const [dateInput, setDateInput] = useState<HTMLInputElement | null>(null);

  // ?sort=expiry — переход из блока «Скоро истекает».
  const sort: SortMode = searchParams.get('sort') === 'expiry' ? 'expiry' : 'name';
  const setSort = (next: SortMode) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'expiry') params.set('sort', 'expiry');
    else params.delete('sort');
    setSearchParams(params, { replace: true });
  };

  const visible = useMemo(() => {
    const needle = normalizeName(search);
    let list = needle ? fridge.filter((item) => normalizeName(item.name).includes(needle)) : fridge;

    if (onlyExpiring) {
      list = list.filter((item) => {
        const status = getExpiryStatus(item.expiresAt);
        return status === 'soon' || status === 'today' || status === 'expired';
      });
    }

    const sorted = [...list];
    if (sort === 'expiry') {
      sorted.sort((a, b) => {
        const diff = STATUS_ORDER[getExpiryStatus(a.expiresAt)] - STATUS_ORDER[getExpiryStatus(b.expiresAt)];
        if (diff !== 0) return diff;
        if (a.expiresAt !== b.expiresAt) {
          if (!a.expiresAt) return 1;
          if (!b.expiresAt) return -1;
          return a.expiresAt.localeCompare(b.expiresAt);
        }
        return a.name.localeCompare(b.name, 'ru');
      });
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }
    return sorted;
  }, [fridge, search, onlyExpiring, sort]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    dateTouched.current = false;
  };

  /** Общая обёртка: busy, тост, обновление списка. */
  const run = async (task: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await task();
      toast.show(successMessage, 'success');
      resetForm();
      await reloadFridge();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось выполнить операцию', 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Ввод названия: подставляем типовой срок, пока дату не тронули руками. */
  const handleNameChange = (name: string) => {
    setForm((prev) => {
      if (dateTouched.current || prev.expiresAt) return { ...prev, name };
      const suggested = isEternal(name) ? null : defaultExpiresAt(name);
      return { ...prev, name, expiresAt: suggested ?? '' };
    });
  };

  const handleDateChange = (value: string) => {
    dateTouched.current = value.length > 0;
    setForm((prev) => ({ ...prev, expiresAt: value }));
  };

  const applyQuickDate = (days: number) => {
    dateTouched.current = true;
    setForm((prev) => ({ ...prev, expiresAt: datePlusDays(days) }));
  };

  const buildInput = (): FridgeInput => ({
    name: form.name,
    amount: Number(form.amount.replace(',', '.')),
    unit: form.unit,
    expiresAt: form.expiresAt || null
  });

  const save = async (input: FridgeInput) => {
    if (editingId) {
      await run(() => api.updateFridgeItem(editingId, input), `«${input.name.trim()}» обновлено.`);
      return;
    }

    const clash = fridge.find(
      (item) => item.unit === input.unit && normalizeName(item.name) === normalizeName(input.name)
    );

    if (clash) {
      setDuplicate({ existing: clash, input });
      return;
    }

    await run(
      () => api.addFridgeItem(input),
      `«${input.name.trim()}» — ${formatAmount(input.amount)} ${input.unit} в холодильнике.`
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const input = buildInput();
    const validation = validateFridgeInput(input);
    if (!validation.ok) {
      toast.show(validation.errors[0], 'error');
      return;
    }

    // Дата в прошлом — переспрашиваем, но сохранить даём.
    if (input.expiresAt && getExpiryStatus(input.expiresAt) === 'expired') {
      setPastDateOpen(true);
      return;
    }

    await save(input);
  };

  const resolveDuplicate = async (value: string | null) => {
    const pending = duplicate;
    setDuplicate(null);
    if (!pending || !value || value === 'cancel') return;

    if (value === 'replace') {
      await run(
        () => api.updateFridgeItem(pending.existing.id, { amount: pending.input.amount, expiresAt: pending.input.expiresAt }),
        `Количество «${pending.existing.name}» заменено.`
      );
      return;
    }

    // «Сложить»: количества суммируем, срок — минимальный из двух.
    const dates = [pending.existing.expiresAt, pending.input.expiresAt ?? null].filter(
      (value): value is string => Boolean(value)
    );
    const mergedExpiresAt = dates.length ? dates.sort()[0] : null;

    await run(
      () =>
        api.updateFridgeItem(pending.existing.id, {
          amount: round3(pending.existing.amount + pending.input.amount),
          expiresAt: mergedExpiresAt
        }),
      `К «${pending.existing.name}» добавлено ${formatAmount(pending.input.amount)} ${pending.input.unit}.`
    );
  };

  const startEdit = (item: FridgeItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      amount: String(item.amount),
      unit: item.unit,
      expiresAt: item.expiresAt ?? ''
    });
    // Дату уже показали из базы — автоподстановка не должна её перебивать.
    dateTouched.current = Boolean(item.expiresAt);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const expiringCount = useMemo(
    () =>
      fridge.filter((item) => {
        const status = getExpiryStatus(item.expiresAt);
        return status === 'soon' || status === 'today' || status === 'expired';
      }).length,
    [fridge]
  );

  return (
    <div className="flex flex-col gap-4 animate-rise-in">
      <header>
        <h1 className="font-display text-3xl text-ink">Холодильник</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {loading ? 'Загружаем…' : `${productWord(fridge.length)} · сравнение по названию и единице измерения`}
        </p>
      </header>

      <Card className="flex flex-col gap-3">
        <h2 className="font-display text-lg text-ink">
          {editingId ? 'Изменить продукт' : 'Добавить продукт'}
        </h2>

        <form className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={(event) => void handleSubmit(event)}>
          <Field label="Название" htmlFor="fridge-name">
            <Input
              id="fridge-name"
              value={form.name}
              placeholder="мука"
              autoComplete="off"
              onChange={(event) => handleNameChange(event.target.value)}
            />
          </Field>

          <Field label="Количество" htmlFor="fridge-amount">
            <Input
              id="fridge-amount"
              value={form.amount}
              inputMode="decimal"
              placeholder="1000"
              autoComplete="off"
              onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
            />
          </Field>

          <Field label="Единица" htmlFor="fridge-unit">
            <Select
              id="fridge-unit"
              value={form.unit}
              onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value as Unit }))}
            >
              <option value="г">г</option>
              <option value="мл">мл</option>
              <option value="шт">шт</option>
            </Select>
          </Field>

          <div className="flex gap-2 sm:pb-6">
            <Button type="submit" disabled={busy} className="flex-1 sm:flex-none">
              <Plus className="size-4" aria-hidden="true" />
              {editingId ? 'Сохранить' : 'Добавить'}
            </Button>
            {editingId ? (
              <Button variant="ghost" onClick={resetForm} disabled={busy}>
                Отмена
              </Button>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:col-span-4">
            <Field label="Срок годности" htmlFor="fridge-expires" hint="Можно оставить пустым — тогда срок не отслеживается.">
              <Input
                id="fridge-expires"
                ref={setDateInput}
                type="date"
                value={form.expiresAt}
                onChange={(event) => handleDateChange(event.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              {QUICK_DAYS.map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={busy}
                  onClick={() => applyQuickDate(days)}
                  className="min-h-9 rounded-full border border-cream-300 bg-white px-3 text-sm font-semibold text-ink-soft transition hover:bg-cream-100"
                >
                  +{days}д
                </button>
              ))}
              {form.expiresAt ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDateChange('')}
                  className="min-h-9 rounded-full border border-cream-300 bg-white px-3 text-sm font-semibold text-ink-muted transition hover:bg-cream-100"
                >
                  Убрать срок
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          />
          <Input
            value={search}
            className="pl-9"
            placeholder="Найти продукт"
            aria-label="Найти продукт"
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-cream-100 text-ink-muted"
              aria-label="Очистить поиск"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-cream-300 bg-white p-1 shadow-soft"
            role="group"
            aria-label="Сортировка продуктов"
          >
            <button
              type="button"
              onClick={() => setSort('name')}
              aria-pressed={sort === 'name'}
              className={cn(
                'min-h-9 rounded-full px-3 text-sm font-semibold transition',
                sort === 'name' ? 'bg-terra-500 text-white' : 'text-ink-soft hover:bg-cream-100'
              )}
            >
              По названию
            </button>
            <button
              type="button"
              onClick={() => setSort('expiry')}
              aria-pressed={sort === 'expiry'}
              className={cn(
                'min-h-9 rounded-full px-3 text-sm font-semibold transition',
                sort === 'expiry' ? 'bg-terra-500 text-white' : 'text-ink-soft hover:bg-cream-100'
              )}
            >
              По сроку
            </button>
          </div>

          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-cream-300 bg-white px-4 shadow-soft">
            <input
              type="checkbox"
              className="size-4 accent-honey-500"
              checked={onlyExpiring}
              onChange={(event) => setOnlyExpiring(event.target.checked)}
            />
            <span className="text-sm font-semibold text-ink-soft">
              Только истекающие{expiringCount ? ` (${expiringCount})` : ''}
            </span>
          </label>

          <Button
            variant="ghost"
            className="text-berry-500"
            disabled={busy || !fridge.length}
            onClick={() => setClearOpen(true)}
          >
            <Eraser className="size-4" aria-hidden="true" />
            Очистить холодильник
          </Button>
        </div>
      </div>

      {error && !loading ? (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-sm text-berry-700">{error}</p>
          <Button onClick={() => void reload()}>Повторить</Button>
        </Card>
      ) : null}

      {loading ? <SkeletonRows /> : null}

      {!loading && visible.length ? (
        <ul className="flex flex-col gap-2">
          {visible.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-2xl border border-cream-300 bg-white px-4 py-3 shadow-soft',
                editingId === item.id && 'border-terra-400 ring-4 ring-terra-100'
              )}
            >
              <span className="min-w-0 flex-1 break-words font-semibold text-ink">{item.name}</span>
              <span className="shrink-0 rounded-full bg-terra-50 px-3 py-1 text-sm font-bold tabular-nums text-terra-700">
                {formatAmount(item.amount)} {item.unit}
              </span>
              <ShelfLifeBadge expiresAt={item.expiresAt} />
              <span className="flex shrink-0 gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-9 !min-h-9 !px-0"
                  aria-label={`Изменить «${item.name}»`}
                  disabled={busy}
                  onClick={() => startEdit(item)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-9 !min-h-9 !px-0 text-berry-500"
                  aria-label={`Удалить «${item.name}»`}
                  disabled={busy}
                  onClick={() => setDeleteTarget(item)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && !visible.length ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="text-4xl" aria-hidden="true">
            {fridge.length ? '🔍' : '🧊'}
          </span>
          <h2 className="font-display text-xl text-ink">
            {fridge.length ? 'Ничего не найдено' : 'Холодильник пуст'}
          </h2>
          <p className="max-w-md text-sm text-ink-soft">
            {fridge.length
              ? onlyExpiring
                ? 'Среди продуктов нет истекающих и просроченных.'
                : 'Продукта с таким названием нет.'
              : 'Добавьте продукты — название, количество и единицу измерения (г, мл или шт).'}
          </p>
          <Link
            to="/import"
            className="inline-flex min-h-11 items-center rounded-full border border-cream-300 bg-white px-4 font-semibold text-ink-soft"
          >
            Заполнить из CSV
          </Link>
        </Card>
      ) : null}

      <ConfirmDialog
        open={Boolean(duplicate)}
        title="Такой продукт уже есть"
        description={
          duplicate
            ? `«${duplicate.existing.name}» — ${formatAmount(duplicate.existing.amount)} ${duplicate.existing.unit}. ` +
              `Новое значение: ${formatAmount(duplicate.input.amount)} ${duplicate.input.unit}. ` +
              'При сложении останется более ранний срок годности.'
            : ''
        }
        busy={busy}
        actions={[
          { label: 'Заменить', value: 'replace', variant: 'primary' },
          { label: 'Сложить', value: 'add', variant: 'olive' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => void resolveDuplicate(value)}
      />

      <ConfirmDialog
        open={pastDateOpen}
        title="Дата уже прошла"
        description={`Срок годности ${form.expiresAt} уже истёк. Это просроченный продукт?`}
        busy={busy}
        actions={[
          { label: 'Да, сохранить', value: 'save', variant: 'danger' },
          { label: 'Изменить', value: 'fix', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          setPastDateOpen(false);
          if (value === 'save') void save(buildInput());
          else dateInput?.focus();
        }}
      />

      <ConfirmDialog
        open={clearOpen}
        title="Очистить холодильник?"
        description={`Будут удалены все продукты (${productWord(fridge.length)}). Блюда останутся, но станут недоступными.`}
        busy={busy}
        actions={[
          { label: 'Очистить', value: 'clear', variant: 'danger' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          setClearOpen(false);
          if (value === 'clear') void run(() => api.clearFridge(), 'Холодильник очищен.');
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить продукт?"
        description={
          deleteTarget
            ? `«${deleteTarget.name}» пропадёт из холодильника, и блюда с ним станут недоступны.`
            : ''
        }
        busy={busy}
        actions={[
          { label: 'Удалить', value: 'delete', variant: 'danger' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (value === 'delete' && target) {
            void run(() => api.deleteFridgeItem(target.id), `«${target.name}» удалён.`);
          }
        }}
      />
    </div>
  );
}
