import { Pressable, View } from 'react-native';
import { Avatar } from './Avatar';
import { StatusPill, type PillTone } from './StatusPill';
import { useTheme } from './theme';
import { Typo } from './Typo';

export interface AgentCardProps {
  initial: string;
  name: string;
  role: string;
  pill: { tone: PillTone; label: string };
  onPress?: () => void;
}

/** Avatar initial + name + role + status pill. */
export function AgentCard({ initial, name, role, pill, onPress }: AgentCardProps) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing['space-3'],
        padding: theme.spacing['space-3'],
        borderRadius: theme.radii['radius-md'],
        borderWidth: 1,
        borderColor: theme.colors.line,
        backgroundColor: pressed ? theme.colors['bg-300'] : theme.colors['bg-200'],
      })}
    >
      <Avatar initial={initial} ring={pill.tone === 'live' ? 'mint' : 'line-strong'} />
      <View style={{ flex: 1, gap: 2 }}>
        <Typo variant="heading" numberOfLines={1}>
          {name}
        </Typo>
        <Typo variant="body-sm" color="ink-muted" numberOfLines={1}>
          {role}
        </Typo>
      </View>
      <StatusPill tone={pill.tone} label={pill.label} />
    </Pressable>
  );
}
