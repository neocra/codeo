import { useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ColorToken } from '@codeo/ui-tokens';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme';
import { Typo } from './Typo';

/** primary = the one mint action of a view, approve = amber, secondary = outlined, ghost = text only. */
export type ButtonVariant = 'primary' | 'approve' | 'secondary' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: IconName;
  /** Keeps the width, swaps the icon for a spinner; the label stays. */
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const PALETTE: Record<ButtonVariant, { ground: ColorToken | null; fg: ColorToken; border: ColorToken | null }> = {
  primary: { ground: 'mint', fg: 'on-mint', border: null },
  approve: { ground: 'amber', fg: 'on-amber', border: null },
  secondary: { ground: 'bg-300', fg: 'ink', border: 'line-strong' },
  ghost: { ground: null, fg: 'ink-muted', border: null },
};

export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const { theme } = useTheme();
  const palette = PALETTE[variant];
  const scale = useRef(new Animated.Value(1)).current;
  const inactive = disabled || loading;

  const pressIn = () =>
    Animated.timing(scale, {
      toValue: 0.97,
      duration: theme.durations['dur-quick'],
      easing: Easing.bezier(0.2, 0, 0, 1),
      useNativeDriver: true,
    }).start();
  const pressOut = () =>
    Animated.timing(scale, {
      toValue: 1,
      duration: theme.durations['dur-base'],
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      useNativeDriver: true,
    }).start();

  const height = size === 'sm' ? 32 : 40;
  const fg = theme.colors[palette.fg];

  return (
    <Animated.View style={[{ transform: [{ scale }], alignSelf: fullWidth ? 'stretch' : 'flex-start' }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={({ pressed }) => ({
          height,
          paddingHorizontal: size === 'sm' ? theme.spacing['space-3'] : theme.spacing['space-4'],
          borderRadius: theme.radii['radius-sm'],
          backgroundColor:
            palette.ground === null
              ? pressed
                ? theme.colors['bg-300']
                : 'transparent'
              : pressed && variant === 'secondary'
                ? theme.colors['bg-400']
                : theme.colors[palette.ground],
          borderWidth: palette.border ? 1 : 0,
          borderColor: palette.border ? theme.colors[palette.border] : 'transparent',
          opacity: disabled ? 0.45 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing['space-2'],
        })}
      >
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : icon ? (
          <View>
            <Icon name={icon} size={16} color={palette.fg} />
          </View>
        ) : null}
        <Typo variant={size === 'sm' ? 'label' : 'heading'} color={palette.fg} numberOfLines={1}>
          {label}
        </Typo>
      </Pressable>
    </Animated.View>
  );
}
