import { useEffect, useState } from 'react';
import { AppShell, Banner, Button, Icon, Select, StatusPill } from '@codeo/ui-desktop';
import type { RuntimeStatus } from '../../shared/bridge-types';
import { codeo } from './lib/api';
import { useT } from './lib/i18n';
import { usePendingApprovals, useRuntimeEvents, useWorkspaces } from './lib/queries';
import { useUi, type Screen } from './lib/store';
import { HomeScreen } from './screens/Home';
import { PluginsScreen } from './screens/Plugins';
import { ReviewScreen } from './screens/Review';
import { SessionsScreen } from './screens/Sessions';
import { SettingsScreen } from './screens/Settings';
import { TasksScreen } from './screens/Tasks';
import { TicketsScreen } from './screens/Tickets';
import { WorkspacesScreen } from './screens/Workspaces';

const SCREENS: Record<Screen, () => React.JSX.Element> = {
  home: HomeScreen,
  tickets: TicketsScreen,
  tasks: TasksScreen,
  sessions: SessionsScreen,
  review: ReviewScreen,
  workspaces: WorkspacesScreen,
  plugins: PluginsScreen,
  settings: SettingsScreen,
};

export function App() {
  const t = useT();
  const { screen, navigate, workspaceId, setWorkspace, theme, calm, setTheme, setCalm, setLocale, setUserName } = useUi();
  const [runtime, setRuntime] = useState<RuntimeStatus>({ state: 'starting', info: null, error: null });
  const workspaces = useWorkspaces();
  const approvals = usePendingApprovals();
  useRuntimeEvents();

  useEffect(() => {
    void codeo.getRuntimeStatus().then(setRuntime);
    return codeo.onRuntimeStatus(setRuntime);
  }, []);
  useEffect(() => {
    void codeo.userName().then(setUserName);
    void codeo.getPreference<'dark' | 'light' | 'system'>('theme', 'dark').then(setTheme);
    void codeo.getPreference<boolean>('calm', false).then(setCalm);
    void codeo.getPreference<'fr' | 'en'>('locale', 'fr').then(setLocale);
    void codeo.getPreference<string | null>('workspaceId', null).then((id) => id && setWorkspace(id));
  }, [setCalm, setLocale, setTheme, setUserName, setWorkspace]);
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    if (calm) document.documentElement.dataset['motion'] = 'calm';
    else delete document.documentElement.dataset['motion'];
  }, [theme, calm]);
  useEffect(() => {
    const list = workspaces.data;
    if (!list?.length) return;
    if (!workspaceId || !list.some((w) => w.id === workspaceId)) setWorkspace(list[0]!.id);
  }, [workspaces.data, workspaceId, setWorkspace]);

  const connected = runtime.state === 'connected';
  const demo = runtime.info?.demoMode === true;
  const Screen = SCREENS[screen];
  const pending = approvals.data?.length ?? 0;
  const nav = [
    { id: 'home', label: t('nav.home'), icon: 'home' as const },
    { id: 'tickets', label: t('nav.tickets'), icon: 'ticket' as const },
    { id: 'tasks', label: t('nav.tasks'), icon: 'tasks' as const, ...(pending ? { badge: pending } : {}) },
    { id: 'sessions', label: t('nav.sessions'), icon: 'session' as const },
    { id: 'review', label: t('nav.review'), icon: 'review' as const },
  ];
  const secondary = [
    { id: 'workspaces', label: t('nav.workspaces'), icon: 'layers' as const },
    { id: 'plugins', label: t('nav.plugins'), icon: 'cpu' as const },
    { id: 'settings', label: t('nav.settings'), icon: 'settings' as const },
  ];

  return (
    <AppShell
      nav={nav}
      secondaryNav={secondary}
      value={screen}
      onNavigate={(id) => navigate(id as Screen)}
      mac={codeo.platform === 'darwin'}
      flush={screen === 'sessions'}
      topbar={
        <>
          <span className="cd-topbar__label">{t('workspaces.select')}</span>
          <Select
            value={workspaceId ?? ''}
            onChange={(e) => {
              setWorkspace(e.target.value || null);
              void codeo.setPreference('workspaceId', e.target.value || null);
            }}
            style={{ width: 240, height: 36 }}
            aria-label={t('workspaces.select')}
          >
            {workspaces.data?.length ? (
              workspaces.data.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))
            ) : (
              <option value="">—</option>
            )}
          </Select>
          <Button variant="ghost" size="sm" icon="plus" onClick={() => navigate('workspaces')}>
            {t('workspaces.create')}
          </Button>
          <span className="cd-topbar__spacer" />
          {demo ? <StatusPill tone="attention">{t('demo.badge')}</StatusPill> : null}
          {!connected ? (
            <span className="cd-row-gap cd-muted cd-body-sm">
              <Icon name="alert" size={14} />
              {runtime.state === 'failed' ? (runtime.error ?? t('runtime.error')) : runtime.state === 'reconnecting' ? t('runtime.disconnected') : t('runtime.connecting')}
            </span>
          ) : null}
        </>
      }
    >
      {runtime.state === 'failed' ? (
        <div style={{ padding: screen === 'sessions' ? 24 : 0, marginBottom: 16 }}>
          <Banner tone="error">{runtime.error ?? t('runtime.error')}</Banner>
        </div>
      ) : null}
      {demo ? (
        <div style={{ padding: screen === 'sessions' ? '24px 24px 0' : 0, marginBottom: 16 }}>
          <Banner tone="warn">{t('demo.banner')}</Banner>
        </div>
      ) : null}
      <Screen />
    </AppShell>
  );
}
