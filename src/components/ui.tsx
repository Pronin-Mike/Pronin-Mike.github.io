import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

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
  sm: 'min-h-9 px-3 text-sm gap-1.5',
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
        'inline-flex items-center justify-center rounded-full font-semibold transition',
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

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClass, 'appearance-none bg-white pr-9', className)} {...rest} />;
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
