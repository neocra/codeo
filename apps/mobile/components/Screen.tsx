import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typo, useTheme } from '@codeo/ui-mobile';

export interface ScreenProps {
  /** One `display` per screen. */
  title: string;
  subtitle?: string | undefined;
  /** Right-aligned header slot (a pill, a button). */
  trailing?: ReactNode;
  /** Rendered above the title (e.g. a back control on pushed screens). */
  leading?: ReactNode;
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean;
  /** Scroll by default; `false` for screens that own a FlatList. */
  scroll?: boolean;
  children: ReactNode;
}

/** Page on `bg-000`, safe-area aware, `space-5` gutter, `space-6` between cards. */
export function Screen({ title, subtitle, trailing, leading, onRefresh, refreshing = false, scroll = true, children }: ScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const header = (
    <View style={{ gap: theme.spacing['space-2'] }}>
      {leading}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing['space-3'] }}>
        <Typo variant="display" style={{ flex: 1 }}>
          {title}
        </Typo>
        {trailing ? <View style={{ paddingTop: theme.spacing['space-2'] }}>{trailing}</View> : null}
      </View>
      {subtitle ? (
        <Typo variant="body-sm" color="ink-muted">
          {subtitle}
        </Typo>
      ) : null}
    </View>
  );

  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg-000'], paddingTop: insets.top + theme.spacing['space-3'] }}>
        <View style={{ paddingHorizontal: theme.spacing['space-5'], paddingBottom: theme.spacing['space-3'] }}>{header}</View>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors['bg-000'] }}
      contentContainerStyle={{
        paddingTop: insets.top + theme.spacing['space-3'],
        paddingHorizontal: theme.spacing['space-5'],
        paddingBottom: theme.spacing['space-8'],
        gap: theme.spacing['space-6'],
      }}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.mint} colors={[theme.colors.mint]} /> : undefined
      }
    >
      {header}
      {children}
    </ScrollView>
  );
}
