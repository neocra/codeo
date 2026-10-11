import { View } from 'react-native';
import { Icon } from './Icon';
import { useTheme } from './theme';
import { Typo } from './Typo';

export interface RepoChipProps {
  /** Repo or branch name — always mono. */
  name: string;
}

export function RepoChip({ name }: RepoChipProps) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing['space-1'],
        paddingHorizontal: theme.spacing['space-2'],
        height: 24,
        borderRadius: theme.radii['radius-xs'],
        backgroundColor: theme.colors['bg-300'],
        alignSelf: 'flex-start',
      }}
    >
      <Icon name="branch" size={12} color="ink-faint" />
      <Typo variant="code-sm" color="ink-muted" numberOfLines={1}>
        {name}
      </Typo>
    </View>
  );
}
