import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import ShelfLifeBadge from './ShelfLifeBadge';
import { useToast } from './Toast';
import { Button, Card, SectionTitle } from './ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { formatAmount } from '../lib/format';

/* ============================================================================
 * ExpiredBlock.tsx — просроченные продукты: выбросить по одному или все сразу.
 * Пустой список — блок не рендерится.
 * ========================================================================== */

export default function ExpiredBlock() {
  const { expired, reloadFridge } = useCookbook();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  if (!expired.length) return null;

  const run = async (task: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await task();
      toast.show(successMessage, 'success');
      await reloadFridge();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось выполнить операцию', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 border-berry-200 bg-berry-50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle count={expired.length}>
          <Trash2 className="size-4 text-berry-500" aria-hidden="true" />
          Просрочено
        </SectionTitle>
        <Button
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() => setClearOpen(true)}
        >
          Выбросить всё
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {expired.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-berry-200 bg-white px-3 py-2 text-[15px]"
          >
            <span className="min-w-0 flex-1 break-words font-semibold text-ink">{item.name}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-soft">
              {formatAmount(item.amount)} {item.unit}
            </span>
            <ShelfLifeBadge expiresAt={item.expiresAt} />
            <Button
              variant="ghost"
              size="sm"
              className="text-berry-500"
              disabled={busy}
              aria-label={`Выбросить «${item.name}»`}
              onClick={() => void run(() => api.deleteFridgeItem(item.id), `«${item.name}» выброшен.`)}
            >
              Выбросить
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={clearOpen}
        title="Выбросить просроченное?"
        description={`Будут удалены все просроченные продукты (${expired.length}).`}
        busy={busy}
        actions={[
          { label: 'Выбросить', value: 'clear', variant: 'danger' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          setClearOpen(false);
          if (value !== 'clear') return;
          void run(async () => {
            for (const item of expired) await api.deleteFridgeItem(item.id);
          }, 'Просроченные продукты выброшены.');
        }}
      />
    </Card>
  );
}
