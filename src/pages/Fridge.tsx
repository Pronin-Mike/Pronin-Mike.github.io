import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Eraser,
  PackageOpen,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonRows } from '../components/Loading';
import Modal from '../components/Modal';
import ProductForm, { type ProductFormState } from '../components/ProductForm';
import ProductRow from '../components/ProductRow';
import ShelfLifeBadge from '../components/ShelfLifeBadge';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Select, Tabs } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { normalizeName, round3 } from '../lib/availability';
import { formatAmount, productWord } from '../lib/format';
import { formatCost, formatMoney, formatStockUnitCost } from '../lib/pricing';
import { planFridgeNameNormalization } from '../lib/receiptMatcher';
import { ETERNAL_PRODUCTS, defaultExpiresAt, getExpiryStatus, type ExpiryStatus } from '../lib/shelfLife';
import type { FridgeInput, FridgeItem } from '../lib/types';
import { validateFridgeInput } from '../lib/validation';

const EMPTY_FORM: ProductFormState = { name: '', amount: '', unit: 'г', expiresAt: '', cost: '' };
type SortMode = 'name' | 'expiry';
type FilterMode = 'all' | 'attention';
type ProductDialog = 'details' | 'edit' | 'use' | 'waste' | 'delete';

const STATUS_ORDER: Record<ExpiryStatus, number> = {
  expired: 0,
  today: 1,
  soon: 2,
  ok: 3,
  none: 4
};

function datePlusDays(days: number): string {
  const today = new Date();
  const stamp = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(stamp + days * 86_400_000).toISOString().slice(0, 10);
}

function isEternal(name: string): boolean {
  const normalized = normalizeName(name);
  return ETERNAL_PRODUCTS.some((product) => normalized === product || normalized.startsWith(`${product} `));
}

function buildInput(form: ProductFormState): FridgeInput {
  return {
    name: form.name,
    amount: Number(form.amount.replace(',', '.')),
    unit: form.unit,
    expiresAt: form.expiresAt || null,
    purchaseCost: form.cost.trim() === '' ? null : Number(form.cost.replace(',', '.'))
  };
}

function itemCost(item: FridgeItem) {
  const knownCost = item.totalCost ?? 0;
  const pricedAmount = item.pricedAmount ?? 0;
  return {
    knownCost,
    status: pricedAmount >= item.amount ? 'exact' as const : knownCost > 0 ? 'partial' as const : 'unknown' as const
  };
}

