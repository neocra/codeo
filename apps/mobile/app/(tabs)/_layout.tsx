import { Tabs } from 'expo-router';
import { Icon, useTheme, type IconName } from '@codeo/ui-mobile';
import { useT } from '@/lib/i18n';
import { useCommand, useRuntime } from '@/lib/runtime';

const tabIcon =
  (name: IconName) =>
  ({ color }: { color: string }) => <Icon name={name} size={20} color={color} />;

/** Bottom tab bar on `bg-100`: mint active, ink-muted inactive, five destinations. */
export default function TabsLayout() {
  const t = useT();
  const { theme, fontFamily } = useTheme();
  const { state } = useRuntime();
  const home = useCommand('home.summary', {}, { enabled: state === 'connected' });
  const pending = home.data?.pendingApprovals.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.mint,
        tabBarInactiveTintColor: theme.colors['ink-muted'],
        tabBarStyle: {
          backgroundColor: theme.colors['bg-100'],
          borderTopColor: theme.colors.line,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontFamily: fontFamily(500, false), fontSize: 11 },
        tabBarBadgeStyle: {
          backgroundColor: theme.colors.amber,
          color: theme.colors['on-amber'],
          fontFamily: fontFamily(500, true),
          fontSize: 11,
        },
        sceneStyle: { backgroundColor: theme.colors['bg-000'] },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('nav.home'), tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="tasks" options={{ title: t('nav.tasks'), tabBarIcon: tabIcon('tasks') }} />
      <Tabs.Screen name="sessions" options={{ title: t('nav.sessions'), tabBarIcon: tabIcon('session') }} />
      <Tabs.Screen
        name="approvals"
        options={{
          title: t('nav.approvals'),
          tabBarIcon: tabIcon('shield'),
          ...(pending > 0 ? { tabBarBadge: pending } : {}),
        }}
      />
      <Tabs.Screen name="more" options={{ title: t('nav.more'), tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
