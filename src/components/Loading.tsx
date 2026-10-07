import { Loader2 } from 'lucide-react';
import { cn } from './ui';

/* ============================================================================
 * Loading.tsx — индикаторы загрузки: спиннер и скелетоны.
 * ========================================================================== */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-terra-500', className)} aria-hidden="true" />;
}

export function FullScreenSpinner({ label = 'Загружаем…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-ink-soft">
      <Spinner className="size-7" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="flex h-40 animate-pulse flex-col gap-3 rounded-2xl border border-cream-300 bg-white p-4">
      <div className="flex gap-3">
        <div className="size-11 rounded-2xl bg-cream-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded-full bg-cream-200" />
          <div className="h-3 w-1/3 rounded-full bg-cream-200" />
        </div>
      </div>
      <div className="h-3 w-full rounded-full bg-cream-200" />
      <div className="mt-auto h-8 w-28 self-end rounded-full bg-cream-200" />
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-2xl border border-cream-300 bg-white" />
      ))}
    </div>
  );
}
