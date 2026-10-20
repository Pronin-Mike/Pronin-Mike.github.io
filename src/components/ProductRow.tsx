import { Ellipsis } from 'lucide-react';
import type { FridgeItem } from '../lib/types';
import { formatAmount } from '../lib/format';
import { getExpiryStatus } from '../lib/shelfLife';
import ShelfLifeBadge from './ShelfLifeBadge';
import { Button, IconButton } from './ui';

export interface ProductRowProps {
  item: FridgeItem;
  busy?: boolean;
  onOpen: (item: FridgeItem) => void;
  onUse: (item: FridgeItem) => void;
  onWaste: (item: FridgeItem) => void;
}

/** Компактная строка запаса: на 320px действия всегда занимают предсказуемую вторую строку. */
export default function ProductRow({ item, busy = false, onOpen, onUse, onWaste }: ProductRowProps) {
  const expired = getExpiryStatus(item.expiresAt) === 'expired';

  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-2xl border border-cream-300 bg-white px-3 py-3 shadow-soft sm:grid-cols-[minmax(10rem,1fr)_auto_auto_auto] sm:gap-x-4 sm:px-4">
      <button
        type="button"
        className="min-w-0 text-left font-bold leading-snug text-ink hover:text-terra-700 sm:truncate"
        title={item.name}
        onClick={() => onOpen(item)}
      >
        <span className="break-words sm:block sm:truncate">{item.name}</span>
      </button>

      <span className="shrink-0 text-right text-sm font-extrabold tabular-nums text-ink">
        {formatAmount(item.amount)} {item.unit}
      </span>

      <div className="min-w-0 sm:justify-self-end">
        <ShelfLifeBadge expiresAt={item.expiresAt} />
        {!item.expiresAt ? <span className="text-xs font-semibold text-ink-muted">Срок не указан</span> : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 sm:justify-self-end">
        <Button
          variant={expired ? 'danger' : 'primary'}
          size="sm"
          disabled={busy}
          onClick={() => expired ? onWaste(item) : onUse(item)}
        >
          {expired ? 'Выбросить' : 'Использовать'}
        </Button>
        <IconButton label={`Подробнее о «${item.name}»`} disabled={busy} onClick={() => onOpen(item)}>
          <Ellipsis className="size-5" aria-hidden="true" />
        </IconButton>
      </div>
    </li>
  );
}
