import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = mint (once per view) · approve = amber (approvals only) · secondary · ghost */
  variant?: 'primary' | 'approve' | 'secondary' | 'ghost' | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  icon?: IconName | undefined;
  /** Keeps the width, swaps the icon for the orbiting arc. */
  loading?: boolean | undefined;
}

export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      className={['cd-btn', `cd-btn--${variant}`, size !== 'md' && `cd-btn--${size}`, loading && 'is-loading', className].filter(Boolean).join(' ')}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
    >
      {loading ? <span className="cd-orbit" aria-hidden /> : icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}
