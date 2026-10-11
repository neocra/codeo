import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import type { ColorToken } from '@codeo/ui-tokens';
import { useTheme } from './theme';
import { Typo } from './Typo';

export interface ProgressBarProps {
  /** 0–100. The fill width transitions over `dur-slow`; numbers tick, they don't jump. */
  value: number;
  tone?: 'mint' | 'amber' | 'sky';
  /** Show the percentage in `code-sm` with tabular numerals. */
  showValue?: boolean;
  height?: number;
}

export function ProgressBar({ value, tone = 'mint', showValue = false, height = 6 }: ProgressBarProps) {
  const { theme } = useTheme();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const anim = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamped,
      duration: theme.durations['dur-slow'],
      easing: Easing.bezier(0.2, 0, 0, 1),
      useNativeDriver: false,
    }).start();
  }, [anim, clamped, theme]);

  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  const fill: ColorToken = tone;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['space-3'] }}>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
        style={{
          flex: 1,
          height,
          borderRadius: theme.radii['radius-full'],
          backgroundColor: theme.colors['bg-300'],
          overflow: 'hidden',
        }}
      >
        <Animated.View style={{ height, width, borderRadius: theme.radii['radius-full'], backgroundColor: theme.colors[fill] }} />
      </View>
      {showValue ? (
        <Typo variant="code-sm" color="ink-muted" tabular style={{ minWidth: 36, textAlign: 'right' }}>
          {`${Math.round(clamped)}%`}
        </Typo>
      ) : null}
    </View>
  );
}
