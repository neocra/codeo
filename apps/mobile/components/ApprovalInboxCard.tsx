import { useMutation, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';
import type { ApprovalRequest, Task } from '@codeo/domain';
import { ApprovalCard, StatusPill, Typo, useTheme } from '@codeo/ui-mobile';
import { useT } from '@/lib/i18n';
import { approvalKind, formatCountdown, providerLabel, riskLabel, riskTone } from '@/lib/presentation';
import { useConnectedClient, useNow } from '@/lib/runtime';

export interface ApprovalInboxCardProps {
  approval: ApprovalRequest;
  /** The task it belongs to, when known (for the ticket key). */
  task?: Task | undefined;
  /** Compact variant for the home screen: no affected list. */
  compact?: boolean;
}

const MAX_AFFECTED = 4;

/** Binds the design's ApprovalCard to `approvals.resolve`. */
export function ApprovalInboxCard({ approval, task, compact = false }: ApprovalInboxCardProps) {
  const t = useT();
  const { theme } = useTheme();
  const getClient = useConnectedClient();
  const queryClient = useQueryClient();
  const now = useNow(1000);

  const resolve = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => getClient().request('approvals.resolve', { approvalId: approval.id, decision }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals.list'] });
      void queryClient.invalidateQueries({ queryKey: ['home.summary'] });
    },
  });

  const remainingMs = new Date(approval.expiresAt).getTime() - now.getTime();
  const expired = approval.status === 'pending' && remainingMs <= 0;
  const resolved =
    approval.status === 'approved'
      ? 'approved'
      : approval.status === 'rejected'
        ? 'rejected'
        : approval.status === 'expired' || approval.status === 'cancelled' || expired
          ? 'expired'
          : null;

  const affected = approval.affected.slice(0, MAX_AFFECTED);
  const more = approval.affected.length - affected.length;

  return (
    <ApprovalCard
      kind={approvalKind(approval.tool, t)}
      reference={task?.ticketKey ?? null}
      title={approval.summary}
      description={approval.reason ?? t('approvals.requested', { agent: providerLabel(approval.provider, t) })}
      approveLabel={t('action.approve')}
      rejectLabel={t('action.reject')}
      approvedLabel={t('approvals.approved')}
      rejectedLabel={t('approvals.rejected')}
      expiredLabel={approval.status === 'cancelled' ? t('status.cancelled') : t('approvals.expired')}
      errorLabel={t('error.generic')}
      resolved={resolved}
      onApprove={async () => {
        await resolve.mutateAsync('approve');
      }}
      onReject={async () => {
        await resolve.mutateAsync('reject');
      }}
    >
      <View style={{ gap: theme.spacing['space-2'] }}>
        {task ? (
          <Typo variant="body-sm" color="ink-muted" numberOfLines={1}>
            {task.title}
          </Typo>
        ) : null}
        {!compact && affected.length > 0 ? (
          <View style={{ gap: 2 }}>
            <Typo variant="overline" color="ink-faint">
              {t('approvals.affected')}
            </Typo>
            {affected.map((item) => (
              <Typo key={item} variant="code-sm" color="ink-muted" numberOfLines={1}>
                {item}
              </Typo>
            ))}
            {more > 0 ? (
              <Typo variant="code-sm" color="ink-faint">
                {`+${more}`}
              </Typo>
            ) : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing['space-2'] }}>
          <StatusPill tone={riskTone(approval.risk)} label={riskLabel(approval.risk, t)} pulse={false} />
          {resolved === null ? (
            <Typo variant="code-sm" color={remainingMs < 60_000 ? 'coral' : 'ink-faint'} tabular>
              {t('approvals.expiresIn', { time: formatCountdown(remainingMs) })}
            </Typo>
          ) : null}
        </View>
      </View>
    </ApprovalCard>
  );
}