export default function Fridge() {
  const { fridge, loading, error, reload, reloadFridge } = useCookbook();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [addForm, setAddForm] = useState<ProductFormState>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<ProductFormState>(EMPTY_FORM);
  const [selected, setSelected] = useState<FridgeItem | null>(null);
  const [dialog, setDialog] = useState<ProductDialog | null>(null);
  const [useAmount, setUseAmount] = useState('');
  const [wasteAmount, setWasteAmount] = useState('');
  const [duplicate, setDuplicate] = useState<{ existing: FridgeItem; input: FridgeInput } | null>(null);
  const [pastDate, setPastDate] = useState<{ mode: 'create' | 'edit'; input: FridgeInput } | null>(null);
  const [normalizeOpen, setNormalizeOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const addDateTouched = useRef(false);
  const editDateTouched = useRef(false);
  const addNameRef = useRef<HTMLInputElement | null>(null);
  const useOperationRef = useRef<{ itemId: string; amount: number; operationId: string } | null>(null);

  const sort: SortMode = searchParams.get('sort') === 'expiry' ? 'expiry' : 'name';
  const filter: FilterMode = searchParams.get('expiring') === '1' ? 'attention' : 'all';

  const setSort = (next: SortMode) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'expiry') params.set('sort', 'expiry');
    else params.delete('sort');
    setSearchParams(params, { replace: true });
  };

  const setFilter = (next: FilterMode) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'attention') {
      params.set('expiring', '1');
      params.set('sort', 'expiry');
    } else {
      params.delete('expiring');
    }
    setSearchParams(params, { replace: true });
  };

  const openAdd = () => setAddOpen(true);

  useEffect(() => {
    if (searchParams.get('add') !== '1') return;
    openAdd();
    const params = new URLSearchParams(searchParams);
    params.delete('add');
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const normalizationGroups = useMemo(() => planFridgeNameNormalization(fridge), [fridge]);
  const normalizationRows = normalizationGroups.reduce((total, group) => total + group.ids.length, 0);
  const visible = useMemo(() => {
    const needle = normalizeName(search);
    let list = needle ? fridge.filter((item) => normalizeName(item.name).includes(needle)) : fridge;
    if (filter === 'attention') {
      list = list.filter((item) => ['soon', 'today', 'expired'].includes(getExpiryStatus(item.expiresAt)));
    }
    return [...list].sort((a, b) => {
      if (sort === 'expiry') {
        const statusDiff = STATUS_ORDER[getExpiryStatus(a.expiresAt)] - STATUS_ORDER[getExpiryStatus(b.expiresAt)];
        if (statusDiff) return statusDiff;
        if (a.expiresAt !== b.expiresAt) {
          if (!a.expiresAt) return 1;
          if (!b.expiresAt) return -1;
          return a.expiresAt.localeCompare(b.expiresAt);
        }
      }
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [filter, fridge, search, sort]);

  const perform = async <T,>(
    task: () => Promise<T>,
    success: string
  ): Promise<{ ok: true; value: T } | { ok: false }> => {
    setBusy(true);
    try {
      const result = await task();
      await reloadFridge();
      toast.show(success, 'success');
      return { ok: true, value: result };
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось выполнить операцию', 'error');
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };

  const suggestName = (
    form: ProductFormState,
    setForm: (value: ProductFormState) => void,
    touched: MutableRefObject<boolean>,
    name: string
  ) => {
    if (touched.current || form.expiresAt) {
      setForm({ ...form, name });
      return;
    }
    setForm({ ...form, name, expiresAt: isEternal(name) ? '' : defaultExpiresAt(name) ?? '' });
  };

  const setDate = (
    form: ProductFormState,
    setForm: (value: ProductFormState) => void,
    touched: MutableRefObject<boolean>,
    value: string
  ) => {
    touched.current = value.length > 0;
    setForm({ ...form, expiresAt: value });
  };

  const quickDate = (
    form: ProductFormState,
    setForm: (value: ProductFormState) => void,
    touched: MutableRefObject<boolean>,
    days: number
  ) => {
    touched.current = true;
    setForm({ ...form, expiresAt: datePlusDays(days) });
  };

  const saveNew = async (input: FridgeInput) => {
    const clash = fridge.find((item) => item.unit === input.unit && normalizeName(item.name) === normalizeName(input.name));
    if (clash) {
      setDuplicate({ existing: clash, input });
      return;
    }
    const result = await perform(
      () => api.addFridgeItem(input),
      `«${input.name.trim()}» — ${formatAmount(input.amount)} ${input.unit} добавлено.`
    );
    if (!result.ok) return;
    setAddForm(EMPTY_FORM);
    addDateTouched.current = false;
    setAddOpen(false);
  };

  const saveEdit = async (input: FridgeInput) => {
    if (!selected) return;
    const result = await perform(() => api.updateFridgeItem(selected.id, input), `«${input.name.trim()}» обновлено.`);
    if (!result.ok) return;
    setSelected(result.value);
    setDialog('details');
  };

  const submitForm = (mode: 'create' | 'edit', event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = buildInput(mode === 'create' ? addForm : editForm);
    const validation = validateFridgeInput(input);
    if (!validation.ok) {
      toast.show(validation.errors[0], 'error');
      return;
    }
    if (input.expiresAt && getExpiryStatus(input.expiresAt) === 'expired') {
      setPastDate({ mode, input });
      return;
    }
    if (mode === 'create') void saveNew(input);
    else void saveEdit(input);
  };

  const resolveDuplicate = async (value: string | null) => {
    const pending = duplicate;
    setDuplicate(null);
    if (!pending || !value || value === 'cancel') return;
    if (value === 'replace') {
      const result = await perform(
        () => api.applyFridgePurchase(pending.existing.id, pending.input, 'replace'),
        `Количество «${pending.existing.name}» заменено.`
      );
      if (result.ok) {
        setAddForm(EMPTY_FORM);
        addDateTouched.current = false;
        setAddOpen(false);
      }
      return;
    }
    const dates = [pending.existing.expiresAt, pending.input.expiresAt ?? null]
      .filter((value): value is string => Boolean(value));
    const expiresAt = dates.length ? dates.sort()[0] : null;
    const result = await perform(
      () => api.applyFridgePurchase(pending.existing.id, { ...pending.input, expiresAt }, 'sum'),
      `К «${pending.existing.name}» добавлено ${formatAmount(pending.input.amount)} ${pending.input.unit}.`
    );
    if (result.ok) {
      setAddForm(EMPTY_FORM);
      addDateTouched.current = false;
      setAddOpen(false);
    }
  };

  const openDetails = (item: FridgeItem) => {
    setSelected(item);
    setDialog('details');
  };

  const openEdit = () => {
    if (!selected) return;
    setEditForm({
      name: selected.name,
      amount: String(selected.amount),
      unit: selected.unit,
      expiresAt: selected.expiresAt ?? '',
      cost: ''
    });
    editDateTouched.current = Boolean(selected.expiresAt);
    setDialog('edit');
  };

  const openUse = (item: FridgeItem) => {
    setSelected(item);
    setUseAmount('');
    useOperationRef.current = null;
    setDialog('use');
  };

  const openWaste = (item: FridgeItem) => {
    setSelected(item);
    setWasteAmount(String(item.amount));
    setDialog('waste');
  };

  const parsedWaste = Number(wasteAmount.replace(',', '.'));
  const wasteValid = Boolean(selected) && Number.isFinite(parsedWaste) && parsedWaste > 0 && parsedWaste <= (selected?.amount ?? 0);
  const wasteRemainder = wasteValid && selected ? selected.amount - parsedWaste : null;

  const confirmWaste = async () => {
    if (!selected || !wasteValid) {
      toast.show(`Количество должно быть больше нуля и не превышать ${formatAmount(selected?.amount ?? 0)}.`, 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await api.wasteProduct(selected.id, parsedWaste);
      await reloadFridge();
      toast.show(
        `«${selected.name}» выброшено. Потери: ${result.costComplete ? '' : '~'}${formatMoney(result.cost)}.`,
        'success'
      );
      setDialog(null);
      setSelected(null);
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось выбросить продукт', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!selected) return;
    const result = await perform(() => api.deleteFridgeItem(selected.id), `«${selected.name}» удалено.`);
    if (!result.ok) return;
    setDialog(null);
    setSelected(null);
  };

  const rawUseAmount = Number(useAmount.replace(',', '.'));
  const parsedUse = Number.isFinite(rawUseAmount) ? round3(rawUseAmount) : Number.NaN;
  const useValid = Boolean(selected) && Number.isFinite(parsedUse) && parsedUse > 0 && parsedUse <= (selected?.amount ?? 0);
  const useRemainder = useValid && selected ? selected.amount - parsedUse : null;

  const confirmUse = async () => {
    if (!selected || !useValid) {
      toast.show(`Количество должно быть больше нуля и не превышать ${formatAmount(selected?.amount ?? 0)}.`, 'error');
      return;
    }
    const previous = useOperationRef.current;
    const operationId = previous?.itemId === selected.id && previous.amount === parsedUse
      ? previous.operationId
      : crypto.randomUUID();
    useOperationRef.current = { itemId: selected.id, amount: parsedUse, operationId };

    setBusy(true);
    try {
      const result = await api.consumeProduct(selected.id, parsedUse, operationId);
      await reloadFridge();
      toast.show(
        `Использовано ${formatAmount(result.amount)} ${selected.unit} «${selected.name}». Стоимость: ${result.costComplete ? '' : '~'}${formatMoney(result.cost)}.`,
        'success'
      );
      useOperationRef.current = null;
      setDialog(null);
      setSelected(null);
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось использовать продукт', 'error');
    } finally {
      setBusy(false);
    }
  };

  const dialogTitle = dialog === 'edit'
    ? 'Редактировать продукт'
    : dialog === 'use'
      ? 'Использовать продукт'
      : dialog === 'waste'
        ? 'Выбросить продукт'
        : dialog === 'delete'
          ? 'Удалить продукт?'
          : selected?.name ?? 'Продукт';

  return (
    <div className="flex flex-col gap-5 animate-rise-in">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Мои продукты</h1>
          <p className="mt-1 text-sm text-ink-soft">{loading ? 'Загружаем…' : `${productWord(fridge.length)} в холодильнике`}</p>
        </div>
        <Button onClick={openAdd} className="shrink-0">
          <Plus className="size-4" aria-hidden="true" />
          Добавить продукт
        </Button>
      </header>

      <section aria-label="Сводка запасов" className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card className="flex min-h-[105px] min-w-0 flex-col justify-between p-3 shadow-none sm:min-h-[117px] sm:p-5">
          <span className="block truncate text-xs font-semibold text-ink-muted">Продукты</span>
          <strong className="mt-[13px] block text-[35px] font-extrabold leading-[1.12] tracking-[-2px] tabular-nums text-ink min-[366px]:text-[40px] sm:text-[48px]">{loading ? '—' : fridge.length}</strong>
        </Card>
        <Card className="flex min-h-[105px] min-w-0 flex-col justify-between p-3 shadow-none sm:min-h-[117px] sm:p-5">
          <span className="block text-xs font-semibold leading-tight text-ink-muted">Истекают</span>
          <strong className="mt-[13px] block text-[35px] font-extrabold leading-[1.12] tracking-[-2px] tabular-nums text-ink min-[366px]:text-[40px] sm:text-[48px]">{loading ? '—' : fridge.filter((item) => ['soon', 'today'].includes(getExpiryStatus(item.expiresAt))).length}</strong>
        </Card>
        <Card className="flex min-h-[105px] min-w-0 flex-col justify-between p-3 shadow-none sm:min-h-[117px] sm:p-5">
          <span className="block truncate text-xs font-semibold text-ink-muted">Просрочено</span>
          <strong className="mt-[13px] block text-[35px] font-extrabold leading-[1.12] tracking-[-2px] tabular-nums text-ink min-[366px]:text-[40px] sm:text-[48px]">{loading ? '—' : fridge.filter((item) => getExpiryStatus(item.expiresAt) === 'expired').length}</strong>
        </Card>
      </section>

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:flex-nowrap">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <div className="relative">
            <Input
              value={search}
              className="pr-11"
              placeholder="Поиск продукта"
              aria-label="Найти продукт"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search ? (
              <IconButton
                label="Очистить поиск"
                onClick={() => setSearch('')}
                className="absolute right-0 top-1/2 -translate-y-1/2 border-0 bg-transparent shadow-none"
              >
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        </div>
        <Tabs
          label="Фильтр продуктов"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'Все' },
            { value: 'attention', label: 'Требуют внимания' }
          ]}
        />
        <div className="flex min-w-0 shrink-0 gap-2">
          <Select className="min-w-0 max-w-44" value={sort} aria-label="Сортировка продуктов" onChange={(event) => setSort(event.target.value as SortMode)}>
            <option value="name">По названию</option>
            <option value="expiry">По сроку</option>
          </Select>
          <IconButton label="Действия со списком" onClick={() => setToolsOpen(true)}>
            <SlidersHorizontal className="size-5" aria-hidden="true" />
          </IconButton>
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
        <ul className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-soft">
          {visible.map((item) => (
            <ProductRow
              key={item.id}
              item={item}
              busy={busy}
              onOpen={openDetails}
              onUse={openUse}
              onWaste={openWaste}
            />
          ))}
        </ul>
      ) : null}

      {!loading && !visible.length ? (
        <EmptyState
          icon={<PackageOpen className="size-9" />}
          title={fridge.length ? 'Ничего не найдено' : 'Холодильник пуст'}
          description={fridge.length
            ? filter === 'attention' ? 'Сейчас ни один продукт не требует внимания.' : 'Попробуйте изменить поиск.'
            : 'Добавьте первый продукт вручную или загрузите CSV.'}
          action={fridge.length ? (
            <Button variant="ghost" onClick={() => { setSearch(''); setFilter('all'); }}>Сбросить фильтры</Button>
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={openAdd}>Добавить продукт</Button>
              <Link to="/import" className="inline-flex min-h-11 items-center rounded-[10px] border border-cream-300 bg-white px-4 font-semibold text-ink-soft">
                Загрузить CSV
              </Link>
            </div>
          )}
        />
      ) : null}

      <Modal
        open={addOpen}
        title="Добавить продукт"
        size="add"
        onClose={() => setAddOpen(false)}
        initialFocusRef={addNameRef}
        footer={(
          <Button type="submit" form="product-add-modal" disabled={busy} className="w-full">Добавить продукт</Button>
        )}
      >
        <ProductForm
          id="product-add-modal"
          value={addForm}
          mode="create"
          busy={busy}
          nameInputRef={addNameRef}
          onChange={setAddForm}
          onNameChange={(name) => suggestName(addForm, setAddForm, addDateTouched, name)}
          onDateChange={(date) => setDate(addForm, setAddForm, addDateTouched, date)}
          onQuickDate={(days) => quickDate(addForm, setAddForm, addDateTouched, days)}
          onSubmit={(event) => submitForm('create', event)}
        />
      </Modal>

      <Modal
        open={Boolean(dialog && selected)}
        title={dialogTitle}
        size="sm"
        onClose={() => { setDialog(null); setSelected(null); }}
        onBack={dialog && dialog !== 'details' ? () => setDialog('details') : undefined}
        footer={dialog === 'edit' ? (
          <>
            <Button type="submit" form="product-edit" disabled={busy} className="flex-1">Сохранить изменения</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setDialog('details')}>Отмена</Button>
          </>
        ) : dialog === 'waste' ? (
          <>
            <Button variant="danger" disabled={busy || !wasteValid} onClick={() => void confirmWaste()} className="flex-1">Выбросить</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setDialog('details')}>Отмена</Button>
          </>
        ) : dialog === 'delete' ? (
          <>
            <Button variant="danger" disabled={busy} onClick={() => void confirmDelete()} className="flex-1">Удалить запись</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setDialog('details')}>Отмена</Button>
          </>
        ) : dialog === 'use' ? (
          <>
            <Button disabled={busy || !useValid} onClick={() => void confirmUse()} className="flex-1">Подтвердить использование</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setDialog('details')}>Отмена</Button>
          </>
        ) : undefined}
      >
        {selected && dialog === 'details' ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-cream-300 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-display text-xl font-extrabold text-ink">{selected.name}</p>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink">{formatAmount(selected.amount)} {selected.unit}</p>
                </div>
                <ShelfLifeBadge expiresAt={selected.expiresAt} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-cream-300 pt-4 text-sm">
                <div><dt className="text-ink-muted">Срок годности</dt><dd className="mt-1 font-bold text-ink">{selected.expiresAt ?? 'Не указан'}</dd></div>
                <div><dt className="text-ink-muted">Стоимость остатка</dt><dd className="mt-1 font-bold text-ink">{formatCost(itemCost(selected))}</dd></div>
                <div className="col-span-2"><dt className="text-ink-muted">Средняя стоимость</dt><dd className="mt-1 font-bold text-ink">{formatStockUnitCost(selected)}</dd></div>
              </dl>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                disabled={getExpiryStatus(selected.expiresAt) === 'expired'}
                onClick={() => openUse(selected)}
              >Использовать</Button>
              <Button variant="ghost" onClick={openEdit}><Pencil className="size-4" aria-hidden="true" />Редактировать</Button>
              <Button variant="ghost" className="text-honey-700" onClick={() => openWaste(selected)}>Выбросить</Button>
              <Button variant="ghost" className="text-berry-500" onClick={() => setDialog('delete')}><Trash2 className="size-4" aria-hidden="true" />Удалить запись</Button>
            </div>
          </div>
        ) : null}

        {selected && dialog === 'edit' ? (
          <ProductForm
            id="product-edit"
            value={editForm}
            mode="edit"
            busy={busy}
            onChange={setEditForm}
            onNameChange={(name) => suggestName(editForm, setEditForm, editDateTouched, name)}
            onDateChange={(date) => setDate(editForm, setEditForm, editDateTouched, date)}
            onQuickDate={(days) => quickDate(editForm, setEditForm, editDateTouched, days)}
            onSubmit={(event) => submitForm('edit', event)}
          />
        ) : null}

        {selected && dialog === 'use' ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl bg-cream-200 p-3 text-sm text-ink-soft">
              Текущий остаток: <strong className="text-ink">{formatAmount(selected.amount)} {selected.unit}</strong>
            </div>
            <Field label={`Количество, ${selected.unit}`} htmlFor="use-amount">
              <Input id="use-amount" inputMode="decimal" value={useAmount} onChange={(event) => setUseAmount(event.target.value)} />
            </Field>
            <p className="text-sm text-ink-soft">
              Останется: <strong className="text-ink">{useRemainder === null ? '—' : `${formatAmount(useRemainder)} ${selected.unit}`}</strong>
            </p>
            {!useValid && useAmount ? <p className="text-sm font-semibold text-berry-700">Введите количество больше нуля и не больше текущего остатка.</p> : null}
          </div>
        ) : null}

        {selected && dialog === 'waste' ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl bg-cream-200 p-3 text-sm text-ink-soft">
              Текущий остаток: <strong className="text-ink">{formatAmount(selected.amount)} {selected.unit}</strong>
            </div>
            <Field label={`Количество, ${selected.unit}`} htmlFor="waste-amount">
              <Input id="waste-amount" inputMode="decimal" value={wasteAmount} onChange={(event) => setWasteAmount(event.target.value)} />
            </Field>
            <p className="text-sm text-ink-soft">
              После выбрасывания останется: <strong className="text-ink">{wasteRemainder === null ? '—' : `${formatAmount(wasteRemainder)} ${selected.unit}`}</strong>
            </p>
            {!wasteValid ? <p className="text-sm font-semibold text-berry-700">Количество должно быть больше нуля и не превышать остаток.</p> : null}
          </div>
        ) : null}

        {selected && dialog === 'delete' ? (
          <div className="flex flex-col gap-3">
            <Badge tone="error" className="self-start">Опасное действие</Badge>
            <p className="text-[15px] leading-relaxed text-ink-soft">
              Запись «{selected.name}» будет удалена из холодильника. Это административное удаление, а не использование или выбрасывание продукта.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal open={toolsOpen} title="Действия со списком" size="sm" onClose={() => setToolsOpen(false)}>
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            disabled={busy || !normalizationGroups.length}
            onClick={() => { setToolsOpen(false); setNormalizeOpen(true); }}
            className="justify-start"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Объединить названия{normalizationGroups.length ? ` (${normalizationGroups.length})` : ''}
          </Button>
          <Button
            variant="ghost"
            className="justify-start text-berry-500"
            disabled={busy || !fridge.length}
            onClick={() => { setToolsOpen(false); setClearOpen(true); }}
          >
            <Eraser className="size-4" aria-hidden="true" />
            Очистить холодильник
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(duplicate)}
        title="Такой продукт уже есть"
        description={duplicate
          ? `«${duplicate.existing.name}» — ${formatAmount(duplicate.existing.amount)} ${duplicate.existing.unit}. Новое значение: ${formatAmount(duplicate.input.amount)} ${duplicate.input.unit}. При сложении останется более ранний срок годности.`
          : ''}
        busy={busy}
        actions={[
          { label: 'Заменить', value: 'replace', variant: 'primary' },
          { label: 'Сложить', value: 'add', variant: 'olive' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => void resolveDuplicate(value)}
      />

      <ConfirmDialog
        open={Boolean(pastDate)}
        title="Дата уже прошла"
        description={pastDate ? `Срок годности ${pastDate.input.expiresAt} уже истёк. Сохранить просроченный продукт?` : ''}
        busy={busy}
        actions={[
          { label: 'Да, сохранить', value: 'save', variant: 'danger' },
          { label: 'Изменить', value: 'fix', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          const pending = pastDate;
          setPastDate(null);
          if (value === 'save' && pending) {
            if (pending.mode === 'create') void saveNew(pending.input);
            else void saveEdit(pending.input);
          }
        }}
      />

      <ConfirmDialog
        open={normalizeOpen}
        title="Объединить магазинные названия?"
        description={`Будет обработано ${normalizationRows} позиций: магазинные названия заменятся общей категорией, а остатки сложатся.`}
        busy={busy}
        actions={[
          { label: 'Объединить', value: 'normalize', variant: 'primary' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          setNormalizeOpen(false);
          if (value === 'normalize') void perform(() => api.normalizeFridgeNames(normalizationGroups), 'Магазинные названия объединены.');
        }}
      />

      <ConfirmDialog
        open={clearOpen}
        title="Очистить холодильник?"
        description={`Будут удалены все продукты (${productWord(fridge.length)}). Рецепты останутся, но станут недоступны.`}
        busy={busy}
        actions={[
          { label: 'Очистить', value: 'clear', variant: 'danger' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          setClearOpen(false);
          if (value === 'clear') void perform(() => api.clearFridge(), 'Холодильник очищен.');
        }}
      />
    </div>
  );
}
