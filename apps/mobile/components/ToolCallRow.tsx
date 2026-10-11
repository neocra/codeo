import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { SessionEntry } from '@codeo/domain';
import { Card, Icon, StatusPill, Typo, useTheme, type PillTone } from '@codeo/ui-mobile';
import { useT } from '@/lib/i18n';
import { previewInput, truncate } from '@/lib/presentation';

type ToolCallEntry = Extract<SessionEntry, { kind: 'tool_call' }>;

const MAX_INPUT = 160;
const MAX_OUTPUT = 1200;

export function ToolCallRow({ entry }: { entry: ToolCallEntry }) {
  const t = useT();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);

  const pill: { tone: PillTone; label: string } =
    entry.status === 'running'
      ? { tone: 'live', label: t('status.running') }
      : entry.status === 'completed'
        ? { tone: 'done', label: t('status.completed') }
        : entry.status === 'denied'
          ? { tone: 'attention', label: t('sessions.toolDenied') }
          : { tone: 'error', label: t('status.failed') };

  const output = entry.output;

  return (
    <Card compact style={{ gap: theme.spacing['space-2'], marginLeft: 32 + theme.spacing['space-3'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['space-2'] }}>
        <Icon name="file" size={16} color="ink-faint" />
        <Typo variant="code-sm" style={{ flex: 1 }} numberOfLines={1}>
          {entry.tool}
        </Typo>
        <StatusPill tone={pill.tone} label={pill.label} pulse={entry.status === 'running'} />
      </View>
      <Typo variant="code-sm" color="ink-muted" numberOfLines={open ? undefined : 2}>
        {open ? previewInput(entry.input) : truncate(previewInput(entry.input), MAX_INPUT)}
      </Typo>
      {output !== null && output.length > 0 ? (
        <View style={{ gap: theme.spacing['space-2'] }}>
          <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-start' }}>
            <Typo variant="label" color="mint">
              {open ? t('sessions.toolOutput.hide') : t('sessions.toolOutput.show')}
            </Typo>
          </Pressable>
          {open ? (
            <View
              style={{
                backgroundColor: theme.colors['bg-000'],
                borderRadius: theme.radii['radius-sm'],
                borderWidth: 1,
                borderColor: theme.colors.line,
                padding: theme.spacing['space-3'],
              }}
            >
              <Typo variant="code-sm" color="ink-muted">
                {truncate(output, MAX_OUTPUT)}
              </Typo>
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
