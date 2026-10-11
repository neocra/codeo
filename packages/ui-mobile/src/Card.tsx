import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';
import type { ColorToken } from '@codeo/ui-tokens';
import { useTheme } from './theme';
import { Typo } from './Typo';

export interface CardProps extends ViewProps {
  /** `space-5` inside cards, `space-4` when compact. */
  compact?: boolean;
  /** `radius-lg` for the hero task card. */
  hero?: boolean;
  ground?: ColorToken;
  border?: ColorToken;
}

/** A `bg-200` surface with a 1px `line` border and `radius-md` corners. */
export function Card({ compact = false, hero = false, ground = 'bg-200', border = 'line', style, ...rest }: CardProps) {
  const { theme } = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: theme.colors[ground],
          borderColor: theme.colors[border],
          borderWidth: 1,
          borderRadius: hero ? theme.radii['radius-lg'] : theme.radii['radius-md'],
          padding: compact ? theme.spacing['space-4'] : theme.spacing['space-5'],
        },
        style,
      ]}
    />
  );
}

export interface SectionProps extends ViewProps {
  /** Kicker in capitals ("ACTIVITÉ EN COURS"). */
  kicker: string;
  /** Optional count rendered in mono next to the kicker. */
  count?: number;
  /** Right-aligned slot (e.g. a "Voir tout" link). */
  trailing?: ReactNode;
}

export function Section({ kicker, count, trailing, children, style, ...rest }: SectionProps) {
  const { theme } = useTheme();
  return (
    <View {...rest} style={[{ gap: theme.spacing['space-3'] }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['space-2'] }}>
          <Typo variant="overline" color="ink-muted">
            {kicker}
          </Typo>
          {count !== undefined ? (
            <Typo variant="code-sm" color="ink-faint" tabular>
              {count}
            </Typo>
          ) : null}
        </View>
        {trailing ?? null}
      </View>
      {children}
    </View>
  );
}

export function Divider() {
  const { theme } = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.colors.line }} />;
}

export interface EmptyStateProps {
  title: string;
  body?: string;
  action?: ReactNode;
}

/** A calm empty state: nothing moves, nothing shouts. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  const { theme } = useTheme();
  return (
    <Card style={{ alignItems: 'center', gap: theme.spacing['space-2'], paddingVertical: theme.spacing['space-8'] }}>
      <Typo variant="heading" align="center">
        {title}
      </Typo>
      {body ? (
        <Typo variant="body-sm" color="ink-muted" align="center">
          {body}
        </Typo>
      ) : null}
      {action ? <View style={{ marginTop: theme.spacing['space-3'] }}>{action}</View> : null}
    </Card>
  );
}
