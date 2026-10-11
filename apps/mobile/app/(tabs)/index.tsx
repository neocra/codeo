import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { formatRelative } from '@codeo/i18n';
import { Button, Card, EmptyState, ProgressBar, RepoChip, Section, StatusPill, Typo, useTheme, withAlpha } from '@codeo/ui-mobile';
import { ApprovalInboxCard } from '@/components/ApprovalInboxCard';
import { NotConnected } from '@/components/NotConnected';
import { Screen } from '@/components/Screen';
import { SessionRow } from '@/components/SessionRow';
import { useT } from '@/lib/i18n';
import { providerLabel, roleLabel, sessionPill } from '@/lib/presentation';
import { useCommand, useRuntime } from '@/lib/runtime';
import { useSettings } from '@/lib/settings';

export default function HomeScreen() {
  const t = useT();
  const { theme } = useTheme();
  const { state, info } = useRuntime();
  const name = useSettings((s) => s.name);
  const home = useCommand('home.summary', {});

  const greeting = name.length > 0 ? t('home.greeting', { name }) : t('mobile.greeting.anonymous');
  // The wave is the product's one emoji; it lives only in this greeting.
  const title = `${greeting} 👋`;

  if (state !== 'connected') {
    return (
      <Screen title={title}>
        <NotConnected />
      </Screen>
    );
  }

  const data = home.data;
  const workspace = data?.workspace ?? null;
  const subtitle = workspace ? t('home.subtitle', { workspace: workspace.name }) : t('home.subtitle.noWorkspace');

  const hero = data?.activeSessions[0] ?? null;
  const heroTask = hero && hero.taskId !== null ? (data?.activeTasks.find((task) => task.id === hero.taskId) ?? null) : null;
  const heroRepos =
    workspace === null
      ? []
      : heroTask
        ? workspace.repositories.filter((r) => heroTask.repositoryIds.includes(r.id))
        : workspace.repositories.filter((r) => r.id === hero?.repositoryId);
  const pendingApprovals = data?.pendingApprovals ?? [];
  const recentSessions = data?.recentSessions ?? [];
  const quiet = data !== undefined && hero === null && pendingApprovals.length === 0 && recentSessions.length === 0;

  return (
    <Screen
      title={title}
      subtitle={subtitle}
      trailing={<StatusPill tone="live" label={t('runtime.state.connected')} />}
      onRefresh={() => void home.refetch()}
      refreshing={home.isRefetching}
    >
      {info ? (
        <Typo variant="code-sm" color="ink-faint" numberOfLines={1}>
          {t('home.connected', { machine: info.machine.name })}
        </Typo>
      ) : null}

      {home.isPending ? (
        <Typo variant="body-sm" color="ink-muted">
          {t('mobile.loading')}
        </Typo>
      ) : null}

      {home.isError ? (
        <Card style={{ gap: theme.spacing['space-3'] }}>
          <Typo variant="body-sm" color="coral">
            {home.error.message}
          </Typo>
          <Button variant="secondary" label={t('action.retry')} onPress={() => void home.refetch()} />
        </Card>
      ) : null}

      {quiet ? <EmptyState title={t('home.empty.title')} body={t('home.empty.body')} /> : null}

      {data && !quiet ? (
        <Section kicker={t('home.activity')}>
          {hero ? (
            <Card hero border="line" style={{ gap: theme.spacing['space-4'], borderColor: withAlpha(theme.colors.mint, 0.35) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing['space-2'] }}>
                {heroTask?.ticketKey ? (
                  <Typo variant="code-sm" color="ink-faint">
                    {heroTask.ticketKey}
                  </Typo>
                ) : (
                  <View />
                )}
                <StatusPill tone={sessionPill(hero.status, t).tone} label={sessionPill(hero.status, t).label} />
              </View>
              <Typo variant="title">{heroTask?.title ?? hero.title}</Typo>
              {heroTask ? <ProgressBar value={heroTask.progress} showValue /> : null}
              <Typo variant="body-sm" color="ink-muted">
                {`${providerLabel(hero.provider, t)} · ${roleLabel(hero.role, t)} · ${t('home.startedAgo', { ago: formatRelative(t, hero.createdAt) })}`}
              </Typo>
              {heroRepos.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing['space-2'] }}>
                  {heroRepos.map((r) => (
                    <RepoChip key={r.id} name={r.name} />
                  ))}
                </View>
              ) : null}
              <Button variant="primary" icon="play" label={t('home.openSession')} onPress={() => router.push(`/session/${hero.id}`)} fullWidth />
            </Card>
          ) : (
            <Card>
              <Typo variant="body-sm" color="ink-muted">
                {t('home.noActivity')}
              </Typo>
            </Card>
          )}
        </Section>
      ) : null}

      {pendingApprovals.length > 0 ? (
        <Section
          kicker={t('home.pendingApprovals')}
          count={pendingApprovals.length}
          trailing={
            <Pressable onPress={() => router.navigate('/approvals')} accessibilityRole="link" hitSlop={8}>
              <Typo variant="label" color="mint">
                {t('home.seeAll')}
              </Typo>
            </Pressable>
          }
        >
          <View style={{ gap: theme.spacing['space-3'] }}>
            {pendingApprovals.map((approval) => (
              <ApprovalInboxCard
                key={approval.id}
                approval={approval}
                task={approval.taskId !== null ? data?.activeTasks.find((task) => task.id === approval.taskId) : undefined}
                compact
              />
            ))}
          </View>
        </Section>
      ) : null}

      {recentSessions.length > 0 ? (
        <Section
          kicker={t('home.recentSessions')}
          trailing={
            <Pressable onPress={() => router.navigate('/sessions')} accessibilityRole="link" hitSlop={8}>
              <Typo variant="label" color="mint">
                {t('home.seeAll')}
              </Typo>
            </Pressable>
          }
        >
          <View style={{ gap: theme.spacing['space-2'] }}>
            {recentSessions.map((session) => (
              <SessionRow key={session.id} session={session} onPress={() => router.push(`/session/${session.id}`)} />
            ))}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}
