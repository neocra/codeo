import type { ApprovalRequest } from '@codeo/domain';
import { ApprovalCard } from '@codeo/ui-desktop';
import { useT } from '../lib/i18n';
import { useResolveApproval } from '../lib/queries';
import { useUi } from '../lib/store';
import { approvalKindKey, providerName } from './status';

export function ApprovalItem({ approval }: { approval: ApprovalRequest }) {
  const t = useT();
  const resolve = useResolveApproval();
  const openSession = useUi((s) => s.openSession);
  const affected = approval.affected.slice(0, 3).join(' · ');
  return (
    <ApprovalCard
      ticket={providerName[approval.provider]}
      kind={t(approvalKindKey(approval))}
      title={approval.summary}
      description={`${t('approvals.requested', { agent: providerName[approval.provider] })} ${t(`approvals.risk.${approval.risk}`)}${affected ? ` — ${affected}` : ''}`}
      approveLabel={t('action.approve')}
      rejectLabel={t('action.reject')}
      detailsLabel={t('action.details')}
      approvedLabel={t('approvals.approved')}
      onApprove={() => resolve.mutateAsync({ approvalId: approval.id, decision: 'approve' })}
      onReject={() => resolve.mutateAsync({ approvalId: approval.id, decision: 'reject' })}
      onDetails={() => openSession(approval.sessionId)}
    />
  );
}
