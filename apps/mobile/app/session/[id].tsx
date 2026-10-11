import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SessionEntry } from '@codeo/domain';
import { formatRelative } from '@codeo/i18n';
import { AgentMessage, Button, EmptyState, Icon, StatusPill, Typo, useTextStyle, useTheme } from '@codeo/ui-mobile';
import { NotConnected } from '@/components/NotConnected';
import { ResultRow } from '@/components/ResultRow';
import { Screen } from '@/components/Screen';
import { ToolCallRow } from '@/components/ToolCallRow';
import { useT } from '@/lib/i18n';
import { ACTIVE_SESSION_STATUSES, providerInitial, providerLabel, roleLabel, sessionPill } from '@/lib/presentation';
import { useCommand, useConnectedClient, useRuntime } from '@/lib/runtime';

type ThinkingEntry = Extract<SessionEntry, { kind: 'thinking' }>;

function ThinkingRow({ entry }: { entry: ThinkingEntry }) {
  const t = useT();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" style={{ marginLeft: 32 + theme.spacing['space-3'], gap: theme.spacing['space-1'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['space-1'] }}>
        <Typo variant="label" color="ink-faint">
          {t('sessions.thinking')}
        </Typo>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chevron" size={12} color="ink-faint" />
        </View>
      </View>
      {open ? (
        <Typo variant="body-sm" color="ink-faint">
          {entry.text}
        </Typo>
      ) : null}
    </Pressable>
  );
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.navigate('/sessions');
}

export default function SessionScreen() {
  const t = useT();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { state } = useRuntime();
  const getClient = useConnectedClient();
  const params = useLocalSearchParams<{ id: string }>();
  const sessionId = typeof params.id === 'string' ? params.id : '';
  const query = useCommand('sessions.get', { sessionId }, { enabled: sessionId.length > 0 });
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<SessionEntry>>(null);
  const inputStyle = useTextStyle('body');

  const send = useMutation({
    mutationFn: (text: string) => getClient().request('sessions.send', { sessionId, text }),
    onSuccess: () => setDraft(''),
  });
  const cancel = useMutation({
    mutationFn: () => getClient().request('sessions.cancel', { sessionId }),
  });

  const entries = query.data?.entries ?? [];
  const session = query.data?.session ?? null;

  useEffect(() => {
    if (entries.length > 0) listRef.current?.scrollToEnd({ animated: true });
  }, [entries.length]);

  const back = (
    <Pressable onPress={goBack} accessibilityRole="button" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['space-1'], alignSelf: 'flex-start' }}>
      <View style={{ transform: [{ scaleX: -1 }] }}>
        <Icon name="chevron" size={16} color="ink-muted" />
      </View>
      <Typo variant="label" color="ink-muted">
        {t('nav.sessions')}
      </Typo>
    </Pressable>
  );

  if (state !== 'connected') {
    return (
      <Screen title={t('sessions.title')} leading={back}>
        <NotConnected />
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen title={t('sessions.title')} leading={back}>
        <EmptyState title={t('sessions.notFound')} body={query.error.message} action={<Button variant="secondary" label={t('action.retry')} onPress={() => void query.refetch()} />} />
      </Screen>
    );
  }

  const pill = session ? sessionPill(session.status, t) : null;
  const active = session !== null && ACTIVE_SESSION_STATUSES.includes(session.status);
  const agent = session ? providerLabel(session.provider, t) : '';
  const initial = session ? providerInitial(session.provider, t) : '';
  const youInitial = t('sessions.you').slice(0, 1);

  const renderEntry = ({ item }: { item: SessionEntry }) => {
    switch (item.kind) {
      case 'user_message':
        return <AgentMessage initial={youInitial} author={t('sessions.you')} time={formatRelative(t, item.at)} text={item.text} tone="user" />;
      case 'assistant_text':
        return <AgentMessage initial={initial} author={agent} time={formatRelative(t, item.at)} text={item.text} streaming={item.streaming} />;
      case 'thinking':
        return <ThinkingRow entry={item} />;
      case 'tool_call':
        return <ToolCallRow entry={item} />;
      case 'system':
        return (
          <Typo variant="body-sm" color={item.level === 'error' ? 'coral' : item.level === 'warn' ? 'amber' : 'ink-faint'} style={{ marginLeft: 32 + theme.spacing['space-3'] }}>
            {`${t('sessions.system')} · ${item.text}`}
          </Typo>
        );
      case 'result':
        return <ResultRow entry={item} />;
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors['bg-000'] }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        scroll={false}
        leading={back}
        title={session?.title ?? t('sessions.title')}
        subtitle={session ? `${agent} · ${roleLabel(session.role, t)}` : undefined}
        trailing={pill ? <StatusPill tone={pill.tone} label={pill.label} /> : undefined}
      >
        <FlatList
          ref={listRef}
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          contentContainerStyle={{ paddingHorizontal: theme.spacing['space-5'], paddingVertical: theme.spacing['space-3'], gap: theme.spacing['space-4'] }}
          ListEmptyComponent={
            <Typo variant="body-sm" color="ink-muted">
              {query.isPending ? t('mobile.loading') : t('sessions.entries.empty')}
            </Typo>
          }
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
        />

        <View
          style={{
            paddingHorizontal: theme.spacing['space-5'],
            paddingTop: theme.spacing['space-3'],
            paddingBottom: Math.max(insets.bottom, theme.spacing['space-3']),
            backgroundColor: theme.colors['bg-100'],
            borderTopWidth: 1,
            borderTopColor: theme.colors.line,
            gap: theme.spacing['space-2'],
          }}
        >
          {send.isError ? (
            <Typo variant="body-sm" color="coral">
              {send.error.message}
            </Typo>
          ) : null}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('sessions.composer.placeholder', { agent })}
            placeholderTextColor={theme.colors['ink-faint']}
            multiline
            editable={!send.isPending}
            style={[
              inputStyle,
              {
                minHeight: 44,
                maxHeight: 120,
                paddingHorizontal: theme.spacing['space-3'],
                paddingVertical: theme.spacing['space-2'],
                borderRadius: theme.radii['radius-sm'],
                borderWidth: 1,
                borderColor: theme.colors['line-strong'],
                backgroundColor: theme.colors['bg-300'],
                textAlignVertical: 'top',
              },
            ]}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing['space-2'] }}>
            <Button
              variant="ghost"
              label={t('action.stop')}
              onPress={() => cancel.mutate()}
              loading={cancel.isPending}
              disabled={!active}
            />
            <Button
              variant="primary"
              icon="play"
              label={t('action.send')}
              onPress={() => send.mutate(draft.trim())}
              loading={send.isPending}
              disabled={draft.trim().length === 0 || session === null}
            />
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
