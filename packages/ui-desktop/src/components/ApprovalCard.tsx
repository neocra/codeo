import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

export interface ApprovalCardProps {
  ticket: string;
  kind: string;
  title: string;
  description?: ReactNode;
  approveLabel: string;
  rejectLabel?: string | undefined;
  detailsLabel?: string | undefined;
  approvedLabel: string;
  approvedText?: string | undefined;
  approved?: boolean | undefined;
  /** Resolve to confirm; reject to return to pending. */
  onApprove?: (() => Promise<unknown> | void) | undefined;
  onReject?: (() => Promise<unknown> | void) | undefined;
  onDetails?: (() => void) | undefined;
  className?: string | undefined;
}

/** The one place Codeo raises its voice: an amber sweep, three breaths, then still. */
export function ApprovalCard(p: ApprovalCardProps) {
  const [state, setState] = useState<'pending' | 'approving' | 'rejecting' | 'approved'>(p.approved ? 'approved' : 'pending');
  const run = async (which: 'approving' | 'rejecting', fn?: () => Promise<unknown> | void) => {
    setState(which);
    try {
      await fn?.();
      setState(which === 'approving' ? 'approved' : 'pending');
    } catch {
      setState('pending');
    }
  };
  const approved = state === 'approved';
  return (
    <section className={['cd-approval', approved && 'is-approved', p.className].filter(Boolean).join(' ')} aria-live="polite">
      <div className="cd-approval__head">
        <Icon name="branch" size={14} />
        {p.ticket}
        <span className="cd-approval__kind">{approved ? p.approvedLabel : p.kind}</span>
      </div>
      <div>
        <div className="cd-approval__title">{p.title}</div>
        {p.description ? <div className="cd-approval__desc">{approved ? (p.approvedText ?? p.approvedLabel) : p.description}</div> : null}
      </div>
      {approved ? (
        <div className="cd-done">
          <span className="cd-done__badge">
            <Icon name="check" size={14} strokeWidth={2.5} />
          </span>
          <span>{p.approvedLabel}</span>
        </div>
      ) : (
        <div className="cd-approval__actions">
          <Button variant="approve" icon={state === 'approving' ? undefined : 'check'} loading={state === 'approving'} disabled={state === 'rejecting'} onClick={() => void run('approving', p.onApprove)}>
            {p.approveLabel}
          </Button>
          {p.onReject && p.rejectLabel ? (
            <Button variant="secondary" loading={state === 'rejecting'} disabled={state === 'approving'} onClick={() => void run('rejecting', p.onReject)}>
              {p.rejectLabel}
            </Button>
          ) : null}
          {p.onDetails && p.detailsLabel ? (
            <Button variant="secondary" onClick={p.onDetails}>
              {p.detailsLabel}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
