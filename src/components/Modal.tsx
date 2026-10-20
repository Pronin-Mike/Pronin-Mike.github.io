import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X } from 'lucide-react';
import { cn, IconButton } from './ui';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeOnBackdrop?: boolean;
  /** Возврат к предыдущему экрану внутри того же модального сценария. */
  onBack?: () => void;
  backLabel?: string;
}

const SIZES = {
  sm: 'md:max-w-md',
  md: 'md:max-w-xl',
  lg: 'md:max-w-3xl'
} as const;

let scrollLockDepth = 0;
let lockedScrollY = 0;
let previousBodyStyles: Partial<CSSStyleDeclaration> = {};

function lockPageScroll() {
  scrollLockDepth += 1;
  if (scrollLockDepth > 1) return;

  lockedScrollY = window.scrollY;
  previousBodyStyles = {
    position: document.body.style.position,
    top: document.body.style.top,
    left: document.body.style.left,
    right: document.body.style.right,
    width: document.body.style.width,
    overflow: document.body.style.overflow
  };
  Object.assign(document.body.style, {
    position: 'fixed',
    top: `-${lockedScrollY}px`,
    left: '0',
    right: '0',
    width: '100%',
    overflow: 'hidden'
  });
}

function unlockPageScroll() {
  scrollLockDepth = Math.max(0, scrollLockDepth - 1);
  if (scrollLockDepth > 0) return;
  Object.assign(document.body.style, previousBodyStyles);
  if (!navigator.userAgent.includes('jsdom')) {
    window.scrollTo({ top: lockedScrollY, behavior: 'auto' });
  }
}

export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  onBack,
  backLabel = 'Назад'
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !boxRef.current) return;

      const focusable = [...boxRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        boxRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    lockPageScroll();
    document.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => {
      const firstFocusable = boxRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
      );
      (firstFocusable ?? boxRef.current)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      unlockPageScroll();
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

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
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'flex max-h-[calc(100dvh-env(safe-area-inset-top,0px))] w-full flex-col rounded-t-2xl bg-cream-100 shadow-sheet outline-none md:max-h-[min(92dvh,56rem)] md:rounded-2xl',
          'animate-sheet-in',
          SIZES[size]
        )}
      >
        <header className="flex items-start gap-3 rounded-t-2xl border-b border-cream-300 bg-white p-4">
          {onBack ? (
            <IconButton label={backLabel} onClick={onBack} className="-ml-1">
              <ArrowLeft className="size-5" aria-hidden="true" />
            </IconButton>
          ) : null}
          <h2 id={titleId} className="flex-1 font-display text-xl font-bold leading-tight text-ink">{title}</h2>
          <IconButton label="Закрыть" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </header>

        <div className="flex-1 overscroll-contain overflow-y-auto p-4">{children}</div>

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
