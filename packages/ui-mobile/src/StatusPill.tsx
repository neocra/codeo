import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import type { ColorToken } from '@codeo/ui-tokens';
import { useTheme } from './theme';
import { Typo } from './Typo';

/** mint = alive, amber = needs you, sky = queued, coral = broken, grey = nothing to say. */
export type PillTone = 'live' | 'attention' | 'waiting' | 'done' | 'error' | 'idle';

const TONES: Record<PillTone, { ground: ColorToken; fg: ColorToken }> = {
  live: { ground: 'mint-soft', fg: 'mint' },
  attention: { ground: 'amber-soft', fg: 'amber' },
  waiting: { ground: 'sky-soft', fg: 'sky' },
  done: { ground: 'bg-300', fg: 'ink-muted' },
  error: { ground: 'coral-soft', fg: 'coral' },
  idle: { ground: 'bg-300', fg: 'ink-faint' },
};

export interface StatusPillProps {
  tone: PillTone;
  /** Each pill always carries its word — colour is never the only signal. */
  label: string;
  /** Ambient breathe on the dot (rung 1). Defaults to true for `live`, off under calm mode. */
  pulse?: boolean;
}

export function StatusPill({ tone, label, pulse }: StatusPillProps) {
  const { theme, calm } = useTheme();
  const colors = TONES[tone];
  const breathing = (pulse ?? tone === 'live') && !calm;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!breathing) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: theme.durations['dur-ambient'] / 2,
          easing: Easing.bezier(0.45, 0, 0.55, 1),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: theme.durations['dur-ambient'] / 2,
          easing: Easing.bezier(0.45, 0, 0.55, 1),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathing, opacity, theme]);

  return (
    <View
      accessibilityRole="text"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing['space-2'],
        paddingHorizontal: theme.spacing['space-2'] + 2,
        height: 24,
        borderRadius: theme.radii['radius-full'],
        backgroundColor: theme.colors[colors.ground],
        alignSelf: 'flex-start',
      }}
    >
      <Animated.View
        style={{
          width: 6,
          height: 6,
          borderRadius: theme.radii['radius-full'],
          backgroundColor: theme.colors[colors.fg],
          opacity,
        }}
      />
      <Typo variant="label" color={colors.fg} numberOfLines={1}>
        {label}
      </Typo>
    </View>
  );
}
