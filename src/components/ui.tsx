import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react';

/* ============================================================================
 * ui.tsx — маленькие переиспользуемые примитивы (без UI-библиотек).
 * ========================================================================== */

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- *
 * Кнопка: тач-таргеты не меньше 44px
 * -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'olive' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-terra-500 text-white hover:bg-terra-600 shadow-soft',
  olive: 'bg-olive-500 text-white hover:bg-olive-600 shadow-soft',
  ghost: 'bg-white text-ink-soft border border-cream-300 hover:bg-cream-100',
  danger: 'bg-berry-500 text-white hover:bg-berry-700'
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-[15px] gap-2',
  lg: 'min-h-12 px-5 text-base gap-2'
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-[10px] font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terra-400',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    />
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
}

export function IconButton({ label, variant = 'ghost', size = 'md', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-[10px] font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terra-400',
        VARIANTS[variant],
        size === 'lg' ? 'size-12' : 'size-11',
        className
      )}
      {...rest}
    />
  );
}

/* -------------------------------------------------------------------------- *
 * Поля ввода
 * -------------------------------------------------------------------------- */

export const inputClass = cn(
  'w-full rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-[15px] text-ink',
  'placeholder:text-ink-muted/70',
  'focus:border-terra-400 focus:outline-none focus:ring-4 focus:ring-terra-100'
);

/** forwardRef — чтобы страницы могли вернуть фокус в поле (например, в дату). */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(inputClass, className)} {...rest} />;
  }
);

export function Select({ className, style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(inputClass, 'appearance-none bg-white pr-10', className)}
      style={{
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2368736C' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 0.75rem center',
        backgroundRepeat: 'no-repeat',
        ...style
      }}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, 'min-h-20 resize-y leading-relaxed', className)} {...rest} />;
}

export function Field({
  label,
  hint,
  htmlFor,
  children
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5" htmlFor={htmlFor}>
      <span className="text-[13px] font-semibold text-ink-soft">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}

/* -------------------------------------------------------------------------- *
 * Бейджи и карточки
 * -------------------------------------------------------------------------- */

type BadgeTone = 'neutral' | 'ok' | 'warn' | 'error';

const BADGES: Record<BadgeTone, string> = {
  neutral: 'bg-cream-100 text-ink-soft border-cream-300',
  ok: 'bg-olive-50 text-olive-700 border-olive-200',
  warn: 'bg-honey-50 text-honey-700 border-honey-100',
  error: 'bg-berry-50 text-berry-700 border-berry-50'
};

export function Badge({ tone = 'neutral', className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        BADGES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-2xl border border-cream-300 bg-white p-4 shadow-soft', className)}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="flex items-baseline gap-2 font-display text-lg text-ink">
      {children}
      {typeof count === 'number' ? <span className="text-sm font-normal text-ink-muted">{count}</span> : null}
    </h2>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="scrollbar-hide flex max-w-full gap-2 overflow-x-auto pb-1" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          onClick={() => onChange(item.value)}
          className={cn(
            'min-h-11 shrink-0 rounded-[10px] border px-3.5 text-sm font-semibold transition-colors',
            item.value === value
              ? 'border-terra-500 bg-terra-500 text-white'
              : 'border-cream-300 bg-white text-ink-soft hover:bg-cream-100'
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col items-center gap-3 py-10 text-center', className)}>
      {icon ? <span className="text-terra-500" aria-hidden="true">{icon}</span> : null}
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      {description ? <p className="max-w-md text-sm leading-relaxed text-ink-soft">{description}</p> : null}
      {action}
    </Card>
  );
}

export function LoadingState({ label = 'Загружаем…' }: { label?: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center" role="status" aria-live="polite">
      <span className="text-sm font-semibold text-ink-muted">{label}</span>
    </div>
  );
}
