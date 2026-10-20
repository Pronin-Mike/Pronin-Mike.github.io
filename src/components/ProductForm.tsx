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

export default function ProductForm({
  id,
  value,
  mode,
  nameInputRef,
  dateInputRef,
  onChange,
  onNameChange,
  onDateChange,
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

      {edit ? (
        <div className="min-w-0 sm:col-span-2">
          <Field label="Срок годности" htmlFor={`${id}-expires`} hint="Можно оставить пустым — срок не отслеживается.">
            <Input id={`${id}-expires`} ref={dateInputRef} type="date" value={value.expiresAt} onChange={(event) => onDateChange(event.target.value)} />
          </Field>
          <div className="mt-4">
            <Field label="Стоимость остатка, ₽" htmlFor={`${id}-cost`} hint="Пустое поле сохраняет текущую оценку">
              <Input id={`${id}-cost`} value={value.cost} inputMode="decimal" placeholder="Необязательно" autoComplete="off" onChange={(event) => onChange({ ...value, cost: event.target.value })} />
            </Field>
          </div>
        </div>
      ) : (
        <details className="group sm:col-span-2">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between rounded-xl border border-cream-300 bg-white px-3 text-sm font-bold text-ink transition-colors hover:bg-cream-100">
            Срок годности и стоимость
            <span aria-hidden="true" className="text-lg leading-none text-ink-muted transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="mt-3 grid gap-4 rounded-xl border border-cream-300 bg-cream-100 p-3 sm:grid-cols-2">
            <Field label="Срок годности" htmlFor={`${id}-expires`} hint="Можно оставить пустым — срок не отслеживается.">
              <Input id={`${id}-expires`} ref={dateInputRef} type="date" value={value.expiresAt} onChange={(event) => onDateChange(event.target.value)} />
            </Field>
            <Field label="Общая стоимость покупки, ₽" htmlFor={`${id}-cost`} hint="Стоимость всего указанного количества">
              <Input id={`${id}-cost`} value={value.cost} inputMode="decimal" placeholder="Необязательно" autoComplete="off" onChange={(event) => onChange({ ...value, cost: event.target.value })} />
            </Field>
          </div>
        </details>
      )}
    </form>
  );
}
