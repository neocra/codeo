import { View } from 'react-native';
import type { SessionEntry } from '@codeo/domain';
import { Icon, Typo, useTheme } from '@codeo/ui-mobile';
import { useT } from '@/lib/i18n';
import { formatDuration } from '@/lib/presentation';

type ResultEntry = Extract<SessionEntry, { kind: 'result' }>;

export function ResultRow({ entry }: { entry: ResultEntry }) {
  const t = useT();
  const { theme } = useTheme();
  const meta: string[] = [];
  if (entry.durationMs !== null) meta.push(formatDuration(entry.durationMs));
  if (entry.costUsd !== null) meta.push(`$${entry.costUsd.toFixed(2)}`);
  if (entry.turns !== null) meta.push(`${entry.turns} turns`);

  return (
    <View
      style={{
        marginLeft: 32 + theme.spacing['space-3'],
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.spacing['space-2'],
        paddingVertical: theme.spacing['space-2'],
        borderTopWidth: 1,
        borderTopColor: theme.colors.line,
      }}
    >
      <View style={{ paddingTop: 2 }}>
        <Icon name={entry.ok ? 'check' : 'review'} size={16} color={entry.ok ? 'mint' : 'coral'} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Typo variant="label" color={entry.ok ? 'mint' : 'coral'}>
          {entry.ok ? t('sessions.result.ok') : t('sessions.result.error')}
        </Typo>
        {entry.summary ? (
          <Typo variant="body-sm" color="ink-muted">
            {entry.summary}
          </Typo>
        ) : null}
        {meta.length > 0 ? (
          <Typo variant="code-sm" color="ink-faint" tabular>
            {meta.join(' · ')}
          </Typo>
        ) : null}
      </View>
    </View>
  );
}
