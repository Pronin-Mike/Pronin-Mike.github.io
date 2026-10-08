import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

/* ============================================================================
 * Toast.tsx — простые уведомления снизу экрана с авто-скрытием.
 * ========================================================================== */

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
  warning: AlertTriangle
};

const STYLES: Record<ToastKind, string> = {
  success: 'border-l-olive-500',
  error: 'border-l-berry-500',
  info: 'border-l-terra-500',
  warning: 'border-l-honey-500'
};

const AUTO_HIDE: Record<ToastKind, number> = {
  success: 3000,
  info: 3000,
  error: 5000,
  warning: 5000
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId.current;
      nextId.current += 1;
      setItems((list) => [...list, { id, kind, message }]);
      timers.current.set(id, window.setTimeout(() => remove(id), AUTO_HIDE[kind]));
    },
    [remove]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-[60] flex flex-col gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:w-96"
        role="status"
        aria-live="polite"
      >
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex animate-toast-in items-start gap-2.5 rounded-2xl border border-cream-200 border-l-4 bg-white p-3.5 text-sm shadow-lift ${STYLES[item.kind]}`}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
              <p className="flex-1 break-words text-ink">{item.message}</p>
              <button
                type="button"
                onClick={() => remove(item.id)}
                className="rounded-full p-0.5 text-ink-muted transition hover:bg-cream-100 hover:text-ink"
                aria-label="Скрыть уведомление"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast используется вне ToastProvider');
  return context;
}
