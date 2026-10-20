import { Ellipsis } from 'lucide-react';
import type { FridgeItem } from '../lib/types';
import { formatAmount } from '../lib/format';
import { formatExpiryLabel, getExpiryStatus } from '../lib/shelfLife';
import { Button, cn, IconButton } from './ui';

export interface ProductRowProps {
  item: FridgeItem;
  busy?: boolean;
  onOpen: (item: FridgeItem) => void;
  onUse: (item: FridgeItem) => void;
  onWaste: (item: FridgeItem) => void;
}

/** Плотная строка из прототипа: название/срок, количество и действия остаются в одном ряду. */
export default function ProductRow({ item, busy = false, onOpen, onUse, onWaste }: ProductRowProps) {
  const status = getExpiryStatus(item.expiresAt);
  const expired = status === 'expired';
  const expiryLabel = item.expiresAt ? formatExpiryLabel(item.expiresAt) : 'Срок не указан';

  return (
    <li className="flex min-h-[60px] min-w-0 items-center gap-2 border-b border-cream-300 px-2.5 py-2 last:border-b-0 sm:gap-3 sm:px-4">
      <button
        type="button"
        aria-label={item.name}
        className="min-w-0 flex-1 text-left leading-tight text-ink hover:text-terra-700"
        title={item.name}
        onClick={() => onOpen(item)}
      >
        <span className="block truncate text-[13px] font-extrabold sm:text-sm">{item.name}</span>
        <span className={cn(
          'mt-1 block truncate text-[10px] font-semibold sm:text-xs',
          expired ? 'text-berry-700' : status === 'soon' || status === 'today' ? 'text-honey-700' : 'text-ink-muted'
        )}>
          {expiryLabel}
        </span>
      </button>

      <span className="shrink-0 whitespace-nowrap text-right text-[11px] font-extrabold tabular-nums text-ink sm:text-sm">
        {formatAmount(item.amount)} {item.unit}
      </span>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'px-2 text-[11px] sm:px-3 sm:text-sm',
            expired
              ? 'border-berry-200 bg-white text-berry-700 hover:bg-berry-50'
              : 'border-terra-100 bg-terra-100 text-terra-700 shadow-none hover:bg-terra-200'
          )}
          disabled={busy}
          onClick={() => expired ? onWaste(item) : onUse(item)}
        >
          {expired ? 'Выбросить' : 'Использовать'}
        </Button>
        <IconButton className="border-cream-300 bg-white" label={`Подробнее о «${item.name}»`} disabled={busy} onClick={() => onOpen(item)}>
          <Ellipsis className="size-5" aria-hidden="true" />
        </IconButton>
      </div>
    </li>
  );
}
