import { Pressable, View } from 'react-native';
import type { AgentSession } from '@codeo/domain';
import { formatRelative } from '@codeo/i18n';
import { Avatar, Icon, StatusPill, Typo, useTheme } from '@codeo/ui-mobile';
import { useT } from '@/lib/i18n';
import { providerInitial, providerLabel, roleLabel, sessionPill } from '@/lib/presentation';

export interface SessionRowProps {
  session: AgentSession;
  onPress: () => void;
}

export function SessionRow({ session, onPress }: SessionRowProps) {
  const t = useT();
  const { theme } = useTheme();
  const pill = sessionPill(session.status, t);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
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
      <Avatar initial={providerInitial(session.provider, t)} ring={pill.tone === 'live' ? 'mint' : 'line-strong'} />
      <View style={{ flex: 1, gap: 2 }}>
        <Typo variant="heading" numberOfLines={1}>
          {session.title}
        </Typo>
        <Typo variant="body-sm" color="ink-muted" numberOfLines={1}>
          {`${providerLabel(session.provider, t)} · ${roleLabel(session.role, t)} · ${formatRelative(t, session.lastActivityAt)}`}
        </Typo>
      </View>
      <StatusPill tone={pill.tone} label={pill.label} />
      <Icon name="chevron" size={16} color="ink-faint" />
    </Pressable>
  );
}
