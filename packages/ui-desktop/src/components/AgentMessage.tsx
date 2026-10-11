import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export interface AgentMessageProps {
  author: string;
  time?: string | undefined;
  children?: ReactNode;
  items?: string[] | undefined;
  /** Shows the blinking caret while text is still arriving. */
  streaming?: boolean | undefined;
  className?: string | undefined;
}

/** An agent's report in the session chat. Once arrived, it holds still. */
export function AgentMessage({ author, time, children, items = [], streaming, className }: AgentMessageProps) {
  return (
    <article className={['cd-msg', className].filter(Boolean).join(' ')}>
      <span className={['cd-avatar-wrap', streaming && 'is-active'].filter(Boolean).join(' ')}>
        <Avatar name={author} dot={false} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="cd-msg__head">
          <span className="cd-msg__author">{author}</span>
          {time ? <span className="cd-msg__time">{time}</span> : null}
        </div>
        {children != null ? (
          <p className="cd-msg__body">
            {children}
            {streaming ? <span className="cd-caret" /> : null}
          </p>
        ) : null}
        {items.length ? (
          <ul className="cd-msg__list">
            {items.map((t, i) => (
              <li key={i} className="cd-msg__item">
                <span className="cd-check">
                  <Icon name="check" size={12} strokeWidth={2.75} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
