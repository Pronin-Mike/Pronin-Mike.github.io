import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import ShelfLifeBadge from './ShelfLifeBadge';
import { Button, Card, SectionTitle } from './ui';
import { useCookbook } from '../hooks/useCookbook';
import { formatAmount } from '../lib/format';

/* ============================================================================
 * ExpiringBlock.tsx — продукты, у которых срок годности скоро истекает.
 * Показываем не больше пяти; пустой список — блок не рендерится.
 * ========================================================================== */

const LIMIT = 5;

export default function ExpiringBlock() {
  const { expiring } = useCookbook();
  const navigate = useNavigate();

  if (!expiring.length) return null;

  const visible = expiring.slice(0, LIMIT);

  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle count={expiring.length}>
        <Clock className="size-4 text-honey-500" aria-hidden="true" />
        Скоро истекает
      </SectionTitle>

      <ul className="flex flex-col gap-2">
        {visible.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-honey-100 bg-honey-50 px-3 py-2 text-[15px]"
          >
            <span className="min-w-0 flex-1 break-words font-semibold text-ink">{item.name}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-soft">
              {formatAmount(item.amount)} {item.unit}
            </span>
            <ShelfLifeBadge expiresAt={item.expiresAt} />
          </li>
        ))}
      </ul>

      {expiring.length > LIMIT ? (
        <Button variant="ghost" onClick={() => navigate('/fridge?sort=expiry')}>
          Показать все
        </Button>
      ) : null}
    </Card>
  );
}
