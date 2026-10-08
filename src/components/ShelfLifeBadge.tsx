import { formatExpiryLabel, getExpiryStatus, type ExpiryStatus } from '../lib/shelfLife';
import { cn } from './ui';

/* ============================================================================
 * ShelfLifeBadge.tsx — бейдж срока годности продукта.
 * Без даты не рендерится совсем.
 * ========================================================================== */

const STYLES: Record<Exclude<ExpiryStatus, 'none'>, string> = {
  ok: 'bg-olive-50 text-olive-700 border-olive-200',
  soon: 'bg-honey-50 text-honey-700 border-honey-200',
  today: 'bg-honey-100 text-honey-800 border-honey-300',
  expired: 'bg-berry-50 text-berry-700 border-berry-200'
};

export interface ShelfLifeBadgeProps {
  expiresAt: string | null;
  className?: string;
}

export default function ShelfLifeBadge({ expiresAt, className }: ShelfLifeBadgeProps) {
  const status = getExpiryStatus(expiresAt);
  if (status === 'none' || !expiresAt) return null;

  const label = formatExpiryLabel(expiresAt);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
        STYLES[status],
        className
      )}
      title={label}
    >
      {status === 'expired' ? `⚠ ${label}` : label}
    </span>
  );
}
