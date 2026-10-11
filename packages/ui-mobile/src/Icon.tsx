import Svg, { Path } from 'react-native-svg';
import type { ColorToken } from '@codeo/ui-tokens';
import { resolveColor, useTheme } from './theme';

/** Line icons on a 24px grid, 1.75px stroke, round caps and joins (Lucide style). */
const PATHS = {
  home: ['M4 11l8-7 8 7', 'M6 9.5V20h12V9.5'],
  ticket: ['M5 4h14v16H5z', 'M9 9h6', 'M9 13h6'],
  tasks: ['M5 5h14v14H5z', 'M8.5 12l2.5 2.5 4.5-5'],
  session: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M10 8.5v7l6-3.5z'],
  review: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  play: ['M7 4.5v15l12-7.5z'],
  plus: ['M12 5v14', 'M5 12h14'],
  shield: ['M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  chevron: ['M9 6l6 6-6 6'],
  branch: ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
} as const;

export type IconName = keyof typeof PATHS;
export const iconNames = Object.keys(PATHS) as IconName[];

export interface IconProps {
  name: IconName;
  /** 16 inline, 20 in the nav. */
  size?: number;
  /** A colour token or a raw colour (react-navigation hands over hex strings). */
  color?: ColorToken | (string & {});
  strokeWidth?: number;
}

export function Icon({ name, size = 16, color = 'ink', strokeWidth = 1.75 }: IconProps) {
  const { theme } = useTheme();
  const stroke = resolveColor(theme, color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {PATHS[name].map((d) => (
        <Path key={d} d={d} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}
