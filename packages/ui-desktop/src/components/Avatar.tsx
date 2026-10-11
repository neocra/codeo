export interface AvatarProps {
  name: string;
  dot?: boolean;
  className?: string;
}

/** Agents are a round initial, never a logo. The orbit appears via a parent `.is-active`. */
export function Avatar({ name, dot = true, className }: AvatarProps) {
  return (
    <span className={['cd-avatar', className].filter(Boolean).join(' ')} aria-hidden>
      <span className="cd-avatar__orbit" />
      {(name || '?').charAt(0).toUpperCase()}
      {dot ? <span className="cd-avatar__dot" /> : null}
    </span>
  );
}
