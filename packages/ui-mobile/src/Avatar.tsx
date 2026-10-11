import { View } from 'react-native';
import type { ColorToken } from '@codeo/ui-tokens';
import { useTheme } from './theme';
import { Typo } from './Typo';

export interface AvatarProps {
  /** Agents are shown as a round avatar with their initial ("C"), never a logo. */
  initial: string;
  size?: number;
  ground?: ColorToken;
  ring?: ColorToken;
}

export function Avatar({ initial, size = 32, ground = 'bg-300', ring = 'line-strong' }: AvatarProps) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radii['radius-full'],
        backgroundColor: theme.colors[ground],
        borderWidth: 1,
        borderColor: theme.colors[ring],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Typo variant={size >= 32 ? 'code' : 'code-sm'} color="ink">
        {initial.slice(0, 1).toUpperCase()}
      </Typo>
    </View>
  );
}
