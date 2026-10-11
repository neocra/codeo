import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from './theme';
import { Typo } from './Typo';

export interface FilterOption<Id extends string> {
  id: Id;
  label: string;
  count?: number;
}

export interface FilterPillsProps<Id extends string> {
  options: readonly FilterOption<Id>[];
  value: Id;
  onChange: (id: Id) => void;
}

/** Horizontal filter pills ("Toutes · Actives · En attente · Terminées"). */
export function FilterPills<Id extends string>({ options, value, onChange }: FilterPillsProps<Id>) {
  const { theme } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing['space-2'] }}>
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing['space-1'],
              paddingHorizontal: theme.spacing['space-3'],
              height: 32,
              borderRadius: theme.radii['radius-full'],
              backgroundColor: selected ? theme.colors['mint-soft'] : pressed ? theme.colors['bg-400'] : theme.colors['bg-300'],
              borderWidth: 1,
              borderColor: selected ? theme.colors.mint : theme.colors.line,
            })}
          >
            <Typo variant="label" color={selected ? 'mint' : 'ink-muted'}>
              {o.label}
            </Typo>
            {o.count !== undefined ? (
              <View>
                <Typo variant="code-sm" color={selected ? 'mint' : 'ink-faint'} tabular>
                  {o.count}
                </Typo>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
