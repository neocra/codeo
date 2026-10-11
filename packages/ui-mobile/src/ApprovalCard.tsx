import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Button } from './Button';
import { Icon } from './Icon';
import { useTheme, withAlpha } from './theme';
import { Typo } from './Typo';

export type ApprovalCardState = 'pending' | 'approving' | 'rejecting' | 'approved' | 'rejected' | 'error';

export interface ApprovalCardProps {
  /** Kicker: the kind of operation ("Modifications de code", "Commande"). */
  kind: string;
  /** Ticket key / PR number, rendered in mono. */
  reference?: string | null;
  title: string;
  description?: string | null;
  /** Extra metadata rows (affected files, risk, expiry). */
  children?: ReactNode;
  approveLabel: string;
  rejectLabel: string;
  approvedLabel: string;
  rejectedLabel: string;
  errorLabel: string;
  /** Resolves when the runtime accepted the decision; rejects to show the error state. */
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  /** Already resolved elsewhere (desktop, policy, expiry): locks the buttons. */
  resolved?: 'approved' | 'rejected' | 'expired' | null;
  expiredLabel?: string;
}

/**
 * The approval inbox card. Amber ground while it needs you (rung 4: one sweep, three breaths,
 * then still); turns mint with a drawn check once you approve (rung 5).
 */
export function ApprovalCard({
  kind,
  reference,
  title,
  description,
  children,
  approveLabel,
  rejectLabel,
  approvedLabel,
  rejectedLabel,
  errorLabel,
  onApprove,
  onReject,
  resolved = null,
  expiredLabel,
}: ApprovalCardProps) {
  const { theme, calm } = useTheme();
  const [state, setState] = useState<ApprovalCardState>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const glow = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  const effective: ApprovalCardState =
    resolved === 'approved' ? 'approved' : resolved === 'rejected' ? 'rejected' : state;
  const expired = resolved === 'expired';
  const settled = effective === 'approved' || effective === 'rejected' || expired;

  useEffect(() => {
    if (calm || settled) {
      glow.setValue(0);
      return;
    }
    const breath = (to: number) =>
      Animated.timing(glow, {
        toValue: to,
        duration: theme.durations['dur-ambient'] / 2,
        easing: Easing.bezier(0.45, 0, 0.55, 1),
        useNativeDriver: false,
      });
    const seq = Animated.sequence([breath(1), breath(0), breath(1), breath(0), breath(1), breath(0)]);
    seq.start();
    return () => seq.stop();
  }, [calm, settled, glow, theme]);

  useEffect(() => {
    if (effective !== 'approved') return;
    Animated.timing(pop, {
      toValue: 1,
      duration: theme.durations['dur-deliberate'],
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      useNativeDriver: true,
    }).start();
  }, [effective, pop, theme]);

  const decide = async (decision: 'approve' | 'reject') => {
    setState(decision === 'approve' ? 'approving' : 'rejecting');
    setErrorMessage(null);
    try {
      await (decision === 'approve' ? onApprove() : onReject());
      setState(decision === 'approve' ? 'approved' : 'rejected');
    } catch (err) {
      setState('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const ground = effective === 'approved' ? theme.colors['mint-soft'] : expired || effective === 'rejected' ? theme.colors['bg-200'] : theme.colors['amber-soft'];
  const accent = effective === 'approved' ? theme.colors.mint : expired || effective === 'rejected' ? theme.colors['line-strong'] : theme.colors.amber;
  const borderColor = glow.interpolate({ inputRange: [0, 1], outputRange: [withAlpha(accent, 0.3), withAlpha(accent, 0.7)] });

  return (
    <Animated.View
      style={{
        backgroundColor: ground,
        borderWidth: 1,
        borderColor: settled ? withAlpha(accent, 0.4) : borderColor,
        borderRadius: theme.radii['radius-md'],
        padding: theme.spacing['space-4'],
        gap: theme.spacing['space-3'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['space-2'] }}>
        <Icon name="shield" size={16} color={effective === 'approved' ? 'mint' : settled ? 'ink-faint' : 'amber'} />
        <Typo variant="overline" color={effective === 'approved' ? 'mint' : settled ? 'ink-faint' : 'amber'} numberOfLines={1} style={{ flexShrink: 1 }}>
          {kind}
        </Typo>
        {reference ? (
          <Typo variant="code-sm" color="ink-muted" numberOfLines={1}>
            {reference}
          </Typo>
        ) : null}
      </View>

      <View style={{ gap: theme.spacing['space-1'] }}>
        <Typo variant="heading">{title}</Typo>
        {description ? (
          <Typo variant="body-sm" color="ink-muted">
            {description}
          </Typo>
        ) : null}
      </View>

      {children}

      {effective === 'approved' || effective === 'rejected' || expired ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['space-2'] }}>
          {effective === 'approved' ? (
            <Animated.View style={{ transform: [{ scale: pop }] }}>
              <Icon name="check" size={16} color="mint" strokeWidth={2.25} />
            </Animated.View>
          ) : null}
          <Typo variant="label" color={effective === 'approved' ? 'mint' : 'ink-muted'}>
            {effective === 'approved' ? approvedLabel : expired ? (expiredLabel ?? rejectedLabel) : rejectedLabel}
          </Typo>
        </View>
      ) : (
        <View style={{ gap: theme.spacing['space-2'] }}>
          <View style={{ flexDirection: 'row', gap: theme.spacing['space-2'] }}>
            <Button
              variant="approve"
              icon="check"
              label={approveLabel}
              loading={effective === 'approving'}
              disabled={effective === 'rejecting'}
              onPress={() => void decide('approve')}
              style={{ flex: 1 }}
            />
            <Button
              variant="secondary"
              label={rejectLabel}
              loading={effective === 'rejecting'}
              disabled={effective === 'approving'}
              onPress={() => void decide('reject')}
              style={{ flex: 1 }}
            />
          </View>
          {effective === 'error' ? (
            <Typo variant="body-sm" color="coral">
              {errorMessage ? `${errorLabel} ${errorMessage}` : errorLabel}
            </Typo>
          ) : null}
        </View>
      )}
    </Animated.View>
  );
}
