import type { FormEvent, Ref } from 'react';
import type { Unit } from '../lib/types';
import { Field, Input, Select } from './ui';

export interface ProductFormState {
  name: string;
  amount: string;
  unit: Unit;
  expiresAt: string;
  cost: string;
}

export interface ProductFormProps {
  id: string;
  value: ProductFormState;
  mode: 'create' | 'edit';
  busy?: boolean;
  nameInputRef?: Ref<HTMLInputElement>;
  dateInputRef?: Ref<HTMLInputElement>;
  onChange: (next: ProductFormState) => void;
  onNameChange: (name: string) => void;
  onDateChange: (date: string) => void;
  onQuickDate: (days: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const QUICK_DAYS = [1, 3, 7, 14, 30];

export default function ProductForm({
  id,
  value,
  mode,
  busy = false,
  nameInputRef,
  dateInputRef,
  onChange,
  onNameChange,
  onDateChange,
  onQuickDate,
  onSubmit
}: ProductFormProps) {
  const edit = mode === 'edit';

  return (
    <form
      id={id}
      className="grid min-w-0 gap-4 sm:grid-cols-2"
      onSubmit={onSubmit}
    >
      <div className="min-w-0 sm:col-span-2">
        <Field label="Название продукта" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            ref={nameInputRef}
            value={value.name}
            placeholder="Например, молоко"
            autoComplete="off"
            onChange={(event) => onNameChange(event.target.value)}
          />
        </Field>
      </div>

      <Field label="Количество" htmlFor={`${id}-amount`}>
        <Input
          id={`${id}-amount`}
          value={value.amount}
          inputMode="decimal"
          placeholder="1000"
          autoComplete="off"
          onChange={(event) => onChange({ ...value, amount: event.target.value })}
        />
      </Field>

      <Field label="Единица" htmlFor={`${id}-unit`}>
        <Select
          id={`${id}-unit`}
          value={value.unit}
          onChange={(event) => onChange({ ...value, unit: event.target.value as Unit })}
        >
          <option value="г">г</option>
          <option value="мл">мл</option>
          <option value="шт">шт</option>
        </Select>
      </Field>

      <div className="min-w-0">
        <Field label="Срок годности" htmlFor={`${id}-expires`} hint="Можно оставить пустым — срок не отслеживается.">
          <Input
            id={`${id}-expires`}
            ref={dateInputRef}
            type="date"
            value={value.expiresAt}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </Field>
      </div>

      <div className="min-w-0">
        <Field
          label={edit ? 'Стоимость остатка, ₽' : 'Общая стоимость покупки, ₽'}
          htmlFor={`${id}-cost`}
          hint={edit ? 'Пустое поле сохраняет текущую оценку' : 'Стоимость всего указанного количества'}
        >
          <Input
            id={`${id}-cost`}
            value={value.cost}
            inputMode="decimal"
            placeholder="Необязательно"
            autoComplete="off"
            onChange={(event) => onChange({ ...value, cost: event.target.value })}
          />
        </Field>
      </div>

      <div className="scrollbar-hide flex max-w-full gap-2 overflow-x-auto pb-1 sm:col-span-2">
          {QUICK_DAYS.map((days) => (
            <button
              key={days}
              type="button"
              disabled={busy}
              onClick={() => onQuickDate(days)}
              className="min-h-11 shrink-0 rounded-[10px] border border-cream-300 bg-white px-3 text-sm font-semibold text-ink-soft transition-colors hover:bg-cream-100"
            >
              +{days}д
            </button>
          ))}
          {value.expiresAt ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDateChange('')}
              className="min-h-11 shrink-0 rounded-[10px] border border-cream-300 bg-white px-3 text-sm font-semibold text-ink-muted transition-colors hover:bg-cream-100"
            >
              Убрать срок
            </button>
          ) : null}
      </div>
    </form>
  );
}
