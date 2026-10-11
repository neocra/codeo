import type { CSSProperties, ReactNode } from 'react';
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
}

const KW = /^(public|private|protected|internal|readonly|static|async|await|var|let|const|return|if|else|new|null|class|interface|using|namespace|void|string|int|bool|true|false|this|import|export|from|function|type)$/;

export function highlight(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+|.)/g;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(src))) {
    const t = m[0];
    let cls: string | null = null;
    if (m[1]) cls = 'syn-c';
    else if (m[2]) cls = 'syn-s';
    else if (m[3]) cls = 'syn-n';
    else if (m[4]) {
      if (KW.test(t)) cls = 'syn-k';
      else if (src.charAt(re.lastIndex) === '(') cls = 'syn-f';
      else if (/^[A-Z]/.test(t)) cls = 'syn-t';
    }
    out.push(cls ? <span key={k++} className={cls}>{t}</span> : t);
  }
  return out;
}

/** A file diff: still, readable, highlighted. New hunks flash once on arrival. */
export function DiffView({ file, lines, additions, deletions, className }: DiffViewProps) {
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
          return (
            <div key={i} className={`cd-line cd-line--${t}`} style={{ '--i': idx } as CSSProperties}>
              <span className="cd-line__n">{l.old ?? ''}</span>
              <span className="cd-line__n">{l.new ?? ''}</span>
              <span className="cd-line__sign">{t === 'add' ? '+' : t === 'del' ? '−' : ' '}</span>
              <span>{highlight(l.text || ' ')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
