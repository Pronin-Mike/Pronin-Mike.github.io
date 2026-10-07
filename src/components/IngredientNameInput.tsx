import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Input, cn } from './ui';
import {
  filterIngredientSuggestions,
  shouldShowSuggestions,
  type IngredientSuggestion
} from '../lib/suggestions';

/* ============================================================================
 * IngredientNameInput.tsx — поле названия ингредиента с подсказками
 * из холодильника.
 *
 * Комбобокс: список фильтруется по началу названия, выбирается мышью или
 * стрелками (↑/↓ + Enter), Esc закрывает. Если совпадений нет — список
 * закрыт и поле ведёт себя как обычный input.
 * ========================================================================== */

export interface IngredientNameInputProps {
  value: string;
  suggestions: IngredientSuggestion[];
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  /** Выбор подсказки: имя и единица измерения из холодильника. */
  onPick?: (suggestion: IngredientSuggestion) => void;
}

export default function IngredientNameInput({
  value,
  suggestions,
  disabled = false,
  placeholder,
  ariaLabel,
  onChange,
  onPick
}: IngredientNameInputProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const matches = useMemo(
    () => filterIngredientSuggestions(suggestions, value),
    [suggestions, value]
  );

  const visible = open && !disabled && shouldShowSuggestions(matches, value);

  /* Закрываем список по клику вне поля */
  useEffect(() => {
    if (!visible) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (wrapperRef.current && target && !wrapperRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [visible]);

  /* При смене текста подсветка возвращается к первому пункту */
  useEffect(() => {
    setHighlight(0);
  }, [value]);

  const pick = (item: IngredientSuggestion) => {
    onChange(item.name);
    onPick?.(item);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (!visible) {
      if (event.key === 'ArrowDown' && shouldShowSuggestions(matches, value)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      const item = matches[highlight];
      if (item) {
        event.preventDefault();
        pick(item);
      }
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible ? `${listId}-${highlight}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {visible ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Продукты из холодильника"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-cream-300 bg-white py-1 shadow-lift"
        >
          {matches.map((item, index) => (
            <li
              key={`${item.name}-${item.unit}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                index === highlight ? 'bg-terra-50 text-terra-700' : 'text-ink hover:bg-cream-100'
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => pick(item)}
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 rounded-full bg-cream-100 px-2 py-0.5 text-xs font-semibold text-ink-soft">
                {item.unit}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
