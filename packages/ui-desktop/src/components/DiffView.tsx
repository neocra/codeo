import { Fragment, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface DiffLine {
  type?: 'add' | 'del' | 'ctx';
  old?: number;
  new?: number;
  text: string;
}
export interface DiffViewProps {
  file: string;
  lines: DiffLine[];
  additions?: number | undefined;
  deletions?: number | undefined;
  className?: string | undefined;
  /** Makes numbered lines selectable (e.g. to comment on them); hunk headers stay inert. */
  onLineSelect?: ((line: DiffLine, index: number) => void) | undefined;
  /** Accessible label of a selectable line. */
  lineSelectLabel?: string | undefined;
  /** Content shown under a line (inline comments, a composer), spanning the diff's visible width. */
  renderAfterLine?: ((index: number) => ReactNode) | undefined;
}

const KEYWORDS = new Set(
  'public private protected internal readonly static async await var let const return if else new null class interface using namespace void string int bool true false this import export from function type'.split(' '),
);
const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

/**
 * Light syntax colouring of one diff line. A single forward scan (no backtracking regex): every character is read
 * once, so a long line of agent output cannot make rendering slow. An unterminated string colours the rest of the line.
 */
export function highlight(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = '';
  let k = 0;
  const push = (text: string, cls: string | null) => {
    if (!cls) {
      plain += text;
      return;
    }
    if (plain) out.push(plain);
    plain = '';
    out.push(<span key={k++} className={cls}>{text}</span>);
  };
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === '/' && src.charAt(i + 1) === '/') {
      push(src.slice(i), 'syn-c');
      break;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src.charAt(j) !== c) j += src.charAt(j) === '\\' ? 2 : 1;
      const endAt = Math.min(j + 1, src.length);
      push(src.slice(i, endAt), 'syn-s');
      i = endAt;
      continue;
    }
    /* A number starts a word (as `\b` did): digits inside identifiers stay part of them. */
    if (isDigit(c) && !isIdentPart(src.charAt(i - 1))) {
      let j = i;
      while (isDigit(src.charAt(j))) j++;
      if (src.charAt(j) === '.' && isDigit(src.charAt(j + 1))) {
        j++;
        while (isDigit(src.charAt(j))) j++;
      }
      if (!isIdentPart(src.charAt(j))) {
        push(src.slice(i, j), 'syn-n');
        i = j;
        continue;
      }
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src.charAt(j))) j++;
      const word = src.slice(i, j);
      const cls = KEYWORDS.has(word) ? 'syn-k' : src.charAt(j) === '(' ? 'syn-f' : /^[A-Z]/.test(word) ? 'syn-t' : null;
      push(word, cls);
      i = j;
      continue;
    }
    push(c, null);
    i++;
  }
  if (plain) out.push(plain);
  return out;
}

/** A file diff: still, readable, highlighted. New hunks flash once on arrival. */
export function DiffView({ file, lines, additions, deletions, className, onLineSelect, lineSelectLabel, renderAfterLine }: DiffViewProps) {
  let add = 0;
  let del = 0;
  let changed = 0;
  for (const l of lines) {
    if (l.type === 'add') add++;
    if (l.type === 'del') del++;
  }
  return (
    <div className={['cd-diff', className].filter(Boolean).join(' ')}>
      <div className="cd-diff__file">
        <Icon name="file" size={14} />
        <span>{file}</span>
        <span className="cd-diff__stat">
          <span className="cd-diff__plus">+{additions ?? add}</span>
          <span className="cd-diff__minus">−{deletions ?? del}</span>
        </span>
      </div>
      <div className="cd-diff__body">
        {lines.map((l, i) => {
          const t = l.type ?? 'ctx';
          const idx = t === 'ctx' ? 0 : changed++;
          const selectable = Boolean(onLineSelect) && (l.old !== undefined || l.new !== undefined);
          const after = renderAfterLine?.(i);
          return (
            <Fragment key={i}>
              <div
                className={['cd-line', `cd-line--${t}`, selectable ? 'cd-line--selectable' : null].filter(Boolean).join(' ')}
                style={{ '--i': idx } as CSSProperties}
                {...(selectable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': lineSelectLabel,
                      onClick: () => onLineSelect?.(l, i),
                      onKeyDown: (e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onLineSelect?.(l, i);
                        }
                      },
                    }
                  : {})}
              >
                <span className="cd-line__n">{l.old ?? ''}</span>
                <span className="cd-line__n">{l.new ?? ''}</span>
                <span className="cd-line__sign">{t === 'add' ? '+' : t === 'del' ? '−' : ' '}</span>
                <span>{highlight(l.text || ' ')}</span>
              </div>
              {after ? <div className="cd-diff__note">{after}</div> : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
