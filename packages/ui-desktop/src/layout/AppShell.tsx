import type { ReactNode } from 'react';
import { SideNav, type NavItem } from '../components/SideNav';

export interface AppShellProps {
  nav: NavItem[];
  secondaryNav?: NavItem[] | undefined;
  value: string;
  onNavigate: (id: string) => void;
  topbar?: ReactNode;
  children: ReactNode;
  /** Adds room for macOS traffic lights (hidden-inset title bar). */
  mac?: boolean | undefined;
  flush?: boolean | undefined;
  navLabel?: string | undefined;
}

export function AppShell({ nav, secondaryNav = [], value, onNavigate, topbar, children, mac, flush, navLabel }: AppShellProps) {
  return (
    <div className="cd-shell">
      <aside className={['cd-sidebar', mac && 'is-mac'].filter(Boolean).join(' ')}>
        <div className="cd-brand">
          <span className="cd-brand__mark" aria-hidden />
          Codeo
        </div>
        <SideNav items={nav} value={value} onChange={onNavigate} {...(navLabel ? { label: navLabel } : {})} />
        {secondaryNav.length ? (
          <div className="cd-sidebar__footer">
            <SideNav items={secondaryNav} value={value} onChange={onNavigate} label="Secondary" />
          </div>
        ) : null}
      </aside>
      <main className="cd-main">
        {topbar ? <div className="cd-topbar">{topbar}</div> : null}
        <div className={['cd-content', flush && 'cd-content--flush'].filter(Boolean).join(' ')}>{children}</div>
      </main>
    </div>
  );
}
