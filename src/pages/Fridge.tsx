import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Eraser, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonRows } from '../components/Loading';
import { useToast } from '../components/Toast';
import { Button, Card, cn, Field, Input, Select } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { normalizeName, round3 } from '../lib/availability';
import { formatAmount, productWord } from '../lib/format';
import { validateFridgeInput } from '../lib/validation';
import type { FridgeInput, FridgeItem, Unit } from '../lib/types';

/* ============================================================================
 * Fridge.tsx — продукты: быстрое добавление, правка, удаление, поиск.
 * При дубликате (название + единица) предлагаем «Заменить / Сложить / Отмена».
 * ========================================================================== */

interface FormState {
  name: string;
  amount: string;
  unit: Unit;
}

const EMPTY_FORM: FormState = { name: '', amount: '', unit: 'г' };

export default function Fridge() {
  const { fridge, loading, error, reload, reloadFridge } = useCookbook();
  const toast = useToast();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<{ existing: FridgeItem; input: FridgeInput } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FridgeItem | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const visible = useMemo(() => {
    const needle = normalizeName(search);
    const list = needle ? fridge.filter((item) => normalizeName(item.name).includes(needle)) : fridge;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [fridge, search]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const input: FridgeInput = {
      name: form.name,
      amount: Number(form.amount.replace(',', '.')),
      unit: form.unit
    };

    const validation = validateFridgeInput(input);
    if (!validation.ok) {
      toast.show(validation.errors[0], 'error');
      return;
    }

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

  const resolveDuplicate = async (value: string | null) => {
    const pending = duplicate;
    setDuplicate(null);
    if (!pending || !value || value === 'cancel') return;

    if (value === 'replace') {
      await run(
        () => api.updateFridgeItem(pending.existing.id, { amount: pending.input.amount }),
        `Количество «${pending.existing.name}» заменено.`
      );
      return;
    }

    await run(
      () =>
        api.updateFridgeItem(pending.existing.id, {
          amount: round3(pending.existing.amount + pending.input.amount)
        }),
      `К «${pending.existing.name}» добавлено ${formatAmount(pending.input.amount)} ${pending.input.unit}.`
    );
  };

  const startEdit = (item: FridgeItem) => {
    setEditingId(item.id);
    setForm({ name: item.name, amount: String(item.amount), unit: item.unit });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

        <form className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end" onSubmit={(event) => void handleSubmit(event)}>
          <Field label="Название" htmlFor="fridge-name">
            <Input
              id="fridge-name"
              value={form.name}
              placeholder="мука"
              autoComplete="off"
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
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

          <div className="flex gap-2">
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
                'flex items-center gap-3 rounded-2xl border border-cream-300 bg-white px-4 py-3 shadow-soft',
                editingId === item.id && 'border-terra-400 ring-4 ring-terra-100'
              )}
            >
              <span className="min-w-0 flex-1 break-words font-semibold text-ink">{item.name}</span>
              <span className="shrink-0 rounded-full bg-terra-50 px-3 py-1 text-sm font-bold tabular-nums text-terra-700">
                {formatAmount(item.amount)} {item.unit}
              </span>
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
              ? 'Продукта с таким названием нет.'
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
              `Новое значение: ${formatAmount(duplicate.input.amount)} ${duplicate.input.unit}.`
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
