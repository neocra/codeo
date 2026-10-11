import { useEffect, type ReactNode } from 'react';
import { Button } from '../components/Button';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}

export function Dialog({ open, title, onClose, closeLabel, children }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="cd-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cd-dialog" role="dialog" aria-modal aria-label={typeof title === 'string' ? title : undefined}>
        <div className="cd-dialog__head">
          <h2 className="cd-dialog__title">{title}</h2>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose} aria-label={closeLabel}>
            {closeLabel}
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
