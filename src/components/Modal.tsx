import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './ui';

/* ============================================================================
 * Modal.tsx — модальное окно: шторка снизу на мобильных, карточка на desktop.
 * ========================================================================== */

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeOnBackdrop?: boolean;
}

const SIZES = {
  sm: 'md:max-w-md',
  md: 'md:max-w-xl',
  lg: 'md:max-w-3xl'
} as const;

export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    boxRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-ink/40 backdrop-blur-sm md:items-center md:p-4"
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-cream-100 shadow-sheet outline-none md:rounded-3xl',
          'animate-sheet-in',
          SIZES[size]
        )}
      >
        <header className="flex items-start gap-3 rounded-t-3xl border-b border-cream-300 bg-white p-4">
          <h2 className="flex-1 font-display text-xl leading-tight text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-cream-300 bg-cream-100 text-ink-soft transition hover:bg-cream-200"
            aria-label="Закрыть"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {footer ? (
          <footer className="flex flex-wrap gap-2 border-t border-cream-300 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
