import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  question?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, question, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="cd-page-head">
      <div className="cd-page-head__text">
        <h1>{title}</h1>
        {question ? <p className="cd-page-head__question">{question}</p> : null}
        {subtitle ? <p className="cd-page-head__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="cd-page-head__actions">{actions}</div> : null}
    </header>
  );
}
