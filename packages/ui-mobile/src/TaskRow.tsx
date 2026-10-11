import { Pressable, View } from 'react-native';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import { StatusPill, type PillTone } from './StatusPill';
import { useTheme } from './theme';
import { Typo } from './Typo';

export interface TaskRowProps {
  /** `PROJ-123` — mono, optional. */
  ticketKey?: string | null;
  title: string;
  pill: { tone: PillTone; label: string };
  /** 0–100 */
  progress: number;
  /** Meta line under the bar: repos, agent count, elapsed time. */
  meta?: string;
  onPress?: () => void;
}

export function TaskRow({ ticketKey, title, pill, progress, meta, onPress }: TaskRowProps) {
  const { theme } = useTheme();
  const tone = pill.tone === 'attention' ? 'amber' : pill.tone === 'waiting' ? 'sky' : 'mint';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        gap: theme.spacing['space-3'],
        padding: theme.spacing['space-4'],
        borderRadius: theme.radii['radius-md'],
        borderWidth: 1,
        borderColor: theme.colors.line,
        backgroundColor: pressed ? theme.colors['bg-300'] : theme.colors['bg-200'],
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['space-3'] }}>
        <View style={{ flex: 1, gap: 2 }}>
          {ticketKey ? (
            <Typo variant="code-sm" color="ink-faint">
              {ticketKey}
            </Typo>
          ) : null}
          <Typo variant="heading" numberOfLines={2}>
            {title}
          </Typo>
        </View>
        <StatusPill tone={pill.tone} label={pill.label} pulse={false} />
        {onPress ? <Icon name="chevron" size={16} color="ink-faint" /> : null}
      </View>
      <ProgressBar value={progress} tone={tone} showValue />
      {meta ? (
        <Typo variant="body-sm" color="ink-muted" numberOfLines={1}>
          {meta}
        </Typo>
      ) : null}
    </Pressable>
  );
}
