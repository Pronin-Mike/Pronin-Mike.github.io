import { Trash2 } from 'lucide-react';
import type { DishIngredient, MissingIngredient } from '../lib/types';
import { UNITS } from '../lib/types';
import { formatAmount } from '../lib/format';
import type { IngredientSuggestion } from '../lib/suggestions';
import IngredientNameInput from './IngredientNameInput';
import ShelfLifeBadge from './ShelfLifeBadge';
import { Button, Input, Select, cn } from './ui';

/* ============================================================================
 * IngredientRow.tsx — строка ингредиента: редактируемая и для просмотра.
 * ========================================================================== */

export interface IngredientEditorRowProps {
  ingredient: DishIngredient;
  index: number;
  disabled?: boolean;
  /** Подсказки из холодильника для поля названия. */
  suggestions?: IngredientSuggestion[];
  onChange: (index: number, patch: Partial<DishIngredient>) => void;
  onRemove: (index: number) => void;
  onPick?: (index: number, suggestion: IngredientSuggestion) => void;
}

export function IngredientEditorRow({
  ingredient,
  index,
  disabled,
  suggestions = [],
  onChange,
  onRemove,
  onPick
}: IngredientEditorRowProps) {
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-xl border border-cream-300 bg-white p-2.5 md:grid-cols-[1.6fr_0.7fr_0.7fr_auto]">
      <IngredientNameInput
        value={ingredient.name}
        suggestions={suggestions}
        disabled={disabled}
        placeholder="мука"
        ariaLabel={`Название ингредиента №${index + 1}`}
        onChange={(name) => onChange(index, { name })}
        onPick={(suggestion) => onPick?.(index, suggestion)}
      />
      <Input
        value={Number.isFinite(ingredient.amount) ? String(ingredient.amount) : ''}
        disabled={disabled}
        inputMode="decimal"
        placeholder="1000"
        aria-label={`Количество ингредиента №${index + 1}`}
        onChange={(event) => {
          const parsed = Number(event.target.value.replace(',', '.'));
          onChange(index, { amount: Number.isFinite(parsed) ? parsed : Number.NaN });
        }}
      />
      <Select
        value={ingredient.unit}
        disabled={disabled}
        aria-label={`Единица измерения ингредиента №${index + 1}`}
        onChange={(event) => onChange(index, { unit: event.target.value as DishIngredient['unit'] })}
      >
        {UNITS.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
      </Select>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className="size-9 !min-h-9 !px-0 text-berry-500"
        aria-label={`Удалить ингредиент №${index + 1}`}
        onClick={() => onRemove(index)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

export interface IngredientViewRowProps {
  ingredient: DishIngredient;
  missing?: MissingIngredient;
  /** Продукт в холодильнике просрочен — показываем красный бейдж. */
  expiresAt?: string | null;
}

/** Строка ингредиента в просмотре рецепта: галочка или крестик. */
export function IngredientViewRow({ ingredient, missing, expiresAt = null }: IngredientViewRowProps) {
  const ok = !missing;

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[15px]',
        ok ? 'border-cream-300 bg-white' : 'border-honey-100 bg-honey-50'
      )}
    >
      <span
        className={cn('w-5 shrink-0 text-center font-bold', ok ? 'text-olive-500' : 'text-honey-500')}
        aria-hidden="true"
      >
        {ok ? '✓' : '✕'}
      </span>
      <span className="flex-1 break-words">{ingredient.name}</span>
      <span className="shrink-0 font-semibold tabular-nums text-ink-soft">
        {formatAmount(ingredient.amount)} {ingredient.unit}
      </span>
      {missing ? (
        <span className="w-full text-xs text-honey-700 md:w-auto md:shrink-0">
          {missing.reason === 'absent'
            ? 'нет в холодильнике'
            : missing.reason === 'unit'
              ? `нужен ${missing.unit}`
              : `есть ${formatAmount(missing.have)} ${missing.unit}`}
        </span>
      ) : null}
      <ShelfLifeBadge expiresAt={expiresAt} className="w-full md:w-auto" />
    </li>
  );
}
