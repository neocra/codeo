import type { SVGProps } from 'react';

/** Line icons from the design: 24px grid, 1.75 stroke, round caps. */
export const ICON_PATHS = {
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  branch: ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'],
  play: ['M7 4.5v15l12-7.5z'],
  plus: ['M12 5v14', 'M5 12h14'],
  shield: ['M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z'],
  home: ['M4 11l8-7 8 7', 'M6 9.5V20h12V9.5'],
  ticket: ['M5 4h14v16H5z', 'M9 9h6', 'M9 13h6'],
  tasks: ['M5 5h14v14H5z', 'M8.5 12l2.5 2.5 4.5-5'],
  session: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M10 8.5v7l6-3.5z'],
  review: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  chevron: ['M9 6l6 6-6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z'],
  stop: ['M6 6h12v12H6z'],
  send: ['M4 12l16-8-6 16-2-7z'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  folder: ['M3 6h6l2 2h10v11H3z'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 13v7H4V6h7'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  users: ['M16 19v-2a4 4 0 0 0-8 0v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M21 19v-2a4 4 0 0 0-3-3.9'],
  alert: ['M12 3l10 18H2z', 'M12 10v4', 'M12 18h.01'],
  refresh: ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v5h-5'],
  terminal: ['M4 17l6-5-6-5', 'M12 19h8'],
  cpu: ['M6 6h12v12H6z', 'M9 9h6v6H9z', 'M9 2v4', 'M15 2v4', 'M9 18v4', 'M15 18v4', 'M2 9h4', 'M2 15h4', 'M18 9h4', 'M18 15h4'],
} as const;
export type IconName = keyof typeof ICON_PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | undefined;
  strokeWidth?: number | undefined;
}

export function Icon({ name, size = 16, strokeWidth = 1.75, className, ...rest }: IconProps) {
  return (
    <svg
      className={['cd-icon', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
