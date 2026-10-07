import type { ReactNode } from 'react';
import Modal from './Modal';
import { Button } from './ui';

/* ============================================================================
 * ConfirmDialog.tsx — подтверждение действия.
 * Поддерживает больше двух кнопок (например: Заменить / Сложить / Отмена).
 * ========================================================================== */

export interface ConfirmAction {
  label: string;
  value: string;
  variant?: 'primary' | 'olive' | 'ghost' | 'danger';
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  actions: ConfirmAction[];
  /** null приходит при закрытии по Esc/фону — это «отмена». */
  onResolve: (value: string | null) => void;
  busy?: boolean;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  actions,
  onResolve,
  busy = false
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      size="sm"
      onClose={() => onResolve(null)}
      footer={actions.map((action) => (
        <Button
          key={action.value}
          variant={action.variant ?? 'ghost'}
          disabled={busy}
          onClick={() => onResolve(action.value)}
          className="flex-1"
        >
          {action.label}
        </Button>
      ))}
    >
      {typeof description === 'string' ? (
        <p className="text-[15px] leading-relaxed text-ink-soft">{description}</p>
      ) : (
        description
      )}
    </Modal>
  );
}
